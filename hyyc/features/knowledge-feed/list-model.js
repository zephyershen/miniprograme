const {
  CHANNELS,
  channelByKey,
  decorateChannels,
  decorateChannelCounts,
  addFeaturedShortcut
} = require('./channels.js');
const { filterFeedItems, filterSummary, filterOptionsWithCounts } = require('./filters.js');
const { isFacetMatrix, facetMatrixCount } = require('./facet-matrix.js');
const { buildReadingGuide } = require('./reading.js');
const { normalizeMembershipAccess } = require('../membership/access.js');
const {
  TIME_FILTERS,
  COMPANY_FILTERS,
  DIRECTION_FILTERS,
  SORT_OPTIONS,
  DEFAULT_FEED_FILTERS,
  DEFAULT_SORT,
  PAGE_SIZE
} = require('./config.js');

const FILTER_OPTIONS = Object.freeze({ time: TIME_FILTERS, company: COMPANY_FILTERS, direction: DIRECTION_FILTERS });
const TIME_FILTER_KEYS = new Set(TIME_FILTERS.map((option) => option.key));

function normalizeFeedAccess(raw = {}) {
  const normalized = normalizeMembershipAccess(raw);
  const allowedTimeKeys = normalized.access.allowedTimeKeys.filter((key) => TIME_FILTER_KEYS.has(key));
  return {
    viewer: normalized.viewer,
    entitlements: normalized.entitlements,
    coverage: normalized.coverage,
    access: { ...normalized.access, allowedTimeKeys },
    timeFilters: TIME_FILTERS.filter((option) => allowedTimeKeys.includes(option.key))
  };
}

function filterOptionsForFeed(raw = {}) {
  const { viewer, timeFilters } = normalizeFeedAccess(raw);
  const time = [...timeFilters];
  if (viewer.role === 'free' && !time.some((option) => option.key === '30d')) {
    const locked = TIME_FILTERS.find((option) => option.key === '30d');
    if (locked) time.push({ ...locked, locked: true, featureKey: 'history_30d' });
  }
  return { ...FILTER_OPTIONS, time };
}

function copyFilters(filters = DEFAULT_FEED_FILTERS) {
  return { time: filters.time, company: filters.company, direction: filters.direction };
}

function defaultFiltersForFeed(raw = {}) {
  const { access } = normalizeFeedAccess(raw);
  return { ...copyFilters(), time: access.defaultTimeKey };
}

function reconcileFeedFilters(raw = {}, filters = DEFAULT_FEED_FILTERS, preferDefault = false) {
  const current = copyFilters(filters);
  const { access } = normalizeFeedAccess(raw);
  const appliedTime = raw.appliedFilters && raw.appliedFilters.time;
  const time = access.allowedTimeKeys.includes(appliedTime)
    ? appliedTime
    : (preferDefault
      ? access.defaultTimeKey
      : (access.allowedTimeKeys.includes(current.time) ? current.time : access.defaultTimeKey));
  return { ...current, time };
}

function requestFilters(filters, accessResolved = false) {
  const next = copyFilters(filters);
  if (!accessResolved) delete next.time;
  return next;
}

function createSortState(activeSort = DEFAULT_SORT) {
  const selected = SORT_OPTIONS.find((option) => option.key === activeSort) || SORT_OPTIONS[0];
  return {
    sortMode: selected.key,
    sortOptions: SORT_OPTIONS.map((option) => ({ ...option, active: option.key === selected.key })),
    sortHint: selected.hint
  };
}

function createNewItemsNotice(value = 0) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return {
    newItemCount: count,
    newItemsVisible: count > 0,
    newItemsLabel: count > 99 ? '99+ 条新资讯' : `${count} 条新资讯`
  };
}

function isSortKey(value) {
  return SORT_OPTIONS.some((option) => option.key === value);
}

function formatFeedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hour}:${minute}`;
}

function prepareFeedItems(items = []) {
  return items.map((item) => ({
    ...item,
    publishedLabel: formatFeedDate(item.publishedAt),
    scoreLabel: Number.isFinite(Number(item.score))
      ? `热度 ${item.score}`
      : (item.qualityTier === 'curated' ? '编辑精选' : '热度待评估'),
    summaryPreview: buildReadingGuide(item.summary).brief
  }));
}

function filterByChannel(items, activeChannel) {
  return activeChannel === 'all' ? items : items.filter((item) => item.channelKey === activeChannel);
}

function decorateFilterOptions(raw, activeChannel, filters) {
  if (isFacetMatrix(raw && raw.facetMatrix)) {
    return Object.fromEntries(Object.entries(filterOptionsForFeed(raw)).map(([group, entries]) => [
      group,
      entries.map((entry) => {
        if (entry.locked) {
          return { ...entry, count: '', active: false, disabled: false };
        }
        const candidate = { ...filters, [group]: entry.key };
        const count = facetMatrixCount(raw.facetMatrix, activeChannel, candidate);
        return {
          ...entry,
          count,
          active: filters[group] === entry.key,
          disabled: count === 0 && filters[group] !== entry.key
        };
      })
    ]));
  }
  const options = filterOptionsWithCounts(
    filterOptionsForFeed(raw),
    filterByChannel(raw.facets || [], activeChannel),
    filters
  );
  options.time = options.time.map((entry) => entry.locked
    ? { ...entry, count: '', active: false, disabled: false }
    : entry);
  return options;
}

function countFacetResults(raw, activeChannel, filters) {
  const matrixCount = facetMatrixCount(raw && raw.facetMatrix, activeChannel, filters);
  if (matrixCount !== null) return matrixCount;
  return filterByChannel(filterFeedItems(raw.facets || [], filters), activeChannel).length;
}

function createFilterDraftState(raw, activeChannel, filters) {
  const draftFilters = copyFilters(filters);
  return {
    draftFilters,
    draftCount: countFacetResults(raw, activeChannel, draftFilters),
    filterOptions: decorateFilterOptions(raw, activeChannel, draftFilters)
  };
}

function mergeUniqueItems(current = [], incoming = []) {
  const seen = new Set(current.map((item) => item.id));
  const additions = incoming.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return current.concat(additions);
}

function mergeFeedPage(current = {}, page = {}, items = []) {
  return {
    ...current,
    ...page,
    facets: current.facets || page.facets || [],
    facetMatrix: current.facetMatrix || page.facetMatrix,
    viewer: current.viewer || page.viewer,
    access: current.access || page.access,
    entitlements: current.entitlements || page.entitlements,
    coverage: current.coverage || page.coverage,
    appliedFilters: current.appliedFilters || page.appliedFilters,
    items
  };
}

function createFeedAppendPatch(currentFeed, nextFeed, previousLoadedCount) {
  const currentLeadId = currentFeed && currentFeed.leadItem && currentFeed.leadItem.id;
  const nextLeadId = nextFeed && nextFeed.leadItem && nextFeed.leadItem.id;
  if (!currentLeadId || currentLeadId !== nextLeadId) return null;
  const start = Math.max(0, Math.min(
    nextFeed.remainingItems.length,
    Math.max(0, Number(previousLoadedCount) || 0) - 1
  ));
  const patch = {
    'feed.remainingCount': nextFeed.remainingCount,
    'feed.resultCount': nextFeed.resultCount,
    'feed.loadedCount': nextFeed.loadedCount,
    'feed.totalAvailable': nextFeed.totalAvailable,
    'feed.hasMore': nextFeed.hasMore,
    'feed.accessSummary': nextFeed.accessSummary,
    'feed.historyBoundary': nextFeed.historyBoundary
  };
  nextFeed.remainingItems.slice(start).forEach((item, offset) => {
    patch[`feed.remainingItems[${start + offset}]`] = item;
  });
  return patch;
}

function decorateFeed(raw = { items: [], facets: [] }, activeChannel = 'all', filters = DEFAULT_FEED_FILTERS, loadedItems = []) {
  const accessState = normalizeFeedAccess(raw);
  const filterOptions = filterOptionsForFeed(raw);
  const filteredFacets = isFacetMatrix(raw.facetMatrix)
    ? []
    : filterFeedItems(raw.facets || [], filters);
  const visibleItems = prepareFeedItems(loadedItems).map((item, index) => ({
    ...item,
    sequenceLabel: String(index + 1).padStart(2, '0')
  }));
  const facetResultCount = countFacetResults(raw, activeChannel, filters);
  const resultCount = Number.isFinite(Number(raw.resultCount)) ? Number(raw.resultCount) : facetResultCount;
  const totalAvailable = Number.isFinite(Number(raw.totalAvailable))
    ? Number(raw.totalAvailable)
    : (raw.facets || []).length;
  return {
    leadItem: visibleItems[0] || null,
    remainingItems: visibleItems.slice(1),
    remainingCount: Math.max(0, resultCount - 1),
    channels: addFeaturedShortcut(isFacetMatrix(raw.facetMatrix)
      ? decorateChannelCounts(Object.fromEntries(CHANNELS.map((channel) => [
        channel.key,
        facetMatrixCount(raw.facetMatrix, channel.key, filters)
      ])), activeChannel)
      : decorateChannels(filteredFacets, activeChannel)),
    activeChannel,
    activeChannelLabel: channelByKey(activeChannel).label,
    resultCount,
    loadedCount: visibleItems.length,
    totalAvailable,
    hasMore: raw.hasMore === true,
    filterSummary: filterSummary(filters, filterOptions),
    viewer: accessState.viewer,
    entitlements: accessState.entitlements,
    coverage: accessState.coverage,
    access: accessState.access,
    accessSummary: `${accessState.access.label} · 收录 ${totalAvailable} 条`,
    historyBoundary: accessState.viewer.role === 'free'
      && filters.time === '7d'
      && raw.hasMore !== true
      && visibleItems.length > 0
  };
}

function createInitialListState() {
  const filters = copyFilters();
  return {
    loading: true,
    loadingMore: false,
    loadMoreError: '',
    activeChannel: 'all',
    ...createSortState(),
    feedError: '',
    filters,
    ...createFilterDraftState({ facets: [] }, 'all', filters),
    filterOpen: false,
    filterScrollTarget: '',
    checkingForUpdates: false,
    applyingNewItems: false,
    ...createNewItemsNotice(),
    feed: decorateFeed()
  };
}

module.exports = {
  PAGE_SIZE,
  copyFilters,
  defaultFiltersForFeed,
  reconcileFeedFilters,
  requestFilters,
  normalizeFeedAccess,
  createSortState,
  createNewItemsNotice,
  isSortKey,
  decorateFilterOptions,
  countFacetResults,
  createFilterDraftState,
  mergeUniqueItems,
  mergeFeedPage,
  createFeedAppendPatch,
  decorateFeed,
  createInitialListState
};
