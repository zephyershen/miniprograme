const test = require('node:test');
const assert = require('node:assert/strict');

const { AppError } = require('../cloudfunctions/knowledgeFeed/lib/errors');
const {
  publiclyVisibleComment
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-engagement');
const {
  createModerationBackfillRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/moderation-backfill');
const {
  createModerationBackfillService
} = require('../cloudfunctions/knowledgeFeed/services/moderation-backfill-service');
const {
  profileView
} = require('../cloudfunctions/knowledgeFeed/services/user-profile-service');
const {
  createModerationBackfillProxy
} = require('../cloudfunctions/knowledgeOps/services/moderation-backfill-proxy');

const TOKEN = 'm'.repeat(40);
const START = Date.parse('2026-07-20T08:00:00.000Z');

function memoryRepository(seed) {
  const records = {
    comments: new Map((seed.comments || []).map((item) => [item._id, structuredClone(item)])),
    profiles: new Map((seed.profiles || []).map((item) => [item._id, structuredClone(item)]))
  };

  return {
    records,
    list: async (kind, cursor, limit) => [...records[kind].values()]
      .filter((item) => !cursor || item._id > cursor)
      .sort((left, right) => left._id.localeCompare(right._id))
      .slice(0, limit)
      .map((item) => structuredClone(item)),
    claim: async (kind, id, options) => {
      const item = records[kind].get(id);
      if (item.moderation !== undefined && item.moderation !== null) {
        return { state: 'skipped', reason: 'already-reviewed' };
      }
      const backfill = item.moderationBackfill || {};
      if (backfill.state === 'reviewing' && new Date(backfill.leaseUntil) > options.startedAt) {
        return { state: 'locked' };
      }
      if (backfill.state === 'retry' && new Date(backfill.nextAttemptAt) > options.startedAt) {
        return { state: 'deferred' };
      }
      item.moderationBackfill = {
        state: 'reviewing', attemptId: options.attemptId,
        startedAt: options.startedAt, leaseUntil: options.leaseUntil
      };
      if (kind === 'comments') item.status = 'moderation_pending';
      return { state: 'claimed', document: structuredClone(item) };
    },
    finalize: async (kind, id, attemptId, outcome) => {
      const item = records[kind].get(id);
      if (!item.moderationBackfill || item.moderationBackfill.attemptId !== attemptId
        || (item.moderation !== undefined && item.moderation !== null)) {
        return { state: 'superseded' };
      }
      if (outcome.state === 'approved') {
        item.moderation = outcome.moderation;
        item.moderationBackfill = null;
        if (kind === 'comments') item.status = 'active';
      } else if (outcome.state === 'rejected') {
        item.moderation = outcome.moderation;
        item.moderationBackfill = null;
        if (kind === 'comments') item.status = 'moderation_rejected';
      } else {
        item.moderationBackfill = {
          state: 'retry', nextAttemptAt: outcome.nextAttemptAt,
          lastErrorCode: outcome.errorCode
        };
        if (kind === 'comments') item.status = 'moderation_pending';
      }
      return { state: outcome.state };
    }
  };
}

test('backfills only missing moderation, preserves media, and is repeatable', async () => {
  let currentTime = START;
  let profileAttempts = 0;
  const repository = memoryRepository({
    comments: [
      {
        _id: 'comment-allow', content: 'useful', status: 'active',
        attachments: [{ fileId: 'cloud://env/user-media/comments/keep.jpg' }]
      },
      {
        _id: 'comment-reject', content: 'reject', status: 'active',
        attachments: [{ fileId: 'cloud://env/user-media/comments/also-keep.jpg' }]
      },
      {
        _id: 'comment-reviewed', content: 'done', status: 'active',
        moderation: { status: 'approved' }
      }
    ],
    profiles: [{
      _id: 'profile-pending', ownerKey: 'profile-pending', nickname: 'reader',
      avatarFileId: 'cloud://env/user-media/avatars/keep.jpg'
    }]
  });
  const service = createModerationBackfillService({
    repository,
    commentModerationService: {
      review: async ({ content }) => {
        if (content === 'reject') throw new AppError('CONTENT_REJECTED', 'rejected');
        return { status: 'approved', verdict: 'allow', confidence: 0.99 };
      }
    },
    profileModerationService: {
      review: async () => {
        profileAttempts += 1;
        if (profileAttempts === 1) {
          throw new AppError('CONTENT_REVIEW_UNAVAILABLE', 'retry');
        }
        return { status: 'approved', provider: 'test', model: 'test-model' };
      }
    },
    maintenanceToken: TOKEN,
    now: () => currentTime,
    retryDelayMs: 1000
  });

  await assert.rejects(() => service.run({ token: 'wrong' }), { code: 'AUTH_REQUIRED' });
  const first = await service.run({ token: TOKEN, limit: 25 });
  assert.deepEqual(first.totals, {
    scanned: 4, claimed: 3, approved: 1, rejected: 1,
    pending: 1, locked: 0, skipped: 1
  });
  assert.equal(repository.records.comments.get('comment-allow').status, 'active');
  assert.equal(repository.records.comments.get('comment-reject').status, 'moderation_rejected');
  assert.equal(
    repository.records.comments.get('comment-reject').attachments[0].fileId,
    'cloud://env/user-media/comments/also-keep.jpg'
  );
  assert.equal(repository.records.profiles.get('profile-pending').moderation, undefined);
  assert.equal(profileView(repository.records.profiles.get('profile-pending')).isComplete, false);

  const immediateRepeat = await service.run({ token: TOKEN, limit: 25 });
  assert.equal(immediateRepeat.totals.claimed, 0);
  assert.equal(immediateRepeat.totals.locked, 1);

  currentTime += 1001;
  const retry = await service.run({ token: TOKEN, limit: 25 });
  assert.equal(retry.profiles.approved, 1);
  assert.equal(profileView(repository.records.profiles.get('profile-pending')).nickname, 'reader');
  assert.equal((await service.run({ token: TOKEN, limit: 25 })).totals.claimed, 0);
});

test('only exposes comments and profiles with an approved moderation result', () => {
  assert.equal(publiclyVisibleComment({ status: 'active' }), false);
  assert.equal(publiclyVisibleComment({
    status: 'moderation_pending', moderation: { status: 'approved' }
  }), false);
  assert.equal(publiclyVisibleComment({
    status: 'active', moderation: { verdict: 'allow', confidence: 0.99, categories: [] }
  }), true);
  assert.equal(profileView({ nickname: 'legacy', avatarFileId: 'cloud://avatar' }).isComplete, false);
  assert.equal(profileView({
    nickname: 'approved', avatarFileId: 'cloud://avatar', moderation: { status: 'approved' }
  }).isComplete, true);
});

test('repository hides a counted legacy comment before review and restores the count once', async () => {
  const documents = {
    comments: new Map([['comment-1', {
      _id: 'comment-1', itemId: 'item00001', content: 'legacy', status: 'active'
    }]]),
    profiles: new Map(),
    items: new Map([['aihot_item00001', { _id: 'aihot_item00001', commentCount: 1 }]])
  };
  const names = {
    knowledge_feed_comments: 'comments',
    knowledge_user_profiles: 'profiles',
    knowledge_feed_items: 'items'
  };
  function reference(collectionName, id) {
    const collection = documents[names[collectionName]];
    return {
      get: async () => {
        if (!collection.has(id)) throw Object.assign(new Error('DOCUMENT_NOT_FOUND'), { errCode: -1 });
        return { data: structuredClone(collection.get(id)) };
      },
      update: async ({ data }) => {
        collection.set(id, { ...collection.get(id), ...structuredClone(data) });
      }
    };
  }
  const db = {
    createCollection: async () => null,
    runTransaction: async (operation) => operation({
      collection: (name) => ({ doc: (id) => reference(name, id) })
    }),
    command: { gt: (value) => value }
  };
  const repository = createModerationBackfillRepository(db, {
    provider: 'aihot',
    itemsCollectionName: 'knowledge_feed_items',
    commentsCollectionName: 'knowledge_feed_comments',
    userProfilesCollectionName: 'knowledge_user_profiles'
  });
  const startedAt = new Date(START);
  const claim = await repository.claim('comments', 'comment-1', {
    attemptId: 'attempt-1',
    startedAt,
    leaseUntil: new Date(START + 60000)
  });
  assert.equal(claim.state, 'claimed');
  assert.equal(documents.comments.get('comment-1').status, 'moderation_pending');
  assert.equal(documents.items.get('aihot_item00001').commentCount, 0);

  const approved = await repository.finalize('comments', 'comment-1', 'attempt-1', {
    state: 'approved',
    moderation: { status: 'approved', verdict: 'allow' },
    completedAt: new Date(START + 100)
  });
  assert.equal(approved.state, 'approved');
  assert.equal(documents.comments.get('comment-1').status, 'active');
  assert.equal(documents.items.get('aihot_item00001').commentCount, 1);
  assert.equal(
    (await repository.finalize('comments', 'comment-1', 'attempt-1', {
      state: 'approved', moderation: { status: 'approved' }, completedAt: new Date(START + 200)
    })).state,
    'superseded'
  );
  assert.equal(documents.items.get('aihot_item00001').commentCount, 1);
});

test('knowledgeOps proxy authorizes and forwards a bounded backfill request', async () => {
  const calls = [];
  const proxy = createModerationBackfillProxy({
    authorize: (token) => {
      if (token !== TOKEN) throw new AppError('AUTH_REQUIRED', 'denied');
    },
    callFunction: async (request) => {
      calls.push(request);
      return { result: { ok: true, data: { done: true, totals: { approved: 3 } } } };
    }
  });
  await assert.rejects(() => proxy.run({ token: 'wrong' }), { code: 'AUTH_REQUIRED' });
  const result = await proxy.run({
    token: TOKEN,
    kind: 'comments',
    limit: 5,
    cursor: { comments: 'comment-1', profiles: '' }
  });
  assert.equal(result.totals.approved, 3);
  assert.deepEqual(calls[0], {
    name: 'knowledgeFeed',
    data: {
      action: 'moderationBackfill', token: TOKEN, kind: 'comments', limit: 5,
      cursor: { comments: 'comment-1', profiles: '' }
    }
  });
});
