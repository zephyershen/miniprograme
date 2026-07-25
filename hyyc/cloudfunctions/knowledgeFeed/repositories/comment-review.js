const { AppError } = require('../lib/errors');
const { storedDocumentId } = require('../lib/stored-feed-item');
const { messageEventDocument, writableDocument } = require('../lib/message-event');
const { engagementDocumentId } = require('./feed-engagement');
const {
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');
const { runBusyTransaction } = require('./transaction-support');

const DEFAULT_COMMENT_SUBMISSION_COOLDOWN_MS = 30 * 1000;
const DEFAULT_COMMENT_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMMENT_SUBMISSION_WINDOW_LIMIT = 30;

function timestamp(value) {
  const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function assertOwnerKey(ownerKey) {
  if (!/^[a-f0-9]{64}$/.test(ownerKey || '')) throw new Error('COMMENT_OWNER_INVALID');
  return ownerKey;
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commentSubmissionPolicy(config = {}) {
  return {
    cooldownMs: positiveInteger(
      config.commentSubmissionCooldownMs,
      DEFAULT_COMMENT_SUBMISSION_COOLDOWN_MS
    ),
    windowMs: positiveInteger(
      config.commentSubmissionWindowMs,
      DEFAULT_COMMENT_SUBMISSION_WINDOW_MS
    ),
    windowLimit: positiveInteger(
      config.commentSubmissionWindowLimit,
      DEFAULT_COMMENT_SUBMISSION_WINDOW_LIMIT
    )
  };
}

function recentCommentSubmissionTimes(engagement, submittedAt, windowMs) {
  const submittedAtMs = timestamp(submittedAt);
  const cutoff = submittedAtMs - windowMs;
  const values = Array.isArray(engagement && engagement.commentSubmissionTimes)
    ? engagement.commentSubmissionTimes
    : [];
  const lastSubmittedAtMs = timestamp(engagement && engagement.lastCommentSubmittedAt);
  return [...new Set([
    ...values.map(timestamp),
    lastSubmittedAtMs
  ])]
    .filter((value) => value > cutoff && value <= submittedAtMs)
    .sort((left, right) => left - right);
}

function nextCommentSubmissionState(engagement, submittedAt, policy) {
  const submittedAtMs = timestamp(submittedAt);
  const recentTimes = recentCommentSubmissionTimes(
    engagement,
    submittedAt,
    policy.windowMs
  );
  const lastSubmittedAtMs = recentTimes[recentTimes.length - 1] || 0;
  if (lastSubmittedAtMs && submittedAtMs - lastSubmittedAtMs < policy.cooldownMs) {
    throw new AppError('RATE_LIMITED', '评论发送太快，请稍后再试');
  }
  if (recentTimes.length >= policy.windowLimit) {
    throw new AppError(
      'RATE_LIMITED',
      '你在这条资讯下 24 小时内的评论次数已达上限，请稍后再试'
    );
  }
  return {
    lastCommentSubmittedAt: submittedAt,
    commentSubmissionTimes: [
      ...recentTimes.map((value) => new Date(value)),
      submittedAt
    ]
  };
}

async function documentOrNull(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createCommentReviewRepository(db, config) {
  const commentsCollectionName = config.commentsCollectionName;
  const itemsCollectionName = config.itemsCollectionName;
  const eventsCollectionName = config.messageEventsCollectionName;
  const engagementsCollectionName = config.userEngagementsCollectionName;
  const comments = () => db.collection(commentsCollectionName);
  const ensureComments = createCollectionEnsurer(db, commentsCollectionName);
  const ensureItems = config.ensureItems || createCollectionEnsurer(db, itemsCollectionName);
  const ensureEvents = createCollectionEnsurer(db, eventsCollectionName);
  const ensureEngagements = createCollectionEnsurer(db, engagementsCollectionName);
  const submissionPolicy = commentSubmissionPolicy(config);

  async function get(commentId, itemId) {
    await ensureComments();
    const comment = await documentOrNull(comments().doc(commentId));
    if (!comment || comment.itemId !== itemId) return null;
    return comment;
  }

  async function enqueue(ownerKey, itemId, commentId, input, createdAt) {
    await Promise.all([ensureComments(), ensureItems(), ensureEngagements()]);
    return runBusyTransaction(db, async (transaction) => {
      const commentReference = transaction.collection(commentsCollectionName).doc(commentId);
      const existing = await documentOrNull(commentReference);
      const itemReference = transaction.collection(itemsCollectionName)
        .doc(storedDocumentId(config.provider, itemId));
      const item = await documentOrNull(itemReference);
      if (existing) {
        return { comment: { _id: commentId, ...existing }, commentCount: count(item && item.commentCount) };
      }
      if (!item || item.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      const safeOwnerKey = assertOwnerKey(ownerKey);
      const engagementReference = transaction.collection(engagementsCollectionName)
        .doc(engagementDocumentId(safeOwnerKey, itemId));
      const engagement = await documentOrNull(engagementReference);
      const submissionState = nextCommentSubmissionState(
        engagement,
        createdAt,
        submissionPolicy
      );
      const comment = {
        _id: commentId,
        itemId,
        authorKey: safeOwnerKey,
        content: input.content,
        attachments: input.attachments,
        reviewAttachments: input.reviewAttachments,
        parentCommentId: input.parentCommentId || '',
        replyToCommentId: input.replyToCommentId || '',
        replyToOwnerKey: input.replyToOwnerKey || '',
        threadOwnerKey: input.threadOwnerKey || '',
        replyToNickname: input.replyToNickname || '',
        replyToPreview: input.replyToPreview || '',
        rootCommentPreview: input.rootCommentPreview || '',
        reviewRevision: input.reviewRevision,
        reviewState: 'pending',
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: createdAt,
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        moderation: { status: 'pending' },
        createdAt,
        updatedAt: createdAt
      };
      await commentReference.set({ data: writableDocument(comment) });
      await engagementReference.set({
        data: {
          ...writableDocument(engagement),
          ownerKey: safeOwnerKey,
          itemId,
          ...submissionState,
          createdAt: engagement && engagement.createdAt || createdAt,
          updatedAt: createdAt
        }
      });
      return { comment, commentCount: count(item.commentCount) };
    });
  }

  async function listDue(dueAt, limit = config.commentReviewBatchSize) {
    await ensureComments();
    const size = Math.max(1, Math.min(30, Number(limit) || 8));
    const response = await comments()
      .where({
        reviewState: db.command.in(['pending', 'retry']),
        nextAttemptAt: db.command.lte(dueAt)
      })
      .orderBy('nextAttemptAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function listStaleClaims(dueAt, limit = config.commentReviewBatchSize) {
    await ensureComments();
    const size = Math.max(1, Math.min(30, Number(limit) || 8));
    const response = await comments()
      .where({
        reviewState: 'processing',
        claimExpiresAt: db.command.lte(dueAt)
      })
      .orderBy('claimExpiresAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function claim(commentId, revision, claimedAt, claimId, claimExpiresAt) {
    await ensureComments();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(commentsCollectionName).doc(commentId);
      const current = await documentOrNull(reference);
      if (!current || current.reviewRevision !== revision || current.status !== 'pending') return null;
      const due = ['pending', 'retry'].includes(current.reviewState)
        && timestamp(current.nextAttemptAt) <= timestamp(claimedAt);
      const stale = current.reviewState === 'processing'
        && timestamp(current.claimExpiresAt) <= timestamp(claimedAt);
      if (!due && !stale) return null;
      const patch = {
        reviewState: 'processing',
        attemptCount: (Number(current.attemptCount) || 0) + 1,
        claimId,
        claimedAt,
        claimExpiresAt,
        updatedAt: claimedAt
      };
      await reference.update({ data: patch });
      return { _id: commentId, ...current, ...patch };
    });
  }

  async function transitionClaimed(commentId, revision, claimId, patch) {
    await ensureComments();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(commentsCollectionName).doc(commentId);
      const current = await documentOrNull(reference);
      if (!current
        || current.reviewRevision !== revision
        || current.reviewState !== 'processing'
        || current.claimId !== claimId) return null;
      await reference.update({ data: patch });
      return { _id: commentId, ...current, ...patch };
    });
  }

  async function approve(commentId, revision, claimId, input, completedAt) {
    await Promise.all([ensureComments(), ensureItems(), ensureEvents()]);
    return runBusyTransaction(db, async (transaction) => {
      const commentReference = transaction.collection(commentsCollectionName).doc(commentId);
      const current = await documentOrNull(commentReference);
      if (!current
        || current.reviewRevision !== revision
        || current.reviewState !== 'processing'
        || current.claimId !== claimId
        || current.status !== 'pending') return null;
      const itemReference = transaction.collection(itemsCollectionName)
        .doc(storedDocumentId(config.provider, current.itemId));
      const item = await documentOrNull(itemReference);
      if (!item || item.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      const commentCount = count(item.commentCount) + 1;
      const patch = {
        attachments: input.attachments,
        reviewAttachments: [],
        moderation: input.moderation,
        reviewState: 'approved',
        status: 'active',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: null,
        completedAt,
        updatedAt: completedAt
      };
      const event = messageEventDocument('comment_approved', commentId, {
        ownerKey: current.authorKey,
        itemId: current.itemId,
        itemTitle: item.title || '',
        itemThumbnailFileId: item.listVisualFileId || item.visualFileId || '',
        commentId,
        commentPreview: current.content || (
          Array.isArray(current.attachments) && current.attachments.length ? '[图片]' : ''
        ),
        parentCommentId: current.parentCommentId || '',
        replyToCommentId: current.replyToCommentId || '',
        replyToOwnerKey: current.replyToOwnerKey || '',
        threadOwnerKey: current.threadOwnerKey || '',
        replyToPreview: current.replyToPreview || '',
        rootCommentPreview: current.rootCommentPreview || ''
      }, completedAt);
      await commentReference.update({ data: patch });
      await itemReference.update({
        data: { commentCount, engagementUpdatedAt: completedAt }
      });
      await transaction.collection(eventsCollectionName).doc(event._id)
        .set({ data: writableDocument(event) });
      return { comment: { _id: commentId, ...current, ...patch }, commentCount };
    });
  }

  async function reject(commentId, revision, claimId, input, completedAt) {
    await Promise.all([ensureComments(), ensureEvents()]);
    return runBusyTransaction(db, async (transaction) => {
      const commentReference = transaction.collection(commentsCollectionName).doc(commentId);
      const current = await documentOrNull(commentReference);
      if (!current
        || current.reviewRevision !== revision
        || current.reviewState !== 'processing'
        || current.claimId !== claimId
        || current.status !== 'pending') return null;
      const patch = {
        content: '',
        attachments: [],
        reviewAttachments: [],
        moderation: input.moderation || { status: 'rejected' },
        reviewState: input.reviewState || 'rejected',
        failureCode: input.failureCode || 'CONTENT_REJECTED',
        status: 'rejected',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: null,
        completedAt,
        updatedAt: completedAt
      };
      const rejectionReason = typeof input.rejectionReason === 'string'
        ? input.rejectionReason.trim().slice(0, 120)
        : '';
      if (rejectionReason) patch.rejectionReason = rejectionReason;
      const eventType = patch.reviewState === 'failed'
        ? 'comment_review_failed'
        : 'comment_rejected';
      const event = messageEventDocument(eventType, commentId, {
        ownerKey: current.authorKey,
        itemId: current.itemId,
        commentId,
        rejectionReason
      }, completedAt);
      await commentReference.update({ data: patch });
      await transaction.collection(eventsCollectionName).doc(event._id)
        .set({ data: writableDocument(event) });
      return { _id: commentId, ...current, ...patch };
    });
  }

  return {
    get,
    enqueue,
    listDue,
    listStaleClaims,
    claim,
    approve,
    reject,
    markRetry: transitionClaimed
  };
}

module.exports = { createCommentReviewRepository };
