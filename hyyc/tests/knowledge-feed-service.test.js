const test = require('node:test');
const assert = require('node:assert/strict');
const { createAihotSource } = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const { createFeedService } = require('../cloudfunctions/knowledgeFeed/services/feed-service');
const { createCoverService } = require('../cloudfunctions/knowledgeFeed/services/cover-service');
const { visualPathStem } = require('../cloudfunctions/knowledgeFeed/lib/visual-version');
const {
  createVisualMaintenanceService,
  isVisualMaintenanceEvent
} = require('../cloudfunctions/knowledgeFeed/services/visual-maintenance-service');

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

function readyFeedItem(overrides = {}) {
  return feedItem({
    coverFileId: 'cloud://env.bucket/knowledge-covers/ready.jpg',
    coverStatus: 'ready',
    ...overrides
  });
}

function repositoryWith(cache) {
  return {
    get: async () => cache,
    replace: async (data, prepareDocument) => ({
      document: prepareDocument(data, cache),
      previous: cache
    }),
    touch: async () => {},
    patchItems: async () => ({
      items: (cache && cache.items) || [],
      appliedIds: [],
      pendingVisualDeletes: []
    }),
    claimVisualDeletes: async (fileIds) => fileIds,
    acknowledgeVisualDeletes: async () => []
  };
}

test('serves the existing public feed contract through the feed service boundary', async () => {
  const cache = {
    fetchedAt: new Date(NOW - 1000),
    items: [
      readyFeedItem(),
      readyFeedItem({ id: 'item0002', publishedAt: '2026-07-15T23:00:00.000Z', score: 90 })
    ]
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
  const cache = { fetchedAt: new Date(NOW - 60 * 60 * 1000), items: [readyFeedItem()] };
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

test('stages refreshed items until a cover or source preview is ready', async () => {
  const ready = readyFeedItem();
  const pending = feedItem({
    id: 'pending01',
    title: '等待截图的新资讯',
    url: 'https://example.com/pending',
    publishedAt: '2026-07-16T00:30:00.000Z'
  });
  let stored = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [ready]
  };
  const repository = {
    get: async () => stored,
    replace: async (data, prepareDocument) => {
      const previous = stored;
      stored = prepareDocument(data, stored);
      return { document: stored, previous };
    },
    acknowledgeVisualDeletes: async () => []
  };
  const service = createFeedService({
    repository,
    source: { provider: 'test', loadSelected: async () => ({ etag: 'new', items: [pending, ready] }) },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW
  });

  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(stored.items.map((item) => item.id), ['pending01', 'item0001']);
  assert.deepEqual(result.items.map((item) => item.id), ['item0001']);
  assert.equal(result.totalAvailable, 1);
  assert.equal(result.facets.length, 1);
  await assert.rejects(() => service.getItem('pending01'), { code: 'ITEM_NOT_FOUND' });
});

test('does not reuse a visual when an upstream item keeps its id but changes URL', async () => {
  const previewFileId = 'cloud://env.bucket/knowledge-previews/source/item0001-1.jpg';
  const previous = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [feedItem({ previewFileIds: [previewFileId], previewStatus: 'ready' })]
  };
  let stored = previous;
  const repository = {
    get: async () => previous,
    replace: async (data, prepareDocument) => {
      stored = prepareDocument(data, previous);
      return { document: stored, previous };
    },
    acknowledgeVisualDeletes: async () => []
  };
  const service = createFeedService({
    repository,
    source: {
      provider: 'test',
      loadSelected: async () => ({
        etag: 'new',
        items: [feedItem({ url: 'https://example.com/replaced-article' })]
      })
    },
    cacheConfig: CACHE_CONFIG,
    now: () => NOW
  });

  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.equal(result.items.length, 0);
  assert.deepEqual(stored.items[0].previewFileIds, []);
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
    deleteFiles: async (fileIds) => {
      deleted.push(...fileIds);
      return { deletedFileIds: fileIds, retryFileIds: [], uncertain: false };
    },
    now: () => NOW
  });
  await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(deleted.sort(), [orphanedCover, orphanedPreview].sort());
  assert.equal(deleted.includes(retainedPreview), false);
  assert.equal(deleted.includes(foreignFile), false);
  assert.deepEqual(acknowledged.sort(), deleted.sort());
});

test('keeps partial and unacknowledged visual deletes claimed until a later retry succeeds', async () => {
  const previewPrefix = 'cloud://env.bucket/knowledge-previews/source/';
  const deletedBeforeAck = `${previewPrefix}old-item-1.jpg`;
  const retryAfterPartial = `${previewPrefix}old-item-2.jpg`;
  const foreign = 'cloud://env.bucket/user-uploads/avatar.jpg';
  let cache = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [feedItem()],
    pendingVisualDeletes: [deletedBeforeAck, retryAfterPartial, foreign],
    visualDeleteClaims: []
  };
  let cleanupAttempt = 0;
  let acknowledgeAttempt = 0;
  const deleteCalls = [];
  const repository = {
    get: async () => cache,
    touch: async () => {},
    claimVisualDeletes: async (fileIds) => {
      const active = new Set(cache.items.flatMap((item) => [
        item.coverFileId,
        ...(Array.isArray(item.previewFileIds) ? item.previewFileIds : [])
      ]).filter(Boolean));
      const pending = new Set(cache.pendingVisualDeletes);
      const claims = new Set(cache.visualDeleteClaims);
      const claimed = fileIds.filter((fileId) => !active.has(fileId)
        && (pending.has(fileId) || claims.has(fileId)));
      claimed.forEach((fileId) => {
        pending.delete(fileId);
        claims.add(fileId);
      });
      cache = { ...cache, pendingVisualDeletes: [...pending], visualDeleteClaims: [...claims] };
      return claimed;
    },
    acknowledgeVisualDeletes: async (fileIds) => {
      acknowledgeAttempt += 1;
      if (acknowledgeAttempt === 1) throw new Error('database unavailable');
      const acknowledged = new Set(fileIds);
      cache = {
        ...cache,
        pendingVisualDeletes: cache.pendingVisualDeletes.filter((fileId) => !acknowledged.has(fileId)),
        visualDeleteClaims: cache.visualDeleteClaims.filter((fileId) => !acknowledged.has(fileId))
      };
    }
  };
  const service = createFeedService({
    repository,
    source: { provider: 'test', loadSelected: async () => ({ notModified: true }) },
    cacheConfig: CACHE_CONFIG,
    ownedVisualPrefixes: [previewPrefix],
    deleteFiles: async (fileIds) => {
      cleanupAttempt += 1;
      deleteCalls.push([...fileIds]);
      if (cleanupAttempt === 1) {
        return {
          deletedFileIds: [deletedBeforeAck],
          retryFileIds: [retryAfterPartial],
          uncertain: true
        };
      }
      return { deletedFileIds: fileIds, retryFileIds: [], uncertain: false };
    },
    now: () => NOW,
    logger: { warn() {}, error() {} }
  });

  await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(cache.pendingVisualDeletes, [foreign]);
  assert.deepEqual(cache.visualDeleteClaims.sort(), [deletedBeforeAck, retryAfterPartial].sort());

  await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(deleteCalls[1].sort(), [deletedBeforeAck, retryAfterPartial].sort());
  assert.deepEqual(cache.visualDeleteClaims, []);
  assert.deepEqual(cache.pendingVisualDeletes, [foreign]);
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

test('uploads a unique cover revision and writes it only for the current source URL', async () => {
  const item = feedItem();
  const prefix = 'cloud://env.bucket/knowledge-covers/';
  const cloudPaths = [];
  const receivedPatches = [];
  const service = createCoverService({
    cloud: {
      getWXContext: () => ({}),
      uploadFile: async ({ cloudPath }) => {
        cloudPaths.push(cloudPath);
        return { fileID: `${prefix}${cloudPath.replace(/^knowledge-covers\//, '')}` };
      }
    },
    repository: {
      get: async () => ({ items: [item] }),
      patchItems: async (patches) => {
        receivedPatches.push(patches[0]);
        return { items: [{ ...item, ...patches[0].fields }], appliedIds: [item.id] };
      }
    },
    fetchPublicBuffer: async (url) => url === item.url
      ? {
        headers: { 'content-type': 'text/html; charset=utf-8' },
        finalUrl: item.url,
        buffer: Buffer.from('<html></html>')
      }
      : {
        headers: { 'content-type': 'image/jpeg' },
        finalUrl: url,
        buffer: Buffer.from('jpeg')
      },
    extractCoverUrl: () => 'https://cdn.example/cover.jpg',
    config: {
      imageTypes: { 'image/jpeg': 'jpg' },
      fileIdPrefix: prefix,
      cloudPathPrefix: 'knowledge-covers/',
      maxBytes: 1024,
      retryMs: 1
    }
  });

  const first = await service.hydrateCovers(1, true, true);
  const second = await service.hydrateCovers(1, true, true);
  assert.equal(first.stale, 0);
  assert.equal(second.stale, 0);
  const firstFileId = receivedPatches[0].fields.coverFileId;
  const secondFileId = receivedPatches[1].fields.coverFileId;
  assert.notEqual(firstFileId, secondFileId);
  assert.match(firstFileId, new RegExp(`${visualPathStem(item)}-[a-f0-9]{12}\\.jpg$`));
  assert.match(secondFileId, new RegExp(`${visualPathStem(item)}-[a-f0-9]{12}\\.jpg$`));
  assert.equal(cloudPaths.length, 2);
  assert.equal(receivedPatches[0].expectedUrl, item.url);
  assert.deepEqual(receivedPatches[0].discardFileIds, [firstFileId]);
});

test('runs visual preparation only for the configured timer trigger', async () => {
  const triggerName = 'knowledge-feed-visual-sync';
  const event = { Type: 'Timer', TriggerName: triggerName };
  assert.equal(isVisualMaintenanceEvent(event, triggerName, 'timer'), true);
  assert.equal(isVisualMaintenanceEvent(event, triggerName, 'api'), false);
  assert.equal(isVisualMaintenanceEvent({ ...event, TriggerName: 'other' }, triggerName, 'timer'), false);

  const calls = [];
  const service = createVisualMaintenanceService({
    cloud: { getWXContext: () => ({}) },
    feedService: {
      getFeed: async (query) => {
        calls.push(['feed', query]);
        return { updatedAt: '2026-07-16T01:00:00.000Z', stale: false };
      }
    },
    coverService: {
      hydrateCovers: async (limit, force, scheduled) => {
        calls.push(['covers', limit, force, scheduled]);
        return { attempted: 1, resolved: 0, missing: 1 };
      }
    },
    previewService: {
      hydratePreviews: async (limit, force, token) => {
        calls.push(['previews', limit, force, token]);
        return { attempted: 1, resolved: 1 };
      },
      maintenanceStatus: async (token) => {
        calls.push(['status', token]);
        return { totalItems: 2, totalWithVisuals: 2 };
      }
    },
    previewMaintenanceToken: 'm'.repeat(40),
    config: { triggerName, coverBatchSize: 9, previewBatchSize: 2 },
    triggerSource: 'timer',
    logger: { info() {} }
  });

  const result = await service.run(event);
  assert.equal(result.status.totalWithVisuals, 2);
  assert.deepEqual(calls, [
    ['feed', { limit: 1 }],
    ['covers', 9, false, true],
    ['previews', 2, false, 'm'.repeat(40)],
    ['status', 'm'.repeat(40)]
  ]);

  const userService = createVisualMaintenanceService({
    cloud: { getWXContext: () => ({ OPENID: 'user-openid' }) },
    feedService: {},
    coverService: {},
    previewService: {},
    previewMaintenanceToken: 'm'.repeat(40),
    config: { triggerName, coverBatchSize: 9, previewBatchSize: 2 },
    triggerSource: 'api'
  });
  await assert.rejects(() => userService.run(event), { code: 'TEMPORARY_FAILURE' });
});
