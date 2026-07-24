const test = require('node:test');
const assert = require('node:assert/strict');

const {
  storedDocumentId
} = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const {
  ENGAGEMENT_CONFIG
} = require('../cloudfunctions/knowledgeFeed/config');
const {
  engagementDocumentId
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-engagement');
const {
  createCommentReviewRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/comment-review');

const OWNER = 'a'.repeat(64);
const COMMENT_ID = '1'.repeat(64);
const NEXT_COMMENT_ID = '2'.repeat(64);
const ITEM_ID = 'item00001';
const CREATED_AT = new Date('2026-07-24T08:00:00.000Z');
const ITEM_DOCUMENT_ID = storedDocumentId('aihot', ITEM_ID);
const ENGAGEMENT_DOCUMENT_ID = engagementDocumentId(OWNER, ITEM_ID);

function notFound() {
  const error = new Error('document not found');
  error.errCode = -1;
  return error;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createHarness({
  comments = [],
  engagements = [],
  item = {
    id: ITEM_ID,
    publicState: 'active',
    commentCount: 3
  },
  config = {},
  failSet = null
} = {}) {
  const stores = new Map([
    ['items', new Map(item ? [[ITEM_DOCUMENT_ID, clone(item)]] : [])],
    ['comments', new Map(comments.map((entry) => [entry._id, clone(entry)]))],
    ['engagements', new Map(engagements.map((entry) => [entry._id, clone(entry)]))]
  ]);
  const createdCollections = [];
  const reads = [];
  const writes = [];
  let transactionCount = 0;

  function collection(name, target = stores) {
    if (!target.has(name)) target.set(name, new Map());
    return {
      doc(id) {
        return {
          async get() {
            reads.push({ name, id });
            const value = target.get(name).get(id);
            if (!value) throw notFound();
            return { data: clone(value) };
          },
          async set({ data }) {
            if (typeof failSet === 'function' && failSet(name, id, data)) {
              throw new Error('simulated write failure');
            }
            writes.push({ operation: 'set', name, id });
            target.get(name).set(id, clone(data));
          },
          async update({ data }) {
            if (typeof failSet === 'function' && failSet(name, id, data)) {
              throw new Error('simulated write failure');
            }
            writes.push({ operation: 'update', name, id });
            const current = target.get(name).get(id);
            if (!current) throw notFound();
            target.get(name).set(id, { ...current, ...clone(data) });
          }
        };
      }
    };
  }

  const db = {
    async createCollection(name) {
      createdCollections.push(name);
      if (name === 'events') throw new Error('message outbox unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
    },
    collection,
    async runTransaction(callback) {
      transactionCount += 1;
      const staged = clone(stores);
      const result = await callback({
        collection(name) {
          return collection(name, staged);
        }
      });
      stores.clear();
      staged.forEach((documents, name) => stores.set(name, documents));
      return result;
    }
  };
  const repository = createCommentReviewRepository(db, {
    provider: 'aihot',
    commentsCollectionName: 'comments',
    itemsCollectionName: 'items',
    userEngagementsCollectionName: 'engagements',
    messageEventsCollectionName: 'events',
    ensureItems: async () => null,
    ...config
  });
  return {
    stores,
    createdCollections,
    reads,
    writes,
    get transactionCount() {
      return transactionCount;
    },
    repository
  };
}

function commentInput(revision = 'mutation-1') {
  return {
    content: '先提交，后台审核',
    attachments: [],
    reviewAttachments: [],
    reviewRevision: revision
  };
}

function pendingComment(overrides = {}) {
  return {
    _id: COMMENT_ID,
    itemId: ITEM_ID,
    authorKey: OWNER,
    content: '已经入队',
    attachments: [],
    reviewAttachments: [],
    reviewRevision: 'mutation-1',
    reviewState: 'pending',
    status: 'pending',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
  };
}

function engagementWithTimes(times, overrides = {}) {
  return {
    _id: ENGAGEMENT_DOCUMENT_ID,
    ownerKey: OWNER,
    itemId: ITEM_ID,
    liked: false,
    favorited: false,
    commentSubmissionTimes: times,
    lastCommentSubmittedAt: times[times.length - 1] || null,
    createdAt: times[0] || CREATED_AT,
    updatedAt: times[times.length - 1] || CREATED_AT,
    ...overrides
  };
}

test('configures a 30-second cooldown and a 30-comment rolling day', () => {
  assert.equal(ENGAGEMENT_CONFIG.commentSubmissionCooldownMs, 30 * 1000);
  assert.equal(ENGAGEMENT_CONFIG.commentSubmissionWindowMs, 24 * 60 * 60 * 1000);
  assert.equal(ENGAGEMENT_CONFIG.commentSubmissionWindowLimit, 30);
});

test('queues a comment and atomically records its submission without using the message outbox', async () => {
  const harness = createHarness();
  const result = await harness.repository.enqueue(
    OWNER,
    ITEM_ID,
    COMMENT_ID,
    commentInput(),
    CREATED_AT
  );

  assert.deepEqual(harness.createdCollections, ['comments', 'engagements']);
  assert.equal(harness.transactionCount, 1);
  assert.equal(result.comment.status, 'pending');
  assert.equal(result.commentCount, 3);
  assert.equal(harness.stores.get('comments').get(COMMENT_ID).reviewState, 'pending');
  const engagement = harness.stores.get('engagements').get(ENGAGEMENT_DOCUMENT_ID);
  assert.equal(engagement.ownerKey, OWNER);
  assert.equal(engagement.itemId, ITEM_ID);
  assert.equal(engagement.commentSubmissionTimes.length, 1);
  assert.equal(engagement.commentSubmissionTimes[0].toISOString(), CREATED_AT.toISOString());
  assert.equal(engagement.lastCommentSubmittedAt.toISOString(), CREATED_AT.toISOString());
  assert.deepEqual(harness.writes.map(({ name }) => name), ['comments', 'engagements']);
});

test('returns an existing deterministic comment before reading or applying rate limits', async () => {
  const recentTimes = Array.from(
    { length: 30 },
    (_, index) => new Date(CREATED_AT.getTime() - (30 - index) * 60 * 1000)
  );
  recentTimes[recentTimes.length - 1] = new Date(CREATED_AT.getTime() - 1000);
  const existing = pendingComment();
  const rateState = engagementWithTimes(recentTimes);
  const harness = createHarness({
    comments: [existing],
    engagements: [rateState]
  });

  const result = await harness.repository.enqueue(
    OWNER,
    ITEM_ID,
    COMMENT_ID,
    commentInput(),
    CREATED_AT
  );

  assert.equal(result.comment._id, COMMENT_ID);
  assert.equal(result.comment.content, existing.content);
  assert.equal(result.commentCount, 3);
  assert.equal(
    harness.reads.some(({ name }) => name === 'engagements'),
    false
  );
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(
    harness.stores.get('engagements').get(ENGAGEMENT_DOCUMENT_ID),
    rateState
  );
});

test('rejects a second comment on the same item during the 30-second cooldown', async () => {
  const previous = new Date(CREATED_AT.getTime() - 10 * 1000);
  const harness = createHarness({
    engagements: [engagementWithTimes([previous])]
  });

  await assert.rejects(
    harness.repository.enqueue(
      OWNER,
      ITEM_ID,
      NEXT_COMMENT_ID,
      commentInput('mutation-2'),
      CREATED_AT
    ),
    (error) => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.match(error.message, /评论发送太快/);
      return true;
    }
  );
  assert.equal(harness.stores.get('comments').has(NEXT_COMMENT_ID), false);
  assert.equal(
    harness.stores.get('engagements').get(ENGAGEMENT_DOCUMENT_ID)
      .commentSubmissionTimes.length,
    1
  );
});

test('rejects the thirty-first comment inside the same rolling 24-hour window', async () => {
  const recentTimes = Array.from(
    { length: 30 },
    (_, index) => new Date(CREATED_AT.getTime() - (30 - index) * 60 * 1000)
  );
  const harness = createHarness({
    engagements: [engagementWithTimes(recentTimes)]
  });

  await assert.rejects(
    harness.repository.enqueue(
      OWNER,
      ITEM_ID,
      NEXT_COMMENT_ID,
      commentInput('mutation-31'),
      CREATED_AT
    ),
    (error) => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.match(error.message, /24 小时内/);
      return true;
    }
  );
  assert.equal(harness.stores.get('comments').has(NEXT_COMMENT_ID), false);
});

test('expires timestamps at the rolling-day boundary before admitting a new comment', async () => {
  const expiredTimes = Array.from(
    { length: 30 },
    (_, index) => new Date(
      CREATED_AT.getTime() - 24 * 60 * 60 * 1000 - index * 60 * 1000
    )
  );
  const harness = createHarness({
    engagements: [engagementWithTimes(expiredTimes)]
  });

  const result = await harness.repository.enqueue(
    OWNER,
    ITEM_ID,
    NEXT_COMMENT_ID,
    commentInput('mutation-after-window'),
    CREATED_AT
  );

  assert.equal(result.comment._id, NEXT_COMMENT_ID);
  const engagement = harness.stores.get('engagements').get(ENGAGEMENT_DOCUMENT_ID);
  assert.deepEqual(
    engagement.commentSubmissionTimes.map((value) => value.toISOString()),
    [CREATED_AT.toISOString()]
  );
});

test('rolls back the comment when the atomic rate-state write fails', async () => {
  const harness = createHarness({
    failSet: (name) => name === 'engagements'
  });

  await assert.rejects(
    harness.repository.enqueue(
      OWNER,
      ITEM_ID,
      COMMENT_ID,
      commentInput(),
      CREATED_AT
    ),
    /simulated write failure/
  );
  assert.equal(harness.stores.get('comments').has(COMMENT_ID), false);
  assert.equal(harness.stores.get('engagements').has(ENGAGEMENT_DOCUMENT_ID), false);
});
