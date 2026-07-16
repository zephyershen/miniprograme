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
    set: async () => {},
    touch: async () => {},
    updateItems: async () => {}
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
