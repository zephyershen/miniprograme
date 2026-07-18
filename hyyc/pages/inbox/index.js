const {
  PAGE_SIZE,
  copyFilters,
  defaultFiltersForFeed,
  reconcileFeedFilters,
  requestFilters,
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
} = require('../../features/knowledge-feed/list-model.js');
const {
  getKnowledgeFeed,
  getKnowledgeFeedUpdates
} = require('../../features/knowledge-feed/api.js');
const {
  refreshMembershipAccess,
  membershipRevision
} = require('../../features/membership/session.js');

const FEED_UPDATE_POLL_MS = 60 * 1000;

Page({
  data: createInitialListState(),

  onLoad() {
    this.feedPageVisible = false;
    this.skipNextMembershipRefresh = true;
    this.seenMembershipRevision = membershipRevision();
    this.loadFeed(false);
  },

  onShow() {
    this.feedPageVisible = true;
    if (this.skipNextMembershipRefresh) {
      this.skipNextMembershipRefresh = false;
      this.scheduleFeedUpdateCheck();
      return;
    }
    this.refreshMembershipAndFeed();
  },

  onHide() {
    this.feedPageVisible = false;
    this.stopFeedUpdateChecks();
  },

  onUnload() {
    this.feedPageVisible = false;
    this.stopFeedUpdateChecks();
  },

  async refreshMembershipAndFeed() {
    try {
      await refreshMembershipAccess({ force: true });
      const nextRevision = membershipRevision();
      if (nextRevision === this.seenMembershipRevision) {
        this.scheduleFeedUpdateCheck();
        return;
      }
      this.seenMembershipRevision = nextRevision;
      this.feedAccessResolved = false;
      this.historyBoundarySeen = false;
      await this.loadFeed(false);
    } catch (error) {
      console.warn('资讯权限暂时未刷新', error && error.code ? error.code : error);
      this.scheduleFeedUpdateCheck();
    }
  },

  onReachBottom() {
    this.loadMoreFeed();
  },

  onPullDownRefresh() {
    this.loadFeed(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeed(force, options = {}) {
    const preserveCurrent = options.preserveCurrent === true;
    const requestId = (this.feedRequestId || 0) + 1;
    this.feedRequestId = requestId;
    const previousRawFeed = this.rawFeed;
    const previousLoadedItems = this.loadedItems || [];
    const activeChannel = this.data.activeChannel;
    const sort = this.data.sortMode;
    const filters = copyFilters(this.data.filters);
    const accessResolved = this.feedAccessResolved === true;
    const requestedFilters = requestFilters(filters, accessResolved);
    if (!preserveCurrent) this.loadedItems = [];
    this.setData(preserveCurrent
      ? { applyingNewItems: true, loadMoreError: '' }
      : { loading: true, loadingMore: false, loadMoreError: '', feedError: '' });
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
      if (requestId !== this.feedRequestId) return false;
      this.rawFeed = rawFeed;
      this.feedAccessResolved = true;
      this.loadedItems = rawFeed.items || [];
      this.feedHeadCursor = rawFeed.headCursor || '';
      this.present('', reconcileFeedFilters(rawFeed, filters, !accessResolved));
      this.setData(createNewItemsNotice());
      this.scheduleFeedUpdateCheck();
      return true;
    } catch (error) {
      if (requestId !== this.feedRequestId) return false;
      this.rawFeed = previousRawFeed || { items: [], facets: [] };
      this.loadedItems = preserveCurrent ? previousLoadedItems : [];
      if (preserveCurrent) {
        wx.showToast({ title: error.message || '刷新失败，请重试', icon: 'none' });
      } else {
        this.present(error.message, filters);
      }
      this.scheduleFeedUpdateCheck();
      return false;
    } finally {
      if (requestId === this.feedRequestId) {
        this.setData(preserveCurrent ? { applyingNewItems: false } : { loading: false });
      }
    }
  },

  scheduleFeedUpdateCheck(delay = FEED_UPDATE_POLL_MS) {
    this.stopFeedUpdateChecks();
    if (!this.feedPageVisible) return;
    this.feedUpdateTimer = setTimeout(async () => {
      this.feedUpdateTimer = null;
      await this.checkForFeedUpdates();
      this.scheduleFeedUpdateCheck();
    }, delay);
  },

  stopFeedUpdateChecks() {
    if (this.feedUpdateTimer) clearTimeout(this.feedUpdateTimer);
    this.feedUpdateTimer = null;
  },

  async checkForFeedUpdates() {
    if (!this.feedPageVisible || this.feedUpdateCheckActive || !this.feedHeadCursor
      || this.data.loading || this.data.applyingNewItems || this.data.filterOpen) return;
    const anchor = this.feedHeadCursor;
    const requestId = this.feedRequestId;
    this.feedUpdateCheckActive = true;
    this.setData({ checkingForUpdates: true });
    try {
      const result = await getKnowledgeFeedUpdates({
        headCursor: anchor,
        channel: this.data.activeChannel,
        filters: copyFilters(this.data.filters)
      });
      if (!this.feedPageVisible || requestId !== this.feedRequestId || anchor !== this.feedHeadCursor) return;
      this.setData(createNewItemsNotice(result && result.newCount));
    } catch (error) {
      console.warn('新资讯检测暂时失败', error && error.code ? error.code : error);
    } finally {
      this.feedUpdateCheckActive = false;
      if (this.feedPageVisible) this.setData({ checkingForUpdates: false });
    }
  },

  async applyNewItems() {
    if (this.data.applyingNewItems || !this.data.newItemsVisible) return;
    const refreshed = await this.loadFeed(false, { preserveCurrent: true });
    if (refreshed) wx.pageScrollTo({ scrollTop: 0, duration: 260 });
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
    if (key === 'featured') {
      wx.navigateTo({ url: '/pages/featured/index' });
      return;
    }
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
