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
const PAGE_SIZE = 8;

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
  return filterOptionsWithCounts(FILTER_OPTIONS, filterByChannel(raw.facets || [], activeChannel), filters);
}

function countFacetResults(raw, activeChannel, filters) {
  return filterByChannel(filterFeedItems(raw.facets || [], filters), activeChannel).length;
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
  const visibleItems = prepareFeedItems({ items: loadedItems }).map((item, index) => ({
    ...item,
    sequenceLabel: String(index + 1).padStart(2, '0')
  }));
  const channel = channelByKey(activeChannel);
  const facetResultCount = filterByChannel(filteredFacets, activeChannel).length;
  const resultCount = Number.isFinite(Number(raw.resultCount)) ? Number(raw.resultCount) : facetResultCount;

  return {
    visibleItems,
    leadItem: visibleItems[0] || null,
    remainingItems: visibleItems.slice(1),
    remainingCount: Math.max(0, resultCount - 1),
    channels: decorateChannels(filteredFacets, activeChannel),
    activeChannel,
    activeChannelLabel: channel.label,
    resultCount,
    loadedCount: visibleItems.length,
    totalAvailable: Number(raw.totalAvailable) || (raw.facets || []).length,
    hasMore: raw.hasMore === true,
    filterSummary: filterSummary(filters, FILTER_OPTIONS)
  };
}

Page({
  data: {
    loading: true,
    loadingMore: false,
    loadMoreError: '',
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

  onLoad() {
    this.loadFeed(false);
  },

  onReachBottom() {
    this.loadMoreFeed();
  },

  onPullDownRefresh() {
    this.loadFeed(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeed(force) {
    const requestId = (this.feedRequestId || 0) + 1;
    this.feedRequestId = requestId;
    const activeChannel = this.data.activeChannel;
    const filters = copyFilters(this.data.filters);
    this.loadedItems = [];
    this.setData({ loading: true, loadingMore: false, loadMoreError: '', feedError: '' });
    try {
      const rawFeed = await getKnowledgeFeed({
        force,
        offset: 0,
        limit: PAGE_SIZE,
        channel: activeChannel,
        filters
      });
      if (requestId !== this.feedRequestId) return;
      this.rawFeed = rawFeed;
      this.loadedItems = rawFeed.items || [];
      this.present();
    } catch (error) {
      if (requestId !== this.feedRequestId) return;
      this.rawFeed = { items: [], facets: [] };
      this.loadedItems = [];
      this.present(error.message);
    } finally {
      if (requestId === this.feedRequestId) this.setData({ loading: false });
    }
  },

  async loadMoreFeed() {
    if (this.data.loading || this.data.loadingMore || this.data.filterOpen || !this.data.feed.hasMore) return;
    const requestId = this.feedRequestId;
    const activeChannel = this.data.activeChannel;
    const filters = copyFilters(this.data.filters);
    const offset = Number(this.rawFeed && this.rawFeed.nextOffset) || this.loadedItems.length;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const page = await getKnowledgeFeed({
        offset,
        limit: PAGE_SIZE,
        channel: activeChannel,
        filters
      });
      if (requestId !== this.feedRequestId) return;
      this.loadedItems = mergeUniqueItems(this.loadedItems, page.items || []);
      this.rawFeed = {
        ...this.rawFeed,
        ...page,
        facets: this.rawFeed.facets || page.facets || [],
        items: this.loadedItems
      };
      this.present();
    } catch (error) {
      if (requestId !== this.feedRequestId) return;
      this.setData({ loadMoreError: error.message || '加载失败，请重试' });
    } finally {
      if (requestId === this.feedRequestId) this.setData({ loadingMore: false });
    }
  },

  present(feedError = '') {
    const activeChannel = this.data.activeChannel;
    const filters = this.data.filters;
    const feed = decorateFeed(this.rawFeed || { items: [], facets: [] }, activeChannel, filters, this.loadedItems || []);
    getApp().globalData.knowledgeFeed = {
      ...(this.rawFeed || {}),
      items: this.loadedItems || []
    };
    this.setData({ feed, activeChannel, feedError });
  },

  selectChannel(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeChannel) return;
    this.setData({ activeChannel: key }, () => this.loadFeed(false));
  },

  retryFeed() {
    this.loadFeed(true);
  },

  openFilters() {
    const draftFilters = copyFilters(this.data.filters);
    const draftCount = countFacetResults(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    const filterOptions = decorateFilterOptions(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
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
    const draftCount = countFacetResults(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    const filterOptions = decorateFilterOptions(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  resetFilters() {
    const draftFilters = copyFilters();
    const draftCount = countFacetResults(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    const filterOptions = decorateFilterOptions(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  applyFilters() {
    const filters = copyFilters(this.data.draftFilters);
    this.setData({ filters, filterOpen: false }, () => this.loadFeed(false));
  },

  openFeedItem(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  }
});
