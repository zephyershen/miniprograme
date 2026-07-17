const { CHANNELS, channelByKey, decorateChannelCounts } = require('../knowledge-feed/channels.js');
const { COMPANY_FILTERS, DIRECTION_FILTERS } = require('../knowledge-feed/config.js');
const { buildReadingGuide } = require('../knowledge-feed/reading.js');

const WINDOW_OPTIONS = Object.freeze([
  { key: '1d', label: '24 小时' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' }
]);
const SORT_OPTIONS = Object.freeze([
  { key: 'importance', label: '重要度' },
  { key: 'latest', label: '最新' }
]);

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function decorateItems(items = []) {
  return items.map((item) => ({
    ...item,
    publishedLabel: formatDate(item.publishedAt),
    curationReason: item.curationReason || '重要变化 · 值得继续读',
    summaryPreview: buildReadingGuide(item.summary).brief
  }));
}

function optionLabel(options, key, fallback) {
  const match = options.find((item) => item.key === key);
  return match ? match.label : fallback;
}

function createFilterState(filters = {}) {
  return {
    time: WINDOW_OPTIONS.some((item) => item.key === filters.time) ? filters.time : '7d',
    company: COMPANY_FILTERS.some((item) => item.key === filters.company) ? filters.company : 'all',
    direction: DIRECTION_FILTERS.some((item) => item.key === filters.direction) ? filters.direction : 'all'
  };
}

function filterSummary(filters) {
  const parts = [optionLabel(WINDOW_OPTIONS, filters.time, '7 天')];
  if (filters.company !== 'all') parts.push(optionLabel(COMPANY_FILTERS, filters.company, '全部公司'));
  if (filters.direction !== 'all') parts.push(optionLabel(DIRECTION_FILTERS, filters.direction, '全部方向'));
  if (parts.length === 1) parts.push('全部主题');
  return parts.join(' · ');
}

function createCuratedView(raw = {}, state = {}) {
  const items = decorateItems(raw.items || []);
  const activeChannel = state.activeChannel || 'all';
  const counts = raw.channelCounts || {};
  return {
    leadItem: items[0] || null,
    remainingItems: items.slice(1),
    channels: decorateChannelCounts(Object.fromEntries(CHANNELS.map((channel) => [
      channel.key,
      Number(counts[channel.key]) || (channel.key === 'all' ? Number(raw.resultCount) || 0 : 0)
    ])), activeChannel),
    activeChannelLabel: channelByKey(activeChannel).label,
    resultCount: Number(raw.resultCount) || items.length,
    totalAnalyzed: Number(raw.totalAnalyzed) || 0,
    coverageState: raw.coverage && raw.coverage.state || 'partial',
    updatedAt: raw.updatedAt || '',
    nextCursor: raw.nextCursor || '',
    hasMore: raw.hasMore === true,
    items
  };
}

function createCuratedState() {
  const filters = createFilterState();
  return {
    loading: true,
    loadingMore: false,
    error: '',
    locked: false,
    providerPending: false,
    activeChannel: 'all',
    filters,
    draftFilters: { ...filters },
    filterOpen: false,
    filterSummary: filterSummary(filters),
    companyOptions: COMPANY_FILTERS,
    directionOptions: DIRECTION_FILTERS,
    windowOptions: WINDOW_OPTIONS.map((item) => ({ ...item, active: item.key === filters.time })),
    sortMode: 'importance',
    sortOptions: SORT_OPTIONS.map((item) => ({ ...item, active: item.key === 'importance' })),
    view: createCuratedView()
  };
}

module.exports = {
  WINDOW_OPTIONS,
  SORT_OPTIONS,
  createFilterState,
  filterSummary,
  createCuratedView,
  createCuratedState
};
