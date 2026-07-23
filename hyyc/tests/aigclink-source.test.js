const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAigclinkRecord,
  queryBody,
  createAigclinkSource
} = require('../cloudfunctions/knowledgeFeed/adapters/aigclink-source');
const {
  createAigclinkSyncService
} = require('../cloudfunctions/knowledgeFeed/services/aigclink-sync-service');

const CONFIG = {
  siteRoot: 'https://d.aigclink.ai',
  queryRoot: 'https://d.aigclink.ai/api/v3/queryCollection?src=initial_load',
  collectionId: 'collection-id',
  viewId: 'view-id',
  spaceId: 'space-id',
  excludedTags: ['会议'],
  headItems: 30,
  maxItems: 30,
  maxSegments: 3,
  timeoutMs: 1000,
  sourceAvatarFileId: 'cloud://env.bucket/knowledge-source-avatars/github.png'
};

function record() {
  return {
    value: {
      value: {
        id: '3a59857c-0f47-8126-bd69-ce5cc043d83d',
        properties: {
          title: [['Open-seo：开源 SEO 工具']],
          '@r`I': [['一套可以自托管的开源 SEO 工具。']],
          FWPt: [['https://github.com/every-app/open-seo']],
          MkyH: [['开源']],
          '>Dc>': [['AI营销,MCP,AI工作流']],
          'V;i=': [['7']],
          vuJC: [['‣', [['d', { type: 'date', start_date: '2026-07-21' }]]]]
        }
      }
    }
  };
}

test('normalizes public AIGCLINK index fields without copying article body', () => {
  const item = normalizeAigclinkRecord(record(), CONFIG);
  assert.equal(item.id, 'aigclink_3a59857c0f478126bd69ce5cc043d83d');
  assert.equal(item.url, 'https://github.com/every-app/open-seo');
  assert.equal(item.permalink, 'https://d.aigclink.ai/3a59857c0f478126bd69ce5cc043d83d?pvs=25');
  assert.equal(item.source, 'GitHub 开源库');
  assert.equal(item.score, 70);
  assert.deepEqual(item.sourceTags, ['AI营销', 'MCP', 'AI工作流']);
  assert.deepEqual(item.sourceChannelKeys, ['openSource']);
  assert.equal(item.sourceAvatarFileId, CONFIG.sourceAvatarFileId);
  assert.equal(item.attribution.source, 'AIGCLINK');
  const withoutSummary = record();
  delete withoutSummary.value.value.properties['@r`I'];
  assert.equal(normalizeAigclinkRecord(withoutSummary, CONFIG).summary, '');
});

test('continues with an inclusive date segment when the public block map is truncated', async () => {
  const calls = [];
  const source = createAigclinkSource(CONFIG, async (url, options) => {
    const body = JSON.parse(options.body);
    const dateFilter = body.loader.filter.filters.find((entry) => entry.property === 'vuJC');
    calls.push(dateFilter && dateFilter.filter.value.value.start_date || '');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          reducerResults: {
            collection_group_results: { blockIds: ['page-1'], hasMore: calls.length === 1 }
          }
        },
        recordMap: { block: { 'page-1': record() } }
      })
    };
  });
  const result = await source.loadItems();
  assert.deepEqual(calls, ['', '2026-07-21']);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.items.length, 1);
});

test('builds a bounded read-only collection query', () => {
  const body = queryBody(CONFIG);
  assert.equal(body.loader.reducers.collection_group_results.limit, 30);
  assert.equal(body.loader.reducers.collection_group_results.loadContentCover, false);
  assert.equal(body.loader.sort[0].property, 'vuJC');
  assert.equal(body.loader.filter.filters[0].property, '>Dc>');
});

test('loads and orders only records returned by the public reducer', async () => {
  const bodyRecord = record();
  const source = createAigclinkSource(CONFIG, async (url, options) => {
    assert.equal(url, CONFIG.queryRoot);
    assert.equal(options.method, 'POST');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: { reducerResults: { collection_group_results: { blockIds: ['page-1'], hasMore: false } } },
        recordMap: { block: { 'page-1': bodyRecord } }
      })
    };
  });
  const result = await source.loadItems();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Open-seo：开源 SEO 工具');
  assert.equal(result.hasMore, false);
});

test('fails closed when a returned AIGCLINK block cannot be normalized', async () => {
  const invalid = record();
  delete invalid.value.value.properties.title;
  const source = createAigclinkSource(CONFIG, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      result: {
        reducerResults: {
          collection_group_results: { blockIds: ['invalid-page'], hasMore: false }
        }
      },
      recordMap: { block: { 'invalid-page': invalid } }
    })
  }));

  await assert.rejects(() => source.loadItems(), /AIGCLINK_SOURCE_INCOMPLETE/);
  await assert.rejects(() => source.observeHead(), /AIGCLINK_SOURCE_INCOMPLETE/);
});

test('syncs the library independently and merges its dates into the shared index', async () => {
  const item = normalizeAigclinkRecord(record(), CONFIG);
  const state = {};
  const mergedDays = [];
  const markedVisuals = [];
  const service = createAigclinkSyncService({
    source: { loadItems: async () => ({ items: [item] }) },
    itemRepository: {
      upsertMany: async (documents) => ({
        inserted: documents.length,
        updated: 0,
        insertedVisualCandidates: documents
      }),
      markVisualQueued: async (documents) => markedVisuals.push(...documents)
    },
    dayIndexRepository: {
      mergeHistoricalDay: async (day, items, observedAt, coverage) => {
        mergedDays.push({ day, items, observedAt, coverage });
      }
    },
    syncStateRepository: {
      get: async () => ({ ...state }),
      acquireLease: async (owner, acquiredAt, expiresAt) => ({
        acquired: true,
        document: { ...state, leaseOwner: owner, leaseAcquiredAt: acquiredAt, leaseUntil: expiresAt }
      }),
      renewLease: async (owner, renewedAt, expiresAt) => ({
        renewed: true,
        document: { ...state, leaseOwner: owner, leaseHeartbeatAt: renewedAt, leaseUntil: expiresAt }
      }),
      patch: async (fields) => Object.assign(state, fields),
      releaseLease: async () => true
    },
    visualJobRepository: {
      enqueueMany: async (documents) => ({
        requested: documents.length,
        inserted: documents.length,
        reset: 0,
        retained: 0,
        queuedItems: documents
      })
    },
    config: {
      provider: 'aihot',
      syncVersion: 2,
      pollMs: 60 * 1000,
      fullRefreshMs: 24 * 60 * 60 * 1000,
      leaseMs: 2 * 60 * 1000,
      visualPriorityBoost: 1500,
      visualRecentWindowMs: 365 * 24 * 60 * 60 * 1000,
      writeDayIndex: true,
      maxItems: 5000
    },
    now: () => Date.parse('2026-07-23T00:00:00.000Z'),
    logger: { warn() {} }
  });

  const result = await service.run();
  assert.equal(result.status, 'updated');
  assert.equal(result.itemCount, 1);
  assert.equal(mergedDays[0].day, '2026-07-21');
  assert.equal(mergedDays[0].coverage, 'source-library');
  assert.equal(mergedDays[0].items[0].archiveSource, 'aigclink');
  assert.equal(markedVisuals.length, 1);
  assert.equal(state.aigclinkItemCount, 1);
  assert.equal(state.aigclinkSyncVersion, 2);
});

test('refreshes stored library presentation immediately when its sync version changes', async () => {
  const item = normalizeAigclinkRecord(record(), CONFIG);
  let loaded = 0;
  const state = {
    aigclinkSyncedAt: new Date('2026-07-23T00:00:00.000Z'),
    aigclinkSyncVersion: 1
  };
  const service = createAigclinkSyncService({
    source: { loadItems: async () => { loaded += 1; return { items: [item] }; } },
    itemRepository: {
      upsertMany: async () => ({ inserted: 0, updated: 1, insertedVisualCandidates: [] })
    },
    dayIndexRepository: { mergeHistoricalDay: async () => null },
    syncStateRepository: {
      get: async () => ({ ...state }),
      acquireLease: async (owner) => ({ acquired: true, document: { ...state, leaseOwner: owner } }),
      renewLease: async (owner, renewedAt, expiresAt) => ({
        renewed: true,
        document: { ...state, leaseOwner: owner, leaseHeartbeatAt: renewedAt, leaseUntil: expiresAt }
      }),
      patch: async (fields) => Object.assign(state, fields),
      releaseLease: async () => true
    },
    visualJobRepository: null,
    config: {
      provider: 'aihot',
      syncVersion: 2,
      pollMs: 60 * 1000,
      fullRefreshMs: 24 * 60 * 60 * 1000,
      leaseMs: 2 * 60 * 1000,
      visualPriorityBoost: 1500,
      visualRecentWindowMs: 7 * 24 * 60 * 60 * 1000,
      writeDayIndex: false,
      maxItems: 5000
    },
    now: () => Date.parse('2026-07-23T00:01:00.000Z'),
    logger: { warn() {} }
  });

  const result = await service.run();
  assert.equal(result.status, 'updated');
  assert.equal(loaded, 1);
  assert.equal(state.aigclinkSyncVersion, 2);
});

test('abandons a stale full refresh before writing when another worker owns the lease', async () => {
  const item = normalizeAigclinkRecord(record(), CONFIG);
  const state = {};
  let writes = 0;
  const service = createAigclinkSyncService({
    source: {
      loadItems: async () => {
        state.leaseOwner = 'new-worker';
        return { items: [item] };
      }
    },
    itemRepository: {
      upsertMany: async () => {
        writes += 1;
        return { inserted: 1, updated: 0, insertedVisualCandidates: [] };
      }
    },
    dayIndexRepository: { mergeHistoricalDay: async () => null },
    syncStateRepository: {
      get: async () => ({ ...state }),
      acquireLease: async (owner, acquiredAt, expiresAt) => {
        Object.assign(state, { leaseOwner: owner, leaseAcquiredAt: acquiredAt, leaseUntil: expiresAt });
        return { acquired: true, document: { ...state } };
      },
      renewLease: async (owner) => ({
        renewed: state.leaseOwner === owner,
        document: { ...state }
      }),
      patch: async (fields) => Object.assign(state, fields),
      releaseLease: async () => false
    },
    visualJobRepository: null,
    config: {
      provider: 'aihot',
      syncVersion: 2,
      pollMs: 60 * 1000,
      fullRefreshMs: 24 * 60 * 60 * 1000,
      leaseMs: 2 * 60 * 1000,
      visualPriorityBoost: 1500,
      visualRecentWindowMs: 7 * 24 * 60 * 60 * 1000,
      writeDayIndex: false,
      maxItems: 5000
    },
    now: () => Date.parse('2026-07-23T00:01:00.000Z'),
    logger: { warn() {} }
  });

  const result = await service.run({ force: true });
  assert.equal(result.status, 'busy');
  assert.equal(result.errorCode, 'AIGCLINK_SYNC_LEASE_LOST');
  assert.equal(writes, 0);
  assert.equal(state.aigclinkLastErrorCode, undefined);
});

test('fails before item writes when the stored open-source inventory is truncated', async () => {
  const item = normalizeAigclinkRecord(record(), CONFIG);
  const state = {};
  let writes = 0;
  let withdrawals = 0;
  const service = createAigclinkSyncService({
    source: { loadItems: async () => ({ items: [item] }) },
    itemRepository: {
      listFacets: async () => ({ items: [{ id: 'stale-item' }], truncated: true }),
      upsertMany: async () => {
        writes += 1;
        return { inserted: 1, updated: 0, insertedVisualCandidates: [] };
      },
      markWithdrawn: async () => {
        withdrawals += 1;
        return 1;
      }
    },
    dayIndexRepository: { mergeHistoricalDay: async () => null },
    syncStateRepository: {
      get: async () => ({ ...state }),
      acquireLease: async (owner) => ({ acquired: true, document: { ...state, leaseOwner: owner } }),
      renewLease: async (owner, renewedAt, expiresAt) => ({
        renewed: true,
        document: { ...state, leaseOwner: owner, leaseHeartbeatAt: renewedAt, leaseUntil: expiresAt }
      }),
      patch: async (fields) => Object.assign(state, fields),
      releaseLease: async () => true
    },
    visualJobRepository: null,
    config: {
      provider: 'aihot',
      syncVersion: 2,
      pollMs: 60 * 1000,
      fullRefreshMs: 24 * 60 * 60 * 1000,
      leaseMs: 6 * 60 * 1000,
      visualPriorityBoost: 1500,
      visualRecentWindowMs: 7 * 24 * 60 * 60 * 1000,
      writeDayIndex: false,
      maxItems: 5000
    },
    now: () => Date.parse('2026-07-23T00:01:00.000Z'),
    logger: { warn() {} }
  });

  const result = await service.run({ force: true });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'AIGCLINK_INVENTORY_TRUNCATED');
  assert.equal(writes, 0);
  assert.equal(withdrawals, 0);
  assert.equal(state.aigclinkSyncedAt, undefined);
});

test('normalizes a guarded final-patch lease loss as superseded work', async () => {
  const item = normalizeAigclinkRecord(record(), CONFIG);
  const service = createAigclinkSyncService({
    source: { loadItems: async () => ({ items: [item] }) },
    itemRepository: {
      upsertMany: async () => ({ inserted: 1, updated: 0, insertedVisualCandidates: [] })
    },
    dayIndexRepository: { mergeHistoricalDay: async () => null },
    syncStateRepository: {
      get: async () => ({}),
      acquireLease: async (owner) => ({ acquired: true, document: { leaseOwner: owner } }),
      renewLease: async (owner) => ({ renewed: true, document: { leaseOwner: owner } }),
      patch: async () => {
        const error = new Error('ALL_SYNC_LEASE_LOST');
        error.code = 'ALL_SYNC_LEASE_LOST';
        throw error;
      },
      releaseLease: async () => false
    },
    visualJobRepository: null,
    config: {
      provider: 'aihot',
      syncVersion: 2,
      pollMs: 60 * 1000,
      fullRefreshMs: 24 * 60 * 60 * 1000,
      leaseMs: 6 * 60 * 1000,
      visualPriorityBoost: 1500,
      visualRecentWindowMs: 7 * 24 * 60 * 60 * 1000,
      writeDayIndex: false,
      maxItems: 5000
    },
    now: () => Date.parse('2026-07-23T00:01:00.000Z'),
    logger: { warn() {} }
  });

  const result = await service.run({ force: true });
  assert.equal(result.status, 'busy');
  assert.equal(result.errorCode, 'AIGCLINK_SYNC_LEASE_LOST');
});
