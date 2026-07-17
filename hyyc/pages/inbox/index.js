const {
  PAGE_SIZE,
  copyFilters,
  defaultFiltersForFeed,
  reconcileFeedFilters,
  requestFilters,
  createSortState,
  isSortKey,
  decorateFilterOptions,
  countFacetResults,
  createFilterDraftState,
  mergeUniqueItems,
  mergeFeedPage,
  createFeedAppendPatch,
  decorateFeed,
  createInitialListState
} = require('../../features/knowledge-feed/list-model.js');
const { getKnowledgeFeed } = require('../../features/knowledge-feed/api.js');

Page({
  data: createInitialListState(),

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
    const previousRawFeed = this.rawFeed;
    const activeChannel = this.data.activeChannel;
    const sort = this.data.sortMode;
    const filters = copyFilters(this.data.filters);
    const accessResolved = this.feedAccessResolved === true;
    const requestedFilters = requestFilters(filters, accessResolved);
    this.loadedItems = [];
    this.setData({ loading: true, loadingMore: false, loadMoreError: '', feedError: '' });
    try {
      const rawFeed = await getKnowledgeFeed({
        force,
        cursor: '',
        offset: 0,
        limit: PAGE_SIZE,
        channel: activeChannel,
        sort,
        filters: requestedFilters
      });
      if (requestId !== this.feedRequestId) return;
      this.rawFeed = rawFeed;
      this.feedAccessResolved = true;
      this.loadedItems = rawFeed.items || [];
      this.present('', reconcileFeedFilters(rawFeed, filters, !accessResolved));
    } catch (error) {
      if (requestId !== this.feedRequestId) return;
      this.rawFeed = previousRawFeed || { items: [], facets: [] };
      this.loadedItems = [];
      this.present(error.message, filters);
    } finally {
      if (requestId === this.feedRequestId) this.setData({ loading: false });
    }
  },

  async loadMoreFeed() {
    if (this.data.loading || this.data.loadingMore || this.data.filterOpen || !this.data.feed.hasMore) return;
    const requestId = this.feedRequestId;
    const activeChannel = this.data.activeChannel;
    const sort = this.data.sortMode;
    const filters = copyFilters(this.data.filters);
    const offset = Number(this.rawFeed && this.rawFeed.nextOffset) || this.loadedItems.length;
    const cursor = this.rawFeed && this.rawFeed.nextCursor || '';
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const page = await getKnowledgeFeed({
        cursor,
        offset,
        limit: PAGE_SIZE,
        channel: activeChannel,
        sort,
        filters
      });
      if (requestId !== this.feedRequestId) return;
      const previousLoadedCount = this.loadedItems.length;
      this.loadedItems = mergeUniqueItems(this.loadedItems, page.items || []);
      this.rawFeed = mergeFeedPage(this.rawFeed, page, this.loadedItems);
      this.present('', null, previousLoadedCount);
    } catch (error) {
      if (requestId !== this.feedRequestId) return;
      this.setData({ loadMoreError: error.message || '加载失败，请重试' });
    } finally {
      if (requestId === this.feedRequestId) this.setData({ loadingMore: false });
    }
  },

  present(feedError = '', nextFilters = null, appendFrom = null) {
    const activeChannel = this.data.activeChannel;
    const filters = nextFilters || reconcileFeedFilters(this.rawFeed || {}, this.data.filters);
    const feed = decorateFeed(this.rawFeed || { items: [], facets: [] }, activeChannel, filters, this.loadedItems || []);
    getApp().globalData.knowledgeFeed = {
      items: this.loadedItems || [],
      viewer: this.rawFeed && this.rawFeed.viewer,
      access: this.rawFeed && this.rawFeed.access,
      entitlements: this.rawFeed && this.rawFeed.entitlements,
      coverage: this.rawFeed && this.rawFeed.coverage,
      updatedAt: this.rawFeed && this.rawFeed.updatedAt
    };
    const appendPatch = Number.isInteger(appendFrom)
      ? createFeedAppendPatch(this.data.feed, feed, appendFrom)
      : null;
    const historyBoundaryVisible = feed.historyBoundary && this.historyBoundarySeen !== true;
    if (historyBoundaryVisible) this.historyBoundarySeen = true;
    const commonPatch = { historyBoundaryVisible };
    this.setData(appendPatch ? { ...appendPatch, ...commonPatch } : {
      feed,
      filters,
      activeChannel,
      feedError,
      ...commonPatch
    });
  },

  selectChannel(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeChannel) return;
    this.setData({ activeChannel: key }, () => this.loadFeed(false));
  },

  selectSort(event) {
    const sortMode = event.currentTarget.dataset.key;
    if (!isSortKey(sortMode) || sortMode === this.data.sortMode) return;
    this.setData(createSortState(sortMode), () => this.loadFeed(false));
  },

  retryFeed() {
    this.loadFeed(true);
  },

  openFilters() {
    const draft = createFilterDraftState(this.rawFeed || { facets: [] }, this.data.activeChannel, this.data.filters);
    this.setData({ filterOpen: true, ...draft, filterScrollTarget: '' }, () => {
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
    if (option.locked) {
      this.setData({ filterOpen: false, filterScrollTarget: '' }, () => {
        wx.switchTab({ url: '/pages/profile/index' });
      });
      return;
    }
    const draftFilters = { ...this.data.draftFilters, [group]: key };
    const draftCount = countFacetResults(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    const filterOptions = decorateFilterOptions(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  resetFilters() {
    const filters = defaultFiltersForFeed(this.rawFeed || {});
    this.setData(createFilterDraftState(this.rawFeed || { facets: [] }, this.data.activeChannel, filters));
  },

  applyFilters() {
    const filters = copyFilters(this.data.draftFilters);
    this.setData({ filters, filterOpen: false }, () => this.loadFeed(false));
  },

  openFeedItem(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  },

  openMembership() {
    this.setData({ historyBoundaryVisible: false }, () => {
      wx.switchTab({ url: '/pages/profile/index' });
    });
  }
});
