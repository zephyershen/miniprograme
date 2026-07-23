const {
  PAGE_SIZE,
  copyFilters,
  defaultFiltersForFeed,
  reconcileFeedFilters,
  requestFilters,
  createSortState,
  createNewItemsNotice,
  isSortKey,
  usesFlatFeedLayout,
  decorateFilterOptions,
  countFacetResults,
  createFilterDraftState,
  mergeUniqueItems,
  mergeFeedPage,
  createFeedAppendPatch,
  decorateFeed,
  applyTimelineCollapse,
  applyTimelineDayStates,
  timelineParts,
  createInitialListState
} = require('../../features/knowledge-feed/list-model.js');
const {
  getKnowledgeFeed,
  getKnowledgeFeedDay,
  getKnowledgeFeedUpdates
} = require('../../features/knowledge-feed/api.js');
const {
  refreshMembershipAccess,
  membershipRevision
} = require('../../features/membership/session.js');
const { toggleLike } = require('../../features/engagement/api.js');
const { updateFavorite } = require('../../features/engagement/favorites-session.js');
const { decorateEngagement } = require('../../features/engagement/model.js');
const {
  rememberEngagement,
  engagementPatch,
  applyRememberedEngagement
} = require('../../features/engagement/session.js');
const { createLatestTargetSync } = require('../../features/engagement/latest-target-sync.js');
const {
  createUpdatePollState,
  updatePollDelay,
  recordUpdatePollSuccess,
  recordUpdatePollFailure
} = require('../../features/knowledge-feed/update-polling.js');
const {
  applyResolvedFeedMedia,
  collectFeedMediaFileIds,
  knowledgeMediaSession
} = require('../../features/knowledge-feed/cloud-media-session.js');
const {
  createPageMediaRecovery
} = require('../../features/knowledge-feed/cloud-media-recovery.js');

function feedLayoutState(sortMode, activeChannel) {
  return {
    libraryMode: activeChannel === 'openSource',
    flatFeedMode: usesFlatFeedLayout(sortMode, activeChannel)
  };
}

function createTimelineRequestScope(page) {
  return {
    generation: page.feedRequestId || 0,
    channel: page.data.activeChannel,
    sort: page.data.sortMode,
    filters: JSON.stringify(copyFilters(page.data.filters))
  };
}

function isCurrentTimelineRequest(page, scope, token, dateKey) {
  const current = createTimelineRequestScope(page);
  const state = page.timelineDayStates && page.timelineDayStates[dateKey];
  return current.generation === scope.generation
    && current.channel === scope.channel
    && current.sort === scope.sort
    && current.filters === scope.filters
    && state && state.requestToken === token;
}

function settleTimelineDayStates(states = {}) {
  return Object.keys(states).reduce((result, dateKey) => {
    result[dateKey] = { ...states[dateKey], loading: false };
    return result;
  }, {});
}

Page({
  data: {
    ...createInitialListState(),
    membershipPromptVisible: false,
    membershipPromptFeature: 'curated_feed'
  },

  onLoad() {
    this.pageDisposed = false;
    this.feedPageVisible = false;
    this.skipNextMembershipRefresh = true;
    this.seenMembershipRevision = membershipRevision();
    this.feedPollState = createUpdatePollState();
    this.collapsedTimelineDays = new Set();
    this.timelineDayStates = {};
    this.engagementSyncs = new Map();
    this.feedMediaRequestId = 0;
    this.mediaRecovery = createPageMediaRecovery(this);
    this.loadFeed(false);
  },

  onShow() {
    this.feedPageVisible = true;
    if (this.mediaRecovery) this.mediaRecovery.resume();
    this.syncRememberedEngagement();
    if (this.skipNextMembershipRefresh) {
      this.skipNextMembershipRefresh = false;
      this.scheduleFeedUpdateCheck();
      return;
    }
    this.refreshMembershipAndFeed();
  },

  onHide() {
    this.feedPageVisible = false;
    if (this.mediaRecovery) this.mediaRecovery.pause();
    this.stopFeedUpdateChecks();
  },

  onUnload() {
    this.pageDisposed = true;
    this.feedPageVisible = false;
    this.feedRequestId = (this.feedRequestId || 0) + 1;
    this.timelineDayRequestToken = (this.timelineDayRequestToken || 0) + 1;
    this.feedMediaRequestId = (this.feedMediaRequestId || 0) + 1;
    if (this.mediaRecovery) this.mediaRecovery.dispose();
    this.stopFeedUpdateChecks();
    this.disposeEngagementSyncs();
  },

  async refreshMembershipAndFeed() {
    if (this.pageDisposed) return false;
    const pendingAccess = refreshMembershipAccess({ force: true });
    const localRevision = membershipRevision();
    if (localRevision !== this.seenMembershipRevision) {
      this.seenMembershipRevision = localRevision;
      this.feedAccessResolved = false;
      this.historyBoundarySeen = false;
      this.loadFeed(false);
    }
    try {
      await pendingAccess;
      if (this.pageDisposed) return false;
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
      if (this.pageDisposed) return false;
      console.warn('资讯权限暂时未刷新', error && error.code ? error.code : error);
      this.scheduleFeedUpdateCheck();
    }
  },

  onReachBottom() {
    if (!this.data.flatFeedMode) return;
    this.loadMoreFeed();
  },

  onPullDownRefresh() {
    this.loadFeed(true, { preserveCurrent: true }).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeed(force, options = {}) {
    if (this.pageDisposed) return false;
    const preserveCurrent = options.preserveCurrent === true;
    const channelTransition = options.channelTransition === true;
    const requestId = (this.feedRequestId || 0) + 1;
    this.feedRequestId = requestId;
    const previousRawFeed = this.rawFeed;
    const previousLoadedItems = this.loadedItems || [];
    const activeChannel = this.data.activeChannel;
    const sort = this.data.sortMode;
    const filters = copyFilters(this.data.filters);
    const accessResolved = this.feedAccessResolved === true;
    const requestedFilters = requestFilters(filters, accessResolved, activeChannel);
    if (preserveCurrent) {
      this.timelineDayStates = settleTimelineDayStates(this.timelineDayStates);
    } else {
      this.loadedItems = [];
      this.timelineDayStates = {};
    }
    this.setData(preserveCurrent
      ? {
        applyingNewItems: true,
        loadMoreError: '',
        feed: applyTimelineDayStates(this.data.feed, this.timelineDayStates)
      }
      : {
        loading: !channelTransition,
        channelTransitionLoading: channelTransition,
        loadingMore: false,
        loadMoreError: '',
        feedError: ''
      });
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
      this.timelineDayStates = {};
      this.collapsedTimelineDays = new Set(
        (rawFeed.dayBuckets || []).slice(1).map((bucket) => bucket.dateKey)
      );
      this.pruneEngagementSyncs();
      this.feedHeadCursor = rawFeed.headCursor || '';
      this.feedPollState = createUpdatePollState();
      this.present('', reconcileFeedFilters(rawFeed, filters, !accessResolved, activeChannel));
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
      this.feedPollState = recordUpdatePollFailure(this.feedPollState);
      this.scheduleFeedUpdateCheck();
      return false;
    } finally {
      if (requestId === this.feedRequestId) {
        this.setData(preserveCurrent
          ? { applyingNewItems: false }
          : { loading: false, channelTransitionLoading: false });
      }
    }
  },

  scheduleFeedUpdateCheck(delay = updatePollDelay(this.feedPollState)) {
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
    try {
      const result = await getKnowledgeFeedUpdates({
        headCursor: anchor,
        channel: this.data.activeChannel,
        filters: requestFilters(copyFilters(this.data.filters), true, this.data.activeChannel)
      });
      if (!this.feedPageVisible || requestId !== this.feedRequestId || anchor !== this.feedHeadCursor) return;
      const newCount = result && result.newCount;
      this.feedPollState = recordUpdatePollSuccess(this.feedPollState, newCount);
      this.setData(createNewItemsNotice(newCount));
    } catch (error) {
      this.feedPollState = recordUpdatePollFailure(this.feedPollState);
      console.warn('新资讯检测暂时失败', error && error.code ? error.code : error);
    } finally {
      this.feedUpdateCheckActive = false;
    }
  },

  async applyNewItems() {
    if (this.data.applyingNewItems || !this.data.newItemsVisible) return;
    const refreshed = await this.loadFeed(false, { preserveCurrent: true });
    if (refreshed) wx.pageScrollTo({ scrollTop: 0, duration: 260 });
  },

  async loadMoreFeed() {
    if (this.pageDisposed) return false;
    if (!this.data.flatFeedMode || this.data.loading || this.data.loadingMore
      || this.data.filterOpen || !this.data.feed.hasMore) return;
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
        filters: requestFilters(filters, true, activeChannel)
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
    const filters = nextFilters
      || reconcileFeedFilters(this.rawFeed || {}, this.data.filters, false, activeChannel);
    const rememberedItems = applyRememberedEngagement(this.loadedItems || []);
    if (rememberedItems.changed) this.loadedItems = rememberedItems.items;
    if (this.rawFeed && Array.isArray(this.rawFeed.items)) {
      const rememberedRawItems = applyRememberedEngagement(this.rawFeed.items);
      if (rememberedRawItems.changed) {
        this.rawFeed = { ...this.rawFeed, items: rememberedRawItems.items };
      }
    }
    const feed = applyTimelineDayStates(applyTimelineCollapse(
      decorateFeed(
        this.rawFeed || { items: [], facets: [] },
        activeChannel,
        filters,
        this.loadedItems || []
      ),
      this.collapsedTimelineDays
    ), this.timelineDayStates);
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
    const commonPatch = {
      historyBoundaryVisible,
      ...feedLayoutState(this.data.sortMode, activeChannel)
    };
    const mediaRequestId = (this.feedMediaRequestId || 0) + 1;
    this.feedMediaRequestId = mediaRequestId;
    if (this.mediaRecovery) this.mediaRecovery.reset();
    this.setData(appendPatch ? { ...appendPatch, ...commonPatch } : {
      feed,
      filters,
      activeChannel,
      feedError,
      ...commonPatch
    });
    this.resolveVisibleFeedMedia(feed, mediaRequestId);
  },

  async resolveVisibleFeedMedia(feed, requestId) {
    const resolvedUrls = await knowledgeMediaSession.resolveForFeed(feed);
    if (requestId !== this.feedMediaRequestId) return false;
    const currentFeed = this.data && this.data.feed;
    if (!currentFeed) return false;
    this.setData({ feed: applyResolvedFeedMedia(currentFeed, resolvedUrls) });
    if (this.mediaRecovery) {
      this.mediaRecovery.track(collectFeedMediaFileIds(this.data.feed), (freshUrls) => {
        if (requestId !== this.feedMediaRequestId || !this.data.feed) return;
        this.setData({ feed: applyResolvedFeedMedia(this.data.feed, freshUrls) });
      });
    }
    return true;
  },

  handleMediaError(event) {
    if (this.mediaRecovery) this.mediaRecovery.handleError(event);
  },

  selectChannel(event) {
    const key = event.currentTarget.dataset.key;
    if (key === 'featured') {
      const canReadCurated = this.data.feed
        && this.data.feed.entitlements
        && this.data.feed.entitlements.curatedFeed === true;
      if (!canReadCurated) {
        this.openMembershipPrompt('curated_feed');
        return;
      }
      wx.navigateTo({ url: '/pages/featured/index' });
      return;
    }
    if (!key || key === this.data.activeChannel) return;
    this.setData({
      activeChannel: key,
      loading: false,
      channelTransitionLoading: true,
      ...createNewItemsNotice(),
      ...feedLayoutState(this.data.sortMode, key)
    }, () => this.loadFeed(false, { channelTransition: true }));
  },

  selectSort(event) {
    const sortMode = event.currentTarget.dataset.key;
    if (!isSortKey(sortMode) || sortMode === this.data.sortMode) return;
    this.setData({
      ...createSortState(sortMode),
      ...feedLayoutState(sortMode, this.data.activeChannel)
    }, () => this.loadFeed(false));
  },

  toggleTimelineDay(event) {
    const dateKey = event.currentTarget.dataset.dateKey;
    if (!dateKey || this.data.sortMode !== 'latest') return;
    if (!this.collapsedTimelineDays) this.collapsedTimelineDays = new Set();
    const expanding = this.collapsedTimelineDays.has(dateKey);
    if (expanding) this.collapsedTimelineDays.delete(dateKey);
    else this.collapsedTimelineDays.add(dateKey);
    this.setData({
      feed: applyTimelineCollapse(this.data.feed, this.collapsedTimelineDays)
    });
    const group = (this.data.feed.dayGroups || []).find((entry) => entry.dateKey === dateKey);
    const state = this.timelineDayStates[dateKey] || {};
    if (expanding && group && group.count > 0 && !group.items.length && !state.pageInitialized) {
      this.loadTimelineDay(dateKey);
    }
  },

  loadMoreTimelineDay(event) {
    const dateKey = event.currentTarget.dataset.dateKey;
    if (dateKey) this.loadTimelineDay(dateKey, { append: true });
  },

  async loadTimelineDay(dateKey, { append = false } = {}) {
    if (this.pageDisposed) return false;
    const previous = this.timelineDayStates[dateKey] || {};
    if (previous.loading || (append && previous.pageInitialized && previous.hasMore !== true)) return;
    const scope = createTimelineRequestScope(this);
    const token = (this.timelineDayRequestToken || 0) + 1;
    this.timelineDayRequestToken = token;
    const filters = copyFilters(this.data.filters);
    this.timelineDayStates = {
      ...this.timelineDayStates,
      [dateKey]: { ...previous, loading: true, error: '', requestToken: token }
    };
    this.present();
    try {
      const page = await getKnowledgeFeedDay({
        dateKey,
        cursor: append && previous.pageInitialized ? previous.nextCursor || '' : '',
        limit: 20,
        channel: scope.channel,
        filters: requestFilters(filters, true, scope.channel)
      });
      if (!isCurrentTimelineRequest(this, scope, token, dateKey)) return false;
      const currentDayItems = (this.loadedItems || []).filter((item) => (
        timelineParts(item.publishedAt).timelineDateKey === dateKey
      ));
      const dayItems = append && previous.pageInitialized
        ? mergeUniqueItems(currentDayItems, page.items || [])
        : (page.items || []);
      const otherItems = (this.loadedItems || []).filter((item) => (
        timelineParts(item.publishedAt).timelineDateKey !== dateKey
      ));
      this.loadedItems = otherItems.concat(dayItems).sort((left, right) => (
        new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
      ));
      this.timelineDayStates = {
        ...this.timelineDayStates,
        [dateKey]: {
          loading: false,
          error: '',
          pageInitialized: true,
          hasMore: page.hasMore === true,
          nextCursor: page.nextCursor || '',
          requestToken: token
        }
      };
    } catch (error) {
      if (!isCurrentTimelineRequest(this, scope, token, dateKey)) return false;
      this.timelineDayStates = {
        ...this.timelineDayStates,
        [dateKey]: {
          ...previous,
          loading: false,
          error: error.message || '这一天的资讯加载失败',
          requestToken: token
        }
      };
    }
    if (!isCurrentTimelineRequest(this, scope, token, dateKey)) return false;
    this.present();
    return true;
  },

  retryFeed() {
    this.loadFeed(true);
  },

  openFilters() {
    const draft = createFilterDraftState(this.rawFeed || { facets: [] }, this.data.activeChannel, this.data.filters);
    this.setData({ filterOpen: true, ...draft, filterScrollTarget: '' }, () => {
      this.setData({
        filterScrollTarget: this.data.libraryMode ? 'filter-source-tag-group' : 'filter-time-group'
      });
    });
  },

  closeFilters() {
    this.setData({ filterOpen: false, filterScrollTarget: '' });
  },

  stopPropagation() {},

  noop() {},

  selectFilter(event) {
    const group = event.currentTarget.dataset.group;
    const key = event.currentTarget.dataset.key;
    if (!['time', 'company', 'direction', 'sourceTag'].includes(group) || !key) return;
    const option = (this.data.filterOptions[group] || []).find((entry) => entry.key === key);
    if (!option || option.disabled) return;
    if (option.locked) {
      this.setData({ filterOpen: false, filterScrollTarget: '' }, () => (
        this.openMembershipPrompt(option.featureKey || 'history_30d')
      ));
      return;
    }
    const draftFilters = { ...this.data.draftFilters, [group]: key };
    const draftCount = countFacetResults(this.rawFeed || { facets: [] }, this.data.activeChannel, draftFilters);
    const filterOptions = decorateFilterOptions(
      this.rawFeed || { facets: [] },
      this.data.activeChannel,
      draftFilters,
      this.data.sourceTagQuery
    );
    this.setData({ draftFilters, draftCount, filterOptions });
  },

  onSourceTagSearch(event) {
    const sourceTagQuery = event && event.detail ? event.detail.value || '' : '';
    const filterOptions = decorateFilterOptions(
      this.rawFeed || { facets: [] },
      this.data.activeChannel,
      this.data.draftFilters,
      sourceTagQuery
    );
    this.setData({ sourceTagQuery, filterOptions });
  },

  resetFilters() {
    const filters = this.data.libraryMode
      ? { ...copyFilters(this.data.filters), sourceTag: 'all' }
      : { ...defaultFiltersForFeed(this.rawFeed || {}), sourceTag: this.data.filters.sourceTag };
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

  syncRememberedEngagement() {
    if (!this.loadedItems || !this.loadedItems.length) return;
    this.loadedItems.forEach((item) => {
      const remembered = item && engagementPatch(item.id);
      if (remembered) this.applyEngagementResult({ itemId: item.id, engagement: remembered });
    });
  },

  findFeedItem(id) {
    return (this.loadedItems || []).find((item) => item && item.id === id) || null;
  },

  applyEngagementResult(result) {
    if (!result || !result.itemId || !result.engagement) return;
    const index = (this.loadedItems || []).findIndex((item) => item && item.id === result.itemId);
    if (index < 0) return;
    const engagement = decorateEngagement(result.engagement);
    rememberEngagement(result.itemId, engagement);
    this.loadedItems[index] = { ...this.loadedItems[index], engagement };
    if (this.rawFeed && Array.isArray(this.rawFeed.items)) {
      const rawIndex = this.rawFeed.items.findIndex((item) => item && item.id === result.itemId);
      if (rawIndex >= 0) this.rawFeed.items[rawIndex] = { ...this.rawFeed.items[rawIndex], engagement };
    }
    if (this.data && this.data.sortMode === 'latest') {
      this.present();
      return;
    }
    const path = index === 0 ? 'feed.leadItem.engagement' : `feed.remainingItems[${index - 1}].engagement`;
    this.setData({ [path]: engagement });
  },

  engagementSyncFor(item) {
    if (!item || !item.id) return null;
    const current = this.engagementSyncs.get(item.id);
    if (current) return current;
    const sync = createLatestTargetSync({
      read: () => {
        const latest = this.findFeedItem(item.id);
        return latest && latest.engagement;
      },
      apply: (engagement) => this.applyEngagementResult({ itemId: item.id, engagement }),
      request: (field, target) => (field === 'liked'
        ? toggleLike(item.id, target)
        : updateFavorite(item.id, target)),
      onError: (error, field) => wx.showToast({
        title: (error && error.message) || (field === 'liked' ? '喜欢失败，请重试' : '收藏失败，请重试'),
        icon: 'none'
      })
    });
    this.engagementSyncs.set(item.id, sync);
    return sync;
  },

  handleLike(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.findFeedItem(id);
    if (!item) return;
    this.engagementSyncFor(item).toggleLike();
  },

  handleFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.findFeedItem(id);
    if (!item) return;
    this.engagementSyncFor(item).toggleFavorite();
  },

  pruneEngagementSyncs() {
    if (!this.engagementSyncs) return;
    const visibleIds = new Set((this.loadedItems || []).map((item) => item && item.id).filter(Boolean));
    this.engagementSyncs.forEach((sync, itemId) => {
      if (visibleIds.has(itemId)) return;
      sync.dispose();
      this.engagementSyncs.delete(itemId);
    });
  },

  disposeEngagementSyncs() {
    if (!this.engagementSyncs) return;
    this.engagementSyncs.forEach((sync) => sync.dispose());
    this.engagementSyncs.clear();
  },

  openComments(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.findFeedItem(id);
    if (!item) return;
    if (!item.engagement || !item.engagement.canComment) {
      this.openMembershipPrompt('comments');
      return;
    }
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}&comments=1` });
  },

  openMembershipPrompt(featureKey) {
    this.setData({
      membershipPromptVisible: true,
      membershipPromptFeature: featureKey || 'curated_feed'
    });
  },

  closeMembershipPrompt() {
    this.setData({ membershipPromptVisible: false });
  },

  openMembershipFromPrompt() {
    this.setData({ membershipPromptVisible: false }, () => {
      wx.switchTab({ url: '/pages/profile/index' });
    });
  },

  openMembership() {
    this.setData({ historyBoundaryVisible: false }, () => this.openMembershipPrompt('history_30d'));
  },

  onShareAppMessage(event) {
    const dataset = event && event.target && event.target.dataset || {};
    const item = this.findFeedItem(dataset.id) || this.loadedItems && this.loadedItems[0];
    const presentedItems = this.data && this.data.feed
      ? [this.data.feed.leadItem, ...(this.data.feed.remainingItems || [])].filter(Boolean)
      : [];
    const presented = presentedItems.find((entry) => entry.id === (item && item.id))
      || presentedItems[0];
    const share = {
      title: item ? item.title : '一条值得看的 AI 资讯',
      path: `/pages/feed-detail/index?id=${encodeURIComponent(item && item.id || '')}`
    };
    if (presented && presented.listVisualUrl) share.imageUrl = presented.listVisualUrl;
    return share;
  }
});
