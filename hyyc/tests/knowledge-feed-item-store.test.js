const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createAihotSource } = require('../cloudfunctions/knowledgeFeed/adapters/aihot-source');
const { toStoredFeedItem } = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const { SEARCH_TOKEN_VERSION } = require('../cloudfunctions/knowledgeFeed/lib/search-terms');
const { ownerKeyForOpenId } = require('../cloudfunctions/knowledgeFeed/services/actor-service');
const {
  entitlementView,
  createFeedEntitlementService
} = require('../cloudfunctions/knowledgeFeed/services/feed-entitlement-service');
const { createItemFeedQueryService } = require('../cloudfunctions/knowledgeFeed/services/item-feed-query-service');
const {
  encodePageCursor,
  decodePageCursor,
  withInitialVisualPublicationState
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-item');
const {
  visualPublicationVisible
} = require('../cloudfunctions/knowledgeFeed/policies/visual-publication');
const { createAllFeedSyncService } = require('../cloudfunctions/knowledgeFeed/services/all-feed-sync-service');
const {
  entriesFromDocument,
  groupEntriesByDay
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-day-index');
const { facetMatrixCount } = require('../features/knowledge-feed/facet-matrix');

const NOW = Date.parse('2026-07-17T04:00:00.000Z');
const ITEM_CONFIG = {
  provider: 'aihot',
  freeWindowDays: 1,
  memberWindowDays: 30,
  adminWindowDays: 90,
  facetLimit: 3000,
  syncLeaseMs: 240000,
  itemsRevalidateMs: 3600000,
  fullRefreshMs: 21600000,
  visualPublicationGraceMs: 4 * 60 * 1000
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
  assert.deepEqual(free.access.allowedTimeKeys, ['1d']);
});

function memoryItemRepository(items) {
  function selected(options) {
    const topics = options.topicKeys || [];
    return items.filter((item) => item.publicState === 'active'
      && (!options.excludeVisualPublicationHolds || item.visualPublicationHeld !== true)
      && (!options.since || item.publishedAt >= options.since)
      && (!options.until || item.publishedAt < options.until)
      && (!options.sourceChannel || options.sourceChannel === 'all'
        || item.sourceChannelKey === options.sourceChannel)
      && (!options.channel || options.channel === 'all' || item.channelKey === options.channel)
      && (options.sourceTags || []).every((tag) => (item.sourceTags || []).includes(tag))
      && topics.every((topic) => item.topicKeys.includes(topic)));
  }
  return {
    queryPage: async (options) => {
      let filtered = selected(options).sort((left, right) => options.sort === 'hot'
        ? right.score - left.score || right.publishedAt.localeCompare(left.publishedAt)
        : right.publishedAt.localeCompare(left.publishedAt));
      const cursor = decodePageCursor(options.cursor, options.sort);
      if (cursor) {
        filtered = filtered.filter((item) => {
          if (options.sort === 'hot') {
            return Number(item.score) < Number(cursor.value)
              || (Number(item.score) === Number(cursor.value)
                && (item.publishedAt < cursor.publishedAt
                  || (item.publishedAt === cursor.publishedAt && item._id < cursor.id)));
          }
          return item.publishedAt < cursor.publishedAt
            || (item.publishedAt === cursor.publishedAt && item._id < cursor.id);
        });
      }
      const offset = cursor ? 0 : Math.max(0, Number(options.offset) || 0);
      const rows = filtered.slice(offset, offset + options.limit + 1);
      const pageItems = rows.slice(0, options.limit);
      return {
        items: pageItems,
        ...(options.includeCount === false ? {} : { resultCount: filtered.length }),
        hasMore: rows.length > options.limit,
        nextCursor: rows.length > options.limit
          ? encodePageCursor(pageItems[pageItems.length - 1], options.sort)
          : ''
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
    releaseExpiredVisualPublicationHolds: async (cutoff, releasedAt) => {
      const cutoffTime = new Date(cutoff).getTime();
      const released = [];
      for (const entry of items) {
        if (entry.publicState !== 'active'
          || entry.visualPublicationHeld !== true
          || new Date(entry.firstStoredAt).getTime() > cutoffTime) continue;
        entry.visualPublicationHeld = false;
        entry.visualPublicationReleasedAt = releasedAt;
        entry.visualPublicationReleaseReason = 'grace-expired';
        released.push(entry._id);
      }
      return released;
    },
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

test('applies a four-minute visual grace only to newly held or legacy-observed text cards', () => {
  const stored = toStoredFeedItem(rawItem('grace0001', '2026-07-17T03:00:00.000Z'), {
    provider: 'aihot', generation: 'grace', observedAt: new Date(NOW), coverage: 'all'
  });
  const waiting = withInitialVisualPublicationState(stored);
  assert.equal(waiting.visualPublicationHeld, true);
  assert.equal(visualPublicationVisible(waiting, NOW, ITEM_CONFIG.visualPublicationGraceMs), false);
  assert.equal(visualPublicationVisible(
    waiting,
    NOW + ITEM_CONFIG.visualPublicationGraceMs,
    ITEM_CONFIG.visualPublicationGraceMs
  ), true);
  assert.equal(visualPublicationVisible({
    ...waiting,
    visualState: 'retry'
  }, NOW, ITEM_CONFIG.visualPublicationGraceMs), true);

  const ready = withInitialVisualPublicationState({
    ...stored,
    coverFileId: 'cloud://visual/ready-now.jpg'
  });
  assert.equal(ready.visualPublicationHeld, false);
  assert.equal(visualPublicationVisible(ready, NOW, ITEM_CONFIG.visualPublicationGraceMs), true);

  const legacyWaiting = {
    id: 'legacy-grace',
    firstObservedAt: new Date(NOW),
    previewFileIds: []
  };
  assert.equal(visualPublicationVisible(
    legacyWaiting,
    NOW,
    ITEM_CONFIG.visualPublicationGraceMs
  ), false);
  assert.equal(visualPublicationVisible({
    ...stored,
    visualPublicationHeld: undefined
  }, NOW, ITEM_CONFIG.visualPublicationGraceMs), true);
});

test('holds new image-less cards briefly, then releases text without weakening history entitlements', async () => {
  let currentTime = NOW;
  const current = toStoredFeedItem(rawItem('item1001', '2026-07-17T01:00:00.000Z', {
    coverFileId: 'cloud://visual/current.jpg', coverStatus: 'ready'
  }), {
    provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all'
  });
  const queued = {
    ...toStoredFeedItem(rawItem('item1003', '2026-07-17T02:00:00.000Z'), {
      provider: 'aihot', generation: 'g2', observedAt: new Date(NOW), coverage: 'all'
    }),
    visualPublicationHeld: true
  };
  const failed = {
    ...toStoredFeedItem(rawItem('item1004', '2026-07-17T01:30:00.000Z'), {
      provider: 'aihot', generation: 'g3', observedAt: new Date(NOW), coverage: 'all'
    }),
    visualState: 'retry',
    visualPublicationHeld: false
  };
  const old = toStoredFeedItem(rawItem('item1002', '2026-06-20T01:00:00.000Z', {
    previewFileIds: ['cloud://visual/old.jpg'], previewStatus: 'ready'
  }), {
    provider: 'aihot', generation: 'g0', observedAt: new Date(NOW), coverage: 'daily-curated'
  });
  const service = createItemFeedQueryService({
    itemRepository: memoryItemRepository([current, queued, failed, old]),
    dayIndexRepository: memoryDayIndexRepository([current, queued, failed, old]),
    syncStateRepository: {
      get: async () => ({
        allItemsSyncedAt: new Date(NOW),
        searchTokenBackfillVersion: SEARCH_TOKEN_VERSION,
        searchTokenBackfillCompletedAt: new Date(NOW)
      })
    },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => currentTime
  });

  const free = entitlementView('free', ITEM_CONFIG);
  await assert.rejects(() => service.getFeed({ filters: { time: '90d' } }, free), (error) => {
    assert.equal(error.code, 'ENTITLEMENT_REQUIRED');
    assert.equal(error.details.featureKey, 'history_30d');
    return true;
  });
  const freeFeed = await service.getFeed({}, free);
  assert.equal(freeFeed.searchReady, true);
  assert.equal(freeFeed.appliedFilters.time, '1d');
  assert.deepEqual(freeFeed.items.map((item) => item.id), ['item1004', 'item1001']);
  assert.equal(freeFeed.items[0].visualKind, '');
  assert.equal(freeFeed.items[1].visualKind, 'cover');
  assert.equal(decodePageCursor(freeFeed.headCursor, 'latest').id, failed._id);
  await assert.rejects(() => service.getItem('item1003', free), { code: 'ITEM_NOT_FOUND' });
  const detail = await service.getItem('item1001', free);
  assert.equal(detail.id, 'item1001');
  assert.deepEqual(detail.relatedItems.map((item) => item.id), ['item1004']);
  assert.equal(detail.relatedItems[0].visualKind, '');
  await assert.rejects(() => service.getItem('item1002', free), { code: 'ENTITLEMENT_REQUIRED' });

  currentTime += ITEM_CONFIG.visualPublicationGraceMs;
  const releasedFeed = await service.getFeed({}, free);
  assert.deepEqual(releasedFeed.items.map((item) => item.id), ['item1003', 'item1004', 'item1001']);
  assert.equal((await service.getItem('item1003', free)).visualKind, '');

  const memberFeed = await service.getFeed({}, entitlementView('member', ITEM_CONFIG));
  assert.equal(memberFeed.appliedFilters.time, '30d');
  assert.deepEqual(memberFeed.items.map((item) => item.id), ['item1003', 'item1004', 'item1001', 'item1002']);

  const adminFeed = await service.getFeed({}, entitlementView('admin', ITEM_CONFIG));
  assert.equal(adminFeed.appliedFilters.time, 'all');
  assert.deepEqual(adminFeed.items.map((item) => item.id), ['item1003', 'item1004', 'item1001', 'item1002']);

  const adminSevenDays = await service.getFeed({ filters: { time: '7d' } }, entitlementView('admin', ITEM_CONFIG));
  assert.equal(adminSevenDays.totalAvailable, 4);
  assert.equal(adminSevenDays.resultCount, 3);
  assert.equal(facetMatrixCount(adminSevenDays.facetMatrix, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }), 3);
});

test('shows the complete AIGCLINK library to every role and filters it by native source tags', async () => {
  const libraryItems = [
    toStoredFeedItem(rawItem('library001', '2023-10-28T04:00:00.000Z', {
      source: 'GitHub 开源库',
      sourceChannelKeys: ['openSource'],
      sourceTags: ['MCP', 'AI agent'],
      coverFileId: 'cloud://visual/library-1.jpg',
      coverStatus: 'ready'
    }), { provider: 'aihot', generation: 'library', observedAt: new Date(NOW), coverage: 'library' }),
    toStoredFeedItem(rawItem('library002', '2024-02-01T04:00:00.000Z', {
      source: 'GitHub 开源库',
      sourceChannelKeys: ['openSource'],
      sourceTags: ['AI agent'],
      coverFileId: 'cloud://visual/library-2.jpg',
      coverStatus: 'ready'
    }), { provider: 'aihot', generation: 'library', observedAt: new Date(NOW), coverage: 'library' })
  ];
  const service = createItemFeedQueryService({
    itemRepository: memoryItemRepository(libraryItems),
    dayIndexRepository: memoryDayIndexRepository(libraryItems),
    syncStateRepository: {
      get: async () => ({
        allItemsSyncedAt: new Date(NOW),
        aigclinkSyncedAt: new Date(NOW)
      })
    },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => NOW
  });
  const free = entitlementView('free', ITEM_CONFIG);
  const library = await service.getFeed({
    channel: 'openSource',
    filters: { sourceTag: 'MCP', time: '1d', company: 'company:openai' }
  }, free);
  assert.equal(library.appliedFilters.time, 'all');
  assert.equal(library.appliedFilters.company, 'all');
  assert.equal(library.appliedFilters.sourceTag, 'MCP');
  assert.deepEqual(library.items.map((item) => item.id), ['library001']);
  assert.equal(library.totalAvailable, 2);
  assert.deepEqual(library.sourceTagFacets, [
    { value: 'AI agent', count: 2 },
    { value: 'MCP', count: 1 }
  ]);
  assert.equal(library.dayBuckets, undefined);
  assert.equal((await service.getItem('library001', free)).id, 'library001');
  const ordinaryFeed = await service.getFeed({}, free);
  assert.deepEqual(ordinaryFeed.items, []);
});

test('returns one collapsible header per selected day and pages an opened day only', async () => {
  const items = [
    toStoredFeedItem(rawItem('dayitem01', '2026-07-17T03:00:00.000Z', {
      coverFileId: 'cloud://visual/today.jpg', coverStatus: 'ready'
    }), { provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all' }),
    toStoredFeedItem(rawItem('dayitem02', '2026-07-16T03:00:00.000Z', {
      coverFileId: 'cloud://visual/yesterday.jpg', coverStatus: 'ready'
    }), { provider: 'aihot', generation: 'g1', observedAt: new Date(NOW), coverage: 'all' })
  ];
  const service = createItemFeedQueryService({
    itemRepository: memoryItemRepository(items),
    dayIndexRepository: memoryDayIndexRepository(items),
    syncStateRepository: { get: async () => ({ allItemsSyncedAt: new Date(NOW) }) },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => NOW
  });
  const member = entitlementView('member', ITEM_CONFIG);
  const feed = await service.getFeed({ filters: { time: '30d' } }, member);
  assert.equal(feed.dayBuckets.length, 30);
  assert.equal(feed.dayBuckets[0].dateKey, '2026-07-17');
  assert.equal(feed.dayBuckets[1].dateKey, '2026-07-16');
  assert.equal(feed.dayBuckets[1].count, 1);

  const opened = await service.getDay({
    dateKey: '2026-07-16',
    filters: { time: '30d' },
    limit: 20
  }, member);
  assert.deepEqual(opened.items.map((item) => item.id), ['dayitem02']);
  assert.equal(opened.hasMore, false);
});

test('computes feed counts only on the first page', async () => {
  const current = toStoredFeedItem(rawItem('item1011', '2026-07-17T01:00:00.000Z', {
    coverFileId: 'cloud://visual/count.jpg', coverStatus: 'ready'
  }), {
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

test('counts image-less new items from an opaque feed head without rebuilding the current page', async () => {
  let currentTime = NOW;
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
    now: () => currentTime
  });
  const entitlement = entitlementView('free', ITEM_CONFIG);
  const firstPage = await service.getFeed({}, entitlement);
  assert.ok(firstPage.headCursor);

  items.push({
    ...toStoredFeedItem(rawItem('item1022', '2026-07-17T02:00:00.000Z'), {
      provider: 'aihot', generation: 'g2', observedAt: new Date(NOW), coverage: 'all'
    }),
    visualPublicationHeld: true
  });
  const waiting = await service.getUpdates({
    headCursor: firstPage.headCursor,
    filters: { time: '1d' }
  }, entitlement);
  assert.equal(waiting.newCount, 0);
  assert.equal(waiting.headCursor, firstPage.headCursor);

  currentTime += ITEM_CONFIG.visualPublicationGraceMs;
  const updates = await service.getUpdates({
    headCursor: firstPage.headCursor,
    filters: { time: '1d' }
  }, entitlement);
  assert.equal(updates.newCount, 1);
  assert.notEqual(updates.headCursor, firstPage.headCursor);
});

test('paginates image-less items normally after the bounded visual grace expires', async () => {
  const queued = Array.from({ length: 25 }, (_, index) => ({
    ...toStoredFeedItem(rawItem(
      `queued${String(index).padStart(3, '0')}`,
      new Date(NOW + (index + 1) * 1000).toISOString()
    ), {
      provider: 'aihot', generation: 'queued', observedAt: new Date(NOW), coverage: 'all'
    }),
    visualPublicationHeld: true
  }));
  const ready = toStoredFeedItem(rawItem('ready0001', '2026-07-17T01:00:00.000Z', {
    coverFileId: 'cloud://visual/ready.jpg', coverStatus: 'ready'
  }), {
    provider: 'aihot', generation: 'ready', observedAt: new Date(NOW), coverage: 'all'
  });
  const allItems = [...queued, ready];
  const service = createItemFeedQueryService({
    itemRepository: memoryItemRepository(allItems),
    dayIndexRepository: memoryDayIndexRepository(allItems),
    syncStateRepository: { get: async () => ({ allItemsSyncedAt: new Date(NOW) }) },
    legacyFeedService: { getFeed: async () => { throw new Error('legacy not expected'); } },
    config: ITEM_CONFIG,
    now: () => NOW + ITEM_CONFIG.visualPublicationGraceMs
  });
  const first = await service.getFeed({ limit: 8 }, entitlementView('admin', ITEM_CONFIG));
  assert.equal(first.items.length, 8);
  assert.equal(first.items[0].id, 'queued024');
  assert.ok(first.items.every((item) => item.visualKind === ''));
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const second = await service.getFeed({
    limit: 8,
    cursor: first.nextCursor
  }, entitlementView('admin', ITEM_CONFIG));
  assert.equal(second.items.length, 8);
  assert.equal(second.items[0].id, 'queued016');
  assert.equal(second.items.some((item) => first.items.some((firstItem) => firstItem.id === item.id)), false);
});

test('stores compact filter facets in each day index and upgrades legacy id-only documents', () => {
  const current = rawItem('item1101', '2026-07-17T01:00:00.000Z');
  const groups = groupEntriesByDay([current]);
  assert.deepEqual(groups.get('2026-07-17'), [{
    id: 'item1101',
    publishedAt: '2026-07-17T01:00:00.000Z',
    channelKey: 'ai',
    sourceChannelKeys: ['news'],
    sourceChannelKey: 'news',
    topicKeys: ['company:openai', 'direction:agent'],
    score: 42,
    qualityTier: 'standard'
  }]);
  assert.deepEqual(entriesFromDocument({ date: '2026-07-16', itemIds: ['legacy001'] }), [{
    id: 'legacy001',
    publishedAt: '2026-07-16T00:00:00.000Z',
    channelKey: 'ai',
    sourceChannelKeys: ['news'],
    sourceChannelKey: 'news',
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

test('reuses the selected sync fingerprint and skips the all-mode lease when nothing changed', async () => {
  const recent = new Date(NOW - 60 * 1000);
  let fingerprintCalls = 0;
  let leaseCalls = 0;
  const service = createAllFeedSyncService({
    source: {
      loadFingerprint: async () => { fingerprintCalls += 1; throw new Error('must reuse observation'); },
      loadAll: async () => { throw new Error('items must remain untouched'); }
    },
    cacheRepository: null,
    itemRepository: {},
    dayIndexRepository: {},
    syncStateRepository: {
      get: async () => ({
        allObservedFingerprint: 'all-same',
        allAppliedFingerprint: 'all-same',
        allItemsCheckedAt: recent,
        allFullSyncedAt: recent
      }),
      acquireLease: async () => { leaseCalls += 1; return { acquired: true, document: {} }; }
    },
    config: ITEM_CONFIG,
    now: () => NOW,
    logger: { warn() {} }
  });

  const result = await service.run({
    fingerprintObservation: { notModified: false, etag: 'fp-v2', all: 'all-same' }
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(fingerprintCalls, 0);
  assert.equal(leaseCalls, 0);
});
