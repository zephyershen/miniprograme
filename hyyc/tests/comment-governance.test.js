const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { storedDocumentId } = require(
  '../cloudfunctions/knowledgeFeed/lib/stored-feed-item'
);
const {
  engagementDocumentId,
  createFeedEngagementRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-engagement');
const {
  commentView,
  createFeedEngagementService
} = require('../cloudfunctions/knowledgeFeed/services/feed-engagement-service');
const {
  commentReadable,
  createUserMediaPublicationVerifier
} = require('../cloudfunctions/knowledgeFeed/services/user-media-publication-verifier');
const {
  MUTATING_ACTIONS
} = require('../config/runtime-environment');

const NOW = Date.parse('2026-07-23T12:00:00.000Z');
const ITEM_ID = 'item00001';
const COMMENT_ID = '1'.repeat(64);
const OWNER = 'a'.repeat(64);
const REPORTER = 'b'.repeat(64);
const REPORTER_TWO = 'c'.repeat(64);
const REPORTER_THREE = 'd'.repeat(64);
const CONFIG = {
  provider: 'aihot',
  itemsCollectionName: 'items',
  userEngagementsCollectionName: 'engagements',
  commentsCollectionName: 'comments',
  commentReportThreshold: 3,
  commentReportLimitPerItem: 100,
  commentGovernanceScanLimit: 500,
  commentPageSize: 30,
  favoriteListLimit: 100
};

function notFound() {
  const error = new Error('DOCUMENT_NOT_FOUND');
  error.errCode = -1;
  return error;
}

function createMemoryDb(initial = {}) {
  const queryLog = [];
  const stores = new Map(
    Object.entries(initial).map(([name, documents]) => [
      name,
      new Map(Object.entries(documents).map(([id, document]) => [id, { ...document }]))
    ])
  );
  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  function collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            const document = store(name).get(id);
            if (!document) throw notFound();
            return { data: { ...document } };
          },
          async set({ data }) {
            store(name).set(id, { ...data });
          },
          async update({ data }) {
            const current = store(name).get(id);
            if (!current) throw notFound();
            store(name).set(id, { ...current, ...data });
          }
        };
      },
      where(filters) {
        const orders = [];
        let offset = 0;
        let take = 100;
        const query = { collection: name, filters: { ...filters }, orders, offset, take };
        queryLog.push(query);
        return {
          orderBy(field, direction) {
            orders.push({ field, direction });
            return this;
          },
          skip(value) {
            offset = value;
            query.offset = value;
            return this;
          },
          limit(value) {
            take = value;
            query.take = value;
            return this;
          },
          async get() {
            const documents = [...store(name).entries()]
              .map(([id, document]) => ({ _id: id, ...document }))
              .filter((document) => Object.entries(filters).every(
                ([field, value]) => document[field] === value
              ))
              .sort((left, right) => {
                for (const order of orders) {
                  const leftValue = left[order.field] instanceof Date
                    ? left[order.field].getTime()
                    : left[order.field];
                  const rightValue = right[order.field] instanceof Date
                    ? right[order.field].getTime()
                    : right[order.field];
                  if (leftValue === rightValue) continue;
                  const comparison = leftValue < rightValue ? -1 : 1;
                  return order.direction === 'desc' ? -comparison : comparison;
                }
                return 0;
              });
            return { data: documents.slice(offset, offset + take) };
          }
        };
      }
    };
  }
  let transactionTail = Promise.resolve();
  return {
    stores,
    queryLog,
    createCollection: async (name) => { store(name); },
    collection,
    runTransaction(work) {
      const result = transactionTail.then(() => work({ collection }));
      transactionTail = result.catch(() => null);
      return result;
    }
  };
}

function activeComment(overrides = {}) {
  return {
    itemId: ITEM_ID,
    authorKey: OWNER,
    content: '需要认真讨论的观点',
    attachments: [],
    moderation: { status: 'approved' },
    status: 'active',
    createdAt: new Date(NOW - 1000),
    updatedAt: new Date(NOW - 1000),
    ...overrides
  };
}

function activeItem(overrides = {}) {
  return {
    id: ITEM_ID,
    publicState: 'active',
    commentCount: 1,
    ...overrides
  };
}

test('stores idempotent reporter state per viewer and hides exactly at the third report', async () => {
  const itemDocumentId = storedDocumentId(CONFIG.provider, ITEM_ID);
  const db = createMemoryDb({
    comments: { [COMMENT_ID]: activeComment() },
    items: { [itemDocumentId]: activeItem() },
    engagements: {}
  });
  const repository = createFeedEngagementRepository(db, CONFIG);

  const [first, duplicate] = await Promise.all([
    repository.reportComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW),
      3
    ),
    repository.reportComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW + 1),
      3
    )
  ]);
  assert.deepEqual(first, { reported: true, hidden: false, commentCount: 1 });
  assert.deepEqual(duplicate, first);
  assert.equal(db.stores.get('comments').get(COMMENT_ID).reportCount, 1);

  await repository.reportComment(
    REPORTER_TWO,
    ITEM_ID,
    COMMENT_ID,
    new Date(NOW + 2),
    3
  );
  const third = await repository.reportComment(
    REPORTER_THREE,
    ITEM_ID,
    COMMENT_ID,
    new Date(NOW + 3),
    3
  );
  assert.deepEqual(third, { reported: true, hidden: true, commentCount: 0 });
  assert.equal(db.stores.get('comments').get(COMMENT_ID).status, 'hidden');
  assert.equal(db.stores.get('comments').get(COMMENT_ID).reportCount, 3);
  assert.equal(db.stores.get('items').get(itemDocumentId).commentCount, 0);
  assert.deepEqual(
    db.stores.get('engagements')
      .get(engagementDocumentId(REPORTER, ITEM_ID))
      .reportedCommentIds,
    [COMMENT_ID]
  );
  assert.deepEqual(
    await repository.reportComment(
      REPORTER_TWO,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW + 4),
      3
    ),
    { reported: true, hidden: true, commentCount: 0 }
  );
  assert.equal(db.stores.get('items').get(itemDocumentId).commentCount, 0);
  await assert.rejects(
    () => repository.reportComment(OWNER, ITEM_ID, COMMENT_ID, new Date(NOW + 5), 3),
    (error) => error && error.code === 'INVALID_REQUEST'
  );
  await assert.rejects(
    () => repository.appealComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW + 6)
    ),
    (error) => error && error.code === 'FORBIDDEN'
  );
  const [appealed, duplicateAppeal] = await Promise.all([
    repository.appealComment(OWNER, ITEM_ID, COMMENT_ID, new Date(NOW + 7)),
    repository.appealComment(OWNER, ITEM_ID, COMMENT_ID, new Date(NOW + 8))
  ]);
  assert.deepEqual(appealed, { appealed: true, commentCount: 0 });
  assert.deepEqual(duplicateAppeal, appealed);
  assert.equal(db.stores.get('comments').get(COMMENT_ID).status, 'appealed');
  await assert.rejects(
    () => repository.restoreComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW + 9),
      false
    ),
    (error) => error && error.code === 'FORBIDDEN'
  );
  const [restored, duplicateRestore] = await Promise.all([
    repository.restoreComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW + 10),
      true
    ),
    repository.restoreComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW + 11),
      true
    )
  ]);
  assert.deepEqual(restored, { restored: true, commentCount: 1 });
  assert.deepEqual(duplicateRestore, restored);
  assert.equal(db.stores.get('comments').get(COMMENT_ID).status, 'active');
  assert.equal(db.stores.get('comments').get(COMMENT_ID).reportCount, 0);
  assert.equal(db.stores.get('items').get(itemDocumentId).commentCount, 1);
});

test('lets only the author or an administrator delete and decrements a visible count once', async () => {
  const itemDocumentId = storedDocumentId(CONFIG.provider, ITEM_ID);
  const authorDb = createMemoryDb({
    comments: { [COMMENT_ID]: activeComment() },
    items: { [itemDocumentId]: activeItem() },
    engagements: {}
  });
  const authorRepository = createFeedEngagementRepository(authorDb, CONFIG);
  const authorDeleted = await authorRepository.deleteComment(
    OWNER,
    ITEM_ID,
    COMMENT_ID,
    new Date(NOW),
    false
  );
  assert.equal(authorDeleted.comment.deletedByRole, 'author');
  assert.equal(authorDeleted.commentCount, 0);

  const db = createMemoryDb({
    comments: { [COMMENT_ID]: activeComment() },
    items: { [itemDocumentId]: activeItem() },
    engagements: {}
  });
  const repository = createFeedEngagementRepository(db, CONFIG);

  await assert.rejects(
    () => repository.deleteComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW),
      false
    ),
    (error) => error && error.code === 'FORBIDDEN'
  );
  const deleted = await repository.deleteComment(
    REPORTER,
    ITEM_ID,
    COMMENT_ID,
    new Date(NOW + 1),
    true
  );
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.commentCount, 0);
  assert.equal(deleted.comment.deletedByRole, 'admin');
  assert.equal(db.stores.get('comments').get(COMMENT_ID).status, 'deleted');
  assert.equal(db.stores.get('items').get(itemDocumentId).commentCount, 0);

  const repeated = await repository.deleteComment(
    OWNER,
    ITEM_ID,
    COMMENT_ID,
    new Date(NOW + 2),
    false
  );
  assert.equal(repeated.commentCount, 0);
  assert.equal(db.stores.get('items').get(itemDocumentId).commentCount, 0);
});

test('cancels a pending review when its author deletes the queued comment', async () => {
  const itemDocumentId = storedDocumentId(CONFIG.provider, ITEM_ID);
  const db = createMemoryDb({
    comments: {
      [COMMENT_ID]: activeComment({
        status: 'pending',
        reviewState: 'processing',
        claimId: 'old-claim',
        claimedAt: new Date(NOW - 1000),
        claimExpiresAt: new Date(NOW + 60000),
        nextAttemptAt: new Date(NOW + 60000),
        moderation: { status: 'pending' }
      })
    },
    items: { [itemDocumentId]: activeItem({ commentCount: 0 }) },
    engagements: {}
  });
  const repository = createFeedEngagementRepository(db, CONFIG);

  const result = await repository.deleteComment(
    OWNER,
    ITEM_ID,
    COMMENT_ID,
    new Date(NOW),
    false
  );
  const stored = db.stores.get('comments').get(COMMENT_ID);

  assert.equal(result.commentCount, 0);
  assert.equal(stored.status, 'deleted');
  assert.equal(stored.reviewState, 'canceled');
  assert.equal(stored.claimId, '');
  assert.equal(stored.claimedAt, null);
  assert.equal(stored.claimExpiresAt, null);
  assert.equal(stored.nextAttemptAt, null);
});

test('keeps hidden lifecycle records private to their author and real administrators', async () => {
  const hiddenId = '4'.repeat(64);
  const appealedId = '5'.repeat(64);
  const itemDocumentId = storedDocumentId(CONFIG.provider, ITEM_ID);
  const db = createMemoryDb({
    comments: {
      [COMMENT_ID]: activeComment({ createdAt: new Date(NOW - 3000) }),
      [hiddenId]: activeComment({
        status: 'hidden',
        createdAt: new Date(NOW - 2000)
      }),
      [appealedId]: activeComment({
        authorKey: REPORTER_TWO,
        status: 'appealed',
        createdAt: new Date(NOW - 1000)
      })
    },
    items: { [itemDocumentId]: activeItem() },
    engagements: {}
  });
  const repository = createFeedEngagementRepository(db, CONFIG);

  assert.deepEqual(
    (await repository.listComments(
      ITEM_ID,
      30,
      { ownerKey: REPORTER, isAdmin: false }
    )).map((comment) => comment._id),
    [COMMENT_ID]
  );
  assert.deepEqual(
    (await repository.listComments(
      ITEM_ID,
      30,
      { ownerKey: OWNER, isAdmin: false }
    )).map((comment) => comment._id),
    [hiddenId, COMMENT_ID]
  );
  assert.deepEqual(
    (await repository.listComments(
      ITEM_ID,
      30,
      { ownerKey: REPORTER, isAdmin: true }
    )).map((comment) => comment._id),
    [appealedId, hiddenId, COMMENT_ID]
  );
});

test('queries an author private lifecycle exactly without scanning active or other authors', async () => {
  const ownerHiddenId = '6'.repeat(64);
  const activeId = '7'.repeat(64);
  const otherHiddenComments = Object.fromEntries(
    Array.from({ length: 510 }, (_, index) => {
      const id = index.toString(16).padStart(64, '0');
      return [id, activeComment({
        authorKey: REPORTER_TWO,
        status: 'hidden',
        createdAt: new Date(NOW - index)
      })];
    })
  );
  const db = createMemoryDb({
    comments: {
      ...otherHiddenComments,
      [activeId]: activeComment({ createdAt: new Date(NOW + 1000) }),
      [ownerHiddenId]: activeComment({
        status: 'hidden',
        createdAt: new Date(NOW - 10000)
      })
    },
    items: {},
    engagements: {}
  });
  const repository = createFeedEngagementRepository(db, CONFIG);

  const listed = await repository.listComments(
    ITEM_ID,
    30,
    { ownerKey: OWNER, isAdmin: false, includeActive: false }
  );

  assert.deepEqual(listed.map((comment) => comment._id), [ownerHiddenId]);
  assert.deepEqual(
    db.queryLog.map((query) => query.filters),
    [
      { itemId: ITEM_ID, status: 'pending', authorKey: OWNER },
      { itemId: ITEM_ID, status: 'hidden', authorKey: OWNER },
      { itemId: ITEM_ID, status: 'appealed', authorKey: OWNER }
    ]
  );
  assert.equal(db.queryLog.some((query) => query.filters.status === 'active'), false);
});

test('keeps real-administrator private lifecycle scans bounded', async () => {
  const rejectedHiddenComments = Object.fromEntries(
    Array.from({ length: 510 }, (_, index) => {
      const id = (index + 1000).toString(16).padStart(64, '0');
      return [id, activeComment({
        authorKey: index % 2 ? OWNER : REPORTER_TWO,
        status: 'hidden',
        moderation: { status: 'rejected' },
        createdAt: new Date(NOW - index)
      })];
    })
  );
  const db = createMemoryDb({
    comments: rejectedHiddenComments,
    items: {},
    engagements: {}
  });
  const repository = createFeedEngagementRepository(db, CONFIG);

  assert.deepEqual(
    await repository.listComments(
      ITEM_ID,
      30,
      { ownerKey: REPORTER, isAdmin: true, includeActive: false }
    ),
    []
  );

  const hiddenQueries = db.queryLog.filter(
    (query) => query.filters.status === 'hidden'
  );
  assert.deepEqual(hiddenQueries.map((query) => query.offset), [0, 100, 200, 300, 400]);
  assert.equal(hiddenQueries.every(
    (query) => !Object.hasOwn(query.filters, 'authorKey')
  ), true);
});

test('bounds per-item reporter state without dropping ids that protect idempotency', async () => {
  const itemDocumentId = storedDocumentId(CONFIG.provider, ITEM_ID);
  const existingIds = ['2'.repeat(64), '3'.repeat(64)];
  const db = createMemoryDb({
    comments: { [COMMENT_ID]: activeComment() },
    items: { [itemDocumentId]: activeItem() },
    engagements: {
      [engagementDocumentId(REPORTER, ITEM_ID)]: {
        ownerKey: REPORTER,
        itemId: ITEM_ID,
        reportedCommentIds: existingIds
      }
    }
  });
  const repository = createFeedEngagementRepository(db, CONFIG);
  await assert.rejects(
    () => repository.reportComment(
      REPORTER,
      ITEM_ID,
      COMMENT_ID,
      new Date(NOW),
      3,
      2
    ),
    (error) => error && error.code === 'REPORT_LIMIT_REACHED'
  );
  assert.deepEqual(
    db.stores.get('engagements')
      .get(engagementDocumentId(REPORTER, ITEM_ID))
      .reportedCommentIds,
    existingIds
  );
  assert.equal(db.stores.get('comments').get(COMMENT_ID).reportCount, undefined);
  assert.equal(db.stores.get('items').get(itemDocumentId).commentCount, 1);
});

test('keeps governance DTOs public-safe and removes deleted comment media best-effort', async () => {
  const attachmentFileId = 'cloud://env/user-media/published/comments/photo.webp';
  const comment = activeComment({
    _id: COMMENT_ID,
    attachments: [{ type: 'image', fileId: attachmentFileId }]
  });
  const hiddenComment = { ...comment, status: 'hidden', reportCount: 3 };
  const deleteCalls = [];
  let itemLoads = 0;
  const repository = {
    getMany: async () => [{ reportedCommentIds: [COMMENT_ID] }],
    listComments: async (_itemId, _limit, access) => (
      access && access.includeActive === false ? [hiddenComment] : [comment]
    ),
    deleteComment: async () => ({
      comment,
      commentCount: 0,
      deleted: true
    }),
    reportComment: async () => ({
      reported: true,
      hidden: false,
      commentCount: 1
    }),
    appealComment: async () => ({ appealed: true, commentCount: 0 }),
    restoreComment: async () => ({ restored: true, commentCount: 1 })
  };
  const service = createFeedEngagementService({
    repository,
    profileRepository: {
      getMany: async () => [{
        ownerKey: OWNER,
        nickname: '作者',
        moderation: { status: 'approved' }
      }],
      get: async () => null
    },
    itemLoader: async () => {
      itemLoads += 1;
      return activeItem();
    },
    commentModerationService: { review: async () => ({ status: 'approved' }) },
    userMediaService: {
      deleteOwned: async (...args) => { deleteCalls.push(args); }
    },
    config: {
      ...CONFIG,
      commentMaxLength: 280,
      commentImageLimit: 3,
      userMediaStagingFileIdPrefix: 'cloud://env/user-media/staging/'
    },
    now: () => NOW
  });
  const member = {
    viewer: { role: 'member', isActualAdmin: false },
    entitlements: { comments: true, history: { mode: 'rolling', days: 30 } }
  };

  const listed = await service.listComments(ITEM_ID, { ownerKey: REPORTER }, member);
  assert.equal(listed.canParticipate, true);
  assert.equal(listed.comments[0].reported, true);
  assert.equal(listed.comments[0].canReport, true);
  assert.equal(listed.comments[0].canDelete, false);
  assert.doesNotMatch(
    JSON.stringify(listed),
    /authorKey|ownerKey|reportedCommentIds|reportCount/
  );

  const deleted = await service.deleteComment(
    ITEM_ID,
    COMMENT_ID,
    { ownerKey: OWNER },
    member
  );
  assert.deepEqual(deleted, { commentId: COMMENT_ID, deleted: true, commentCount: 0 });
  assert.deepEqual(deleteCalls[0], [
    { ownerKey: OWNER },
    'comment',
    [attachmentFileId]
  ]);
  assert.doesNotMatch(JSON.stringify(deleted), /authorKey|ownerKey|reporter/);

  const reported = await service.reportComment(
    ITEM_ID,
    COMMENT_ID,
    { ownerKey: REPORTER },
    member
  );
  assert.deepEqual(reported, {
    commentId: COMMENT_ID,
    reported: true,
    hidden: false,
    commentCount: 1
  });
  assert.doesNotMatch(JSON.stringify(reported), /authorKey|ownerKey|reporter/);

  const adminView = commentView(comment, REPORTER, null, { isAdmin: true });
  assert.equal(adminView.canDelete, true);
  assert.equal(Object.hasOwn(adminView, 'authorKey'), false);
  const authorHiddenView = commentView(hiddenComment, OWNER, null);
  assert.equal(authorHiddenView.canAppeal, true);
  assert.equal(authorHiddenView.canReport, false);
  assert.doesNotMatch(JSON.stringify(authorHiddenView), /reportCount|hiddenReason/);
  const adminHiddenView = commentView(hiddenComment, REPORTER, null, { isAdmin: true });
  assert.equal(adminHiddenView.canRestore, true);
  assert.equal(adminHiddenView.canAppeal, false);

  assert.deepEqual(
    await service.appealComment(ITEM_ID, COMMENT_ID, { ownerKey: OWNER }, member),
    { commentId: COMMENT_ID, appealed: true, commentCount: 0 }
  );
  await assert.rejects(
    () => service.restoreComment(
      ITEM_ID,
      COMMENT_ID,
      { ownerKey: REPORTER },
      member
    ),
    (error) => error && error.code === 'FORBIDDEN'
  );
  const admin = {
    viewer: { role: 'member', isActualAdmin: true },
    entitlements: { comments: true, history: { mode: 'rolling', days: 30 } }
  };
  assert.deepEqual(
    await service.restoreComment(
      ITEM_ID,
      COMMENT_ID,
      { ownerKey: REPORTER },
      admin
    ),
    { commentId: COMMENT_ID, restored: true, commentCount: 1 }
  );

  const expired = {
    viewer: { role: 'free', isActualAdmin: false },
    entitlements: { comments: false, history: { mode: 'rolling', days: 1 } }
  };
  const loadsBeforeOwnerGovernance = itemLoads;
  const privateList = await service.listComments(
    ITEM_ID,
    { ownerKey: OWNER },
    expired
  );
  assert.equal(privateList.canParticipate, false);
  assert.equal(privateList.comments.length, 1);
  assert.equal(privateList.comments[0].canAppeal, true);
  assert.deepEqual(
    await service.appealComment(ITEM_ID, COMMENT_ID, { ownerKey: OWNER }, expired),
    { commentId: COMMENT_ID, appealed: true, commentCount: 0 }
  );
  assert.deepEqual(
    await service.deleteComment(ITEM_ID, COMMENT_ID, { ownerKey: OWNER }, expired),
    { commentId: COMMENT_ID, deleted: true, commentCount: 0 }
  );
  assert.equal(itemLoads, loadsBeforeOwnerGovernance);
});

test('serves hidden comment media only to its author or a real administrator', async () => {
  const fileId = 'cloud://env/user-media/published/comments/hidden.webp';
  let comment = activeComment({
    _id: COMMENT_ID,
    status: 'hidden',
    attachments: [{ type: 'image', fileId }]
  });
  const verifier = createUserMediaPublicationVerifier({
    profileRepository: { get: async () => null },
    engagementRepository: {
      getComment: async () => ({ comment, commentCount: 0 })
    }
  });
  const record = {
    status: 'published',
    ownerKey: OWNER,
    publishedFileId: fileId,
    businessBinding: {
      state: 'attached',
      kind: 'comment',
      referenceId: COMMENT_ID,
      itemId: ITEM_ID
    }
  };

  assert.equal(commentReadable(comment, { comments: true, ownerKey: REPORTER }), false);
  assert.equal(await verifier.canRead(
    record,
    { comments: true, ownerKey: REPORTER }
  ), false);
  assert.equal(await verifier.canRead(
    record,
    { comments: true, ownerKey: OWNER }
  ), true);
  assert.equal(await verifier.canRead(
    record,
    { comments: false, ownerKey: OWNER }
  ), true);
  assert.equal(await verifier.canRead(
    record,
    { comments: true, ownerKey: REPORTER, isAdmin: true }
  ), true);
  comment = { ...comment, status: 'appealed' };
  assert.equal(await verifier.canRead(
    record,
    { comments: true, ownerKey: OWNER }
  ), true);
  comment = { ...comment, status: 'active' };
  assert.equal(await verifier.canRead(
    record,
    { comments: true, ownerKey: REPORTER }
  ), true);
  comment = { ...comment, status: 'deleted' };
  assert.equal(await verifier.canRead(
    record,
    { comments: true, ownerKey: OWNER, isAdmin: true }
  ), false);
});

test('routes the full governance lifecycle through the API and mutation gate', async () => {
  const cloudFunctionsPath = require.resolve('../services/cloud-functions');
  const apiPath = require.resolve('../features/engagement/api');
  const previousCloudFunctions = require.cache[cloudFunctionsPath];
  const previousApi = require.cache[apiPath];
  const calls = [];
  require.cache[cloudFunctionsPath] = {
    id: cloudFunctionsPath,
    filename: cloudFunctionsPath,
    loaded: true,
    exports: {
      callCloudFunction: async (name, data) => {
        calls.push({ name, data });
        return data;
      }
    }
  };
  delete require.cache[apiPath];
  try {
    const api = require(apiPath);
    await api.deleteComment(ITEM_ID, COMMENT_ID);
    await api.reportComment(ITEM_ID, COMMENT_ID);
    await api.appealComment(ITEM_ID, COMMENT_ID);
    await api.restoreComment(ITEM_ID, COMMENT_ID);
  } finally {
    if (previousApi) require.cache[apiPath] = previousApi;
    else delete require.cache[apiPath];
    if (previousCloudFunctions) require.cache[cloudFunctionsPath] = previousCloudFunctions;
    else delete require.cache[cloudFunctionsPath];
  }
  assert.deepEqual(calls, [
    {
      name: 'knowledgeFeed',
      data: { action: 'deleteComment', id: ITEM_ID, commentId: COMMENT_ID }
    },
    {
      name: 'knowledgeFeed',
      data: { action: 'reportComment', id: ITEM_ID, commentId: COMMENT_ID }
    },
    {
      name: 'knowledgeFeed',
      data: { action: 'appealComment', id: ITEM_ID, commentId: COMMENT_ID }
    },
    {
      name: 'knowledgeFeed',
      data: { action: 'restoreComment', id: ITEM_ID, commentId: COMMENT_ID }
    }
  ]);
  assert.equal(MUTATING_ACTIONS.knowledgeFeed.has('deleteComment'), true);
  assert.equal(MUTATING_ACTIONS.knowledgeFeed.has('reportComment'), true);
  assert.equal(MUTATING_ACTIONS.knowledgeFeed.has('appealComment'), true);
  assert.equal(MUTATING_ACTIONS.knowledgeFeed.has('restoreComment'), true);
  assert.equal(MUTATING_ACTIONS.knowledgeFeed.has('markMessageRead'), true);
  assert.equal(MUTATING_ACTIONS.knowledgeFeed.has('markAllMessagesRead'), true);
});

test('renders the governance lifecycle with confirmations, ARIA, and count synchronization', () => {
  const root = path.join(__dirname, '..');
  const wxml = fs.readFileSync(
    path.join(root, 'components/comment-sheet/index.wxml'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.join(root, 'components/comment-sheet/index.js'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.join(root, 'components/comment-sheet/index.wxss'),
    'utf8'
  );
  const detail = fs.readFileSync(
    path.join(root, 'pages/feed-detail/index.wxml'),
    'utf8'
  );
  const router = fs.readFileSync(
    path.join(root, 'cloudfunctions/knowledgeFeed/index.js'),
    'utf8'
  );
  assert.match(wxml, /data-action="delete"/);
  assert.match(wxml, /data-action="report"/);
  assert.match(wxml, /data-action="appeal"/);
  assert.match(wxml, /data-action="restore"/);
  assert.match(wxml, /已举报/);
  assert.match(wxml, /aria-role="button"/);
  assert.match(wxml, /aria-label="删除这条评论"/);
  assert.match(wxss, /\.comment-action\s*\{[^}]*min-height:\s*88rpx/);
  assert.match(js, /title: '删除评论'/);
  assert.match(js, /title: '举报评论'/);
  assert.match(js, /title: '申诉评论'/);
  assert.match(js, /title: '恢复评论'/);
  assert.match(detail, /bindchanged="onCommentPublished"/);
  assert.match(detail, /class="detail-action"\s+bindtap="openComments"/);
  assert.match(wxml, /wx:if="\{\{canParticipate\}\}" class="comment-compose"/);
  assert.match(wxml, /comment-governance-footer/);
  assert.match(js, /showMembershipBenefits\(\)/);
  assert.match(router, /deleteComment:\s*async/);
  assert.match(router, /reportComment:\s*async/);
  assert.match(router, /appealComment:\s*async/);
  assert.match(router, /restoreComment:\s*async/);
});
