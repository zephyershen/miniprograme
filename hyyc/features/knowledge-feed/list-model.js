const {
  CHANNELS,
  channelByKey,
  matchesChannel,
  decorateChannels,
  decorateChannelCounts,
  FEATURED_SHORTCUT
} = require('./channels.js');
const { filterFeedItems, filterSummary, filterOptionsWithCounts } = require('./filters.js');
const { isFacetMatrix, facetMatrixCount } = require('./facet-matrix.js');
const { buildReadingGuide } = require('./reading.js');
const { decorateSourcePresentation } = require('./source-presentation.js');
const { normalizeMembershipAccess } = require('../membership/access.js');
const { decorateItemEngagement } = require('../engagement/model.js');
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
  return {
    time: filters.time,
    company: filters.company,
    direction: filters.direction,
    sourceTag: filters.sourceTag || 'all'
  };
}

function defaultFiltersForFeed(raw = {}) {
  const { access } = normalizeFeedAccess(raw);
  return { ...copyFilters(), time: access.defaultTimeKey };
}

function reconcileFeedFilters(raw = {}, filters = DEFAULT_FEED_FILTERS, preferDefault = false, channel = 'all') {
  const current = copyFilters(filters);
  if (channel === 'openSource') {
    const appliedSourceTag = raw.appliedFilters && raw.appliedFilters.sourceTag;
    return {
      ...current,
      sourceTag: typeof appliedSourceTag === 'string' && appliedSourceTag
        ? appliedSourceTag
        : current.sourceTag
    };
  }
  const { access } = normalizeFeedAccess(raw);
  const appliedTime = raw.appliedFilters && raw.appliedFilters.time;
  const time = access.allowedTimeKeys.includes(appliedTime)
    ? appliedTime
    : (preferDefault
      ? access.defaultTimeKey
      : (access.allowedTimeKeys.includes(current.time) ? current.time : access.defaultTimeKey));
  return { ...current, time };
}

function requestFilters(filters, accessResolved = false, channel = 'all') {
  const next = copyFilters(filters);
  if (channel === 'openSource') return { sourceTag: next.sourceTag };
  delete next.sourceTag;
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

function usesFlatFeedLayout(sortMode, activeChannel) {
  return activeChannel === 'openSource' || sortMode !== 'latest';
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

const TIMELINE_WEEKDAYS = Object.freeze([
  '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'
]);

function timelineParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      timelineDateKey: 'unknown',
      timelineDateLabel: '日期待确认',
      timelineWeekdayLabel: '',
      timelineTimeLabel: '--:--'
    };
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return {
    timelineDateKey: `${year}-${month}-${day}`,
    timelineDateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
    timelineWeekdayLabel: TIMELINE_WEEKDAYS[date.getDay()],
    timelineTimeLabel: `${hour}:${minute}`
  };
}

function decorateFeedTimeline(items = []) {
  const prepared = items.map((item) => ({ ...item, ...timelineParts(item.publishedAt) }));
  const counts = prepared.reduce((result, item) => {
    result.set(item.timelineDateKey, (result.get(item.timelineDateKey) || 0) + 1);
    return result;
  }, new Map());
  return prepared.map((item, index) => {
    const timelineDateCount = counts.get(item.timelineDateKey) || 0;
    const timelineStartsDay = index === 0
      || prepared[index - 1].timelineDateKey !== item.timelineDateKey;
    const timelineEndsDay = index === prepared.length - 1
      || prepared[index + 1].timelineDateKey !== item.timelineDateKey;
    const timelineDateCountLabel = `${timelineDateCount} 条`;
    const timelineDateMetaLabel = [
      item.timelineWeekdayLabel,
      timelineDateCountLabel
    ].filter(Boolean).join(' · ');
    return {
      ...item,
      timelineStartsDay,
      timelineEndsDay,
      timelineDateCount,
      timelineDateCountLabel,
      timelineDateMetaLabel,
      timeline: {
        dateKey: item.timelineDateKey,
        dayLabel: item.timelineDateLabel,
        weekdayLabel: item.timelineWeekdayLabel,
        timeLabel: item.timelineTimeLabel,
        startsDay: timelineStartsDay,
        endsDay: timelineEndsDay,
        dayCount: timelineDateCount,
        dayCountLabel: timelineDateCountLabel,
        dateMetaLabel: timelineDateMetaLabel
      }
    };
  });
}

function applyTimelineCollapse(feed = {}, collapsedDateKeys = []) {
  const collapsed = collapsedDateKeys instanceof Set
    ? collapsedDateKeys
    : new Set(Array.isArray(collapsedDateKeys) ? collapsedDateKeys : []);
  const decorate = (item) => item && item.timeline ? {
    ...item,
    timeline: {
      ...item.timeline,
      collapsed: collapsed.has(item.timeline.dateKey)
    }
  } : item;
  return {
    ...feed,
    leadItem: decorate(feed.leadItem),
    remainingItems: (feed.remainingItems || []).map(decorate),
    dayGroups: (feed.dayGroups || []).map((group) => ({
      ...group,
      collapsed: collapsed.has(group.dateKey),
      items: (group.items || []).map(decorate)
    }))
  };
}

function buildTimelineDayGroups(dayBuckets = [], visibleItems = []) {
  const itemsByDay = new Map();
  visibleItems.forEach((item) => {
    const dateKey = item.timeline && item.timeline.dateKey;
    if (!dateKey) return;
    if (!itemsByDay.has(dateKey)) itemsByDay.set(dateKey, []);
    itemsByDay.get(dateKey).push(item);
  });
  const normalizedBuckets = (Array.isArray(dayBuckets) ? dayBuckets : [])
    .filter((bucket) => bucket && typeof bucket.dateKey === 'string')
    .map((bucket) => ({
      dateKey: bucket.dateKey,
      dayLabel: bucket.dayLabel || bucket.dateKey,
      weekdayLabel: bucket.weekdayLabel || '',
      count: Math.max(0, Number(bucket.count) || 0)
    }));
  for (const [dateKey, items] of itemsByDay.entries()) {
    if (normalizedBuckets.some((bucket) => bucket.dateKey === dateKey)) continue;
    const first = items[0] && items[0].timeline;
    normalizedBuckets.push({
      dateKey,
      dayLabel: first && first.dayLabel || dateKey,
      weekdayLabel: first && first.weekdayLabel || '',
      count: items.length
    });
  }
  normalizedBuckets.sort((left, right) => right.dateKey.localeCompare(left.dateKey));
  return normalizedBuckets.map((bucket) => {
    const items = itemsByDay.get(bucket.dateKey) || [];
    const count = Math.max(bucket.count, items.length);
    return {
      ...bucket,
      count,
      countLabel: `${count} 条`,
      metaLabel: [bucket.weekdayLabel, `${count} 条`].filter(Boolean).join(' · '),
      items,
      loadedCount: items.length,
      hasMore: items.length < count,
      loading: false,
      error: '',
      pageInitialized: items.length > 0,
      nextCursor: ''
    };
  });
}

function applyTimelineDayStates(feed = {}, states = {}) {
  return {
    ...feed,
    dayGroups: (feed.dayGroups || []).map((group) => {
      const state = states[group.dateKey] || {};
      return {
        ...group,
        ...state,
        items: group.items || [],
        loadedCount: (group.items || []).length,
        hasMore: state.pageInitialized
          ? state.hasMore === true
          : group.hasMore
      };
    })
  };
}

function prepareFeedItems(items = []) {
  return decorateFeedTimeline(items.map((item) => decorateItemEngagement(decorateSourcePresentation({
    ...item,
    publishedLabel: formatFeedDate(item.publishedAt),
    scoreLabel: Number.isFinite(Number(item.score))
      ? `热度 ${item.score}`
      : (item.qualityTier === 'curated' ? '编辑精选' : '热度待评估'),
    summaryPreview: buildReadingGuide(item.summary).brief
  }))));
}

function filterByChannel(items, activeChannel) {
  return items.filter((item) => matchesChannel(item, activeChannel));
}

function libraryTagOptions(raw = {}, selected = 'all', query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  const facets = (Array.isArray(raw.sourceTagFacets) ? raw.sourceTagFacets : [])
    .filter((entry) => entry && typeof entry.value === 'string')
    .filter((entry) => !needle || entry.value.toLocaleLowerCase('zh-CN').includes(needle));
  let visible = needle ? facets.slice(0, 80) : facets.slice(0, 80);
  const selectedFacet = (raw.sourceTagFacets || []).find((entry) => entry.value === selected);
  if (selected !== 'all' && selectedFacet && !visible.some((entry) => entry.value === selected)) {
    visible = [selectedFacet, ...visible.slice(0, 79)];
  }
  const total = Number.isFinite(Number(raw.totalAvailable)) ? Number(raw.totalAvailable) : 0;
  return [
    { key: 'all', label: '全部标签', count: total, active: selected === 'all', disabled: false },
    ...visible.map((entry) => ({
      key: entry.value,
      label: entry.value,
      count: Math.max(0, Number(entry.count) || 0),
      active: selected === entry.value,
      disabled: false
    }))
  ];
}

function decorateFilterOptions(raw, activeChannel, filters, sourceTagQuery = '') {
  if (activeChannel === 'openSource') {
    return {
      time: [],
      company: [],
      direction: [],
      sourceTag: libraryTagOptions(raw, filters.sourceTag, sourceTagQuery)
    };
  }
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
  if (activeChannel === 'openSource') {
    if (filters.sourceTag === 'all') return Math.max(0, Number(raw.totalAvailable) || 0);
    const facet = (raw.sourceTagFacets || []).find((entry) => entry.value === filters.sourceTag);
    return facet ? Math.max(0, Number(facet.count) || 0) : 0;
  }
  const matrixCount = facetMatrixCount(raw && raw.facetMatrix, activeChannel, filters);
  if (matrixCount !== null) return matrixCount;
  return filterByChannel(filterFeedItems(raw.facets || [], filters), activeChannel).length;
}

function createFilterDraftState(raw, activeChannel, filters, sourceTagQuery = '') {
  const draftFilters = copyFilters(filters);
  return {
    draftFilters,
    draftCount: countFacetResults(raw, activeChannel, draftFilters),
    filterOptions: decorateFilterOptions(raw, activeChannel, draftFilters, sourceTagQuery),
    sourceTagQuery
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
    sourceTagFacets: current.sourceTagFacets || page.sourceTagFacets,
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
  const currentTimelineItems = [currentFeed.leadItem, ...(currentFeed.remainingItems || [])];
  const nextTimelineItems = [nextFeed.leadItem, ...(nextFeed.remainingItems || [])];
  const timelineAliasFields = [
    'timelineStartsDay',
    'timelineEndsDay',
    'timelineDateCount',
    'timelineDateCountLabel',
    'timelineDateMetaLabel'
  ];
  for (let index = 0; index < Math.min(previousLoadedCount, nextTimelineItems.length); index += 1) {
    const currentItem = currentTimelineItems[index];
    const nextItem = nextTimelineItems[index];
    const currentTimeline = currentItem && currentItem.timeline;
    const nextTimeline = nextItem && nextItem.timeline;
    if (!nextTimeline || JSON.stringify(currentTimeline) === JSON.stringify(nextTimeline)) continue;
    const basePath = index === 0 ? 'feed.leadItem' : `feed.remainingItems[${index - 1}]`;
    patch[`${basePath}.timeline`] = nextTimeline;
    timelineAliasFields.forEach((field) => {
      if (currentItem && currentItem[field] === nextItem[field]) return;
      patch[`${basePath}.${field}`] = nextItem[field];
    });
  }
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
  const dayGroups = buildTimelineDayGroups(raw.dayBuckets, visibleItems);
  return {
    leadItem: visibleItems[0] || null,
    remainingItems: visibleItems.slice(1),
    dayGroups,
    remainingCount: Math.max(0, resultCount - 1),
    channels: isFacetMatrix(raw.facetMatrix)
      ? decorateChannelCounts(Object.fromEntries(CHANNELS.map((channel) => [
        channel.key,
        facetMatrixCount(raw.facetMatrix, channel.key, filters)
      ])), activeChannel)
      : decorateChannels(filteredFacets, activeChannel),
    featuredShortcut: {
      ...FEATURED_SHORTCUT,
      locked: accessState.entitlements.curatedFeed !== true
    },
    activeChannel,
    activeChannelLabel: channelByKey(activeChannel).label,
    resultCount,
    loadedCount: visibleItems.length,
    totalAvailable,
    hasMore: raw.hasMore === true,
    filterSummary: activeChannel === 'openSource'
      ? (filters.sourceTag === 'all' ? '全部标签 · 不限时间' : `${filters.sourceTag} · 不限时间`)
      : filterSummary(filters, filterOptions),
    viewer: accessState.viewer,
    entitlements: accessState.entitlements,
    coverage: accessState.coverage,
    access: accessState.access,
    accessSummary: activeChannel === 'openSource'
      ? `收录 ${totalAvailable} 个项目 · 不限时间`
      : `${accessState.access.label} · 收录 ${totalAvailable} 条`,
    historyBoundary: activeChannel !== 'openSource' && accessState.viewer.role === 'free'
      && filters.time === '1d'
      && raw.hasMore !== true
      && visibleItems.length > 0
  };
}

function createInitialListState() {
  const filters = copyFilters();
  return {
    loading: true,
    channelTransitionLoading: false,
    loadingMore: false,
    loadMoreError: '',
    activeChannel: 'all',
    libraryMode: false,
    flatFeedMode: false,
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
  usesFlatFeedLayout,
  libraryTagOptions,
  decorateFilterOptions,
  countFacetResults,
  createFilterDraftState,
  mergeUniqueItems,
  mergeFeedPage,
  createFeedAppendPatch,
  timelineParts,
  decorateFeedTimeline,
  applyTimelineCollapse,
  buildTimelineDayGroups,
  applyTimelineDayStates,
  decorateFeed,
  createInitialListState
};
