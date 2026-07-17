const { getKnowledgeItem } = require('../../features/knowledge-feed/api.js');
const { getDigestReference } = require('../../features/briefing/api.js');
const {
  decorateKnowledgeItem,
  previewSlides
} = require('../../features/knowledge-feed/detail-model.js');

const SOURCE_URL_EXPAND_THRESHOLD = 42;

Page({
  data: {
    loading: true,
    error: '',
    entitlementRequired: false,
    item: null,
    previewIndex: 0,
    previewAutoplay: true,
    sourceUrlCanExpand: false,
    sourceUrlExpanded: false
  },

  onLoad(options) {
    this.itemId = options.id || '';
    this.digestId = options.digestId || '';
    this.loadItem();
  },

  async loadItem() {
    const feed = getApp().globalData.knowledgeFeed;
    const feedItems = (feed && feed.items) || [];
    const cached = feedItems.find((item) => item.id === this.itemId);
    if (cached) this.showItem(cached, feedItems);
    try {
      const response = this.digestId
        ? await getDigestReference(this.digestId, this.itemId)
        : await getKnowledgeItem(this.itemId);
      const item = response && response.item ? response.item : response;
      this.showItem(item, feedItems);
    } catch (error) {
      if (!cached) {
        this.setData({
          error: error.message,
          entitlementRequired: error.code === 'ENTITLEMENT_REQUIRED',
          loading: false
        });
      }
    }
  },

  showItem(item, feedItems = []) {
    const decoratedItem = decorateKnowledgeItem(item, feedItems);
    const sourceUrl = typeof decoratedItem.url === 'string' ? decoratedItem.url : '';
    this.previewAutoplaySteps = 0;
    this.setData({
      item: decoratedItem,
      loading: false,
      previewIndex: 0,
      previewAutoplay: true,
      sourceUrlCanExpand: sourceUrl.length > SOURCE_URL_EXPAND_THRESHOLD,
      sourceUrlExpanded: false
    });
  },

  toggleSourceUrl() {
    if (!this.data.sourceUrlCanExpand) return;
    this.setData({ sourceUrlExpanded: !this.data.sourceUrlExpanded });
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
    try {
      const cacheKey = fileIds.join('|');
      let resolved = this.previewTempCache && this.previewTempCache.key === cacheKey
        ? this.previewTempCache.items
        : null;
      if (!resolved) {
        const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
        resolved = ((result && result.fileList) || [])
          .map((entry, originalIndex) => ({
            originalIndex,
            url: entry && entry.tempFileURL
          }))
          .filter((entry) => typeof entry.url === 'string' && entry.url);
        this.previewTempCache = { key: cacheKey, items: resolved };
      }
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
    wx.switchTab({ url: '/pages/profile/index' });
  },

  onShareAppMessage() {
    const item = this.data.item;
    return {
      title: item ? item.title : '知识更新',
      path: `/pages/feed-detail/index?id=${encodeURIComponent(this.itemId)}`
    };
  }
});
