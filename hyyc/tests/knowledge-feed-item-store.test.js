const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createAihotSource } = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const { toStoredFeedItem } = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const { ownerKeyForOpenId } = require('../cloudfunctions/knowledgeFeed/services/actor-service');
const {
  entitlementView,
  createFeedEntitlementService
} = require('../cloudfunctions/knowledgeFeed/services/feed-entitlement-service');
const { createItemFeedQueryService } = require('../cloudfunctions/knowledgeFeed/services/item-feed-query-service');
const {
  encodePageCursor,
  decodePageCursor
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-item');
const { createAllFeedSyncService } = require('../cloudfunctions/knowledgeFeed/services/all-feed-sync-service');
const { createFeedStoreMigrationService } = require('../cloudfunctions/knowledgeFeed/services/feed-store-migration-service');
const { createFeedAccessAdminService } = require('../cloudfunctions/knowledgeFeed/services/feed-access-admin-service');
const { createFeedMaintenanceService } = require('../cloudfunctions/knowledgeFeed/services/feed-maintenance-service');
const {
  entriesFromDocument,
  groupEntriesByDay
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-day-index');
const { facetMatrixCount } = require('../features/knowledge-feed/facet-matrix');

const NOW = Date.parse('2026-07-17T04:00:00.000Z');
const ITEM_CONFIG = {
  provider: 'aihot',
  freeWindowDays: 7,
  memberWindowDays: 30,
  adminWindowDays: 90,
  facetLimit: 3000,
  syncLeaseMs: 240000,
  itemsRevalidateMs: 3600000,
  fullRefreshMs: 21600000,
  migrationDayBatchSize: 5
};

function rawItem(id, publishedAt, overrides = {}) {
  return {
    id,
    title: `Title ${id}`,
    titleEn: '',
    summary: `Summary ${id}`,
    url: `https://example.com/${id}`,
    permalink: `https://aihot.virxact.com/items/${id}`,
    source: 'Example',
    publishedAt,
    category: 'ai-products',
    categoryLabel: 'AI 产品',
    categoryMarker: 'PRODUCT',
    channelKey: 'ai',
    coverTone: 'cobalt',
    topicKeys: ['company:openai', 'direction:agent'],
    score: 42,
    selected: false,
    attribution: { source: 'AI HOT', canonical: `https://aihot.virxact.com/items/${id}` },
    ...overrides
  };
}

function response(payload, { etag = '"etag"', status = 200 } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === 'etag' ? etag : '' },
    json: async () => payload
  };
}

test('loads the complete all-mode source independently from selected mode', async () => {
  const calls = [];
  const pages = [
    response({
      items: [
        rawItem('item0001', '2026-07-17T01:00:00Z', { selected: true }),
        rawItem('item0002', '2026-07-17T00:00:00Z')
      ],
      hasNext: true,
      nextCursor: 'next'
    }),
    response({
      items: [rawItem('item0003', '2026-07-16T23:00:00Z')],
      hasNext: false,
      nextCursor: ''
    })
  ];
  const source = createAihotSource({
    provider: 'aihot',
    apiRoot: 'https://source.test/items',
    fingerprintRoot: 'https://source.test/fingerprint',
    dailyIndexRoot: 'https://source.test/dailies',
    dailyRoot: 'https://source.test/daily',
    pageSize: 2,
    maxItems: 2,
    allMaxItems: 5,
    timeoutMs: 1000
  }, async (url) => {
    calls.push(url);
    return pages.shift();
  });

  const loaded = await source.loadAll();
  assert.equal(loaded.items.length, 3);
  assert.equal(loaded.items[0].selected, true);
  assert.equal(loaded.items[1].selected, false);
  assert.match(calls[0], /mode=all/);
  assert.match(calls[1], /cursor=next/);
});

test('derives member and administrator history only from server-side documents', async () => {
  const ownerKey = ownerKeyForOpenId('openid-private-value');
  const memberKey = ownerKeyForOpenId('member-private-value');
  assert.equal(ownerKey.length, 64);
  assert.equal(ownerKey.includes('openid-private-value'), false);
  const accessRepository = {
    get: async (key) => key === ownerKey ? {
      role: 'admin',
      status: 'active',
      expiresAt: new Date(NOW + 60000)
    } : null
  };
  const service = createFeedEntitlementService({
    accessRepository,
    membershipRepository: {
      get: async (key) => key === memberKey ? {
        planCode: 'pro', status: 'active', currentPeriodEnd: new Date(NOW + 60000)
      } : null
    },
    config: ITEM_CONFIG,
    now: () => NOW
  });
  const admin = await service.resolve({ ownerKey });
  const member = await service.resolve({ ownerKey: memberKey });
  const free = await service.resolve({ ownerKey: '0'.repeat(64) });
  assert.equal(admin.viewer.role, 'admin');
  assert.equal(admin.access.defaultTimeKey, 'all');
  assert.deepEqual(admin.entitlements.history, { mode: 'all' });
  assert.equal(member.viewer.role, 'member');
  assert.equal(member.access.defaultTimeKey, '30d');
  assert.equal(free.viewer.role, 'free');
  assert.deepEqual(free.access.allowedTimeKeys, ['1d', '3d', '7d']);
});

test('protects administrator grants, migrations, sync and status with the maintenance token', async () => {
  const token = 'm'.repeat(40);
  let granted = null;
  const accessAdminService = createFeedAccessAdminService({
    accessRepository: {
      grant: async (ownerKey, fields) => (granted = { ownerKey, ...fields })
    },
    maintenanceToken: token,
    now: () => NOW
  });
  const service = createFeedMaintenanceService({
    accessAdminService,
    allFeedSyncService: { run: async (options) => ({ status: 'updated', ...options }) },
    migrationService: { run: async () => ({ status: 'complete' }) },
    itemRepository: { stats: async () => ({ itemCount: 1932 }) },
    dayIndexRepository: { stats: async () => ({ dayCount: 7, itemCount: 1932 }) },
    syncStateRepository: { get: async () => ({ allItemCount: 1932 }) },
    migrationRepository: { get: async () => ({ status: 'complete' }) }
  });

  await assert.rejects(() => service.status({ token: 'wrong' }), { code: 'AUTH_REQUIRED' });
  const grant = await service.grantAdmin({ token, ownerKey: 'a'.repeat(64) });
  assert.equal(grant.role, 'admin');
  assert.equal(granted.status, 'active');
  assert.equal((await service.sync({ token, force: true })).force, true);
  assert.equal((await service.migrate({ token })).status, 'complete');
  assert.equal((await service.status({ token })).items.itemCount, 1932);
});

function memoryItemRepository(items) {
  function selected(options) {
    const topics = options.topicKeys || [];
    return items.filter((item) => item.publicState === 'active'
      && (!options.since || item.publishedAt >= options.since)
      && (!options.channel || options.channel === 'all' || item.channelKey === options.channel)
      && topics.every((topic) => item.topicKeys.includes(topic)));
  }
  return {
    queryPage: async (options) => {
      const filtered = selected(options).sort((left, right) => options.sort === 'hot'
        ? right.score - left.score || right.publishedAt.localeCompare(left.publishedAt)
        : right.publishedAt.localeCompare(left.publishedAt));
      return {
        items: filtered.slice(options.offset, options.offset + options.limit),
        resultCount: filtered.length
      };
    },
    latestCursor: async (options) => {
      const latest = selected(options)
        .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
          || right._id.localeCompare(left._id))[0];
      return encodePageCursor(latest, 'latest');
    },
    countAfterCursor: async (options, value) => {
      const cursor = decodePageCursor(value, 'latest');
      if (!cursor) return null;
      return selected(options).filter((item) => item.publishedAt > cursor.publishedAt
        || (item.publishedAt === cursor.publishedAt && item._id > cursor.id)).length;
    },
    count: async (options) => selected(options).length,
    listFacets: async (options) => ({ items: selected(options), truncated: false }),
    getByItemId: async (id) => items.find((item) => item.id === id) || null,
    getManyByItemIds: async (ids) => ids
      .map((id) => items.find((item) => item.id === id))
      .filter(Boolean)
  };
}

function memoryDayIndexRepository(items) {
  return {
    listRange: async () => [{
      date: '2026-07-17',
      entries: items.map((item) => ({
        id: item.id,
        publishedAt: item.publishedAt,
        channelKey: item.channelKey,
        topicKeys: item.topicKeys,
        score: item.score
      }))
    }]
  };
}

test('serves every current item without a picture and rejects free history escalation', async () => {
  const current = toStoredFeedItem(rawItem('item1001', '2026-07-17T01:00:00.000Z'), {
    provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all'
  });
  const old = toStoredFeedItem(rawItem('item1002', '2026-06-20T01:00:00.000Z'), {
    provider: 'aihot', generation: 'g0', observedAt: new Date(NOW), coverage: 'daily-curated'
  });
  const service = createItemFeedQueryService({
    itemRepository: memoryItemRepository([current, old]),
    dayIndexRepository: memoryDayIndexRepository([current, old]),
    syncStateRepository: { get: async () => ({ allItemsSyncedAt: new Date(NOW) }) },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => NOW
  });

  const free = entitlementView('free', ITEM_CONFIG);
  await assert.rejects(() => service.getFeed({ filters: { time: '90d' } }, free), (error) => {
    assert.equal(error.code, 'ENTITLEMENT_REQUIRED');
    assert.equal(error.details.featureKey, 'history_30d');
    return true;
  });
  const freeFeed = await service.getFeed({}, free);
  assert.equal(freeFeed.appliedFilters.time, '7d');
  assert.deepEqual(freeFeed.items.map((item) => item.id), ['item1001']);
  assert.equal(freeFeed.items[0].visualKind, '');
  assert.equal((await service.getItem('item1001', free)).id, 'item1001');
  await assert.rejects(() => service.getItem('item1002', free), { code: 'ENTITLEMENT_REQUIRED' });

  const memberFeed = await service.getFeed({}, entitlementView('member', ITEM_CONFIG));
  assert.equal(memberFeed.appliedFilters.time, '30d');
  assert.deepEqual(memberFeed.items.map((item) => item.id), ['item1001', 'item1002']);

  const adminFeed = await service.getFeed({}, entitlementView('admin', ITEM_CONFIG));
  assert.equal(adminFeed.appliedFilters.time, 'all');
  assert.deepEqual(adminFeed.items.map((item) => item.id), ['item1001', 'item1002']);

  const adminSevenDays = await service.getFeed({ filters: { time: '7d' } }, entitlementView('admin', ITEM_CONFIG));
  assert.equal(adminSevenDays.totalAvailable, 2);
  assert.equal(adminSevenDays.resultCount, 1);
  assert.equal(facetMatrixCount(adminSevenDays.facetMatrix, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }), 1);
});

test('computes feed counts only on the first page', async () => {
  const current = toStoredFeedItem(rawItem('item1011', '2026-07-17T01:00:00.000Z'), {
    provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all'
  });
  const itemRepository = memoryItemRepository([current]);
  const includeCount = [];
  let totalCountCalls = 0;
  const queryPage = itemRepository.queryPage;
  const count = itemRepository.count;
  itemRepository.queryPage = async (options) => {
    includeCount.push(options.includeCount);
    return queryPage(options);
  };
  itemRepository.count = async (options) => {
    totalCountCalls += 1;
    return count(options);
  };
  const service = createItemFeedQueryService({
    itemRepository,
    dayIndexRepository: memoryDayIndexRepository([current]),
    syncStateRepository: { get: async () => ({ allItemsSyncedAt: new Date(NOW) }) },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => NOW
  });
  const entitlement = entitlementView('free', ITEM_CONFIG);
  const first = await service.getFeed({}, entitlement);
  const later = await service.getFeed({ cursor: 'opaque-next-page' }, entitlement);
  assert.equal(first.totalAvailable, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(later, 'totalAvailable'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(later, 'resultCount'), false);
  assert.deepEqual(includeCount, [true, false]);
  assert.equal(totalCountCalls, 1);
});

test('counts new matching items from an opaque feed head without rebuilding the current page', async () => {
  const initial = toStoredFeedItem(rawItem('item1021', '2026-07-17T01:00:00.000Z'), {
    provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all'
  });
  const items = [initial];
  const service = createItemFeedQueryService({
    itemRepository: memoryItemRepository(items),
    dayIndexRepository: memoryDayIndexRepository(items),
    syncStateRepository: { get: async () => ({ allItemsSyncedAt: new Date(NOW) }) },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => NOW
  });
  const entitlement = entitlementView('free', ITEM_CONFIG);
  const firstPage = await service.getFeed({}, entitlement);
  assert.ok(firstPage.headCursor);

  items.push(toStoredFeedItem(rawItem('item1022', '2026-07-17T02:00:00.000Z'), {
    provider: 'aihot', generation: 'g2', observedAt: new Date(NOW), coverage: 'all'
  }));
  const updates = await service.getUpdates({
    headCursor: firstPage.headCursor,
    filters: { time: '7d' }
  }, entitlement);
  assert.equal(updates.newCount, 1);
  assert.notEqual(updates.headCursor, firstPage.headCursor);
});

test('stores compact filter facets in each day index and upgrades legacy id-only documents', () => {
  const current = rawItem('item1101', '2026-07-17T01:00:00.000Z');
  const groups = groupEntriesByDay([current]);
  assert.deepEqual(groups.get('2026-07-17'), [{
    id: 'item1101',
    publishedAt: '2026-07-17T01:00:00.000Z',
    channelKey: 'ai',
    topicKeys: ['company:openai', 'direction:agent'],
    score: 42,
    qualityTier: 'standard'
  }]);
  assert.deepEqual(entriesFromDocument({ date: '2026-07-16', itemIds: ['legacy001'] }), [{
    id: 'legacy001',
    publishedAt: '2026-07-16T00:00:00.000Z',
    channelKey: 'ai',
    topicKeys: [],
    score: null,
    qualityTier: 'standard'
  }]);
});

test('does not write CloudBase system _id back while merging a historical day', async () => {
  const { createFeedDayIndexRepository } = require('../cloudfunctions/knowledgeFeed/repositories/feed-day-index');
  let saved = null;
  const reference = {
    get: async () => ({ data: {
      _id: 'aihot_2026_07_17',
      provider: 'aihot',
      date: '2026-07-17',
      entries: []
    } }),
    set: async ({ data }) => { saved = data; }
  };
  const db = {
    createCollection: async () => {},
    collection: () => ({
      where: () => ({ orderBy: () => ({ limit: async () => ({ data: [] }) }) })
    }),
    runTransaction: async (operation) => operation({
      collection: () => ({ doc: () => reference })
    }),
    command: {
      gte: () => ({ and: () => ({}) }),
      lte: () => ({})
    }
  };
  const repository = createFeedDayIndexRepository(db, {
    provider: 'aihot',
    dayIndexCollectionName: 'knowledge_feed_day_index'
  });
  await repository.mergeHistoricalDay('2026-07-17', [{
    id: 'item1201',
    publishedAt: '2026-07-17T02:00:00.000Z',
    channelKey: 'ai',
    topicKeys: [],
    score: 50
  }], new Date(NOW), 'daily-curated');
  assert.equal(Object.prototype.hasOwnProperty.call(saved, '_id'), false);
  assert.deepEqual(saved.itemIds, ['item1201']);
});

test('reads day indexes in pages instead of silently stopping at one hundred days', async () => {
  const { createFeedDayIndexRepository } = require('../cloudfunctions/knowledgeFeed/repositories/feed-day-index');
  const documents = Array.from({ length: 205 }, (_, index) => ({
    _id: `aihot_2026_${String(1 + Math.floor(index / 28)).padStart(2, '0')}_${String(1 + (index % 28)).padStart(2, '0')}`,
    date: '2026-01-01',
    entries: []
  }));
  const offsets = [];
  const db = {
    createCollection: async () => {},
    collection: () => ({
      where: () => ({
        orderBy: () => ({
          skip: (offset) => {
            offsets.push(offset);
            return {
              limit: (limit) => ({
                get: async () => ({ data: documents.slice(offset, offset + limit) })
              })
            };
          }
        })
      })
    }),
    command: {
      gte: () => ({ and: () => ({}) }),
      lte: () => ({})
    }
  };
  const repository = createFeedDayIndexRepository(db, {
    provider: 'aihot',
    dayIndexCollectionName: 'knowledge_feed_day_index'
  });
  const result = await repository.listRange('2026-01-01');
  assert.equal(result.length, 205);
  assert.deepEqual(offsets, [0, 100, 200]);
});

test('wires the day index into the production item query boundary', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../cloudfunctions/knowledgeFeed/index.js'
  ), 'utf8');
  assert.match(source, /createItemFeedQueryService\(\{[\s\S]*?itemRepository,\s*dayIndexRepository,/);
});

test('synchronizes mode=all into per-item documents and current day indexes', async () => {
  let state = {};
  let storedDocuments = [];
  let indexedDocuments;
  let loadAllCalls = 0;
  let generation = 0;
  const service = createAllFeedSyncService({
    source: {
      loadFingerprint: async () => ({ notModified: false, etag: 'fp-etag', all: 'all-fp' }),
      loadAll: async () => {
        loadAllCalls += 1;
        return {
          notModified: false,
          etag: 'items-etag',
          items: [rawItem('item2001', '2026-07-17T01:00:00.000Z')]
        };
      }
    },
    cacheRepository: {
      get: async () => ({
        items: [{ id: 'item2001', coverFileId: 'cloud://cover', coverStatus: 'ready' }]
      })
    },
    itemRepository: {
      upsertMany: async (documents) => {
        storedDocuments = documents;
        return { inserted: documents.length, updated: 0 };
      },
      markWithdrawn: async (ids) => ids.length
    },
    dayIndexRepository: {
      replaceCurrentWindow: async (documents) => {
        indexedDocuments = documents;
        return { removedItemIds: ['item-old'], dayCount: 1 };
      }
    },
    syncStateRepository: {
      acquireLease: async () => ({ acquired: true, document: state }),
      patch: async (fields) => (state = { ...state, ...fields }),
      releaseLease: async () => true
    },
    config: ITEM_CONFIG,
    now: () => NOW,
    createGeneration: () => `generation-${++generation}`,
    logger: { warn() {} }
  });

  const result = await service.run();
  assert.equal(result.status, 'updated');
  assert.equal(loadAllCalls, 1);
  assert.equal(storedDocuments.length, 1);
  assert.equal(storedDocuments[0].coverFileId, 'cloud://cover');
  assert.equal(storedDocuments[0].historyCoverage, 'all');
  assert.deepEqual(indexedDocuments.map((item) => item.id), ['item2001']);
  assert.equal(state.allItemCount, 1);
  assert.ok(state.allItemsSyncedAt instanceof Date);
});

test('migrates the legacy cache visuals and archived days in bounded batches', async () => {
  const writes = [];
  const mergedDays = [];
  let progress = {};
  const service = createFeedStoreMigrationService({
    cacheRepository: {
      get: async () => ({
        items: [rawItem('item3001', '2026-07-17T01:00:00.000Z', {
          coverFileId: 'cloud://legacy-cover',
          selected: true
        })]
      })
    },
    archiveRepository: {
      listDays: async () => [{
        date: '2026-06-20',
        items: [rawItem('item3002', '2026-06-20T01:00:00.000Z', { archiveSource: 'daily' })]
      }]
    },
    itemRepository: {
      upsertMany: async (documents) => {
        writes.push(...documents);
        return { total: documents.length, inserted: documents.length, updated: 0 };
      }
    },
    dayIndexRepository: {
      mergeHistoricalDay: async (date, entries, updatedAt, coverage) => {
        mergedDays.push({ date, entries, coverage });
      }
    },
    migrationRepository: {
      get: async () => progress,
      patch: async (fields) => (progress = { ...progress, ...fields })
    },
    config: ITEM_CONFIG,
    now: () => NOW,
    createGeneration: () => 'migration-generation',
    logger: { warn() {} }
  });

  const result = await service.run();
  assert.equal(result.status, 'complete');
  assert.equal(writes.length, 2);
  assert.equal(writes.find((item) => item.id === 'item3001').coverFileId, 'cloud://legacy-cover');
  assert.deepEqual(mergedDays.map((day) => day.date), ['2026-07-17', '2026-06-20']);
  assert.deepEqual(mergedDays.map((day) => day.entries[0].id), ['item3001', 'item3002']);
});
