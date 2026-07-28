const { searchKnowledgeFeed } = require('../../features/knowledge-feed/api.js');
const {
  mergeSearchItems,
  searchQueryError,
  searchFailureState
} = require('../../features/knowledge-feed/search-model.js');
const {
  rememberBriefingWindow,
  clearBriefingWindow
} = require('../../features/briefing/navigation.js');
const {
  applyResolvedItemMedia,
  collectItemMediaFileIds,
  knowledgeMediaSession
} = require('../../features/knowledge-feed/cloud-media-session.js');
const { createPageMediaRecovery } = require('../../features/knowledge-feed/cloud-media-recovery.js');
const { finishPullDownRefresh } = require('../../features/runtime/pull-down-refresh.js');
const {
  loadSearchHistory,
  recordSearchHistory,
  clearSearchHistory
} = require('../../features/knowledge-feed/search-history.js');

const PAGE_SIZE = 20;
const SUGGESTIONS = Object.freeze(['Claude Code', 'MCP', 'Agent', '视频生成']);

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (error) {
    return value || '';
  }
}

function resultMediaIds(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .flatMap((item) => collectItemMediaFileIds(item, { includeRelated: false })))];
}

Page({
  data: {
    query: '',
    currentQuery: '',
    suggestions: SUGGESTIONS,
    history: [],
    searched: false,
    loading: false,
    loadingMore: false,
    error: '',
    indexPreparing: false,
    membershipRequired: false,
    items: [],
    resultCount: 0,
    hasMore: false,
    searchFocus: true
  },

  onLoad(options = {}) {
    this.pageDisposed = false;
    this.requestId = 0;
    this.nextCursor = '';
    this.mediaRequestId = 0;
    this.mediaRecovery = createPageMediaRecovery(this);
    const query = safeDecode(options.query).trim();
    this.setData({
      query,
      history: loadSearchHistory(),
      searchFocus: !query
    });
    if (query) this.submitSearch();
  },

  onShow() {
    if (this.mediaRecovery) this.mediaRecovery.resume();
  },

  onHide() {
    if (this.mediaRecovery) this.mediaRecovery.pause();
  },

  onUnload() {
    this.pageDisposed = true;
    this.requestId = (this.requestId || 0) + 1;
    this.mediaRequestId = (this.mediaRequestId || 0) + 1;
    if (this.mediaRecovery) this.mediaRecovery.dispose();
  },

  onPullDownRefresh() {
    return finishPullDownRefresh(() => (
      this.data.searched ? this.loadResults(true, { preserveCurrent: true }) : false
    ));
  },

  onReachBottom() {
    this.loadMore();
  },

  onQueryInput(event) {
    this.setData({ query: event.detail.value || '' });
  },

  clearQuery() {
    this.nextCursor = '';
    if (this.mediaRecovery) this.mediaRecovery.reset();
    this.setData({
      query: '',
      currentQuery: '',
      searched: false,
      loading: false,
      loadingMore: false,
      error: '',
      indexPreparing: false,
      membershipRequired: false,
      items: [],
      resultCount: 0,
      hasMore: false,
      searchFocus: true
    });
  },

  useSuggestion(event) {
    const query = event.currentTarget.dataset.query || '';
    this.setData({ query, searchFocus: false }, () => this.submitSearch());
  },

  useHistory(event) {
    const query = event.currentTarget.dataset.query || '';
    this.setData({ query, searchFocus: false }, () => this.submitSearch());
  },

  clearHistory() {
    this.setData({ history: clearSearchHistory() });
  },

  submitSearch() {
    const query = String(this.data.query || '').trim();
    const error = searchQueryError(query);
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return Promise.resolve(false);
    }
    this.setData({
      query,
      currentQuery: query,
      history: recordSearchHistory(query, this.data.history),
      searchFocus: false
    });
    return this.loadResults(true);
  },

  async loadResults(reset, { preserveCurrent = false } = {}) {
    if (this.pageDisposed || (!reset && (!this.data.hasMore || this.data.loadingMore))) return false;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    const currentItems = preserveCurrent ? this.data.items : [];
    if (reset) {
      this.nextCursor = '';
      this.setData(currentItems.length ? {
        error: '',
        indexPreparing: false,
        membershipRequired: false,
        loadingMore: false
      } : {
        searched: true,
        loading: true,
        loadingMore: false,
        error: '',
        indexPreparing: false,
        membershipRequired: false,
        items: [],
        resultCount: 0,
        hasMore: false
      });
    } else {
      this.setData({
        loadingMore: true,
        error: '',
        indexPreparing: false,
        membershipRequired: false
      });
    }
    try {
      const page = await searchKnowledgeFeed({
        query: this.data.currentQuery,
        scope: 'all',
        cursor: reset ? '' : this.nextCursor,
        limit: PAGE_SIZE
      });
      if (this.pageDisposed || requestId !== this.requestId) return false;
      const items = mergeSearchItems(
        reset ? [] : this.data.items,
        page.items || [],
        this.data.currentQuery
      );
      this.nextCursor = page.nextCursor || '';
      const mediaRequestId = (this.mediaRequestId || 0) + 1;
      this.mediaRequestId = mediaRequestId;
      if (this.mediaRecovery) this.mediaRecovery.reset();
      this.setData({
        searched: true,
        loading: false,
        loadingMore: false,
        error: '',
        indexPreparing: false,
        membershipRequired: false,
        items,
        resultCount: reset ? (Number(page.resultCount) || 0) : this.data.resultCount,
        hasMore: page.hasMore === true
      });
      this.resolveResultMedia(items, mediaRequestId);
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.requestId) return false;
      const failure = searchFailureState(error);
      this.setData({
        searched: true,
        loading: false,
        loadingMore: false,
        error: failure.message,
        indexPreparing: failure.indexPreparing,
        membershipRequired: failure.membershipRequired
      });
      return false;
    }
  },

  async resolveResultMedia(items, requestId) {
    const fileIds = resultMediaIds(items);
    const resolvedUrls = await knowledgeMediaSession.resolveFileIds(fileIds);
    if (this.pageDisposed || requestId !== this.mediaRequestId) return false;
    const hydrated = this.data.items.map((item) => (
      applyResolvedItemMedia(item, resolvedUrls, { includeRelated: false })
    ));
    this.setData({ items: hydrated });
    if (this.mediaRecovery) {
      this.mediaRecovery.track(fileIds, (freshUrls) => {
        if (this.pageDisposed || requestId !== this.mediaRequestId) return;
        this.setData({
          items: this.data.items.map((item) => (
            applyResolvedItemMedia(item, freshUrls, { includeRelated: false })
          ))
        });
      });
    }
    return true;
  },

  handleMediaError(event) {
    if (this.mediaRecovery) this.mediaRecovery.handleError(event);
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.loadResults(false);
  },

  openItem(event) {
    const id = event.currentTarget.dataset.id;
    const kind = event.currentTarget.dataset.kind;
    if (!id) return;
    if (kind === 'column') {
      const type = event.currentTarget.dataset.entryType === 'practical'
        ? 'practical'
        : 'lesson';
      wx.navigateTo({
        url: `/pages/column-reader/index?type=${type}&id=${encodeURIComponent(id)}`
      });
      return;
    }
    if (kind === 'briefing') {
      const windowKey = event.currentTarget.dataset.windowKey || '24h';
      const app = getApp();
      rememberBriefingWindow(app, windowKey);
      wx.switchTab({
        url: '/pages/briefing/index',
        fail: () => clearBriefingWindow(app)
      });
      return;
    }
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  },

  retry() {
    this.loadResults(true, { preserveCurrent: this.data.items.length > 0 });
  },

  handleStateAction() {
    if (this.data.membershipRequired) {
      wx.navigateTo({ url: '/pages/membership/index' });
      return;
    }
    this.retry();
  },

  onShareAppMessage() {
    const query = this.data.currentQuery || this.data.query || '';
    return {
      title: query ? `知识搜索：${query}` : 'AI 知识搜索',
      path: `/pages/search/index?query=${encodeURIComponent(query)}`
    };
  },

  onShareTimeline() {
    const query = this.data.currentQuery || this.data.query || '';
    return {
      title: query ? `知识搜索：${query}` : 'AI 知识搜索',
      query: `query=${encodeURIComponent(query)}`
    };
  }
});
