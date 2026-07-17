const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAihotSource,
  parseRetryAfter
} = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const {
  createSourceSyncService,
  isSourceSyncEvent,
  prepareRefreshedDocument,
  retryDelay
} = require('../cloudfunctions/knowledgeFeed/services/source-sync-service');
const {
  resolveScheduledTrigger
} = require('../cloudfunctions/knowledgeFeed/policies/timer-trigger');
const {
  createFeedCacheRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-cache');
const {
  ITEM_STORE_CONFIG,
  SOURCE_SYNC_CONFIG
} = require('../cloudfunctions/knowledgeFeed/config');

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const CONFIG = {
  triggerName: 'knowledge-feed-source-sync',
  leaseMs: 2 * 60 * 1000,
  itemsRevalidateMs: 60 * 60 * 1000,
  fullRefreshMs: 6 * 60 * 60 * 1000,
  rateLimitBackoffMs: 60 * 1000,
  serverErrorBaseBackoffMs: 60 * 1000,
  defaultBackoffMs: 5 * 60 * 1000,
  maxBackoffMs: 15 * 60 * 1000
};

test('uses minute fingerprints with six-hour conditional validation and a daily integrity refresh', () => {
  assert.equal(SOURCE_SYNC_CONFIG.itemsRevalidateMs, 6 * 60 * 60 * 1000);
  assert.equal(ITEM_STORE_CONFIG.itemsRevalidateMs, 6 * 60 * 60 * 1000);
  assert.equal(SOURCE_SYNC_CONFIG.fullRefreshMs, 24 * 60 * 60 * 1000);
  assert.equal(ITEM_STORE_CONFIG.fullRefreshMs, 24 * 60 * 60 * 1000);
});

function item(overrides = {}) {
  return {
    id: 'item0001',
    title: '测试资讯',
    url: 'https://example.com/article',
    items: [],
    ...overrides
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
  return {
    repository: {
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
      patchSourceState: async (fields, lease) => {
        assertLease(lease);
        cache = { ...cache, ...fields };
        return cache;
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
      claimVisualDeletes: async () => [],
      acknowledgeVisualDeletes: async () => []
    },
    read: () => cache
  };
}

function baseCache(overrides = {}) {
  return {
    etag: 'W/"items-old"',
    fingerprintEtag: 'W/"fingerprint-old"',
    sourceObservedFingerprint: 'selected-old',
    sourceObservedAllFingerprint: 'all-old',
    sourceAppliedFingerprint: 'selected-old',
    fetchedAt: new Date(NOW - 60 * 1000),
    sourceFullSyncedAt: new Date(NOW - 60 * 1000),
    items: [item()],
    pendingVisualDeletes: [],
    visualDeleteClaims: [],
    ...overrides
  };
}

test('loads the opaque selected fingerprint and preserves a weak ETag on 304', async () => {
  const calls = [];
  const source = createAihotSource({
    provider: 'test',
    apiRoot: 'https://source.example/items',
    fingerprintRoot: 'https://source.example/fingerprint',
    pageSize: 100,
    maxItems: 120,
    timeoutMs: 1000
  }, async (url, options) => {
    calls.push({ url, options });
    if (options.headers['if-none-match']) {
      return {
        ok: false,
        status: 304,
        headers: { get: (name) => name === 'etag' ? 'W/"fingerprint-1"' : null },
        json: async () => { throw new Error('304 must not parse JSON'); }
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'etag' ? 'W/"fingerprint-1"' : null },
      json: async () => ({
        selected: 'v2:any-opaque-value',
        all: 'another-opaque-value',
        futureField: true
      })
    };
  });

  const first = await source.loadFingerprint();
  const second = await source.loadFingerprint(first.etag);
  assert.equal(first.selected, 'v2:any-opaque-value');
  assert.equal(first.all, 'another-opaque-value');
  assert.equal(first.etag, 'W/"fingerprint-1"');
  assert.equal(second.notModified, true);
  assert.equal(calls[1].options.headers['if-none-match'], 'W/"fingerprint-1"');
  assert.doesNotMatch(calls[0].options.headers['user-agent'], /Mozilla|Chrome|Headless/i);
});

test('does not load items when only the all-mode fingerprint changes', async () => {
  const memory = memoryRepository(baseCache());
  let itemCalls = 0;
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({
        selected: 'selected-old',
        all: 'all-new',
        etag: 'W/"fingerprint-new"'
      }),
      loadSelected: async () => { itemCalls += 1; return { items: [] }; }
    },
    config: CONFIG,
    now: () => NOW
  });

  const result = await service.poll();
  assert.equal(result.status, 'unchanged');
  assert.equal(itemCalls, 0);
  assert.equal(memory.read().sourceObservedAllFingerprint, 'all-new');
});

test('preserves the renderer capture version with reusable source previews', () => {
  const previewFileId = 'cloud://env.bucket/knowledge-previews/source/item0001-v2-1.jpg';
  const previous = baseCache({
    items: [item({
      previewFileIds: [previewFileId],
      previewStatus: 'ready',
      previewCaptureVersion: 2
    })]
  });
  const refreshed = prepareRefreshedDocument({
    items: [item()]
  }, previous, ['cloud://env.bucket/knowledge-previews/source/']);
  assert.deepEqual(refreshed.items[0].previewFileIds, [previewFileId]);
  assert.equal(refreshed.items[0].previewCaptureVersion, 2);
});

test('loads items once when selected changes and advances applied only after success', async () => {
  const historyCheckedAt = new Date(NOW - (5 * 60 * 1000));
  const visualLeaseUntil = new Date(NOW + (60 * 1000));
  const memory = memoryRepository(baseCache({
    archiveDailyDates: ['2026-07-16', '2026-07-15'],
    archiveHistoryCheckedAt: historyCheckedAt,
    archiveStats: { dayCount: 2, itemCount: 40 },
    visualLeaseOwner: 'visual-worker',
    visualLeaseUntil
  }));
  let itemCalls = 0;
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({
        selected: 'selected-new',
        all: 'all-new',
        etag: 'W/"fingerprint-new"'
      }),
      loadSelected: async (etag) => {
        itemCalls += 1;
        assert.equal(etag, '');
        return { etag: 'W/"items-new"', items: [item({ title: '新资讯' })] };
      }
    },
    config: CONFIG,
    now: () => NOW
  });

  const result = await service.poll();
  assert.equal(result.status, 'updated');
  assert.equal(result.fingerprintChanged, true);
  assert.equal(itemCalls, 1);
  assert.deepEqual(result.pendingVisualItemIds, ['item0001']);
  assert.equal(memory.read().sourceObservedFingerprint, 'selected-new');
  assert.equal(memory.read().sourceAppliedFingerprint, 'selected-new');
  assert.equal(memory.read().items[0].title, '新资讯');
  assert.deepEqual(memory.read().archiveDailyDates, ['2026-07-16', '2026-07-15']);
  assert.equal(memory.read().archiveHistoryCheckedAt, historyCheckedAt);
  assert.deepEqual(memory.read().archiveStats, { dayCount: 2, itemCount: 40 });
  assert.equal(memory.read().visualLeaseOwner, 'visual-worker');
  assert.equal(memory.read().visualLeaseUntil, visualLeaseUntil);
});

test('keeps a changed fingerprint pending when items fail and applies shared backoff', async () => {
  const memory = memoryRepository(baseCache());
  let fingerprintCalls = 0;
  let itemCalls = 0;
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => {
        fingerprintCalls += 1;
        return { selected: 'selected-new', all: 'all-new', etag: 'fingerprint-new' };
      },
      loadSelected: async () => {
        itemCalls += 1;
        const error = new Error('FEED_SOURCE_503');
        error.status = 503;
        throw error;
      }
    },
    config: CONFIG,
    now: () => NOW,
    random: () => 0.5,
    logger: { warn() {}, info() {} }
  });

  const failed = await service.poll();
  const backedOff = await service.poll();
  assert.equal(failed.status, 'failed');
  assert.equal(backedOff.status, 'backoff');
  assert.equal(fingerprintCalls, 1);
  assert.equal(itemCalls, 1);
  assert.equal(memory.read().sourceObservedFingerprint, 'selected-new');
  assert.equal(memory.read().sourceAppliedFingerprint, 'selected-old');
  assert.equal(memory.read().sourceLastErrorCode, 'FEED_SOURCE_503');
});

test('revalidates items conditionally after sixty minutes even when fingerprint is unchanged', async () => {
  const memory = memoryRepository(baseCache({
    fetchedAt: new Date(NOW - (61 * 60 * 1000)),
    sourceFullSyncedAt: new Date(NOW - (61 * 60 * 1000))
  }));
  const itemEtags = [];
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({ notModified: true, etag: 'W/"fingerprint-old"' }),
      loadSelected: async (etag) => {
        itemEtags.push(etag);
        return { notModified: true, etag };
      }
    },
    config: CONFIG,
    now: () => NOW
  });

  const result = await service.poll();
  assert.equal(result.status, 'validated');
  assert.deepEqual(itemEtags, ['W/"items-old"']);
  assert.equal(memory.read().fetchedAt.toISOString(), new Date(NOW).toISOString());
});

test('forces a complete multi-page refresh at the integrity interval', async () => {
  const memory = memoryRepository(baseCache({
    sourceFullSyncedAt: new Date(NOW - (7 * 60 * 60 * 1000))
  }));
  const itemEtags = [];
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({ notModified: true, etag: 'W/"fingerprint-old"' }),
      loadSelected: async (etag) => {
        itemEtags.push(etag);
        return { etag: 'W/"items-new"', items: [item()] };
      }
    },
    config: CONFIG,
    now: () => NOW
  });

  const result = await service.poll();
  assert.equal(result.status, 'updated');
  assert.deepEqual(itemEtags, ['']);
});

test('coalesces concurrent source polls into one fingerprint request', async () => {
  const memory = memoryRepository(baseCache());
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => {
        calls += 1;
        await gate;
        return { notModified: true, etag: 'fingerprint-old' };
      },
      loadSelected: async () => { throw new Error('items should not load'); }
    },
    config: CONFIG,
    now: () => NOW
  });

  const first = service.poll();
  const second = service.poll();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('shares one distributed lease across service instances', async () => {
  const memory = memoryRepository(baseCache());
  let itemCalls = 0;
  let itemStarted;
  let releaseItem;
  const started = new Promise((resolve) => { itemStarted = resolve; });
  const gate = new Promise((resolve) => { releaseItem = resolve; });
  const source = {
    provider: 'test',
    loadFingerprint: async () => ({ selected: 'selected-new', all: 'all-new', etag: 'fingerprint-new' }),
    loadSelected: async () => {
      itemCalls += 1;
      itemStarted();
      await gate;
      return { etag: 'items-new', items: [item()] };
    }
  };
  const firstService = createSourceSyncService({
    repository: memory.repository,
    source,
    config: CONFIG,
    now: () => NOW,
    createLeaseOwner: () => 'lease-first'
  });
  const secondService = createSourceSyncService({
    repository: memory.repository,
    source,
    config: CONFIG,
    now: () => NOW,
    createLeaseOwner: () => 'lease-second'
  });

  const first = firstService.poll();
  await started;
  const second = await secondService.poll();
  releaseItem();
  const completed = await first;
  assert.equal(second.status, 'busy');
  assert.equal(completed.status, 'updated');
  assert.equal(itemCalls, 1);
});

test('enforces source leases in the persistent repository transaction boundary', async () => {
  let stored = null;
  const reference = {
    get: async () => {
      if (!stored) {
        const error = new Error('document not found');
        error.errCode = -1;
        throw error;
      }
      return { data: stored };
    },
    set: async ({ data }) => { stored = data; },
    update: async ({ data }) => { stored = { ...stored, ...data }; }
  };
  const repository = createFeedCacheRepository({
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: () => reference })
    })
  }, { collectionName: 'feed', documentId: 'selected' });

  const first = await repository.acquireSourceSyncLease(
    'lease-first', new Date(NOW), new Date(NOW + 1000)
  );
  const busy = await repository.acquireSourceSyncLease(
    'lease-second', new Date(NOW + 1), new Date(NOW + 1001)
  );
  assert.equal(first.acquired, true);
  assert.equal(busy.acquired, false);
  await repository.patchSourceState({ marker: 'first' }, {
    owner: 'lease-first', now: new Date(NOW + 500)
  });
  await assert.rejects(() => repository.patchSourceState({ marker: 'late' }, {
    owner: 'lease-first', now: new Date(NOW + 1000)
  }), /SOURCE_SYNC_LEASE_LOST/);

  const second = await repository.acquireSourceSyncLease(
    'lease-second', new Date(NOW + 1000), new Date(NOW + 2000)
  );
  assert.equal(second.acquired, true);
  await assert.rejects(() => repository.replace({ items: [item()] }, (next) => next, {
    owner: 'lease-first', now: new Date(NOW + 1001)
  }), /SOURCE_SYNC_LEASE_LOST/);
  assert.equal(stored.marker, 'first');
});

test('prevents an expired lease owner from overwriting a newer snapshot', async () => {
  const memory = memoryRepository(baseCache());
  let clock = NOW;
  let fingerprintStarted;
  let releaseFingerprint;
  const started = new Promise((resolve) => { fingerprintStarted = resolve; });
  const gate = new Promise((resolve) => { releaseFingerprint = resolve; });
  const older = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => {
        fingerprintStarted();
        await gate;
        return { selected: 'selected-older', all: 'all-older', etag: 'fingerprint-older' };
      },
      loadSelected: async () => ({ etag: 'items-older', items: [item({ title: 'older' })] })
    },
    config: CONFIG,
    now: () => clock,
    createLeaseOwner: () => 'lease-older'
  });
  const newer = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({
        selected: 'selected-newer', all: 'all-newer', etag: 'fingerprint-newer'
      }),
      loadSelected: async () => ({ etag: 'items-newer', items: [item({ title: 'newer' })] })
    },
    config: CONFIG,
    now: () => clock,
    createLeaseOwner: () => 'lease-newer'
  });

  const oldPoll = older.poll();
  await started;
  clock += CONFIG.leaseMs + 1;
  const newPoll = await newer.poll();
  releaseFingerprint();
  const oldResult = await oldPoll;
  assert.equal(newPoll.status, 'updated');
  assert.equal(oldResult.status, 'superseded');
  assert.equal(memory.read().sourceAppliedFingerprint, 'selected-newer');
  assert.equal(memory.read().items[0].title, 'newer');
});

test('keeps poll summaries and ensureCache documents type-safe during cold start', async () => {
  const memory = memoryRepository(null);
  let fingerprintStarted;
  let releaseFingerprint;
  const started = new Promise((resolve) => { fingerprintStarted = resolve; });
  const gate = new Promise((resolve) => { releaseFingerprint = resolve; });
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => {
        fingerprintStarted();
        await gate;
        return { selected: 'selected-new', all: 'all-new', etag: 'fingerprint-new' };
      },
      loadSelected: async () => ({ etag: 'items-new', items: [item()] })
    },
    config: CONFIG,
    now: () => NOW,
    createLeaseOwner: () => 'lease-cold-start'
  });

  const polling = service.poll();
  await started;
  const ensuring = service.ensureCache();
  releaseFingerprint();
  const [pollResult, cache] = await Promise.all([polling, ensuring]);
  assert.equal(pollResult.status, 'updated');
  assert.equal(cache.items.length, 1);
  assert.equal(cache.status, undefined);
});

test('persists cold-start rate-limit backoff and does not retry upstream early', async () => {
  const memory = memoryRepository(null);
  let fingerprintCalls = 0;
  let itemCalls = 0;
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => {
        fingerprintCalls += 1;
        return { selected: 'selected-new', all: 'all-new', etag: 'fingerprint-new' };
      },
      loadSelected: async () => {
        itemCalls += 1;
        const error = new Error('FEED_SOURCE_429');
        error.status = 429;
        throw error;
      }
    },
    config: CONFIG,
    now: () => NOW,
    logger: { warn() {}, info() {} }
  });

  await assert.rejects(() => service.ensureCache(), /FEED_SOURCE_UNAVAILABLE/);
  await assert.rejects(() => service.ensureCache(), /FEED_SOURCE_UNAVAILABLE/);
  assert.equal(fingerprintCalls, 1);
  assert.equal(itemCalls, 1);
  assert.equal(memory.read().sourcePollFailures, 1);
  assert.equal(memory.read().sourceLastErrorCode, 'FEED_SOURCE_429');
});

test('increments exponential backoff across consecutive item failures', async () => {
  const memory = memoryRepository(baseCache());
  let clock = NOW;
  const service = createSourceSyncService({
    repository: memory.repository,
    source: {
      provider: 'test',
      loadFingerprint: async () => ({
        selected: 'selected-new', all: 'all-new', etag: 'fingerprint-new'
      }),
      loadSelected: async () => {
        const error = new Error('FEED_SOURCE_503');
        error.status = 503;
        throw error;
      }
    },
    config: CONFIG,
    now: () => clock,
    random: () => 0.5,
    logger: { warn() {}, info() {} }
  });

  await service.poll();
  assert.equal(memory.read().sourcePollFailures, 1);
  assert.equal(memory.read().sourceNextPollAt.getTime() - clock, 60 * 1000);
  clock += 60 * 1000;
  await service.poll();
  assert.equal(memory.read().sourcePollFailures, 2);
  assert.equal(memory.read().sourceNextPollAt.getTime() - clock, 2 * 60 * 1000);
  clock += 2 * 60 * 1000;
  await service.poll();
  assert.equal(memory.read().sourcePollFailures, 3);
  assert.equal(memory.read().sourceNextPollAt.getTime() - clock, 4 * 60 * 1000);
});

test('accepts source sync only from the configured timer and honors retry contracts', () => {
  const event = { Type: 'Timer', TriggerName: CONFIG.triggerName };
  assert.equal(isSourceSyncEvent(event, CONFIG.triggerName, 'timer'), true);
  assert.equal(isSourceSyncEvent(event, CONFIG.triggerName, 'api'), false);
  assert.equal(isSourceSyncEvent({ ...event, TriggerName: 'other' }, CONFIG.triggerName, 'timer'), false);
  assert.equal(parseRetryAfter('45', NOW), 45 * 1000);
  assert.equal(retryDelay({ status: 429 }, 1, CONFIG, () => 0.5), 60 * 1000);
  assert.equal(retryDelay({ status: 503 }, 2, CONFIG, () => 0.5), 2 * 60 * 1000);
  assert.equal(resolveScheduledTrigger(event, {
    source: CONFIG.triggerName,
    visual: 'knowledge-feed-visual-sync'
  }, 'timer'), 'source');
  assert.throws(() => resolveScheduledTrigger(event, { source: CONFIG.triggerName }, 'api'),
    /TIMER_SOURCE_REJECTED/);
  assert.throws(() => resolveScheduledTrigger({ ...event, TriggerName: 'other' }, {
    source: CONFIG.triggerName
  }, 'timer'), /TIMER_NAME_REJECTED/);
});
