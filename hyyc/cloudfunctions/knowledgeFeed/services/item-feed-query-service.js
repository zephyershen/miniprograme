const { AppError } = require('../lib/errors');
const { TIME_WINDOWS, normalizeFeedQuery } = require('../lib/feed-page');
const { toIso } = require('../lib/dates');
const { publicItem } = require('../presenters/public-feed');
const { entriesFromDocument } = require('../repositories/feed-day-index');
const { buildFacetMatrix } = require('../lib/facet-matrix');
const { visualPublicationVisible } = require('../policies/visual-publication');
const { matchesSourceChannel } = require('../lib/source-channels');
const {
  SEARCH_TOKEN_VERSION,
  normalizeSearchText,
  querySearchTokens
} = require('../lib/search-terms');

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = Object.freeze(['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']);
const FEED_SEARCH_SCOPES = Object.freeze(['firstParty', 'news', 'x', 'openSource']);
const FEED_SEARCH_SCOPE_LABELS = Object.freeze({
  firstParty: '官方动态',
  news: '资讯',
  x: '推文',
  openSource: '全部 GitHub 项目'
});

function searchIndexReady(state) {
  return Number(state && state.searchTokenBackfillVersion) === SEARCH_TOKEN_VERSION
    && Boolean(state && state.searchTokenBackfillCompletedAt);
}

function shanghaiDateKey(value) {
  return new Date(Number(value) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function dayKeysForTime(timeKey, currentTime, entries = []) {
  if (timeKey === 'all') {
    return [...new Set(entries
      .map((entry) => new Date(entry && entry.publishedAt).getTime())
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp <= Number(currentTime))
      .map(shanghaiDateKey))]
      .sort()
      .reverse();
  }
  const windowMs = TIME_WINDOWS[timeKey] || DAY_MS;
  const currentDateStart = Date.parse(`${shanghaiDateKey(currentTime)}T00:00:00+08:00`);
  const earliestDateStart = Date.parse(
    `${shanghaiDateKey(Number(currentTime) - windowMs)}T00:00:00+08:00`
  );
  const calendarDays = Math.floor((currentDateStart - earliestDateStart) / DAY_MS) + 1;
  return Array.from(
    { length: Math.max(1, calendarDays) },
    (_, index) => shanghaiDateKey(currentDateStart - (index * DAY_MS))
  );
}

function shanghaiDayRange(dateKey) {
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const start = Date.parse(`${dateKey}T00:00:00+08:00`);
  if (!Number.isFinite(start)) return null;
  return {
    since: new Date(start).toISOString(),
    until: new Date(start + DAY_MS).toISOString()
  };
}

function dayIntersectsTimeWindow(dateKey, timeKey, currentTime) {
  const range = shanghaiDayRange(dateKey);
  const currentTimestamp = Number(currentTime);
  if (!range || !Number.isFinite(currentTimestamp)) return false;
  const dayStart = new Date(range.since).getTime();
  const dayEnd = new Date(range.until).getTime();
  if (dayStart > currentTimestamp) return false;
  if (timeKey === 'all') return true;
  const windowMs = TIME_WINDOWS[timeKey];
  return Number.isFinite(windowMs) && dayEnd > currentTimestamp - windowMs;
}

function buildDayBuckets(entries, query, currentTime) {
  const filtered = filterEntries(entries, { ...query, sort: 'latest' }, currentTime);
  const counts = filtered.reduce((result, entry) => {
    const key = shanghaiDateKey(new Date(entry.publishedAt).getTime());
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  return dayKeysForTime(query.filters.time, currentTime, filtered).map((dateKey) => {
    const noon = new Date(`${dateKey}T12:00:00+08:00`);
    return {
      dateKey,
      dayLabel: `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`,
      weekdayLabel: WEEKDAYS[noon.getUTCDay()],
      count: counts.get(dateKey) || 0
    };
  });
}

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
    sourceChannelKeys: Array.isArray(entry.sourceChannelKeys) ? entry.sourceChannelKeys : [],
    sourceChannelKey: entry.sourceChannelKey || '',
    topicKeys: Array.isArray(entry.topicKeys) ? entry.topicKeys : [],
    sourceTags: Array.isArray(entry.sourceTags) ? entry.sourceTags : [],
    qualityTier: entry.qualityTier || 'standard'
  };
}

function libraryTagFacets(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    for (const rawTag of (Array.isArray(entry && entry.sourceTags) ? entry.sourceTags : [])) {
      const tag = typeof rawTag === 'string' ? rawTag.trim() : '';
      if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count
      || left.value.localeCompare(right.value, 'zh-CN'));
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
    .filter((entry) => matchesSourceChannel(entry, query.channel))
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

function normalizeSearchRequest(input = {}) {
  const query = normalizeSearchText(input.query);
  const length = Array.from(query).length;
  if (length < 2 || length > 50) {
    throw new AppError('INVALID_REQUEST', '请输入 2–50 个字符的关键词');
  }
  const searchTokens = querySearchTokens(query);
  if (!searchTokens.length) {
    throw new AppError('INVALID_REQUEST', '请输入中文或英文关键词');
  }
  return {
    query,
    searchTokens,
    scope: FEED_SEARCH_SCOPES.includes(input.scope) ? input.scope : 'news',
    cursor: typeof input.cursor === 'string' && input.cursor.length <= 1000 ? input.cursor : '',
    limit: Math.min(20, Math.max(1, Math.floor(Number(input.limit) || 10)))
  };
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

  function visualPublicationGraceMs() {
    return Math.max(0, Number(config.visualPublicationGraceMs) || 0);
  }

  async function releaseExpiredVisualPublicationHolds(currentTime) {
    if (typeof itemRepository.releaseExpiredVisualPublicationHolds !== 'function') return [];
    return itemRepository.releaseExpiredVisualPublicationHolds(
      new Date(currentTime - visualPublicationGraceMs()),
      new Date(currentTime)
    );
  }

  function publicQueryOptions() {
    return { excludeVisualPublicationHolds: true };
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
      searchReady: false,
      coverage: 'legacy-selected'
    };
  }

  async function entitledEntries(entitlement, currentTime) {
    const since = entitlementSince(entitlement, currentTime);
    if (typeof itemRepository.listFacets === 'function') {
      const facets = await itemRepository.listFacets({
        since,
        sourceChannel: 'all',
        topicKeys: [],
        qualityTier: '',
        ...publicQueryOptions()
      });
      return facets.items || [];
    }
    const sinceDate = since ? since.slice(0, 10) : '0000-01-01';
    return uniqueEntries(await dayIndexRepository.listRange(sinceDate), entitlement, currentTime);
  }

  async function getFeed(input = {}, entitlement) {
    const store = await allStoreReady();
    if (!store.ready) return legacyFeed(input, entitlement);

    const libraryMode = input.channel === 'openSource';
    const time = libraryMode ? 'all' : requestedTimeKey(input, entitlement);
    const query = normalizeFeedQuery({
      ...input,
      filters: {
        ...((input && input.filters) || {}),
        time,
        ...(libraryMode ? { company: 'all', direction: 'all' } : {})
      }
    });
    const mode = input.mode === 'curated' ? 'curated' : 'all';
    const currentTime = now();
    await releaseExpiredVisualPublicationHolds(currentTime);
    const firstPage = query.offset === 0 && !query.cursor;
    const baseOptions = {
      since: libraryMode ? null : querySince(query.filters.time, entitlement, currentTime),
      sourceChannel: query.channel,
      topicKeys: libraryMode ? [] : topicFilters(query.filters),
      sourceTags: libraryMode && query.filters.sourceTag !== 'all'
        ? [query.filters.sourceTag]
        : [],
      qualityTier: mode === 'curated' ? 'curated' : '',
      sort: query.sort,
      offset: query.offset,
      cursor: query.cursor,
      limit: query.limit,
      includeCount: firstPage,
      ...publicQueryOptions()
    };
    const page = await itemRepository.queryPage(baseOptions);
    const headCursor = firstPage ? await itemRepository.latestCursor(baseOptions) : undefined;
    const entitlementBase = {
      since: libraryMode ? null : entitlementSince(entitlement, currentTime),
      sourceChannel: libraryMode ? 'openSource' : 'all', topicKeys: [], sourceTags: [],
      qualityTier: mode === 'curated' ? 'curated' : '',
      ...publicQueryOptions()
    };
    const totalAvailable = firstPage ? await itemRepository.count(entitlementBase) : undefined;
    let facetMatrix;
    let dayBuckets;
    let sourceTagFacets;
    if (firstPage) {
      if (libraryMode) {
        const facets = await itemRepository.listFacets({
          since: null,
          sourceChannel: 'openSource',
          topicKeys: [],
          sourceTags: [],
          qualityTier: '',
          ...publicQueryOptions()
        });
        sourceTagFacets = libraryTagFacets(facets.items || []);
      } else {
        const entries = await entitledEntries(entitlement, currentTime);
        facetMatrix = buildFacetMatrix(
          mode === 'curated' ? entries.filter((entry) => entry.qualityTier === 'curated') : entries,
          { timeKeys: entitlement.access.allowedTimeKeys, now: currentTime }
        );
        dayBuckets = buildDayBuckets(
          mode === 'curated' ? entries.filter((entry) => entry.qualityTier === 'curated') : entries,
          query,
          currentTime
        );
      }
    }
    const items = (page.items || []).filter((item) => item.publicState === 'active');
    const nextOffset = query.offset + items.length;
    return {
      updatedAt: toIso(libraryMode ? store.state.aigclinkSyncedAt : store.state.allItemsSyncedAt),
      stale: Boolean(libraryMode ? store.state.aigclinkLastErrorCode : store.state.allLastErrorCode),
      windowDays: libraryMode ? null : entitlement.historyDays,
      coverage: libraryMode ? 'aigclink-all'
        : ['30d', '90d', 'all'].includes(query.filters.time)
        ? 'all-current-plus-local-archive'
        : 'all-current',
      archiveCoverage: entitlement.coverage,
      viewer: entitlement.viewer,
      entitlements: entitlement.entitlements,
      features: entitlement.features,
      access: entitlement.access,
      appliedFilters: query.filters,
      searchReady: searchIndexReady(store.state),
      ...(firstPage ? {
        totalAvailable,
        resultCount: Number(page.resultCount) || 0,
        headCursor
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
      facetMatrix,
      ...(firstPage && libraryMode ? { sourceTagFacets } : {}),
      ...(firstPage ? { dayBuckets } : {})
    };
  }

  async function getDay(input = {}, entitlement) {
    const store = await allStoreReady();
    if (!store.ready) throw new AppError('FEED_DAY_UNAVAILABLE', '日期内容暂时无法读取');
    const time = requestedTimeKey(input, entitlement);
    const query = normalizeFeedQuery({
      ...input,
      sort: 'latest',
      offset: 0,
      filters: { ...((input && input.filters) || {}), time }
    });
    const currentTime = now();
    const range = shanghaiDayRange(input.dateKey);
    if (!range || !dayIntersectsTimeWindow(input.dateKey, time, currentTime)) {
      throw new AppError('INVALID_REQUEST', '日期不在当前可查看范围内');
    }
    const allowedSince = querySince(time, entitlement, currentTime);
    const since = allowedSince && allowedSince > range.since ? allowedSince : range.since;
    await releaseExpiredVisualPublicationHolds(currentTime);
    const page = await itemRepository.queryPage({
      since,
      until: range.until,
      sourceChannel: query.channel,
      topicKeys: topicFilters(query.filters),
      qualityTier: input.mode === 'curated' ? 'curated' : '',
      sort: 'latest',
      offset: 0,
      cursor: query.cursor,
      limit: query.limit,
      includeCount: true,
      ...publicQueryOptions()
    });
    const items = (page.items || []).filter((item) => item.publicState === 'active');
    return {
      dateKey: input.dateKey,
      resultCount: Number(page.resultCount) || 0,
      nextCursor: page.nextCursor || '',
      hasMore: page.hasMore === true,
      items: items.map((item) => publicItem(item)),
      viewer: entitlement.viewer,
      entitlements: entitlement.entitlements,
      features: entitlement.features,
      access: entitlement.access,
      appliedFilters: query.filters,
      updatedAt: toIso(store.state.allItemsSyncedAt)
    };
  }

  async function getUpdates(input = {}, entitlement) {
    const store = await allStoreReady();
    if (!store.ready) {
      return { newCount: 0, headCursor: '', updatedAt: null, stale: true };
    }
    const libraryMode = input.channel === 'openSource';
    const time = libraryMode ? 'all' : requestedTimeKey(input, entitlement);
    const query = normalizeFeedQuery({
      ...input,
      filters: {
        ...((input && input.filters) || {}),
        time,
        ...(libraryMode ? { company: 'all', direction: 'all' } : {})
      }
    });
    const currentTime = now();
    await releaseExpiredVisualPublicationHolds(currentTime);
    const baseOptions = {
      since: libraryMode ? null : querySince(query.filters.time, entitlement, currentTime),
      sourceChannel: query.channel,
      topicKeys: libraryMode ? [] : topicFilters(query.filters),
      sourceTags: libraryMode && query.filters.sourceTag !== 'all'
        ? [query.filters.sourceTag]
        : [],
      qualityTier: '',
      sort: 'latest',
      offset: 0,
      cursor: '',
      limit: 1,
      includeCount: false,
      ...publicQueryOptions()
    };
    const headCursor = await itemRepository.latestCursor(baseOptions);
    if (!input.headCursor || !headCursor) {
      return {
        newCount: 0,
        headCursor,
        updatedAt: toIso(libraryMode ? store.state.aigclinkSyncedAt : store.state.allItemsSyncedAt),
        stale: Boolean(libraryMode ? store.state.aigclinkLastErrorCode : store.state.allLastErrorCode)
      };
    }
    const counted = await itemRepository.countAfterCursor(baseOptions, input.headCursor);
    return {
      newCount: counted === null ? 0 : counted,
      headCursor,
      updatedAt: toIso(libraryMode ? store.state.aigclinkSyncedAt : store.state.allItemsSyncedAt),
      stale: Boolean(libraryMode ? store.state.aigclinkLastErrorCode : store.state.allLastErrorCode)
    };
  }

  async function search(input = {}, entitlement) {
    const store = await allStoreReady();
    if (!store.ready || !searchIndexReady(store.state)) {
      throw new AppError('SEARCH_UNAVAILABLE', '搜索索引正在准备，请稍后再试');
    }
    const request = normalizeSearchRequest(input);
    const currentTime = now();
    const openSource = request.scope === 'openSource';
    await releaseExpiredVisualPublicationHolds(currentTime);
    const page = await itemRepository.queryPage({
      since: openSource ? null : entitlementSince(entitlement, currentTime),
      sourceChannel: request.scope,
      topicKeys: [],
      sourceTags: [],
      qualityTier: '',
      searchTokens: request.searchTokens,
      sort: 'latest',
      offset: 0,
      cursor: request.cursor,
      limit: request.limit,
      includeCount: !request.cursor,
      ...publicQueryOptions()
    });
    const items = (page.items || []).filter((item) => item.publicState === 'active');
    const history = entitlement && entitlement.entitlements && entitlement.entitlements.history;
    const historyLabel = history && history.mode === 'all'
      ? '全部历史资讯'
      : `近 ${Math.max(1, Number(history && history.days) || entitlement.historyDays || 1)} 天资讯`;
    return {
      query: request.query,
      scope: request.scope,
      scopeLabel: openSource
        ? FEED_SEARCH_SCOPE_LABELS.openSource
        : `${historyLabel} · ${FEED_SEARCH_SCOPE_LABELS[request.scope]}`,
      ...(request.cursor ? {} : { resultCount: Number(page.resultCount) || 0 }),
      nextCursor: page.nextCursor || '',
      hasMore: page.hasMore === true,
      items: items.map((item) => publicItem(item)),
      viewer: entitlement.viewer,
      entitlements: entitlement.entitlements,
      access: entitlement.access,
      updatedAt: toIso(openSource ? store.state.aigclinkSyncedAt : store.state.allItemsSyncedAt)
    };
  }

  async function getItem(id, entitlement) {
    if (typeof id !== 'string' || !/^[a-z0-9_-]{8,80}$/i.test(id)) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    }
    const store = await allStoreReady();
    if (!store.ready) return legacyFeedService.getItem(id);
    const currentTime = now();
    await releaseExpiredVisualPublicationHolds(currentTime);
    const item = await itemRepository.getByItemId(id);
    if (!item
      || item.publicState !== 'active'
      || !visualPublicationVisible(item, currentTime, visualPublicationGraceMs())) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    }
    const libraryItem = matchesSourceChannel(item, 'openSource');
    if (!libraryItem && !itemWithinEntitlement(item, entitlement, currentTime)) {
      if (entitlement.viewer.role === 'free') {
        throw new AppError('ENTITLEMENT_REQUIRED', '查看 30 天历史需要 Pro 会员', {
          featureKey: 'history_30d'
        });
      }
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不在当前可查看范围内');
    }
    const relatedPage = await itemRepository.queryPage({
      since: libraryItem ? null : entitlementSince(entitlement, currentTime),
      sourceChannel: libraryItem ? 'openSource' : 'all',
      contentChannel: libraryItem ? '' : item.channelKey,
      topicKeys: [], sourceTags: [], qualityTier: '', sort: 'latest', offset: 0, cursor: '', limit: 4,
      ...publicQueryOptions()
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

  return { getFeed, getDay, getUpdates, search, getItem, allStoreReady };
}

module.exports = {
  FEED_SEARCH_SCOPES,
  FEED_SEARCH_SCOPE_LABELS,
  requestedTimeKey,
  publicFacet,
  libraryTagFacets,
  itemWithinEntitlement,
  compareEntries,
  filterEntries,
  uniqueEntries,
  entitlementSince,
  querySince,
  normalizeSearchRequest,
  searchIndexReady,
  shanghaiDateKey,
  dayKeysForTime,
  shanghaiDayRange,
  dayIntersectsTimeWindow,
  buildDayBuckets,
  createItemFeedQueryService
};
