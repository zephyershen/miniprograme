const {
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
    const activeChannel = this.data.activeChannel;
    const sort = this.data.sortMode;
    const filters = copyFilters(this.data.filters);
    this.loadedItems = [];
    this.setData({ loading: true, loadingMore: false, loadMoreError: '', feedError: '' });
    try {
      const rawFeed = await getKnowledgeFeed({
        force,
        offset: 0,
        limit: PAGE_SIZE,
        channel: activeChannel,
        sort,
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
    const sort = this.data.sortMode;
    const filters = copyFilters(this.data.filters);
    const offset = Number(this.rawFeed && this.rawFeed.nextOffset) || this.loadedItems.length;
    this.setData({ loadingMore: true, loadMoreError: '' });
    try {
      const page = await getKnowledgeFeed({
        offset,
        limit: PAGE_SIZE,
        channel: activeChannel,
        sort,
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
    const draftFilters = { ...this.data.draftFilters, [group]: key };
    const draftCount = countFacetResults(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    const filterOptions = decorateFilterOptions(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  resetFilters() {
    this.setData(createFilterDraftState(this.rawFeed || { facets: [] }, this.data.activeChannel, copyFilters()));
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
