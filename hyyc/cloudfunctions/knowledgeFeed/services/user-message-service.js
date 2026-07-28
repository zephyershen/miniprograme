const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const { mapWithConcurrency } = require('../repositories/collection-support');

const RETRY_DELAYS_MS = Object.freeze([
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000
]);

function retryDelay(attemptCount) {
  const index = Math.max(0, Math.min(
    RETRY_DELAYS_MS.length - 1,
    (Number(attemptCount) || 1) - 1
  ));
  return RETRY_DELAYS_MS[index];
}

function isoDate(value) {
  const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function rejectionReason(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 120)
    : '内容不符合社区发布规范';
}

function messageView(message) {
  return {
    id: message && (message._id || message.id),
    type: message && message.type || 'system',
    category: message && message.category || 'system',
    title: message && message.title || '系统消息',
    body: message && message.body || '',
    itemId: message && message.itemId || '',
    itemTitle: message && message.itemTitle || '',
    itemThumbnailFileId: message && message.itemThumbnailFileId || '',
    commentId: message && message.commentId || '',
    parentCommentId: message && message.parentCommentId || '',
    replyToCommentId: message && message.replyToCommentId || '',
    commentPreview: message && message.commentPreview || '',
    replyToPreview: message && message.replyToPreview || '',
    rootCommentPreview: message && message.rootCommentPreview || '',
    actorNickname: message && message.actorNickname || '',
    actorAvatarFileId: message && message.actorAvatarFileId || '',
    version: message && message.sourceEventId || '',
    openComments: Boolean(message && message.itemId
      && ['comment_approved', 'comment_rejected', 'comment_review_failed', 'comment_received']
        .includes(message.type)),
    unread: Boolean(message && message.unread),
    createdAt: isoDate(message && message.createdAt),
    updatedAt: isoDate(message && message.updatedAt)
  };
}

function directMessage(event) {
  const itemBody = event.itemTitle
    ? `《${String(event.itemTitle).slice(0, 48)}》`
    : '这条资讯';
  const values = {
    membership_succeeded: {
      type: 'membership_succeeded',
      category: 'membership',
      title: 'Pro 会员已开通',
      body: '会员已绑定当前微信账号，可立即使用全部 Pro 权益。'
    },
    profile_approved: {
      type: 'profile_approved',
      category: 'profile',
      title: '头像和昵称设置成功',
      body: '新资料已通过审核并开始展示。'
    },
    profile_rejected: {
      type: 'profile_rejected',
      category: 'profile',
      title: '头像或昵称未通过审核',
      body: '请调整头像或昵称后重新提交。'
    },
    profile_review_failed: {
      type: 'profile_review_failed',
      category: 'profile',
      title: '资料审核未完成',
      body: '审核服务暂时不可用，请重新提交资料。'
    },
    comment_approved: {
      type: 'comment_approved',
      category: 'comments',
      title: '评论已通过审核',
      body: `${itemBody}下的评论已经公开。`,
      itemId: event.itemId
    },
    comment_rejected: {
      type: 'comment_rejected',
      category: 'comments',
      title: '评论未通过审核',
      body: `未通过原因：${rejectionReason(event.rejectionReason)}。该评论未公开，评论文字及待审图片已删除。`,
      itemId: event.itemId
    },
    comment_review_failed: {
      type: 'comment_review_failed',
      category: 'comments',
      title: '评论审核未完成',
      body: '审核服务暂时不可用，该评论未公开，请稍后重新发布。',
      itemId: event.itemId
    }
  };
  return values[event.type] || null;
}

function messageListOptions(event) {
  return {
    includeComments: !(event && event.includeComments === false)
  };
}

function createUserMessageService({
  repository,
  profileRepository = null,
  config,
  logger = { warn: () => {} },
  now = () => Date.now(),
  createId = () => crypto.randomBytes(16).toString('hex')
}) {
  const batchSize = Number(config.messageEventBatchSize) || 12;
  const concurrency = Number(config.messageEventConcurrency) || 3;
  const leaseMs = Number(config.messageEventLeaseMs) || (2 * 60 * 1000);
  const maxAttempts = Number(config.messageEventMaxAttempts) || 8;

  async function processCandidate(candidate) {
    const claimedAt = new Date(now());
    const claimId = createId();
    const event = await repository.claimEvent(
      candidate._id,
      claimedAt,
      claimId,
      new Date(claimedAt.getTime() + leaseMs)
    );
    if (!event) return { status: 'skipped' };
    try {
      const actorProfile = event.type === 'comment_approved'
        && profileRepository
        && typeof profileRepository.get === 'function'
        ? await profileRepository.get(event.ownerKey)
        : null;
      const deliveryEvent = actorProfile
        ? {
            ...event,
            actorNickname: actorProfile.nickname || '读者',
            actorAvatarFileId: actorProfile.avatarFileId || ''
          }
        : event;
      const message = directMessage(deliveryEvent);
      if (message && event.ownerKey) {
        await repository.upsertDirectMessage(
          event.ownerKey,
          deliveryEvent,
          message,
          new Date(now())
        );
      }
      if (event.type === 'comment_approved' && event.itemId) {
        const enrichedEvent = {
          ...deliveryEvent,
          actorNickname: deliveryEvent.actorNickname || '读者',
          actorAvatarFileId: deliveryEvent.actorAvatarFileId || ''
        };
        const directReplyOwners = event.replyToCommentId
          ? [event.replyToOwnerKey, event.threadOwnerKey]
              .filter((ownerKey) => ownerKey && ownerKey !== event.ownerKey)
          : [];
        const owners = directReplyOwners.length
          ? [...new Set(directReplyOwners)]
          : await repository.participantOwnerKeys(
            event.itemId,
            event.ownerKey,
            config.messageParticipantLimit,
            event.createdAt
          );
        await repository.upsertCommentThreadMessages(
          owners,
          enrichedEvent,
          new Date(now())
        );
      }
      const completedAt = new Date(now());
      const completed = await repository.markEventDone(event._id, claimId, {
        status: 'completed',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: null,
        completedAt,
        updatedAt: completedAt
      });
      return { status: completed ? 'completed' : 'stale' };
    } catch (error) {
      const failed = (Number(event.attemptCount) || 0) >= maxAttempts;
      const updatedAt = new Date(now());
      const transitioned = await repository.markEventRetry(event._id, claimId, {
        status: failed ? 'failed' : 'retry',
        failureCode: 'DELIVERY_UNAVAILABLE',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: failed ? null : new Date(now() + retryDelay(event.attemptCount)),
        ...(failed ? { completedAt: updatedAt } : {}),
        updatedAt
      });
      logger.warn('User message delivery deferred', {
        code: error && error.code || 'UNKNOWN'
      });
      return { status: transitioned ? (failed ? 'failed' : 'retry') : 'stale' };
    }
  }

  async function processDue() {
    const dueAt = new Date(now());
    const [due, stale] = await Promise.all([
      repository.listDueEvents(dueAt, batchSize),
      repository.listStaleEvents(dueAt, batchSize)
    ]);
    const candidates = [...new Map([...stale, ...due]
      .filter((event) => event && event._id)
      .map((event) => [event._id, event])).values()]
      .slice(0, batchSize);
    const results = await mapWithConcurrency(candidates, concurrency, processCandidate);
    return results.reduce((summary, result) => {
      const status = result && result.status || 'skipped';
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, { scanned: candidates.length });
  }

  async function list(actor, { includeComments = true } = {}) {
    if (includeComments === false) {
      const messages = await repository.listOwnerMessages(
        actor.ownerKey,
        config.userMessagePageSize,
        { excludeCategories: ['comments'] }
      );
      return {
        messages: messages.map(messageView),
        unreadCount: messages.filter((message) => message && message.unread).length
      };
    }
    const [messages, unreadCount] = await Promise.all([
      repository.listOwnerMessages(actor.ownerKey, config.userMessagePageSize),
      repository.unreadCount(actor.ownerKey)
    ]);
    return { messages: messages.map(messageView), unreadCount };
  }

  async function markRead(messageId, messageVersion, actor, options) {
    await repository.markRead(
      actor.ownerKey,
      messageId,
      typeof messageVersion === 'string' ? messageVersion : '',
      new Date(now())
    );
    return list(actor, options);
  }

  async function deleteMessage(messageId, actor, options) {
    await repository.deleteMessage(actor.ownerKey, messageId);
    return list(actor, options);
  }

  async function markAllRead(actor, options) {
    if (options && options.includeComments === false) {
      throw new AppError('COMMENTS_PAUSED', '当前版本不支持全部已读');
    }
    await repository.markAllRead(actor.ownerKey, new Date(now()));
    return list(actor, options);
  }

  return { processDue, list, markRead, deleteMessage, markAllRead };
}

module.exports = {
  retryDelay,
  messageView,
  directMessage,
  messageListOptions,
  createUserMessageService
};
