const { channelByKey, decorateChannels } = require('./channels.js');
const { filterFeedItems, filterSummary, filterOptionsWithCounts } = require('./filters.js');
const { buildReadingGuide } = require('./reading.js');
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

function copyFilters(filters = DEFAULT_FEED_FILTERS) {
  return { time: filters.time, company: filters.company, direction: filters.direction };
}

function createSortState(activeSort = DEFAULT_SORT) {
  const selected = SORT_OPTIONS.find((option) => option.key === activeSort) || SORT_OPTIONS[0];
  return {
    sortMode: selected.key,
    sortOptions: SORT_OPTIONS.map((option) => ({ ...option, active: option.key === selected.key })),
    sortHint: selected.hint
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
    scoreLabel: Number.isFinite(Number(item.score)) ? `热度 ${item.score}` : '编辑精选',
    summaryPreview: buildReadingGuide(item.summary).brief
  }));
}

function filterByChannel(items, activeChannel) {
  return activeChannel === 'all' ? items : items.filter((item) => item.channelKey === activeChannel);
}

function decorateFilterOptions(raw, activeChannel, filters) {
  return filterOptionsWithCounts(FILTER_OPTIONS, filterByChannel(raw.facets || [], activeChannel), filters);
}

function countFacetResults(raw, activeChannel, filters) {
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

function decorateFeed(raw = { items: [], facets: [] }, activeChannel = 'all', filters = DEFAULT_FEED_FILTERS, loadedItems = []) {
  const filteredFacets = filterFeedItems(raw.facets || [], filters);
  const visibleItems = prepareFeedItems(loadedItems).map((item, index) => ({
    ...item,
    sequenceLabel: String(index + 1).padStart(2, '0')
  }));
  const facetResultCount = filterByChannel(filteredFacets, activeChannel).length;
  const resultCount = Number.isFinite(Number(raw.resultCount)) ? Number(raw.resultCount) : facetResultCount;
  return {
    visibleItems,
    leadItem: visibleItems[0] || null,
    remainingItems: visibleItems.slice(1),
    remainingCount: Math.max(0, resultCount - 1),
    channels: decorateChannels(filteredFacets, activeChannel),
    activeChannel,
    activeChannelLabel: channelByKey(activeChannel).label,
    resultCount,
    loadedCount: visibleItems.length,
    totalAvailable: Number(raw.totalAvailable) || (raw.facets || []).length,
    hasMore: raw.hasMore === true,
    filterSummary: filterSummary(filters, FILTER_OPTIONS)
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
    feed: decorateFeed()
  };
}

module.exports = {
  PAGE_SIZE,
  copyFilters,
  createSortState,
  isSortKey,
  decorateFilterOptions,
  countFacetResults,
  createFilterDraftState,
  mergeUniqueItems,
  decorateFeed,
  createInitialListState
};
