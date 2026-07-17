const { AppError } = require('../lib/errors');
const { TIME_WINDOWS, normalizeFeedQuery } = require('../lib/feed-page');
const { toIso } = require('../lib/dates');
const { publicItem } = require('../presenters/public-feed');
const { entriesFromDocument } = require('../repositories/feed-day-index');
const { buildFacetMatrix } = require('../lib/facet-matrix');

const DAY_MS = 24 * 60 * 60 * 1000;

function requestedTimeKey(input, entitlement) {
  const requested = input && input.filters && input.filters.time;
  if (!requested) return entitlement.access.defaultTimeKey;
  if (!Object.prototype.hasOwnProperty.call(TIME_WINDOWS, requested)) {
    throw new AppError('INVALID_REQUEST', '时间筛选无效');
  }
  if (!entitlement.access.allowedTimeKeys.includes(requested)) {
    throw new AppError('ENTITLEMENT_REQUIRED', '查看 30 天历史需要 Pro 会员', {
      featureKey: 'history_30d'
    });
  }
  return requested;
}

function topicFilters(filters) {
  return [filters.company, filters.direction].filter((key) => key && key !== 'all');
}

function publicFacet(entry) {
  return {
    id: entry.id,
    publishedAt: entry.publishedAt,
    channelKey: entry.channelKey,
    topicKeys: Array.isArray(entry.topicKeys) ? entry.topicKeys : [],
    qualityTier: entry.qualityTier || 'standard'
  };
}

function itemWithinDays(item, days, now) {
  const publishedAt = new Date(item && item.publishedAt).getTime();
  return Number.isFinite(publishedAt) && publishedAt >= now - (days * DAY_MS);
}

function itemWithinEntitlement(item, entitlement, now) {
  const history = entitlement && entitlement.entitlements && entitlement.entitlements.history;
  if (history && history.mode === 'all') return true;
  const days = history && Number(history.days) || entitlement.historyDays;
  return itemWithinDays(item, days, now);
}

function compareEntries(left, right, sort) {
  if (sort === 'hot' || sort === 'importance') {
    const key = sort === 'importance' ? 'curationScore' : 'score';
    const leftScore = Number.isFinite(Number(left[key])) ? Number(left[key]) : -1;
    const rightScore = Number.isFinite(Number(right[key])) ? Number(right[key]) : -1;
    if (leftScore !== rightScore) return rightScore - leftScore;
  }
  const time = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
  return time || left.id.localeCompare(right.id);
}

function filterEntries(entries, query, now, mode = 'all') {
  const topics = topicFilters(query.filters);
  const windowMs = TIME_WINDOWS[query.filters.time];
  return entries
    .filter((entry) => windowMs === null || itemWithinDays(entry, windowMs / DAY_MS, now))
    .filter((entry) => mode !== 'curated' || entry.qualityTier === 'curated')
    .filter((entry) => query.channel === 'all' || entry.channelKey === query.channel)
    .filter((entry) => topics.every((topic) => (entry.topicKeys || []).includes(topic)))
    .sort((left, right) => compareEntries(left, right, query.sort));
}

function uniqueEntries(documents, entitlement, now) {
  const unique = new Map();
  for (const document of (documents || [])) {
    for (const entry of entriesFromDocument(document)) {
      if (!unique.has(entry.id) && itemWithinEntitlement(entry, entitlement, now)) {
        unique.set(entry.id, entry);
      }
    }
  }
  return [...unique.values()];
}

function entitlementSince(entitlement, currentTime) {
  const history = entitlement && entitlement.entitlements && entitlement.entitlements.history;
  if (history && history.mode === 'all') return null;
  const days = history && Number(history.days) || entitlement.historyDays;
  return new Date(currentTime - (days * DAY_MS)).toISOString();
}

function querySince(timeKey, entitlement, currentTime) {
  const entitlementCutoff = entitlementSince(entitlement, currentTime);
  const windowMs = TIME_WINDOWS[timeKey];
  if (windowMs === null) return entitlementCutoff;
  const requestedCutoff = new Date(currentTime - windowMs).toISOString();
  if (!entitlementCutoff) return requestedCutoff;
  return requestedCutoff > entitlementCutoff ? requestedCutoff : entitlementCutoff;
}

function createItemFeedQueryService({
  itemRepository,
  dayIndexRepository,
  syncStateRepository,
  legacyFeedService,
  config,
  now = () => Date.now()
}) {
  async function allStoreReady() {
    const state = await syncStateRepository.get();
    return { ready: Boolean(state && state.allItemsSyncedAt), state: state || {} };
  }

  async function legacyFeed(input, entitlement) {
    const fallbackTime = entitlement.access.allowedTimeKeys.includes('7d') ? '7d' : '1d';
    const legacy = await legacyFeedService.getFeed({
      ...input,
      filters: { ...((input && input.filters) || {}), time: fallbackTime }
    });
    return {
      ...legacy,
      viewer: entitlement.viewer,
      entitlements: entitlement.entitlements,
      features: entitlement.features,
      access: entitlement.access,
      archiveCoverage: { state: 'partial', completeFrom: null },
      appliedFilters: { ...((input && input.filters) || {}), time: fallbackTime },
      coverage: 'legacy-selected'
    };
  }

  async function entitledEntries(entitlement, currentTime) {
    const since = entitlementSince(entitlement, currentTime);
    const sinceDate = since ? since.slice(0, 10) : '0000-01-01';
    return uniqueEntries(await dayIndexRepository.listRange(sinceDate), entitlement, currentTime);
  }

  async function getFeed(input = {}, entitlement) {
    const store = await allStoreReady();
    if (!store.ready) return legacyFeed(input, entitlement);

    const time = requestedTimeKey(input, entitlement);
    const query = normalizeFeedQuery({
      ...input,
      filters: { ...((input && input.filters) || {}), time }
    });
    const mode = input.mode === 'curated' ? 'curated' : 'all';
    const currentTime = now();
    const firstPage = query.offset === 0 && !query.cursor;
    const baseOptions = {
      since: querySince(query.filters.time, entitlement, currentTime),
      channel: query.channel,
      topicKeys: topicFilters(query.filters),
      qualityTier: mode === 'curated' ? 'curated' : '',
      sort: query.sort,
      offset: query.offset,
      cursor: query.cursor,
      limit: query.limit,
      includeCount: firstPage
    };
    const page = await itemRepository.queryPage(baseOptions);
    const entitlementBase = {
      since: entitlementSince(entitlement, currentTime),
      channel: 'all', topicKeys: [],
      qualityTier: mode === 'curated' ? 'curated' : ''
    };
    const totalAvailable = firstPage ? await itemRepository.count(entitlementBase) : undefined;
    let facetMatrix;
    if (firstPage) {
      const entries = await entitledEntries(entitlement, currentTime);
      facetMatrix = buildFacetMatrix(
        mode === 'curated' ? entries.filter((entry) => entry.qualityTier === 'curated') : entries,
        { timeKeys: entitlement.access.allowedTimeKeys, now: currentTime }
      );
    }
    const items = (page.items || []).filter((item) => item.publicState === 'active');
    const nextOffset = query.offset + items.length;
    return {
      updatedAt: toIso(store.state.allItemsSyncedAt),
      stale: Boolean(store.state.allLastErrorCode),
      windowDays: entitlement.historyDays,
      coverage: ['30d', '90d', 'all'].includes(query.filters.time)
        ? 'all-current-plus-local-archive'
        : 'all-current',
      archiveCoverage: entitlement.coverage,
      viewer: entitlement.viewer,
      entitlements: entitlement.entitlements,
      features: entitlement.features,
      access: entitlement.access,
      appliedFilters: query.filters,
      ...(firstPage ? {
        totalAvailable,
        resultCount: Number(page.resultCount) || 0
      } : {}),
      offset: query.offset,
      nextOffset,
      cursor: query.cursor,
      nextCursor: page.nextCursor || '',
      limit: query.limit,
      sort: query.sort,
      hasMore: page.hasMore === undefined
        ? (Number.isFinite(Number(page.resultCount)) && nextOffset < Number(page.resultCount))
        : page.hasMore,
      items: items.map((item) => publicItem(item)),
      facetMatrix
    };
  }

  async function getItem(id, entitlement) {
    if (typeof id !== 'string' || !/^[a-z0-9_-]{8,80}$/i.test(id)) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    }
    const store = await allStoreReady();
    if (!store.ready) return legacyFeedService.getItem(id);
    const item = await itemRepository.getByItemId(id);
    const currentTime = now();
    if (!item || item.publicState !== 'active') {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    }
    if (!itemWithinEntitlement(item, entitlement, currentTime)) {
      if (entitlement.viewer.role === 'free') {
        throw new AppError('ENTITLEMENT_REQUIRED', '查看 30 天历史需要 Pro 会员', {
          featureKey: 'history_30d'
        });
      }
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不在当前可查看范围内');
    }
    const relatedPage = await itemRepository.queryPage({
      since: entitlementSince(entitlement, currentTime),
      channel: item.channelKey,
      topicKeys: [], qualityTier: '', sort: 'latest', offset: 0, cursor: '', limit: 4
    });
    return {
      ...publicItem(item, { includeAllPreviews: true }),
      relatedItems: (relatedPage.items || [])
        .filter((candidate) => candidate.id !== item.id && candidate.publicState === 'active')
        .slice(0, 3)
        .map((candidate) => publicItem(candidate)),
      viewer: entitlement.viewer,
      entitlements: entitlement.entitlements,
      features: entitlement.features,
      access: entitlement.access
    };
  }

  return { getFeed, getItem, allStoreReady };
}

module.exports = {
  requestedTimeKey,
  publicFacet,
  itemWithinEntitlement,
  compareEntries,
  filterEntries,
  uniqueEntries,
  entitlementSince,
  querySince,
  createItemFeedQueryService
};
