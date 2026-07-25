const test = require('node:test');
const assert = require('node:assert/strict');

const { AppError } = require('../cloudfunctions/knowledgeFeed/lib/errors');
const { toStoredFeedItem } = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const {
  engagementDocumentId,
  commentDocumentId,
  isTransactionBusy,
  createFeedEngagementRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-engagement');
const {
  canComment,
  normalizeCommentContent,
  normalizeCommentAttachments,
  createFeedEngagementService
} = require('../cloudfunctions/knowledgeFeed/services/feed-engagement-service');
const {
  decorateEngagement,
  formatActionCount,
  decorateFavorites,
  createOptimisticPendingComment,
  updateOptimisticPendingComment,
  mergeAcceptedComment,
  mergeResolvedCommentMedia,
  buildCommentThreads,
  arrangeCommentThreads
} = require('../features/engagement/model');
const { optimisticLike, optimisticFavorite } = require('../features/engagement/optimistic');
const { createLatestTargetSync } = require('../features/engagement/latest-target-sync');
const {
  COMMENT_EMOJIS,
  keyboardDockState
} = require('../features/engagement/composer-model');

const NOW = Date.parse('2026-07-18T08:00:00.000Z');
const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const ITEM = {
  id: 'item00001',
  title: '值得收藏的一条更新',
  source: 'Example',
  publishedAt: '2026-07-18T07:00:00.000Z',
  categoryLabel: 'AI 前沿',
  listVisualFileId: 'cloud://thumb',
  likeCount: 2,
  commentCount: 1,
  favoriteCount: 0
};

function queryableCollection(documents, trace) {
  const filters = {};
  const orders = [];
  let offset = 0;
  let take = 100;
  return {
    where(values) {
      Object.assign(filters, values);
      trace.where.push(values);
      return this;
    },
    orderBy(field, direction) {
      orders.push({ field, direction });
      trace.orderBy.push({ field, direction });
      return this;
    },
    skip(value) {
      offset = value;
      trace.skip.push(value);
      return this;
    },
    limit(value) {
      take = value;
      trace.limit.push(value);
      return this;
    },
    async get() {
      const values = documents
        .filter((document) => Object.entries(filters).every(
          ([field, value]) => (
            value && typeof value === 'object' && typeof value.includes === 'function'
              ? value.includes(document[field])
              : document[field] === value
          )
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
      return { data: values.slice(offset, offset + take) };
    }
  };
}

function entitlement(role) {
  return {
    viewer: { role },
    entitlements: {
      comments: role !== 'free',
      history: role === 'admin' ? { mode: 'all' } : { mode: 'rolling', days: role === 'member' ? 30 : 7 }
    }
  };
}

function memoryRepository() {
  const reactions = new Map();
  const comments = [];
  return {
    getMany: async (ownerKey, itemIds) => itemIds
      .map((itemId) => reactions.get(`${ownerKey}:${itemId}`))
      .filter(Boolean),
    toggleLike: async (ownerKey, item, updatedAt, desiredLiked) => {
      const key = `${ownerKey}:${item.id}`;
      const current = reactions.get(key) || { ownerKey, itemId: item.id };
      const next = { ...current, liked: desiredLiked };
      reactions.set(key, next);
      return { liked: next.liked, favorited: Boolean(next.favorited), likeCount: next.liked ? 3 : 2 };
    },
    toggleFavorite: async (ownerKey, item, updatedAt, desiredFavorited) => {
      const key = `${ownerKey}:${item.id}`;
      const current = reactions.get(key) || { ownerKey, itemId: item.id };
      const next = {
        ...current,
        favorited: desiredFavorited,
        favoritedAt: updatedAt,
        snapshot: { title: item.title, source: item.source, publishedAt: item.publishedAt }
      };
      reactions.set(key, next);
      return { liked: Boolean(next.liked), favorited: next.favorited, favoriteCount: next.favorited ? 1 : 0 };
    },
    listFavorites: async (ownerKey) => [...reactions.values()]
      .filter((entry) => entry.ownerKey === ownerKey && entry.favorited),
    listComments: async (itemId, limit, access = {}) => comments.filter((comment) => (
      comment.status !== 'pending' || comment.authorKey === access.ownerKey
    )),
    getComment: async (commentId, itemId) => {
      const comment = comments.find((entry) => entry._id === commentId && entry.itemId === itemId);
      return comment ? { comment, commentCount: ITEM.commentCount } : null;
    },
    addComment: async (ownerKey, itemId, input, createdAt, id) => {
      const existing = comments.find((comment) => comment._id === id);
      if (existing) return { comment: existing, commentCount: ITEM.commentCount };
      const comment = {
        _id: id,
        itemId,
        authorKey: ownerKey,
        ...input,
        status: 'pending',
        reviewState: 'pending',
        moderation: { status: 'pending' },
        createdAt
      };
      comments.unshift(comment);
      return { comment, commentCount: ITEM.commentCount };
    }
  };
}

test('initializes stored heat fields without mixing source heat and engagement counts', () => {
  const stored = toStoredFeedItem({
    ...ITEM,
    titleEn: '', summary: 'Summary', url: 'https://example.com/item00001', permalink: '',
    category: 'ai', categoryMarker: 'AI', channelKey: 'ai', coverTone: 'cobalt',
    topicKeys: [], score: 42, selected: false, attribution: null
  }, { provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all' });
  assert.equal(stored.baseScore, 42);
  assert.equal(stored.score, 42);
  assert.equal(stored.likeCount, 0);
  assert.equal(stored.commentCount, 0);
});

test('keeps per-user engagement identities deterministic without exposing the owner key', () => {
  const id = engagementDocumentId(OWNER, ITEM.id);
  assert.equal(id, engagementDocumentId(OWNER, ITEM.id));
  assert.notEqual(id, engagementDocumentId(OTHER, ITEM.id));
  assert.equal(id.includes(OWNER), false);
  assert.equal(commentDocumentId(OWNER, ITEM.id, 'mutation_1'), commentDocumentId(OWNER, ITEM.id, 'mutation_1'));
  assert.notEqual(commentDocumentId(OWNER, ITEM.id, 'mutation_1'), commentDocumentId(OWNER, ITEM.id, 'mutation_2'));
  assert.equal(isTransactionBusy({ message: 'ResourceUnavailable.TransactionBusy -501001' }), true);
});

test('filters and sorts favorites in the database before applying the page limit', async () => {
  const trace = { where: [], orderBy: [], skip: [], limit: [] };
  const documents = Array.from({ length: 120 }, (_, index) => ({
    _id: `ignored-${index}`,
    ownerKey: OWNER,
    favorited: false,
    favoritedAt: new Date(NOW - index)
  })).concat([
    {
      _id: 'favorite-old',
      ownerKey: OWNER,
      favorited: true,
      favoritedAt: new Date(NOW - 2000)
    },
    {
      _id: 'favorite-new',
      ownerKey: OWNER,
      favorited: true,
      favoritedAt: new Date(NOW - 1000)
    }
  ]);
  const repository = createFeedEngagementRepository({
    createCollection: async () => null,
    collection: () => queryableCollection(documents, trace)
  }, {
    userEngagementsCollectionName: 'engagements',
    commentsCollectionName: 'comments',
    favoriteListLimit: 100,
    commentPageSize: 30
  });

  const favorites = await repository.listFavorites(OWNER, 2);

  assert.deepEqual(favorites.map((document) => document._id), [
    'favorite-new',
    'favorite-old'
  ]);
  assert.deepEqual(trace.where, [{ ownerKey: OWNER, favorited: true }]);
  assert.deepEqual(trace.orderBy, [{ field: 'favoritedAt', direction: 'desc' }]);
  assert.deepEqual(trace.limit, [2]);
});

test('continues comment pages until the requested approved comments are found', async () => {
  const trace = { where: [], orderBy: [], skip: [], limit: [] };
  const rejected = Array.from({ length: 100 }, (_, index) => ({
    _id: `rejected-${String(index).padStart(3, '0')}`,
    itemId: ITEM.id,
    status: 'active',
    moderation: { verdict: 'reject', confidence: 1 },
    createdAt: new Date(NOW - index)
  }));
  const approved = [
    {
      _id: 'approved-new',
      itemId: ITEM.id,
      status: 'active',
      moderation: { status: 'approved' },
      createdAt: new Date(NOW - 1000)
    },
    {
      _id: 'approved-old',
      itemId: ITEM.id,
      status: 'active',
      moderation: { status: 'approved' },
      createdAt: new Date(NOW - 2000)
    }
  ];
  const repository = createFeedEngagementRepository({
    createCollection: async () => null,
    collection: () => queryableCollection(rejected.concat(approved), trace)
  }, {
    userEngagementsCollectionName: 'engagements',
    commentsCollectionName: 'comments',
    favoriteListLimit: 100,
    commentPageSize: 30
  });

  const comments = await repository.listComments(ITEM.id, 2);

  assert.deepEqual(comments.map((document) => document._id), [
    'approved-new',
    'approved-old'
  ]);
  assert.deepEqual(trace.skip, [0, 100]);
  assert.deepEqual(trace.limit, [100, 100]);
  assert.deepEqual(trace.where, [
    { itemId: ITEM.id, status: 'active' },
    { itemId: ITEM.id, status: 'active' }
  ]);
  assert.deepEqual(trace.orderBy, [
    { field: 'createdAt', direction: 'desc' },
    { field: '_id', direction: 'desc' },
    { field: 'createdAt', direction: 'desc' },
    { field: '_id', direction: 'desc' }
  ]);
});

test('loads comment roots by id without leaking a root from another item', async () => {
  const trace = { where: [], orderBy: [], skip: [], limit: [] };
  const documents = [
    {
      _id: 'root-comment-1',
      itemId: ITEM.id,
      status: 'active',
      moderation: { status: 'approved' }
    },
    {
      _id: 'root-comment-2',
      itemId: 'another-item',
      status: 'active',
      moderation: { status: 'approved' }
    }
  ];
  const repository = createFeedEngagementRepository({
    command: {
      in(values) {
        return { testInValues: values };
      }
    },
    createCollection: async () => null,
    collection: () => {
      const collection = queryableCollection(documents, trace);
      const originalWhere = collection.where;
      collection.where = function where(values) {
        const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [
          key,
          value && value.testInValues
            ? { includes: (candidate) => value.testInValues.includes(candidate) }
            : value
        ]));
        return originalWhere.call(this, normalized);
      };
      return collection;
    }
  }, {
    userEngagementsCollectionName: 'engagements',
    commentsCollectionName: 'comments',
    favoriteListLimit: 100,
    commentPageSize: 30
  });

  const comments = await repository.getCommentsByIds(
    ['root-comment-1', 'root-comment-2'],
    ITEM.id
  );

  assert.deepEqual(comments.map((comment) => comment._id), ['root-comment-1']);
});

test('lets every signed-in viewer like, favorite, and manage private history while only members participate in comments', async () => {
  const repository = memoryRepository();
  const profiles = new Map([
    [OWNER, {
      ownerKey: OWNER,
      nickname: '果冻卡哇伊',
      avatarFileId: 'cloud://env/user-media/avatars/me.jpg',
      moderation: { status: 'approved' }
    }]
  ]);
  let reviewCount = 0;
  let publishCount = 0;
  let holdCount = 0;
  const service = createFeedEngagementService({
    repository,
    profileRepository: {
      get: async (ownerKey) => profiles.get(ownerKey) || null,
      getMany: async (ownerKeys) => ownerKeys.map((key) => profiles.get(key)).filter(Boolean)
    },
    itemLoader: async () => ITEM,
    commentModerationService: {
      review: async () => {
        reviewCount += 1;
        return {
          verdict: 'allow', confidence: 1, categories: [], provider: 'test', model: 'test'
        };
      }
    },
    userMediaService: {
      filesForReview: async (actor, kind, fileIds) => fileIds,
      holdForReview: async () => {
        holdCount += 1;
      },
      publishOwned: async (actor, kind, fileIds) => {
        publishCount += 1;
        return fileIds.map((fileId) => fileId.replace(
          '/user-media/staging/',
          '/user-media/published/comments/'
        ));
      },
      bindPublished: async () => null,
      discardUnpublished: async () => null,
      deleteOwned: async () => null,
      isOwnedPublishedFileId: (fileId) => fileId.includes('/user-media/published/')
    },
    config: {
      commentMaxLength: 280,
      commentPageSize: 30,
      commentImageLimit: 3,
      userMediaStagingFileIdPrefix: 'cloud://env/user-media/staging/',
      favoriteListLimit: 100
    },
    now: () => NOW
  });
  const actor = { ownerKey: OWNER };
  const free = entitlement('free');
  const member = entitlement('member');

  assert.equal(canComment(free), false);
  assert.equal((await service.toggleLike(ITEM.id, true, actor, free)).engagement.liked, true);
  assert.equal((await service.toggleFavorite(ITEM.id, true, actor, free)).engagement.favorited, true);
  const freeComments = await service.listComments(ITEM.id, actor, free);
  assert.equal(freeComments.canParticipate, false);
  assert.deepEqual(freeComments.comments, []);
  await assert.rejects(
    () => service.addComment(
      ITEM.id,
      { content: '不能发布', clientMutationId: 'free_mutation' },
      actor,
      free
    ),
    (error) => error.code === 'ENTITLEMENT_REQUIRED'
      && error.details.featureKey === 'comments'
  );
  await assert.rejects(
    () => service.reportComment(ITEM.id, 'comment-to-report', actor, free),
    (error) => error.code === 'ENTITLEMENT_REQUIRED'
      && error.details.featureKey === 'comments'
  );

  const payload = {
    content: '  一个\n具体判断  ',
    attachments: [{
      fileId: 'cloud://env/user-media/staging/original.jpg',
      width: 1200,
      height: 900
    }],
    clientMutationId: 'mutation_123'
  };
  const added = await service.addComment(ITEM.id, payload, actor, member);
  assert.equal(added.comment.content, '一个\n具体判断');
  assert.equal(added.comment.authorLabel, '果冻卡哇伊');
  assert.equal(added.comment.attachments[0].width, 1200);
  assert.equal((await service.addComment(ITEM.id, payload, actor, member)).commentCount, 1);
  assert.equal(added.comment.reviewPending, true);
  assert.equal(reviewCount, 0);
  assert.equal(publishCount, 0);
  assert.equal(holdCount, 1);
  assert.equal((await service.listComments(ITEM.id, { ownerKey: OTHER }, member)).comments.length, 0);
  const ownerComments = await service.listComments(ITEM.id, actor, member);
  assert.equal(ownerComments.comments[0].reviewPending, true);
  assert.equal(ownerComments.commentCount, ITEM.commentCount);
  profiles.delete(OWNER);
  await assert.rejects(() => service.addComment(ITEM.id, {
    content: '没有资料不能发布',
    clientMutationId: 'mutation_456'
  }, actor, member), (error) => error.code === 'PROFILE_REQUIRED');
  assert.equal((await service.listFavorites(actor, free)).items[0].available, true);
});

test('validates comment copy and formats compact engagement labels', () => {
  assert.equal(normalizeCommentContent('  有用的判断  '), '有用的判断');
  assert.throws(() => normalizeCommentContent('   '), AppError);
  assert.throws(
    () => normalizeCommentContent('请访问 example.com'),
    (error) => error.code === 'COMMENT_LINK_NOT_ALLOWED'
  );
  assert.equal(normalizeCommentContent('', 280, true), '');
  assert.equal(normalizeCommentAttachments([
    { fileId: 'cloud://env/user-media/staging/a.jpg', width: 500, height: 400 }
  ], {
    commentImageLimit: 3,
    userMediaStagingFileIdPrefix: 'cloud://env/user-media/staging/'
  })[0].fileId, 'cloud://env/user-media/staging/a.jpg');
  assert.equal(formatActionCount(1260), '1.2k');
  assert.deepEqual(decorateEngagement({ liked: true, likeCount: 2 }).likeLabel, '2');
  assert.equal(decorateFavorites([{ savedAt: '2026-07-18T08:00:00.000Z' }])[0].savedLabel, '07.18 收藏');
  assert.deepEqual(optimisticLike({ liked: false, likeCount: 2 }), {
    liked: true,
    favorited: false,
    canComment: false,
    likeCount: 3,
    commentCount: 0,
    favoriteCount: 0,
    likeLabel: '3',
    commentLabel: ''
  });
  assert.equal(optimisticFavorite({ favorited: false }).favorited, true);
});

test('stores a reply against its visible root and keeps replies beside that root', async () => {
  const repository = memoryRepository();
  const root = (await repository.addComment(
    OTHER,
    ITEM.id,
    {
      content: '原评论',
      attachments: [],
      moderation: { status: 'approved' }
    },
    new Date(NOW - 1000),
    'root_comment_123'
  )).comment;
  root.status = 'active';
  root.reviewState = 'approved';
  root.moderation = { status: 'approved' };
  const profiles = new Map([
    [OWNER, {
      ownerKey: OWNER,
      nickname: '回复者',
      avatarFileId: 'cloud://env/user-media/avatars/replier.jpg',
      moderation: { status: 'approved' }
    }],
    [OTHER, {
      ownerKey: OTHER,
      nickname: '原作者',
      avatarFileId: 'cloud://env/user-media/avatars/root.jpg',
      moderation: { status: 'approved' }
    }]
  ]);
  const service = createFeedEngagementService({
    repository,
    profileRepository: {
      get: async (ownerKey) => profiles.get(ownerKey) || null,
      getMany: async (ownerKeys) => ownerKeys.map((key) => profiles.get(key)).filter(Boolean)
    },
    itemLoader: async () => ITEM,
    config: {
      commentMaxLength: 280,
      commentPageSize: 30,
      commentImageLimit: 3,
      userMediaStagingFileIdPrefix: 'cloud://env/user-media/staging/',
      favoriteListLimit: 100
    },
    now: () => NOW
  });

  const result = await service.addComment(ITEM.id, {
    content: '这是回复',
    replyToCommentId: root._id,
    clientMutationId: 'reply_mutation_123'
  }, { ownerKey: OWNER }, entitlement('member'));

  assert.equal(result.comment.parentCommentId, root._id);
  assert.equal(result.comment.replyToCommentId, root._id);
  assert.equal(result.comment.replyToNickname, '原作者');
  assert.equal(result.comment.replyToPreview, '原评论');
  root.status = 'deleted';
  root.moderation = { status: 'rejected' };
  const replay = await service.addComment(ITEM.id, {
    content: '这是回复',
    replyToCommentId: root._id,
    clientMutationId: 'reply_mutation_123'
  }, { ownerKey: OWNER }, entitlement('member'));
  assert.equal(replay.comment.id, result.comment.id);
  const arranged = arrangeCommentThreads([
    { id: result.comment.id, parentCommentId: root._id, createdAt: new Date(NOW) },
    { id: root._id, createdAt: new Date(NOW - 1000) }
  ]);
  assert.deepEqual(arranged.map((comment) => comment.id), [root._id, result.comment.id]);
});

test('returns the root comment when a paged result starts with its reply', async () => {
  const root = {
    _id: 'root-comment',
    itemId: ITEM.id,
    authorKey: OTHER,
    content: '原评论',
    status: 'active',
    moderation: { status: 'approved' },
    createdAt: new Date(NOW - 1000)
  };
  const reply = {
    _id: 'reply-comment',
    itemId: ITEM.id,
    authorKey: OWNER,
    content: '这是回复',
    parentCommentId: root._id,
    replyToCommentId: root._id,
    replyToNickname: '原作者',
    status: 'active',
    moderation: { status: 'approved' },
    createdAt: new Date(NOW)
  };
  const requestedRootIds = [];
  const profiles = new Map([
    [OWNER, { ownerKey: OWNER, nickname: '回复者', moderation: { status: 'approved' } }],
    [OTHER, { ownerKey: OTHER, nickname: '原作者', moderation: { status: 'approved' } }]
  ]);
  const service = createFeedEngagementService({
    repository: {
      listComments: async () => [reply],
      getCommentsByIds: async (ids) => {
        requestedRootIds.push(...ids);
        return [root];
      },
      getMany: async () => []
    },
    profileRepository: {
      get: async (ownerKey) => profiles.get(ownerKey) || null,
      getMany: async (ownerKeys) => ownerKeys.map((key) => profiles.get(key)).filter(Boolean)
    },
    itemLoader: async () => ITEM,
    config: {
      commentPageSize: 30,
      commentMaxLength: 280,
      commentImageLimit: 3,
      favoriteListLimit: 100
    },
    now: () => NOW
  });

  const result = await service.listComments(
    ITEM.id,
    { ownerKey: OWNER },
    entitlement('member')
  );
  const arranged = arrangeCommentThreads(result.comments);

  assert.deepEqual(requestedRootIds, [root._id]);
  assert.deepEqual(
    arranged.map((comment) => comment.id),
    [root._id, reply._id]
  );
});

test('does not expose an active thread root through private comment history', async () => {
  const privateReply = {
    _id: 'hidden-reply',
    itemId: ITEM.id,
    authorKey: OWNER,
    content: '我的历史回复',
    parentCommentId: 'active-root',
    replyToCommentId: 'active-root',
    status: 'hidden',
    moderation: { status: 'approved' },
    createdAt: new Date(NOW)
  };
  let rootReadCount = 0;
  const profile = {
    ownerKey: OWNER,
    nickname: '回复者',
    moderation: { status: 'approved' }
  };
  const service = createFeedEngagementService({
    repository: {
      listComments: async (_itemId, _limit, access) => {
        assert.equal(access.includeActive, false);
        return [privateReply];
      },
      getCommentsByIds: async () => {
        rootReadCount += 1;
        return [];
      },
      getMany: async () => []
    },
    profileRepository: {
      get: async () => profile,
      getMany: async () => [profile]
    },
    itemLoader: async () => {
      throw new Error('free private history must not load protected item content');
    },
    config: {
      commentPageSize: 30,
      commentMaxLength: 280,
      commentImageLimit: 3,
      favoriteListLimit: 100
    },
    now: () => NOW
  });

  const result = await service.listComments(
    ITEM.id,
    { ownerKey: OWNER },
    entitlement('free')
  );

  assert.equal(rootReadCount, 0);
  assert.deepEqual(result.comments.map((comment) => comment.id), [privateReply._id]);
});

test('builds a two-level reply group with a stable collapsed preview', () => {
  const comments = arrangeCommentThreads([
    {
      id: 'reply-3',
      parentCommentId: 'root-comment',
      replyToCommentId: 'reply-2',
      createdAt: '2026-07-18T08:03:00.000Z'
    },
    {
      id: 'reply-1',
      parentCommentId: 'root-comment',
      replyToCommentId: 'root-comment',
      createdAt: '2026-07-18T08:01:00.000Z'
    },
    {
      id: 'root-comment',
      createdAt: '2026-07-18T08:00:00.000Z'
    },
    {
      id: 'reply-2',
      parentCommentId: 'root-comment',
      replyToCommentId: 'reply-1',
      createdAt: '2026-07-18T08:02:00.000Z'
    }
  ]);

  const [collapsed] = buildCommentThreads(comments);
  assert.equal(collapsed.root.id, 'root-comment');
  assert.deepEqual(
    collapsed.replies.map((comment) => comment.id),
    ['reply-1', 'reply-2', 'reply-3']
  );
  assert.deepEqual(
    collapsed.visibleReplies.map((comment) => comment.id),
    ['reply-1', 'reply-2']
  );
  assert.equal(collapsed.hiddenReplyCount, 1);
  assert.equal(collapsed.isExpanded, false);
  assert.equal(collapsed.isCollapsed, false);

  const [expanded] = buildCommentThreads(comments, {
    expandedThreadIds: { 'root-comment': true }
  });
  assert.deepEqual(
    expanded.visibleReplies.map((comment) => comment.id),
    ['reply-1', 'reply-2', 'reply-3']
  );
  assert.equal(expanded.hiddenReplyCount, 0);
  assert.equal(expanded.isExpanded, true);

  const [fullyCollapsed] = buildCommentThreads(comments, {
    expandedThreadIds: { 'root-comment': false }
  });
  assert.deepEqual(fullyCollapsed.visibleReplies, []);
  assert.equal(fullyCollapsed.hiddenReplyCount, 3);
  assert.equal(fullyCollapsed.isCollapsed, true);
});

test('keeps reply context when a sparse server response replaces the optimistic comment', () => {
  const root = {
    id: 'root-comment',
    content: '原评论',
    createdAt: '2026-07-18T08:00:00.000Z'
  };
  const optimisticReply = createOptimisticPendingComment({
    id: 'local-reply',
    content: '这是回复',
    profile: { nickname: '回复者' },
    replyTarget: {
      id: root.id,
      parentCommentId: root.id,
      nickname: '原作者',
      preview: root.content
    },
    createdAt: '2026-07-18T08:01:00.000Z'
  });
  const acceptedReply = mergeAcceptedComment({
    id: 'server-reply',
    content: '这是回复',
    attachments: [],
    createdAt: '2026-07-18T08:01:00.000Z'
  }, optimisticReply);
  const [thread] = buildCommentThreads(
    arrangeCommentThreads([acceptedReply, root])
  );

  assert.equal(acceptedReply.parentCommentId, root.id);
  assert.equal(acceptedReply.replyToCommentId, root.id);
  assert.equal(acceptedReply.replyToNickname, '原作者');
  assert.equal(acceptedReply.isReply, true);
  assert.equal(thread.root.id, root.id);
  assert.deepEqual(thread.replies.map((comment) => comment.id), ['server-reply']);
});

test('shows a local image comment immediately and preserves its preview while the server accepts it', () => {
  const pending = createOptimisticPendingComment({
    id: 'local_mutation_123',
    content: '这条评论正在后台提交',
    images: [{
      tempFilePath: 'wxfile://local-photo.jpg',
      width: 1200,
      height: 900
    }],
    profile: {
      nickname: '小明',
      avatarFileId: 'cloud://avatar',
      avatarUrl: 'https://temporary.example/avatar.jpg',
      initial: '小'
    },
    createdAt: '2026-07-18T08:00:00.000Z',
    statusLabel: '提交审核中'
  });
  assert.equal(pending.reviewPending, true);
  assert.equal(pending.localPending, true);
  assert.equal(pending.statusLabel, '提交审核中');
  assert.equal(pending.attachments[0].url, 'wxfile://local-photo.jpg');
  assert.equal(pending.attachmentMediaCount, 1);

  const [uploaded] = updateOptimisticPendingComment([pending], pending.id, {
    attachments: [{
      type: 'image',
      fileId: 'cloud://uploaded-photo',
      width: 1200,
      height: 900,
      url: 'wxfile://local-photo.jpg',
      localPath: 'wxfile://local-photo.jpg'
    }]
  });
  const accepted = mergeAcceptedComment({
    id: 'server-comment-1',
    content: pending.content,
    attachments: [{
      type: 'image',
      fileId: 'cloud://uploaded-photo',
      width: 1200,
      height: 900
    }],
    reviewPending: true,
    statusLabel: '审核中'
  }, uploaded);
  assert.equal(accepted.id, 'server-comment-1');
  assert.equal(accepted.attachments[0].url, 'wxfile://local-photo.jpg');
  assert.equal(accepted.attachments[0].localPath, 'wxfile://local-photo.jpg');
});

test('merges resolved media without letting an old request remove a newer comment', () => {
  const current = [{
    id: 'server-comment-1',
    attachments: [{
      fileId: 'cloud://photo-1',
      url: 'wxfile://local-photo.jpg',
      localPath: 'wxfile://local-photo.jpg'
    }],
    author: { avatarFileId: 'cloud://avatar-1', avatarUrl: '' }
  }, {
    id: 'local-newer-comment',
    localPending: true,
    attachments: [{ fileId: 'local:photo', url: 'wxfile://newer.jpg' }],
    author: { avatarUrl: '' }
  }];
  const merged = mergeResolvedCommentMedia(current, [{
    id: 'server-comment-1',
    attachments: [{
      fileId: 'cloud://photo-1',
      url: 'https://temporary.example/photo-1.jpg'
    }],
    author: {
      avatarFileId: 'cloud://avatar-1',
      avatarUrl: 'https://temporary.example/avatar-1.jpg'
    }
  }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].attachments[0].url, 'https://temporary.example/photo-1.jpg');
  assert.equal(merged[0].attachments[0].localPath, 'wxfile://local-photo.jpg');
  assert.equal(merged[0].author.avatarUrl, 'https://temporary.example/avatar-1.jpg');
  assert.equal(merged[1], current[1]);
});

test('merges staging attachments into published attachments by index', () => {
  const current = [{
    id: 'server-comment-1',
    attachments: [{
      fileId: 'cloud://env/user-media/staging/photo-a.jpg',
      url: 'wxfile://local-photo-a.jpg',
      localPath: 'wxfile://local-photo-a.jpg'
    }, {
      fileId: 'cloud://env/user-media/staging/photo-b.jpg',
      url: 'wxfile://local-photo-b.jpg',
      localPath: 'wxfile://local-photo-b.jpg'
    }],
    author: { avatarUrl: '' }
  }];
  const merged = mergeResolvedCommentMedia(current, [{
    id: 'server-comment-1',
    attachments: [{
      fileId: 'cloud://env/user-media/published/photo-a.jpg',
      url: 'https://temporary.example/photo-a.jpg'
    }, {
      fileId: 'cloud://env/user-media/published/photo-b.jpg',
      url: 'https://temporary.example/photo-b.jpg'
    }],
    author: { avatarUrl: '' }
  }]);

  assert.deepEqual(
    merged[0].attachments.map((attachment) => attachment.fileId),
    [
      'cloud://env/user-media/published/photo-a.jpg',
      'cloud://env/user-media/published/photo-b.jpg'
    ]
  );
  assert.deepEqual(
    merged[0].attachments.map((attachment) => attachment.url),
    [
      'https://temporary.example/photo-a.jpg',
      'https://temporary.example/photo-b.jpg'
    ]
  );
});

test('keeps the whole comment composer above the keyboard and offers a useful emoji palette', () => {
  assert.equal(COMMENT_EMOJIS.length, 64);
  assert.deepEqual(keyboardDockState(336, 812), {
    keyboardOpen: true,
    sheetStyle: 'bottom:336px;height:464px;'
  });
  assert.deepEqual(keyboardDockState(0, 812), {
    keyboardOpen: false,
    sheetStyle: ''
  });
});

test('accepts rapid repeated taps immediately and synchronizes only the latest engagement target', async () => {
  let engagement = decorateEngagement({ liked: false, favorited: false, likeCount: 2 });
  const requests = [];
  const pending = [];
  const createPending = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    pending.push({ promise, resolve });
    return promise;
  };
  const sync = createLatestTargetSync({
    read: () => engagement,
    apply: (next) => { engagement = next; },
    request: (field, target) => {
      requests.push({ field, target });
      return createPending();
    }
  });

  sync.toggleLike();
  assert.equal(engagement.liked, true);
  assert.deepEqual(requests, [{ field: 'liked', target: true }]);

  sync.toggleLike();
  assert.equal(engagement.liked, false);
  assert.equal(requests.length, 1);

  pending[0].resolve({ engagement: { liked: true, favorited: false, likeCount: 3 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests[1], { field: 'liked', target: false });

  pending[1].resolve({ engagement: { liked: false, favorited: false, likeCount: 2 } });
  await sync.whenIdle();
  assert.equal(engagement.liked, false);
  assert.equal(engagement.likeCount, 2);
});

test('lets favorite taps reverse while the previous target is still in flight', async () => {
  let engagement = decorateEngagement({ liked: false, favorited: false, likeCount: 2 });
  const requests = [];
  const pending = [];
  const sync = createLatestTargetSync({
    read: () => engagement,
    apply: (next) => { engagement = next; },
    request: (field, target) => new Promise((resolve) => {
      requests.push({ field, target });
      pending.push(resolve);
    })
  });

  sync.toggleFavorite();
  assert.equal(engagement.favorited, true);
  sync.toggleFavorite();
  assert.equal(engagement.favorited, false);
  assert.deepEqual(requests, [{ field: 'favorited', target: true }]);

  pending[0]({ engagement: { liked: false, favorited: true, likeCount: 2 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests[1], { field: 'favorited', target: false });
  pending[1]({ engagement: { liked: false, favorited: false, likeCount: 2 } });
  await sync.whenIdle();
  assert.equal(engagement.favorited, false);
});
