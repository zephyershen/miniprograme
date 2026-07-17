const test = require('node:test');
const assert = require('node:assert/strict');
const { createAihotSource } = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const { createFeedService } = require('../cloudfunctions/knowledgeFeed/services/feed-service');
const { createCoverService } = require('../cloudfunctions/knowledgeFeed/services/cover-service');
const { visualPathStem } = require('../cloudfunctions/knowledgeFeed/lib/visual-version');
const {
  createSourceSyncService,
  prepareRefreshedDocument
} = require('../cloudfunctions/knowledgeFeed/services/source-sync-service');
const {
  createVisualMaintenanceService
} = require('../cloudfunctions/knowledgeFeed/services/visual-maintenance-service');
const {
  createSyncCycleService,
  isVisualMaintenanceDue,
  isVisualCleanupTick
} = require('../cloudfunctions/knowledgeFeed/services/sync-cycle-service');
const {
  createVisualCleanupService
} = require('../cloudfunctions/knowledgeFeed/services/visual-cleanup-service');

const NOW = Date.parse('2026-07-16T01:00:00.000Z');
const SOURCE_SYNC_CONFIG = {
  triggerName: 'knowledge-feed-source-sync',
  leaseMs: 2 * 60 * 1000,
  itemsRevalidateMs: 15 * 60 * 1000,
  fullRefreshMs: 6 * 60 * 60 * 1000,
  rateLimitBackoffMs: 60 * 1000,
  serverErrorBaseBackoffMs: 60 * 1000,
  defaultBackoffMs: 5 * 60 * 1000,
  maxBackoffMs: 15 * 60 * 1000
};

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
    patchSourceState: async () => {},
    patchItems: async () => ({
      items: (cache && cache.items) || [],
      appliedIds: [],
      pendingVisualDeletes: []
    }),
    claimVisualDeletes: async (fileIds) => fileIds,
    acknowledgeVisualDeletes: async () => []
  };
}

function memoryRepository(initial) {
  let cache = initial;
  function assertLease(lease) {
    if (!lease) return;
    if (!cache
      || cache.sourceSyncLeaseOwner !== lease.owner
      || cache.sourceSyncLeaseUntil.getTime() <= lease.now.getTime()) {
      const error = new Error('SOURCE_SYNC_LEASE_LOST');
      error.code = 'SOURCE_SYNC_LEASE_LOST';
      throw error;
    }
  }
  const repository = {
    get: async () => cache,
    acquireSourceSyncLease: async (owner, acquiredAt, expiresAt) => {
      if (cache && cache.sourceSyncLeaseOwner
        && cache.sourceSyncLeaseUntil.getTime() > acquiredAt.getTime()) {
        return { acquired: false, document: cache };
      }
      cache = {
        ...(cache || {}),
        sourceSyncLeaseOwner: owner,
        sourceSyncLeaseAcquiredAt: acquiredAt,
        sourceSyncLeaseUntil: expiresAt
      };
      return { acquired: true, document: cache };
    },
    releaseSourceSyncLease: async (owner) => {
      if (!cache || cache.sourceSyncLeaseOwner !== owner) return false;
      cache = {
        ...cache,
        sourceSyncLeaseOwner: '',
        sourceSyncLeaseAcquiredAt: null,
        sourceSyncLeaseUntil: null
      };
      return true;
    },
    replace: async (data, prepareDocument, lease) => {
      assertLease(lease);
      const previous = cache;
      cache = {
        ...prepareDocument(data, cache),
        sourceSyncLeaseOwner: cache.sourceSyncLeaseOwner,
        sourceSyncLeaseAcquiredAt: cache.sourceSyncLeaseAcquiredAt,
        sourceSyncLeaseUntil: cache.sourceSyncLeaseUntil
      };
      return { document: cache, previous };
    },
    patchSourceState: async (fields, lease) => {
      assertLease(lease);
      cache = { ...cache, ...fields };
      return cache;
    },
    claimVisualDeletes: async (fileIds) => {
      const active = new Set(((cache && cache.items) || []).flatMap((item) => [
        item.coverFileId,
        ...(Array.isArray(item.previewFileIds) ? item.previewFileIds : [])
      ]).filter(Boolean));
      const pending = new Set((cache && cache.pendingVisualDeletes) || []);
      const claims = new Set((cache && cache.visualDeleteClaims) || []);
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
      const acknowledged = new Set(fileIds);
      cache = {
        ...cache,
        pendingVisualDeletes: (cache.pendingVisualDeletes || [])
          .filter((fileId) => !acknowledged.has(fileId)),
        visualDeleteClaims: (cache.visualDeleteClaims || [])
          .filter((fileId) => !acknowledged.has(fileId))
      };
    }
  };
  return { repository, read: () => cache };
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
  const thumbnailFileId = 'cloud://env.bucket/knowledge-thumbnails/list/item0001.jpg';
  const cache = {
    fetchedAt: new Date(NOW - 1000),
    items: [feedItem({
      previewFileIds: [previewFileId],
      previewStatus: 'ready',
      listThumbnailFileId: thumbnailFileId,
      listThumbnailVersion: 1
    })]
  };
  const service = createFeedService({
    repository: repositoryWith(cache),
    source: { provider: 'test', loadSelected: async () => { throw new Error('should not refresh'); } },
    now: () => NOW
  });
  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.equal(result.items[0].coverFileId, '');
  assert.equal(result.items[0].visualFileId, previewFileId);
  assert.equal(result.items[0].listVisualFileId, thumbnailFileId);
  assert.equal(result.items[0].visualKind, 'source-preview');
  assert.equal(result.items[0].previewStatus, undefined);
});

test('returns cached content as stale after the source synchronizer records a failure', async () => {
  const cache = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    sourceLastErrorCode: 'FEED_SOURCE_503',
    items: [readyFeedItem()]
  };
  const service = createFeedService({
    repository: repositoryWith(cache),
    source: { provider: 'test', loadSelected: async () => { throw new Error('offline'); } },
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
    now: () => NOW
  });

  stored = prepareRefreshedDocument({
    fetchedAt: new Date(NOW),
    items: [pending, ready]
  }, stored, []);
  const result = await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(stored.items.map((item) => item.id), ['pending01', 'item0001']);
  assert.deepEqual(result.items.map((item) => item.id), ['item0001']);
  assert.equal(result.totalAvailable, 1);
  assert.equal(result.facetMatrix.version, 1);
  await assert.rejects(() => service.getItem('pending01'), { code: 'ITEM_NOT_FOUND' });
});

test('keeps archived items out of the free seven-day feed and returns all screenshots only in detail', async () => {
  const previewFileIds = Array.from({ length: 5 }, (_, index) => (
    `cloud://env.bucket/knowledge-previews/source/current-${index + 1}.jpg`
  ));
  const current = feedItem({
    id: 'current01',
    coverFileId: '',
    previewFileIds,
    previewStatus: 'ready',
    publishedAt: new Date(NOW - 60 * 60 * 1000).toISOString()
  });
  const archived = readyFeedItem({
    id: 'archive01',
    publishedAt: new Date(NOW - (8 * 24 * 60 * 60 * 1000)).toISOString()
  });
  const service = createFeedService({
    repository: repositoryWith({ fetchedAt: new Date(NOW), items: [current, archived] }),
    now: () => NOW
  });

  const feed = await service.getFeed({ filters: { time: '7d' } });
  assert.deepEqual(feed.items.map((item) => item.id), ['current01']);
  assert.equal(feed.items[0].previewFileIds.length, 1);
  assert.equal(feed.items[0].previewCount, 5);
  const detail = await service.getItem('current01');
  assert.equal(detail.previewFileIds.length, 5);
  assert.equal(detail.relatedItems.length, 0);
  await assert.rejects(() => service.getItem('archive01'), { code: 'ITEM_NOT_FOUND' });
});

test('does not reuse a visual when an upstream item keeps its id but changes URL', async () => {
  const previewFileId = 'cloud://env.bucket/knowledge-previews/source/item0001-1.jpg';
  const previous = {
    fetchedAt: new Date(NOW - 60 * 60 * 1000),
    items: [feedItem({ previewFileIds: [previewFileId], previewStatus: 'ready' })]
  };
  let stored = previous;
  const repository = {
    get: async () => stored,
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
    now: () => NOW
  });

  stored = prepareRefreshedDocument({
    fetchedAt: new Date(NOW),
    items: [feedItem({ url: 'https://example.com/replaced-article' })]
  }, previous, []);
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
  const mergedCache = prepareRefreshedDocument({
    fetchedAt: new Date(NOW),
    items: [feedItem({ title: '刷新后的标题' })]
  }, latestCache, []);
  const repository = {
    get: async () => mergedCache,
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
  const memory = memoryRepository(cache);
  const repository = memory.repository;
  const acknowledgeVisualDeletes = repository.acknowledgeVisualDeletes;
  repository.acknowledgeVisualDeletes = async (fileIds) => {
    acknowledged.push(...fileIds);
    await acknowledgeVisualDeletes(fileIds);
  };
  const service = createSourceSyncService({
    repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({ selected: 'new', all: 'all', etag: 'fingerprint-new' }),
      loadSelected: async () => ({ etag: 'new', items: [feedItem()] })
    },
    config: SOURCE_SYNC_CONFIG,
    ownedVisualPrefixes: [coverPrefix, previewPrefix],
    now: () => NOW
  });
  const cleanup = createVisualCleanupService({
    repository,
    ownedVisualPrefixes: [coverPrefix, previewPrefix],
    deleteFiles: async (fileIds) => {
      deleted.push(...fileIds);
      return { deletedFileIds: fileIds, retryFileIds: [], uncertain: false };
    },
    now: () => new Date(NOW)
  });
  await service.poll();
  await cleanup.run();
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
    sourceFullSyncedAt: new Date(NOW),
    sourceAppliedFingerprint: 'same',
    sourceObservedFingerprint: 'same',
    items: [feedItem()],
    pendingVisualDeletes: [deletedBeforeAck, retryAfterPartial, foreign],
    visualDeleteClaims: []
  };
  let cleanupAttempt = 0;
  let acknowledgeAttempt = 0;
  const deleteCalls = [];
  function assertLease(lease) {
    if (cache.sourceSyncLeaseOwner !== lease.owner
      || cache.sourceSyncLeaseUntil.getTime() <= lease.now.getTime()) {
      const error = new Error('SOURCE_SYNC_LEASE_LOST');
      error.code = 'SOURCE_SYNC_LEASE_LOST';
      throw error;
    }
  }
  const repository = {
    get: async () => cache,
    acquireSourceSyncLease: async (owner, acquiredAt, expiresAt) => {
      if (cache.sourceSyncLeaseOwner
        && cache.sourceSyncLeaseUntil.getTime() > acquiredAt.getTime()) {
        return { acquired: false, document: cache };
      }
      cache = {
        ...cache,
        sourceSyncLeaseOwner: owner,
        sourceSyncLeaseAcquiredAt: acquiredAt,
        sourceSyncLeaseUntil: expiresAt
      };
      return { acquired: true, document: cache };
    },
    releaseSourceSyncLease: async (owner) => {
      if (cache.sourceSyncLeaseOwner !== owner) return false;
      cache = {
        ...cache,
        sourceSyncLeaseOwner: '',
        sourceSyncLeaseAcquiredAt: null,
        sourceSyncLeaseUntil: null
      };
      return true;
    },
    patchSourceState: async (fields, lease) => {
      assertLease(lease);
      cache = { ...cache, ...fields };
      return cache;
    },
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
  const cleanup = createVisualCleanupService({
    repository,
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
    now: () => new Date(NOW),
    logger: { warn() {}, error() {} }
  });

  await cleanup.run();
  assert.deepEqual(cache.pendingVisualDeletes, [foreign]);
  assert.deepEqual(cache.visualDeleteClaims.sort(), [deletedBeforeAck, retryAfterPartial].sort());

  await cleanup.run();
  assert.deepEqual(deleteCalls[1].sort(), [deletedBeforeAck, retryAfterPartial].sort());
  assert.deepEqual(cache.visualDeleteClaims, []);
  assert.deepEqual(cache.pendingVisualDeletes, [foreign]);
});

test('fails with the stable public error when no cache or source is available', async () => {
  const service = createFeedService({
    repository: repositoryWith(null),
    source: { provider: 'test', loadSelected: async () => { throw new Error('offline'); } },
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

test('runs only due preview retries during scheduled visual maintenance', async () => {
  const calls = [];
  const service = createVisualMaintenanceService({
    sourceSyncService: {
      ensureCache: async () => {
        calls.push(['cache']);
        return { fetchedAt: '2026-07-16T01:00:00.000Z', sourceLastErrorCode: '' };
      }
    },
    coverService: {
      hydrateCovers: async () => { throw new Error('scheduled maintenance must not ingest new covers'); }
    },
    previewService: {
      hydratePreviews: async (limit, force, token, options) => {
        calls.push(['previews', limit, force, token, options]);
        return { attempted: 1, resolved: 1 };
      },
      maintenanceStatus: async (token) => {
        calls.push(['status', token]);
        return { totalItems: 2, totalWithVisuals: 2 };
      }
    },
    previewMaintenanceToken: 'm'.repeat(40),
    config: {
      coverBatchSize: 9,
      previewBatchSize: 1,
      immediateCoverBatchSize: 3,
      immediatePreviewBatchSize: 1
    },
    logger: { info() {} }
  });

  const result = await service.runMaintenance();
  assert.equal(result.publication.totalWithVisuals, 2);
  assert.equal(result.covers.skipped, true);
  assert.deepEqual(calls, [
    ['cache'],
    ['previews', 1, false, 'm'.repeat(40), { retryOnly: true }],
    ['status', 'm'.repeat(40)]
  ]);
});

test('runs visual cleanup at most hourly unless explicitly forced', async () => {
  let clock = new Date('2026-07-16T01:00:00.000Z');
  let cleanupCalls = 0;
  const cache = {
    fetchedAt: clock,
    sourceLastErrorCode: '',
    visualCleanupCheckedAt: new Date('2026-07-16T00:30:00.000Z')
  };
  const service = createVisualMaintenanceService({
    repository: {
      patchSourceState: async (fields) => { Object.assign(cache, fields); }
    },
    sourceSyncService: { ensureCache: async () => cache },
    coverService: { hydrateCovers: async () => { throw new Error('cover ingestion is not maintenance'); } },
    previewService: {
      hydratePreviews: async () => ({ attempted: 0, resolved: 0, failed: 0 }),
      maintenanceStatus: async () => ({ totalItems: 0, totalWithVisuals: 0 })
    },
    cleanupService: {
      run: async () => {
        cleanupCalls += 1;
        return { attempted: 2, deleted: 2, retry: 0 };
      }
    },
    previewMaintenanceToken: 'm'.repeat(40),
    config: { previewBatchSize: 1, leaseMs: 4 * 60 * 1000 },
    now: () => clock.getTime(),
    logger: { info() {}, warn() {} }
  });

  const early = await service.runMaintenance();
  assert.equal(early.cleanup.skipped, true);
  assert.equal(cleanupCalls, 0);

  clock = new Date('2026-07-16T01:30:00.000Z');
  const due = await service.runMaintenance();
  assert.equal(due.cleanup.skipped, false);
  assert.equal(cleanupCalls, 1);
  assert.equal(cache.visualCleanupCheckedAt.toISOString(), '2026-07-16T01:30:00.000Z');

  clock = new Date('2026-07-16T01:35:00.000Z');
  const skipped = await service.runMaintenance();
  assert.equal(skipped.cleanup.skipped, true);
  assert.equal(cleanupCalls, 1);

  const forced = await service.runMaintenance({ forceCleanup: true });
  assert.equal(forced.cleanup.skipped, false);
  assert.equal(cleanupCalls, 2);
});

test('runs visual maintenance every five scheduled minutes in the single timer cycle', async () => {
  const calls = [];
  const maintenanceOptions = [];
  const service = createSyncCycleService({
    sourceSyncService: {
      run: async () => {
        calls.push('source');
        return { triggerName: 'knowledge-feed-source-sync', status: 'unchanged' };
      }
    },
    visualMaintenanceService: {
      preparePendingPublication: async () => {
        calls.push('immediate');
        return { publication: { totalWithVisuals: 2 } };
      },
      runMaintenance: async (options) => {
        calls.push('maintenance');
        maintenanceOptions.push(options);
        return { publication: { totalWithVisuals: 2 } };
      }
    },
    visualIntervalMinutes: 5
  });

  const dueEvent = { Time: '2026-07-17T00:10:00.000Z' };
  const idleEvent = { Time: '2026-07-17T00:11:00.000Z' };
  assert.equal(isVisualMaintenanceDue(dueEvent, 5), true);
  assert.equal(isVisualMaintenanceDue(idleEvent, 5), false);
  assert.equal(isVisualCleanupTick(dueEvent), false);
  assert.equal(isVisualCleanupTick({ Time: '2026-07-17T01:00:00.000Z' }), true);
  const due = await service.run(dueEvent);
  const idle = await service.run(idleEvent);
  assert.equal(due.visualMaintenance.publication.totalWithVisuals, 2);
  assert.equal(idle.visualMaintenance, null);
  assert.deepEqual(calls, [
    'source', 'immediate', 'maintenance',
    'source', 'immediate'
  ]);
  assert.deepEqual(maintenanceOptions, [{ forceCleanup: false }]);
});

test('prepares newly discovered item visuals in the same minute cycle', async () => {
  const prepared = [];
  let archiveCalls = 0;
  const service = createSyncCycleService({
    sourceSyncService: {
      run: async () => ({
        triggerName: 'knowledge-feed-source-sync',
        status: 'updated',
        changed: true,
        pendingVisualItemIds: ['newitem01', 'newitem02']
      })
    },
    archiveService: {
      run: async () => { archiveCalls += 1; return { status: 'ready' }; }
    },
    visualMaintenanceService: {
      preparePendingPublication: async (itemIds) => {
        prepared.push(...itemIds);
        return {
          covers: { attempted: 2 },
          previews: { attempted: 0 },
          publication: { pendingPublication: 0 }
        };
      },
      runMaintenance: async () => ({ publication: { pendingPublication: 0 } })
    },
    visualIntervalMinutes: 5
  });

  const result = await service.run({ Time: '2026-07-17T00:10:00.000Z' });
  assert.deepEqual(prepared, ['newitem01', 'newitem02']);
  assert.equal(result.pendingVisualCount, 2);
  assert.equal(archiveCalls, 0);
  assert.deepEqual(result.archive, { status: 'deferred', reason: 'immediate-visuals' });
  assert.equal(result.visualMaintenance, null);
  assert.equal(result.visualMaintenanceDeferred, 'immediate-visuals');
});
