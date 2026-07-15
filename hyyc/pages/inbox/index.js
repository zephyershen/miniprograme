const { getKnowledgeFeed } = require('../../utils/api');
const { decorateChannels, channelByKey } = require('../../utils/channels');
const { buildReadingGuide } = require('../../utils/editorial-detail');
const { filterFeedItems, filterSummary, filterOptionsWithCounts } = require('../../utils/feed-filter');
const {
  TIME_FILTERS,
  COMPANY_FILTERS,
  DIRECTION_FILTERS,
  DEFAULT_FEED_FILTERS
} = require('../../config/feed-filters');

const FILTER_OPTIONS = Object.freeze({
  time: TIME_FILTERS,
  company: COMPANY_FILTERS,
  direction: DIRECTION_FILTERS
});

function copyFilters(filters = DEFAULT_FEED_FILTERS) {
  return { time: filters.time, company: filters.company, direction: filters.direction };
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

function prepareFeedItems(raw = { items: [] }) {
  return (raw.items || [])
    .map((item) => ({
      ...item,
      publishedLabel: formatFeedDate(item.publishedAt),
      scoreLabel: Number.isFinite(Number(item.score)) ? `热度 ${item.score}` : '编辑精选',
      summaryPreview: buildReadingGuide(item.summary).brief
    }));
}

function filterByChannel(items, activeChannel) {
  return activeChannel === 'all'
    ? items
    : items.filter((item) => item.channelKey === activeChannel);
}

function decorateFilterOptions(raw, activeChannel, filters) {
  return filterOptionsWithCounts(FILTER_OPTIONS, filterByChannel(prepareFeedItems(raw), activeChannel), filters);
}

function decorateFeed(raw = { items: [] }, activeChannel = 'all', filters = DEFAULT_FEED_FILTERS) {
  const allItems = prepareFeedItems(raw);
  const filteredItems = filterFeedItems(allItems, filters);
  const visibleItems = filterByChannel(filteredItems, activeChannel).map((item, index) => ({
    ...item,
    sequenceLabel: String(index + 1).padStart(2, '0')
  }));
  const channel = channelByKey(activeChannel);

  return {
    visibleItems,
    leadItem: visibleItems[0] || null,
    remainingItems: visibleItems.slice(1),
    channels: decorateChannels(filteredItems, activeChannel),
    activeChannel,
    activeChannelLabel: channel.label,
    resultCount: visibleItems.length,
    totalAvailable: Number(raw.totalAvailable) || allItems.length,
    filterSummary: filterSummary(filters, FILTER_OPTIONS)
  };
}

Page({
  data: {
    loading: true,
    activeChannel: 'all',
    feedError: '',
    filters: copyFilters(),
    draftFilters: copyFilters(),
    filterOptions: decorateFilterOptions({ items: [] }, 'all', DEFAULT_FEED_FILTERS),
    filterOpen: false,
    filterScrollTarget: '',
    draftCount: 0,
    feed: decorateFeed()
  },

  onShow() {
    this.loadFeed(false);
  },

  onPullDownRefresh() {
    this.loadFeed(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeed(force) {
    this.setData({ loading: true, feedError: '' });
    try {
      this.rawFeed = await getKnowledgeFeed(force);
      this.present(this.data.activeChannel);
    } catch (error) {
      this.present(this.data.activeChannel, error.message);
    } finally {
      this.setData({ loading: false });
    }
  },

  present(activeChannel, feedError = '', filters = this.data.filters) {
    const feed = decorateFeed(this.rawFeed || { items: [] }, activeChannel, filters);
    getApp().globalData.knowledgeFeed = {
      ...(this.rawFeed || {}),
      items: (this.rawFeed && this.rawFeed.items) || []
    };
    this.setData({ feed, activeChannel, feedError });
  },

  selectChannel(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeChannel) return;
    this.present(key);
  },

  retryFeed() {
    this.loadFeed(true);
  },

  openFilters() {
    const draftFilters = copyFilters(this.data.filters);
    const draftCount = decorateFeed(this.rawFeed || { items: [] }, this.data.activeChannel, draftFilters).resultCount;
    const filterOptions = decorateFilterOptions(this.rawFeed || { items: [] }, this.data.activeChannel, draftFilters);
    this.setData({ filterOpen: true, draftFilters, draftCount, filterOptions, filterScrollTarget: '' }, () => {
      this.setData({ filterScrollTarget: 'filter-time-group' });
    });
  },

  closeFilters() {
    this.setData({ filterOpen: false, filterScrollTarget: '' });
  },

  stopPropagation() {},

  selectFilter(event) {
    const group = event.currentTarget.dataset.group;
    const key = event.currentTarget.dataset.key;
    if (!['time', 'company', 'direction'].includes(group) || !key) return;
    const option = (this.data.filterOptions[group] || []).find((entry) => entry.key === key);
    if (!option || option.disabled) return;
    const draftFilters = { ...this.data.draftFilters, [group]: key };
    const draftCount = decorateFeed(this.rawFeed || { items: [] }, this.data.activeChannel, draftFilters).resultCount;
    const filterOptions = decorateFilterOptions(this.rawFeed || { items: [] }, this.data.activeChannel, draftFilters);
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  resetFilters() {
    const draftFilters = copyFilters();
    const draftCount = decorateFeed(this.rawFeed || { items: [] }, this.data.activeChannel, draftFilters).resultCount;
    const filterOptions = decorateFilterOptions(this.rawFeed || { items: [] }, this.data.activeChannel, draftFilters);
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  applyFilters() {
    const filters = copyFilters(this.data.draftFilters);
    this.setData({ filters, filterOpen: false });
    this.present(this.data.activeChannel, '', filters);
  },

  openFeedItem(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  }
});
