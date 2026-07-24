const { loadKnowledgeItem } = require('../../features/knowledge-feed/item-session.js');
const {
  cachedMembershipAccess,
  membershipCacheScope
} = require('../../features/membership/session.js');
const { getDigestReference } = require('../../features/briefing/api.js');
const {
  decorateKnowledgeItem,
  previewSlides
} = require('../../features/knowledge-feed/detail-model.js');
const {
  toggleLike
} = require('../../features/engagement/api.js');
const { updateFavorite } = require('../../features/engagement/favorites-session.js');
const { decorateEngagement } = require('../../features/engagement/model.js');
const {
  rememberEngagement,
  engagementPatch
} = require('../../features/engagement/session.js');
const { createLatestTargetSync } = require('../../features/engagement/latest-target-sync.js');
const {
  collectItemMediaFileIds,
  createResolvedItemMediaPatch,
  knowledgeMediaSession,
  mediaUrl,
  preserveResolvedItemMedia
} = require('../../features/knowledge-feed/cloud-media-session.js');
const {
  createPageMediaRecovery
} = require('../../features/knowledge-feed/cloud-media-recovery.js');

const SOURCE_URL_EXPAND_THRESHOLD = 42;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_DETAIL_ERROR_CODES = new Set([
  'TEMPORARY_FAILURE',
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
  'TIMEOUT',
  'CLOUD_FUNCTION_TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'SYSTEM_ERROR'
]);

function canKeepCachedDetail(error) {
  return Boolean(error && TRANSIENT_DETAIL_ERROR_CODES.has(error.code));
}

function itemWithinCurrentEntitlement(item, access, now = Date.now()) {
  if (!item || !access || !access.entitlements) return false;
  const sourceChannels = Array.isArray(item.sourceChannelKeys) ? item.sourceChannelKeys : [];
  if (item.sourceChannelKey === 'openSource' || sourceChannels.includes('openSource')) return true;
  const history = access.entitlements.history || {};
  if (history.mode === 'all') return true;
  const days = Number(history.days);
  const publishedAt = new Date(item.publishedAt || '').getTime();
  return Number.isFinite(days) && days > 0
    && Number.isFinite(publishedAt)
    && publishedAt >= Number(now) - (days * DAY_MS);
}

Page({
  data: {
    loading: true,
    error: '',
    entitlementRequired: false,
    item: null,
    previewIndex: 0,
    previewAutoplay: true,
    sourceUrlCanExpand: false,
    sourceUrlExpanded: false,
    commentsOpen: false,
    membershipPromptVisible: false,
    membershipPromptFeature: 'comments'
  },

  onLoad(options) {
    this.itemId = options.id || '';
    this.digestId = options.digestId || '';
    this.openCommentsAfterLoad = options.comments === '1';
    this.pageDisposed = false;
    this.detailLoadRequestId = 0;
    this.skipNextDetailRevalidation = true;
    this.detailMediaRequestId = 0;
    this.mediaRecovery = createPageMediaRecovery(this);
    this.loadItem();
  },

  onUnload() {
    this.pageDisposed = true;
    this.detailLoadRequestId = (this.detailLoadRequestId || 0) + 1;
    this.detailMediaRequestId = (this.detailMediaRequestId || 0) + 1;
    if (this.mediaRecovery) this.mediaRecovery.dispose();
    if (this.engagementSync) this.engagementSync.dispose();
  },

  onShow() {
    if (this.mediaRecovery) this.mediaRecovery.resume();
    if (this.skipNextDetailRevalidation) {
      this.skipNextDetailRevalidation = false;
      return;
    }
    return this.loadItem({ preserveCurrent: true });
  },

  onHide() {
    if (this.mediaRecovery) this.mediaRecovery.pause();
  },

  async loadItem({ preserveCurrent = false } = {}) {
    const requestId = (this.detailLoadRequestId || 0) + 1;
    this.detailLoadRequestId = requestId;
    const feed = getApp().globalData.knowledgeFeed;
    const feedItems = (feed && feed.items) || [];
    const currentItem = preserveCurrent ? this.data.item : null;
    if (!preserveCurrent) {
      this.setData({
        item: null,
        loading: true,
        error: '',
        entitlementRequired: false
      });
    }
    try {
      const response = this.digestId
        ? await getDigestReference(this.digestId, this.itemId)
        : await loadKnowledgeItem(this.itemId);
      if (this.pageDisposed || requestId !== this.detailLoadRequestId) return false;
      const item = response && response.item ? response.item : response;
      this.showItem(item, feedItems, { preserveCurrent });
      this.authorizedDetailScope = membershipCacheScope();
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.detailLoadRequestId) return false;
      const currentScope = membershipCacheScope();
      if (currentItem && canKeepCachedDetail(error)
        && this.authorizedDetailScope && this.authorizedDetailScope === currentScope
        && itemWithinCurrentEntitlement(currentItem, cachedMembershipAccess())) {
        this.setData({ loading: false });
        return false;
      }
      this.authorizedDetailScope = '';
      this.detailMediaRequestId = (this.detailMediaRequestId || 0) + 1;
      if (this.mediaRecovery) this.mediaRecovery.reset();
      this.setData({
        item: null,
        error: (error && error.message) || '资讯详情暂时无法加载',
        entitlementRequired: Boolean(error && error.code === 'ENTITLEMENT_REQUIRED'),
        loading: false
      });
      return false;
    }
  },

  showItem(item, feedItems = [], { preserveCurrent = false } = {}) {
    const decoratedItem = decorateKnowledgeItem(item, feedItems);
    const remembered = decoratedItem.id && engagementPatch(decoratedItem.id);
    const hydratedItem = remembered
      ? { ...decoratedItem, engagement: decorateEngagement(remembered) }
      : decoratedItem;
    const currentItem = preserveCurrent && this.data.item
      && this.data.item.id === hydratedItem.id
      ? this.data.item
      : null;
    const stableItem = currentItem
      ? preserveResolvedItemMedia(hydratedItem, currentItem)
      : hydratedItem;
    const sourceUrl = typeof stableItem.url === 'string' ? stableItem.url : '';
    if (!currentItem) this.previewAutoplaySteps = 0;
    const mediaRequestId = (this.detailMediaRequestId || 0) + 1;
    this.detailMediaRequestId = mediaRequestId;
    if (this.mediaRecovery) this.mediaRecovery.reset();
    this.setData({
      item: stableItem,
      error: '',
      entitlementRequired: false,
      loading: false,
      previewIndex: currentItem ? this.data.previewIndex : 0,
      previewAutoplay: currentItem ? this.data.previewAutoplay : true,
      sourceUrlCanExpand: sourceUrl.length > SOURCE_URL_EXPAND_THRESHOLD,
      sourceUrlExpanded: Boolean(currentItem
        && currentItem.url === stableItem.url
        && this.data.sourceUrlExpanded)
    }, () => {
      if (this.openCommentsAfterLoad) {
        this.openCommentsAfterLoad = false;
        this.openComments();
      }
    });
    this.resolveVisibleItemMedia(stableItem, mediaRequestId);
  },

  async resolveVisibleItemMedia(item, requestId) {
    const resolvedUrls = await knowledgeMediaSession.resolveForItem(item);
    if (requestId !== this.detailMediaRequestId) return false;
    const currentItem = this.data && this.data.item;
    if (!currentItem || currentItem.id !== item.id) return false;
    const patch = createResolvedItemMediaPatch(currentItem, resolvedUrls, 'item');
    if (Object.keys(patch).length) this.setData(patch);
    if (this.mediaRecovery) {
      this.mediaRecovery.track(collectItemMediaFileIds(this.data.item), (freshUrls) => {
        if (requestId !== this.detailMediaRequestId || !this.data.item
          || this.data.item.id !== item.id) return;
        const freshPatch = createResolvedItemMediaPatch(this.data.item, freshUrls, 'item');
        if (Object.keys(freshPatch).length) this.setData(freshPatch);
      });
    }
    return true;
  },

  handleMediaError(event) {
    if (this.mediaRecovery) this.mediaRecovery.handleError(event);
  },

  toggleSourceUrl() {
    if (!this.data.sourceUrlCanExpand) return;
    this.setData({ sourceUrlExpanded: !this.data.sourceUrlExpanded });
  },

  noop() {},

  applyEngagementResult(result) {
    if (!result || !result.engagement || !this.data.item) return;
    const engagement = decorateEngagement(result.engagement);
    rememberEngagement(this.data.item.id, engagement);
    this.setData({ 'item.engagement': engagement });
  },

  engagementSyncFor(item) {
    if (this.engagementSync && this.engagementSyncItemId === item.id) return this.engagementSync;
    if (this.engagementSync) this.engagementSync.dispose();
    this.engagementSyncItemId = item.id;
    this.engagementSync = createLatestTargetSync({
      read: () => this.data.item && this.data.item.engagement,
      apply: (engagement) => this.applyEngagementResult({ itemId: item.id, engagement }),
      request: (field, target) => (field === 'liked'
        ? toggleLike(item.id, target)
        : updateFavorite(item.id, target)),
      onError: (error, field) => wx.showToast({
        title: (error && error.message) || (field === 'liked' ? '喜欢失败，请重试' : '收藏失败，请重试'),
        icon: 'none'
      })
    });
    return this.engagementSync;
  },

  handleLike() {
    const item = this.data.item;
    if (!item) return;
    this.engagementSyncFor(item).toggleLike();
  },

  handleFavorite() {
    const item = this.data.item;
    if (!item) return;
    this.engagementSyncFor(item).toggleFavorite();
  },

  openComments() {
    const engagement = this.data.item && this.data.item.engagement;
    if (!engagement) return;
    this.setData({ commentsOpen: true });
  },

  closeComments() {
    this.setData({ commentsOpen: false });
  },

  onCommentPublished(event) {
    const item = this.data.item;
    if (!item) return;
    const engagement = decorateEngagement({
      ...item.engagement,
      commentCount: event.detail && event.detail.commentCount
    });
    rememberEngagement(item.id, engagement);
    this.setData({ 'item.engagement': engagement });
  },

  handleCommentsLocked() {
    this.setData({ commentsOpen: false });
    this.openMembershipPrompt('comments');
  },

  openMembershipPrompt(featureKey) {
    this.setData({
      membershipPromptVisible: true,
      membershipPromptFeature: featureKey || 'comments'
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

  openOriginal() {
    const item = this.data.item;
    if (!item) return;
    if (!item.originAction.canOpen) {
      this.copyOriginal();
      return;
    }
    wx.navigateTo({
      url: `/pages/source-view/index?url=${encodeURIComponent(item.url)}`
    });
  },

  copyOriginal() {
    if (!this.data.item) return;
    wx.setClipboardData({
      data: this.data.item.url,
      success: () => wx.showToast({ title: '已复制，可在浏览器打开', icon: 'none' })
    });
  },

  onPreviewChange(event) {
    const index = Number(event && event.detail && event.detail.current);
    if (!Number.isInteger(index) || index < 0) return;
    const slides = previewSlides(this.data.item && this.data.item.previewFileIds, index);
    const patch = { previewIndex: index };
    if (event && event.detail && event.detail.source === 'autoplay') {
      this.previewAutoplaySteps = Math.max(0, Number(this.previewAutoplaySteps) || 0) + 1;
      if (this.previewAutoplaySteps >= slides.length) patch.previewAutoplay = false;
    }
    slides.forEach((slide, slideIndex) => {
      const current = this.data.item && this.data.item.previewSlides
        && this.data.item.previewSlides[slideIndex];
      if (!current || current.shouldLoad !== slide.shouldLoad) {
        patch[`item.previewSlides[${slideIndex}].shouldLoad`] = slide.shouldLoad;
      }
    });
    this.setData(patch);
  },

  async previewSourceScreenshots(event) {
    const item = this.data.item;
    const fileIds = item && item.previewFileIds;
    if (!Array.isArray(fileIds) || !fileIds.length) return;
    const index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= fileIds.length) return;
    const mediaRequestId = this.detailMediaRequestId;
    try {
      const resolvedUrls = await knowledgeMediaSession.resolveFileIds(fileIds);
      if (mediaRequestId !== this.detailMediaRequestId
        || !this.data.item || this.data.item.id !== item.id) return;
      const resolved = fileIds
        .map((fileId, originalIndex) => ({
          originalIndex,
          url: mediaUrl(fileId, resolvedUrls)
        }))
        .filter((entry) => entry.url);
      const urls = resolved.map((entry) => entry.url);
      const current = (resolved.find((entry) => entry.originalIndex === index) || resolved[0] || {}).url;
      if (!current || !urls.length) throw new Error('PREVIEW_UNAVAILABLE');
      wx.previewImage({ current, urls });
    } catch (error) {
      wx.showToast({ title: '原文预览暂时无法打开', icon: 'none' });
    }
  },

  openRelated(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.redirectTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  },

  openMembership() {
    this.openMembershipPrompt('history_30d');
  },

  onShareAppMessage() {
    const item = this.data.item;
    const share = {
      title: item ? item.title : 'AI 资讯',
      path: `/pages/feed-detail/index?id=${encodeURIComponent(this.itemId)}`
    };
    if (item && item.listVisualUrl) share.imageUrl = item.listVisualUrl;
    return share;
  },

  onShareTimeline() {
    const item = this.data.item;
    const share = {
      title: item ? item.title : 'AI 资讯',
      query: `id=${encodeURIComponent(this.itemId)}`
    };
    if (item && item.listVisualUrl) share.imageUrl = item.listVisualUrl;
    return share;
  }
});
