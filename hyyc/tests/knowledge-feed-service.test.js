const test = require('node:test');
const assert = require('node:assert/strict');
const { createAihotSource } = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const { createFeedService } = require('../cloudfunctions/knowledgeFeed/services/feed-service');
const { createCoverService } = require('../cloudfunctions/knowledgeFeed/services/cover-service');

const NOW = Date.parse('2026-07-16T01:00:00.000Z');
const CACHE_CONFIG = { ttlMs: 15 * 60 * 1000, forceMinAgeMs: 60 * 1000 };

function feedItem(overrides = {}) {
  return {
    id: 'item0001',
    title: '资讯标题',
    titleEn: '',
    summary: '完整摘要',
    url: 'https://example.com/article',
    permalink: 'https://example.com/permalink',
    source: 'Example（RSS）',
    publishedAt: '2026-07-16T00:00:00.000Z',
    category: 'ai-products',
    categoryLabel: 'AI 产品',
    categoryMarker: 'PRODUCT',
    channelKey: 'ai',
    coverTone: 'cobalt',
    coverFileId: '',
    topicKeys: ['company:openai'],
    score: 80,
    attribution: { source: 'internal' },
    coverStatus: 'missing',
    ...overrides
  };
}

function repositoryWith(cache) {
  return {
    get: async () => cache,
    replace: async (data, prepareDocument) => ({
      document: prepareDocument(data, cache),
      previous: cache
    }),
    touch: async () => {},
    patchItems: async () => (cache && cache.items) || [],
    acknowledgeVisualDeletes: async () => []
  };
}

test('serves the existing public feed contract through the feed service boundary', async () => {
  const cache = {
    fetchedAt: new Date(NOW - 1000),
    items: [feedItem(), feedItem({ id: 'item0002', publishedAt: '2026-07-15T23:00:00.000Z', score: 90 })]
  };
  const service = createFeedService({
    repository: repositoryWith(cache),
    source: { provider: 'test', loadSelected: async () => { throw new Error('should not refresh'); } },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW
  });
  const result = await service.getFeed({ sort: 'hot', limit: 1, filters: { time: '7d' } });
  assert.equal(result.items[0].id, 'item0002');
  assert.equal(result.hasMore, true);
  assert.equal(result.items[0].permalink, undefined);
  assert.equal(result.items[0].attribution, undefined);
  assert.equal(result.items[0].coverStatus, undefined);
});

test('uses a source preview as the public visual without pretending it is an original cover', async () => {
  const previewFileId = 'cloud://env.bucket/knowledge-previews/source/item0001-1.jpg';
  const cache = {
    fetchedAt: new Date(NOW - 1000),
    items: [feedItem({ previewFileIds: [previewFileId], previewStatus: 'ready' })]
  };
  const service = createFeedService({
    repository: repositoryWith(cache),
    source: { provider: 'test', loadSelected: async () => { throw new Error('should not refresh'); } },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW
  });
  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.equal(result.items[0].coverFileId, '');
  assert.equal(result.items[0].visualFileId, previewFileId);
  assert.equal(result.items[0].visualKind, 'source-preview');
  assert.equal(result.items[0].previewStatus, undefined);
});

test('returns stale cached content when source refresh fails', async () => {
  const cache = { fetchedAt: new Date(NOW - 60 * 60 * 1000), items: [feedItem()] };
  const service = createFeedService({
    repository: repositoryWith(cache),
    source: { provider: 'test', loadSelected: async () => { throw new Error('offline'); } },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW,
    logger: { error() {} }
  });
  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.equal(result.stale, true);
  assert.equal(result.items.length, 1);
});

test('merges visual fields from the latest transaction snapshot during a feed refresh', async () => {
  const staleCache = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [feedItem({ previewFileIds: [] })]
  };
  const previewFileId = 'cloud://env.bucket/knowledge-previews/source/item0001-1.jpg';
  const latestCache = {
    ...staleCache,
    items: [feedItem({ previewFileIds: [previewFileId], previewStatus: 'ready' })]
  };
  const repository = {
    get: async () => staleCache,
    touch: async () => {},
    replace: async (data, prepareDocument) => ({
      document: prepareDocument(data, latestCache),
      previous: latestCache
    }),
    acknowledgeVisualDeletes: async () => []
  };
  const service = createFeedService({
    repository,
    source: {
      provider: 'test',
      loadSelected: async () => ({ etag: 'new', items: [feedItem({ title: '刷新后的标题' })] })
    },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW
  });
  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.equal(result.items[0].title, '刷新后的标题');
  assert.equal(result.items[0].visualFileId, previewFileId);
});

test('deletes only orphaned visuals owned by the knowledge feed after refresh', async () => {
  const coverPrefix = 'cloud://env.bucket/knowledge-covers/';
  const previewPrefix = 'cloud://env.bucket/knowledge-previews/source/';
  const retainedPreview = `${previewPrefix}item0001-1.jpg`;
  const orphanedCover = `${coverPrefix}removed01.jpg`;
  const orphanedPreview = `${previewPrefix}removed01-1.jpg`;
  const foreignFile = 'cloud://env.bucket/user-uploads/avatar.jpg';
  const cache = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [
      feedItem({ previewFileIds: [retainedPreview] }),
      feedItem({
        id: 'removed01',
        coverFileId: orphanedCover,
        previewFileIds: [orphanedPreview, foreignFile]
      })
    ]
  };
  const deleted = [];
  const acknowledged = [];
  const repository = repositoryWith(cache);
  repository.acknowledgeVisualDeletes = async (fileIds) => acknowledged.push(...fileIds);
  const service = createFeedService({
    repository,
    source: {
      provider: 'test',
      loadSelected: async () => ({ etag: 'new', items: [feedItem()] })
    },
    cacheConfig: CACHE_CONFIG,
    ownedVisualPrefixes: [coverPrefix, previewPrefix],
    deleteFiles: async (fileIds) => deleted.push(...fileIds),
    now: () => NOW
  });
  await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(deleted.sort(), [orphanedCover, orphanedPreview].sort());
  assert.equal(deleted.includes(retainedPreview), false);
  assert.equal(deleted.includes(foreignFile), false);
  assert.deepEqual(acknowledged.sort(), deleted.sort());
});

test('retries the persisted visual cleanup queue on a not-modified refresh', async () => {
  const previewPrefix = 'cloud://env.bucket/knowledge-previews/source/';
  const pending = `${previewPrefix}old-item-1.jpg`;
  const foreign = 'cloud://env.bucket/user-uploads/avatar.jpg';
  const cache = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [feedItem()],
    pendingVisualDeletes: [pending, foreign]
  };
  const deleted = [];
  const acknowledged = [];
  const repository = repositoryWith(cache);
  repository.acknowledgeVisualDeletes = async (fileIds) => acknowledged.push(...fileIds);
  const service = createFeedService({
    repository,
    source: { provider: 'test', loadSelected: async () => ({ notModified: true }) },
    cacheConfig: CACHE_CONFIG,
    ownedVisualPrefixes: [previewPrefix],
    deleteFiles: async (fileIds) => deleted.push(...fileIds),
    now: () => NOW
  });
  await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(deleted, [pending]);
  assert.deepEqual(acknowledged, [pending]);
});

test('fails with the stable public error when no cache or source is available', async () => {
  const service = createFeedService({
    repository: repositoryWith(null),
    source: { provider: 'test', loadSelected: async () => { throw new Error('offline'); } },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW,
    logger: { error() {} }
  });
  await assert.rejects(() => service.getFeed(), { code: 'FEED_UNAVAILABLE' });
});

test('keeps provider pagination and normalization behind the source adapter', async () => {
  const calls = [];
  const source = createAihotSource({
    provider: 'test-source',
    apiRoot: 'https://source.example/items',
    pageSize: 1,
    maxItems: 2,
    timeoutMs: 1000
  }, async (url, options) => {
    calls.push({ url, options });
    const secondPage = url.includes('cursor=next-page');
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'etag-new' },
      json: async () => ({
        items: [{
          id: secondPage ? 'source02' : 'source01',
          title: secondPage ? '第二条' : '第一条',
          url: `https://example.com/${secondPage ? '2' : '1'}`,
          permalink: `https://example.com/p/${secondPage ? '2' : '1'}`,
          source: 'Example',
          publishedAt: '2026-07-16T00:00:00.000Z',
          category: 'ai-products',
          score: 50
        }],
        hasNext: !secondPage,
        nextCursor: secondPage ? '' : 'next-page'
      })
    };
  });
  const result = await source.loadSelected('etag-old');
  assert.equal(result.items.length, 2);
  assert.equal(result.etag, 'etag-new');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['if-none-match'], 'etag-old');
  assert.match(calls[1].url, /cursor=next-page/);
});

test('keeps cover maintenance unavailable to mini-program user contexts', async () => {
  const service = createCoverService({
    cloud: { getWXContext: () => ({ OPENID: 'user-openid' }) },
    repository: repositoryWith(null),
    fetchPublicBuffer: async () => {},
    extractCoverUrl: () => '',
    config: { imageTypes: {}, fileIdPrefix: '', cloudPathPrefix: '', maxBytes: 1, retryMs: 1 }
  });
  await assert.rejects(() => service.hydrateCovers(1), { code: 'TEMPORARY_FAILURE' });
});
