const test = require('node:test');
const assert = require('node:assert/strict');

const {
  messageEventDocument,
  messageEventId
} = require('../cloudfunctions/knowledgeFeed/lib/message-event');
const {
  createCommentReviewService
} = require('../cloudfunctions/knowledgeFeed/services/comment-review-service');
const {
  createUserMessageService,
  directMessage,
  messageListOptions
} = require('../cloudfunctions/knowledgeFeed/services/user-message-service');
const {
  createScheduledWorkService
} = require('../cloudfunctions/knowledgeFeed/services/scheduled-work-service');

const OWNER = 'a'.repeat(64);
const PARTICIPANT_A = 'b'.repeat(64);
const PARTICIPANT_B = 'c'.repeat(64);
const NOW = Date.parse('2026-07-24T08:00:00.000Z');

function commentCandidate(overrides = {}) {
  return {
    _id: 'comment_async_1',
    itemId: 'item_async_1',
    itemTitle: '异步审核测试',
    authorKey: OWNER,
    content: '这是一条有用的评论',
    attachments: [],
    reviewAttachments: [],
    reviewRevision: 'mutation_async_1',
    reviewState: 'pending',
    status: 'pending',
    attemptCount: 0,
    ...overrides
  };
}

function commentRepository(candidate, overrides = {}) {
  return {
    listDue: async () => [candidate],
    listStaleClaims: async () => [],
    claim: async () => ({ ...candidate, reviewState: 'processing', attemptCount: 1 }),
    approve: async () => ({ comment: candidate, commentCount: 1 }),
    reject: async () => candidate,
    markRetry: async () => candidate,
    ...overrides
  };
}

function mediaService(overrides = {}) {
  return {
    publishOwned: async () => [],
    bindPublished: async () => null,
    discardUnpublished: async () => null,
    deleteOwned: async () => null,
    holdForReview: async () => null,
    ...overrides
  };
}

test('approves a queued comment in the background before making it public', async () => {
  const candidate = commentCandidate();
  let moderationInput = null;
  let approval = null;
  const service = createCommentReviewService({
    repository: commentRepository(candidate, {
      approve: async (...args) => {
        approval = args;
        return { comment: candidate, commentCount: 1 };
      }
    }),
    moderationService: {
      review: async (input) => {
        moderationInput = input;
        return { status: 'approved', verdict: 'allow', confidence: 1 };
      }
    },
    userMediaService: mediaService(),
    config: {},
    now: () => NOW,
    createId: () => 'claim-approve'
  });

  const summary = await service.processDue();

  assert.deepEqual(summary, { scanned: 1, approved: 1 });
  assert.deepEqual(moderationInput, {
    content: candidate.content,
    attachments: candidate.reviewAttachments
  });
  assert.equal(approval[0], candidate._id);
  assert.equal(approval[1], candidate.reviewRevision);
  assert.equal(approval[2], 'claim-approve');
  assert.deepEqual(approval[3].attachments, []);
  assert.equal(approval[3].moderation.status, 'approved');
});

test('rejects unsafe queued content and removes its unpublished media', async () => {
  const candidate = commentCandidate({
    attachments: [{ type: 'image', fileId: 'cloud://env/user-media/staging/comment.jpg' }],
    reviewAttachments: [{ type: 'image', fileId: 'cloud://env/user-media/review/comment.jpg' }]
  });
  let rejection = null;
  let discarded = null;
  const service = createCommentReviewService({
    repository: commentRepository(candidate, {
      reject: async (...args) => {
        rejection = args;
        return candidate;
      }
    }),
    moderationService: {
      review: async () => {
        const error = new Error('unsafe');
        error.code = 'CONTENT_REJECTED';
        error.rejectionReason = '包含广告推广、带货或交易招揽信息';
        error.moderation = {
          status: 'rejected',
          verdict: 'reject',
          confidence: 0.99,
          categories: ['advertising'],
          reason: '检测到广告推广'
        };
        throw error;
      }
    },
    userMediaService: mediaService({
      publishOwned: async () => {
        throw new Error('unsafe media must not be published');
      },
      discardUnpublished: async (actor, kind, fileIds) => {
        discarded = { actor, kind, fileIds };
      }
    }),
    config: {},
    now: () => NOW,
    createId: () => 'claim-reject'
  });

  const summary = await service.processDue();

  assert.deepEqual(summary, { scanned: 1, rejected: 1 });
  assert.equal(rejection[2], 'claim-reject');
  assert.deepEqual(rejection[3], {
    failureCode: 'CONTENT_REJECTED',
    reviewState: 'rejected',
    moderation: {
      status: 'rejected',
      verdict: 'reject',
      confidence: 0.99,
      categories: ['advertising'],
      reason: '检测到广告推广'
    },
    rejectionReason: '包含广告推广、带货或交易招揽信息'
  });
  assert.deepEqual(discarded, {
    actor: { ownerKey: OWNER },
    kind: 'comment',
    fileIds: [candidate.attachments[0].fileId]
  });
});

test('explains a rejected comment with a controlled reason and deletion result', () => {
  const event = messageEventDocument(
    'comment_rejected',
    'comment-rejected-1',
    {
      ownerKey: OWNER,
      itemId: 'item_async_1',
      rejectionReason: '包含链接、域名、小程序链接或二维码链接'
    },
    new Date(NOW)
  );
  const message = directMessage(event);

  assert.equal(event.rejectionReason, '包含链接、域名、小程序链接或二维码链接');
  assert.match(message.body, /未通过原因：包含链接、域名、小程序链接或二维码链接/);
  assert.match(message.body, /评论文字及待审图片已删除/);
});

test('retries a temporary review failure and extends the media hold', async () => {
  const candidate = commentCandidate({
    attachments: [{ type: 'image', fileId: 'cloud://env/user-media/staging/retry.jpg' }]
  });
  let retryPatch = null;
  let held = null;
  const service = createCommentReviewService({
    repository: commentRepository(candidate, {
      markRetry: async (commentId, revision, claimId, patch) => {
        retryPatch = { commentId, revision, claimId, patch };
        return candidate;
      }
    }),
    moderationService: {
      review: async () => {
        const error = new Error('temporary');
        error.code = 'TEMPORARY_FAILURE';
        throw error;
      }
    },
    userMediaService: mediaService({
      holdForReview: async (actor, kind, fileIds, ttlMs) => {
        held = { actor, kind, fileIds, ttlMs };
      }
    }),
    config: { commentReviewMediaTtlMs: 900000 },
    now: () => NOW,
    createId: () => 'claim-retry'
  });

  const summary = await service.processDue();

  assert.deepEqual(summary, { scanned: 1, retry: 1 });
  assert.equal(retryPatch.claimId, 'claim-retry');
  assert.equal(retryPatch.patch.reviewState, 'retry');
  assert.equal(retryPatch.patch.nextAttemptAt.toISOString(), '2026-07-24T08:01:00.000Z');
  assert.deepEqual(held, {
    actor: { ownerKey: OWNER },
    kind: 'comment',
    fileIds: [candidate.attachments[0].fileId],
    ttlMs: 900000
  });
});

test('does not delete deterministic published media when a stale worker loses the claim', async () => {
  const candidate = commentCandidate({
    attachments: [{ type: 'image', fileId: 'cloud://env/user-media/staging/race.jpg' }]
  });
  let deleteCalls = 0;
  let publishOptions = null;
  const service = createCommentReviewService({
    repository: commentRepository(candidate, {
      approve: async () => null
    }),
    moderationService: {
      review: async () => ({ status: 'approved', verdict: 'allow', confidence: 1 })
    },
    userMediaService: mediaService({
      publishOwned: async (actor, kind, fileIds, reference, options) => {
        publishOptions = options;
        return ['cloud://env/user-media/published/comments/race.jpg'];
      },
      deleteOwned: async () => {
        deleteCalls += 1;
      }
    }),
    config: {},
    now: () => NOW,
    createId: () => 'claim-stale'
  });

  const summary = await service.processDue();

  assert.deepEqual(summary, { scanned: 1, stale: 1 });
  assert.equal(deleteCalls, 0);
  assert.deepEqual(publishOptions, { keepPrivateCopies: true });
});

test('delivers one approved-comment result and notifies prior participants once', async () => {
  const event = {
    ...messageEventDocument('comment_approved', 'comment_async_1', {
      ownerKey: OWNER,
      itemId: 'item_async_1',
      itemTitle: '测试资讯',
      commentId: 'comment_async_1'
    }, new Date(NOW)),
    _id: messageEventId('comment_approved', 'comment_async_1')
  };
  const direct = [];
  const threadRecipients = [];
  let completed = null;
  const repository = {
    listDueEvents: async () => [event],
    listStaleEvents: async () => [],
    claimEvent: async (eventId, claimedAt, claimId, claimExpiresAt) => ({
      ...event,
      attemptCount: 1,
      status: 'processing',
      claimId,
      claimedAt,
      claimExpiresAt
    }),
    participantOwnerKeys: async () => [PARTICIPANT_A, PARTICIPANT_B],
    upsertDirectMessage: async (ownerKey, source, message) => {
      direct.push({ ownerKey, source, message });
    },
    upsertCommentThreadMessages: async (ownerKeys) => {
      threadRecipients.push(...ownerKeys);
    },
    markEventDone: async (eventId, claimId, patch) => {
      completed = { eventId, claimId, patch };
      return event;
    },
    markEventRetry: async () => {
      throw new Error('delivery should not retry');
    }
  };
  const service = createUserMessageService({
    repository,
    config: {},
    now: () => NOW,
    createId: () => 'message-claim'
  });

  const summary = await service.processDue();

  assert.deepEqual(summary, { scanned: 1, completed: 1 });
  assert.equal(direct.length, 1);
  assert.equal(direct[0].ownerKey, OWNER);
  assert.equal(direct[0].message.type, 'comment_approved');
  assert.match(direct[0].message.body, /测试资讯/);
  assert.deepEqual(threadRecipients.sort(), [PARTICIPANT_A, PARTICIPANT_B]);
  assert.equal(completed.eventId, event._id);
  assert.equal(completed.claimId, 'message-claim');
  assert.equal(completed.patch.status, 'completed');
});

test('deletes a user message through the owner-scoped repository and returns a fresh list', async () => {
  const calls = [];
  const service = createUserMessageService({
    repository: {
      deleteMessage: async (ownerKey, messageId) => {
        calls.push({ ownerKey, messageId });
      },
      listOwnerMessages: async () => [],
      unreadCount: async () => 0
    },
    config: {}
  });

  const result = await service.deleteMessage('message-1', { ownerKey: OWNER });

  assert.deepEqual(calls, [{ ownerKey: OWNER, messageId: 'message-1' }]);
  assert.deepEqual(result, { messages: [], unreadCount: 0 });
});

test('lists non-comment messages without letting hidden comment rows consume the page', async () => {
  const calls = [];
  const service = createUserMessageService({
    repository: {
      listOwnerMessages: async (ownerKey, limit, options) => {
        calls.push({ ownerKey, limit, options });
        return [
          {
            _id: 'profile-message',
            type: 'profile_approved',
            category: 'profile',
            unread: true
          },
          {
            _id: 'membership-message',
            type: 'membership_succeeded',
            category: 'membership',
            unread: false
          }
        ];
      },
      unreadCount: async () => {
        throw new Error('hidden comment unread count must not be queried');
      }
    },
    config: { userMessagePageSize: 50 }
  });

  const result = await service.list({ ownerKey: OWNER }, { includeComments: false });

  assert.deepEqual(calls, [{
    ownerKey: OWNER,
    limit: 50,
    options: { excludeCategories: ['comments'] }
  }]);
  assert.deepEqual(result.messages.map((message) => message.id), [
    'profile-message',
    'membership-message'
  ]);
  assert.equal(result.unreadCount, 1);
});

test('keeps legacy message requests comment-capable and honors only an explicit false', () => {
  assert.deepEqual(messageListOptions(), { includeComments: true });
  assert.deepEqual(messageListOptions({}), { includeComments: true });
  assert.deepEqual(messageListOptions({ includeComments: true }), { includeComments: true });
  assert.deepEqual(messageListOptions({ includeComments: 'false' }), { includeComments: true });
  assert.deepEqual(messageListOptions({ includeComments: false }), { includeComments: false });
});

test('preserves the hidden-message list mode after single-read and delete mutations', async () => {
  const calls = [];
  const service = createUserMessageService({
    repository: {
      markRead: async (ownerKey, messageId, version) => {
        calls.push({ action: 'read', ownerKey, messageId, version });
      },
      deleteMessage: async (ownerKey, messageId) => {
        calls.push({ action: 'delete', ownerKey, messageId });
      },
      listOwnerMessages: async (ownerKey, limit, options) => {
        calls.push({ action: 'list', ownerKey, limit, options });
        return [];
      },
      unreadCount: async () => {
        throw new Error('hidden mode must not query the global unread count');
      }
    },
    config: { userMessagePageSize: 50 },
    now: () => NOW
  });
  const options = { includeComments: false };

  await service.markRead('message-one', 'event-one', { ownerKey: OWNER }, options);
  await service.deleteMessage('message-two', { ownerKey: OWNER }, options);

  assert.deepEqual(calls, [
    {
      action: 'read',
      ownerKey: OWNER,
      messageId: 'message-one',
      version: 'event-one'
    },
    {
      action: 'list',
      ownerKey: OWNER,
      limit: 50,
      options: { excludeCategories: ['comments'] }
    },
    {
      action: 'delete',
      ownerKey: OWNER,
      messageId: 'message-two'
    },
    {
      action: 'list',
      ownerKey: OWNER,
      limit: 50,
      options: { excludeCategories: ['comments'] }
    }
  ]);
});

test('refuses bulk read while comments are hidden without mutating their unread history', async () => {
  let markAllCalls = 0;
  const service = createUserMessageService({
    repository: {
      markAllRead: async () => {
        markAllCalls += 1;
      }
    },
    config: {}
  });

  await assert.rejects(
    () => service.markAllRead({ ownerKey: OWNER }, { includeComments: false }),
    (error) => error && error.code === 'COMMENTS_PAUSED'
  );
  assert.equal(markAllCalls, 0);
});

test('delivers a reply only to its direct and root comment owners with actor context', async () => {
  const event = {
    ...messageEventDocument('comment_approved', 'reply_async_1', {
      ownerKey: OWNER,
      itemId: 'item_async_1',
      itemTitle: '测试资讯',
      commentId: 'reply_async_1',
      commentPreview: '我补充一个判断',
      parentCommentId: 'root_async_1',
      replyToCommentId: 'target_async_1',
      replyToOwnerKey: PARTICIPANT_A,
      threadOwnerKey: PARTICIPANT_B,
      replyToPreview: '原来的判断'
    }, new Date(NOW)),
    _id: messageEventId('comment_approved', 'reply_async_1')
  };
  let delivered = null;
  const repository = {
    listDueEvents: async () => [event],
    listStaleEvents: async () => [],
    claimEvent: async (eventId, claimedAt, claimId, claimExpiresAt) => ({
      ...event,
      attemptCount: 1,
      status: 'processing',
      claimId,
      claimedAt,
      claimExpiresAt
    }),
    participantOwnerKeys: async () => {
      throw new Error('direct replies must not fan out to every participant');
    },
    upsertDirectMessage: async () => null,
    upsertCommentThreadMessages: async (ownerKeys, source) => {
      delivered = { ownerKeys, source };
    },
    markEventDone: async () => event,
    markEventRetry: async () => null
  };
  const service = createUserMessageService({
    repository,
    profileRepository: {
      get: async () => ({
        nickname: '回复者',
        avatarFileId: 'cloud://env/user-media/avatars/replier.jpg'
      })
    },
    config: {},
    now: () => NOW,
    createId: () => 'reply-message-claim'
  });

  assert.deepEqual(await service.processDue(), { scanned: 1, completed: 1 });
  assert.deepEqual(delivered.ownerKeys.sort(), [PARTICIPANT_A, PARTICIPANT_B]);
  assert.equal(delivered.source.actorNickname, '回复者');
  assert.equal(
    delivered.source.actorAvatarFileId,
    'cloud://env/user-media/avatars/replier.jpg'
  );
  assert.equal(delivered.source.replyToPreview, '原来的判断');
});

test('uses deterministic outbox ids for replay-safe membership and profile events', () => {
  const first = messageEventDocument(
    'membership_succeeded',
    'order-1',
    { ownerKey: OWNER },
    new Date(NOW)
  );
  const replay = messageEventDocument(
    'membership_succeeded',
    'order-1',
    { ownerKey: OWNER },
    new Date(NOW + 1000)
  );

  assert.equal(first._id, replay._id);
  assert.notEqual(
    first._id,
    messageEventId('profile_approved', 'order-1')
  );
  assert.equal(first.status, 'pending');
  assert.equal(first.ownerKey, OWNER);
});

test('delivers old messages even when one review queue fails and then drains new outcomes', async () => {
  let messageRuns = 0;
  const warnings = [];
  const service = createScheduledWorkService({
    userProfileService: {
      processDue: async () => {
        const error = new Error('profile queue unavailable');
        error.code = 'PROFILE_QUEUE_UNAVAILABLE';
        throw error;
      }
    },
    commentReviewService: {
      processDue: async () => ({ scanned: 1, approved: 1 })
    },
    userMessageService: {
      processDue: async () => {
        messageRuns += 1;
        return messageRuns === 1
          ? { scanned: 1, completed: 1 }
          : { scanned: 1, completed: 1 };
      }
    },
    logger: {
      warn: (message, details) => warnings.push({ message, details })
    }
  });

  const result = await service.processProfileReviews();

  assert.equal(messageRuns, 2);
  assert.deepEqual(result.profileReviews, {
    status: 'deferred',
    errorCode: 'PROFILE_QUEUE_UNAVAILABLE'
  });
  assert.deepEqual(result.commentReviews, { scanned: 1, approved: 1 });
  assert.deepEqual(result.userMessages.beforeReviews, { scanned: 1, completed: 1 });
  assert.deepEqual(result.userMessages.afterReviews, { scanned: 1, completed: 1 });
  assert.deepEqual(warnings, [{
    message: 'Scheduled background worker deferred',
    details: {
      worker: 'profile-reviews',
      errorCode: 'PROFILE_QUEUE_UNAVAILABLE'
    }
  }]);
});
