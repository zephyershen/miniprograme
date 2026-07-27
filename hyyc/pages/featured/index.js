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
const {
  refreshMembershipAccess
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const {
  applyResolvedItemMedia,
  collectFeedMediaFileIds,
  createResolvedFeedMediaPatch,
  knowledgeMediaSession
} = require('../../features/knowledge-feed/cloud-media-session.js');
const {
  createPageMediaRecovery
} = require('../../features/knowledge-feed/cloud-media-recovery.js');
const { finishPullDownRefresh } = require('../../features/runtime/pull-down-refresh.js');

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
    membership: membershipPresentation(null),
    membershipPromptVisible: false,
    membershipPromptFeature: 'curated_feed'
  },

  onLoad() {
    this.curatedMediaRequestId = 0;
    this.mediaRecovery = createPageMediaRecovery(this);
  },

  onUnload() {
    this.curatedMediaRequestId = (this.curatedMediaRequestId || 0) + 1;
    if (this.mediaRecovery) this.mediaRecovery.dispose();
  },

  onShow() {
    if (this.mediaRecovery) this.mediaRecovery.resume();
    this.resolveAccess({ force: true, preserveCurrent: this.contentLoaded === true });
  },

  onPullDownRefresh() {
    return finishPullDownRefresh(() => this.resolveAccess({
      force: true,
      preserveCurrent: this.contentLoaded === true
    }));
  },

  onHide() {
    if (this.mediaRecovery) this.mediaRecovery.pause();
  },

  onReachBottom() {
    this.loadMore();
  },

  async resolveAccess({ force = false, preserveCurrent = false } = {}) {
    this.setData(preserveCurrent ? { error: '' } : { loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force });
      const membership = membershipPresentation(access);
      this.accessResolvedAt = Date.now();
      if (!membership.isPrivileged) {
        this.curatedMediaRequestId = (this.curatedMediaRequestId || 0) + 1;
        this.rawItems = [];
        this.setData({ loading: false, locked: true, providerPending: false, membership });
        return;
      }
      this.setData({ locked: false, membership });
      await this.loadFeed(true, { preserveCurrent });
    } catch (error) {
      if (!preserveCurrent) {
        this.setData({ loading: false, error: error.message || '精选暂时无法加载' });
      }
    }
  },

  async loadFeed(reset, { preserveCurrent = false } = {}) {
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    if (reset && !preserveCurrent) {
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
      this.rawItems = reset && preserveCurrent
        ? mergeUnique(raw.items || [], this.rawItems)
        : mergeUnique(reset ? [] : this.rawItems, raw.items || []);
      this.contentLoaded = true;
      this.nextCursor = raw.nextCursor || '';
      this.nextOffset = Number(raw.nextOffset) || this.rawItems.length;
      const merged = { ...raw, items: this.rawItems };
      const view = createCuratedView(merged, { activeChannel: this.data.activeChannel });
      const mediaRequestId = (this.curatedMediaRequestId || 0) + 1;
      this.curatedMediaRequestId = mediaRequestId;
      if (this.mediaRecovery) this.mediaRecovery.reset();
      this.setData({
        view,
        providerPending: raw.status === 'pending' || raw.intelligenceStatus === 'pending',
        loading: false,
        loadingMore: false,
        error: ''
      });
      this.resolveVisibleCuratedMedia(view, mediaRequestId);
      getApp().globalData.curatedFeed = merged;
    } catch (error) {
      if (requestId !== this.requestId) return;
      if (error.code === 'ENTITLEMENT_REQUIRED') {
        this.setData({ loading: false, loadingMore: false, locked: true });
        return;
      }
      if (!preserveCurrent) {
        this.setData({
          loading: false,
          loadingMore: false,
          error: error.message || '精选暂时无法加载'
        });
      }
    }
  },

  async resolveVisibleCuratedMedia(view, requestId) {
    const resolvedUrls = await knowledgeMediaSession.resolveForFeed(view);
    if (requestId !== this.curatedMediaRequestId) return false;
    const currentView = this.data && this.data.view;
    if (!currentView) return false;
    this.rawItems = (this.rawItems || []).map((item) => (
      applyResolvedItemMedia(item, resolvedUrls, { includeRelated: false })
    ));
    const patch = createResolvedFeedMediaPatch(currentView, resolvedUrls, 'view');
    if (Object.keys(patch).length) this.setData(patch);
    if (this.mediaRecovery) {
      this.mediaRecovery.track(collectFeedMediaFileIds(this.data.view), (freshUrls) => {
        if (requestId !== this.curatedMediaRequestId || !this.data.view) return;
        this.rawItems = (this.rawItems || []).map((item) => (
          applyResolvedItemMedia(item, freshUrls, { includeRelated: false })
        ));
        const freshPatch = createResolvedFeedMediaPatch(this.data.view, freshUrls, 'view');
        if (Object.keys(freshPatch).length) this.setData(freshPatch);
      });
    }
    return true;
  },

  handleMediaError(event) {
    if (this.mediaRecovery) this.mediaRecovery.handleError(event);
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

  openMembershipPrompt() {
    this.setData({ membershipPromptVisible: true });
  },

  closeMembershipPrompt() {
    this.setData({ membershipPromptVisible: false });
  },

  openMembershipFromPrompt() {
    this.setData({ membershipPromptVisible: false }, () => this.openProfile());
  },

  retry() {
    this.resolveAccess({ force: true });
  }
});
