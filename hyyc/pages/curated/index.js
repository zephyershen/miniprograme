const { getCuratedFeed } = require('../../features/curated-feed/api.js');
const { CURATED_SAMPLE } = require('../../features/curated-feed/sample.js');
const {
  WINDOW_OPTIONS,
  SORT_OPTIONS,
  createFilterState,
  filterSummary,
  createCuratedView,
  createCuratedState
} = require('../../features/curated-feed/model.js');
const { refreshMembershipAccess } = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');

const PAGE_SIZE = 8;

function activeOptions(options, key) {
  return options.map((item) => ({ ...item, active: item.key === key }));
}

function mergeUnique(current = [], incoming = []) {
  const seen = new Set(current.map((item) => item.id));
  return current.concat((incoming || []).filter((item) => item && !seen.has(item.id) && seen.add(item.id)));
}

Page({
  data: {
    ...createCuratedState(),
    sample: CURATED_SAMPLE,
    membership: membershipPresentation(null)
  },

  onShow() {
    this.resolveAccess();
  },

  onReachBottom() {
    this.loadMore();
  },

  async resolveAccess() {
    this.setData({ loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force: true });
      const membership = membershipPresentation(access);
      if (!membership.isPrivileged) {
        this.rawItems = [];
        this.setData({ loading: false, locked: true, providerPending: false, membership });
        return;
      }
      this.setData({ locked: false, membership });
      await this.loadFeed(true);
    } catch (error) {
      this.setData({ loading: false, error: error.message || '精选暂时无法加载' });
    }
  },

  async loadFeed(reset) {
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    if (reset) {
      this.rawItems = [];
      this.nextCursor = '';
      this.nextOffset = 0;
      this.setData({ loading: true, loadingMore: false, error: '' });
    }
    try {
      const filters = this.data.filters;
      const raw = await getCuratedFeed({
        cursor: reset ? '' : this.nextCursor,
        offset: reset ? 0 : this.nextOffset,
        limit: PAGE_SIZE,
        channel: this.data.activeChannel,
        sort: this.data.sortMode,
        filters
      });
      if (requestId !== this.requestId) return;
      this.rawItems = mergeUnique(reset ? [] : this.rawItems, raw.items || []);
      this.nextCursor = raw.nextCursor || '';
      this.nextOffset = Number(raw.nextOffset) || this.rawItems.length;
      const merged = { ...raw, items: this.rawItems };
      const view = createCuratedView(merged, { activeChannel: this.data.activeChannel });
      this.setData({
        view,
        providerPending: raw.status === 'pending' || raw.intelligenceStatus === 'pending',
        loading: false,
        loadingMore: false,
        error: ''
      });
      getApp().globalData.curatedFeed = merged;
    } catch (error) {
      if (requestId !== this.requestId) return;
      if (error.code === 'ENTITLEMENT_REQUIRED') {
        this.setData({ loading: false, loadingMore: false, locked: true });
        return;
      }
      this.setData({
        loading: false,
        loadingMore: false,
        error: error.message || '精选暂时无法加载'
      });
    }
  },

  loadMore() {
    if (this.data.locked || this.data.loading || this.data.loadingMore || !this.data.view.hasMore) return;
    this.setData({ loadingMore: true }, () => this.loadFeed(false));
  },

  selectChannel(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.activeChannel) return;
    this.setData({ activeChannel: key }, () => this.loadFeed(true));
  },

  selectWindow(event) {
    const key = event.currentTarget.dataset.key;
    if (!WINDOW_OPTIONS.some((item) => item.key === key) || key === this.data.filters.time) return;
    const filters = { ...this.data.filters, time: key };
    this.setData({
      filters,
      windowOptions: activeOptions(WINDOW_OPTIONS, key),
      filterSummary: filterSummary(filters)
    }, () => this.loadFeed(true));
  },

  selectSort(event) {
    const key = event.currentTarget.dataset.key;
    if (!SORT_OPTIONS.some((item) => item.key === key) || key === this.data.sortMode) return;
    this.setData({ sortMode: key, sortOptions: activeOptions(SORT_OPTIONS, key) }, () => this.loadFeed(true));
  },

  openFilters() {
    this.setData({ filterOpen: true, draftFilters: { ...this.data.filters } });
  },

  closeFilters() {
    this.setData({ filterOpen: false });
  },

  stopPropagation() {},

  selectFilter(event) {
    const group = event.currentTarget.dataset.group;
    const key = event.currentTarget.dataset.key;
    if (!['company', 'direction'].includes(group) || !key) return;
    this.setData({ draftFilters: { ...this.data.draftFilters, [group]: key } });
  },

  resetFilters() {
    this.setData({ draftFilters: createFilterState({ time: this.data.filters.time }) });
  },

  applyFilters() {
    const filters = createFilterState(this.data.draftFilters);
    this.setData({ filters, filterOpen: false, filterSummary: filterSummary(filters) }, () => this.loadFeed(true));
  },

  openItem(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  },

  openProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  retry() {
    this.resolveAccess();
  }
});
