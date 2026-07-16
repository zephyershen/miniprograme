const { getKnowledgeItem } = require('../../features/knowledge-feed/api.js');
const { decorateKnowledgeItem } = require('../../features/knowledge-feed/detail-model.js');

const SOURCE_URL_EXPAND_THRESHOLD = 42;

Page({
  data: {
    loading: true,
    error: '',
    item: null,
    sourceUrlCanExpand: false,
    sourceUrlExpanded: false
  },

  onLoad(options) {
    this.itemId = options.id || '';
    this.loadItem();
  },

  async loadItem() {
    const feed = getApp().globalData.knowledgeFeed;
    const feedItems = (feed && feed.items) || [];
    const cached = feedItems.find((item) => item.id === this.itemId);
    if (cached) {
      this.showItem(cached, feedItems);
      return;
    }
    try {
      const item = await getKnowledgeItem(this.itemId);
      this.showItem(item);
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  showItem(item, feedItems = []) {
    const decoratedItem = decorateKnowledgeItem(item, feedItems);
    const sourceUrl = typeof decoratedItem.url === 'string' ? decoratedItem.url : '';
    this.setData({
      item: decoratedItem,
      loading: false,
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

  async previewSourceScreenshots() {
    const item = this.data.item;
    const fileIds = item && item.previewFileIds;
    if (!Array.isArray(fileIds) || !fileIds.length) return;
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
      const urls = (result.fileList || []).map((entry) => entry.tempFileURL).filter(Boolean);
      if (!urls.length) throw new Error('PREVIEW_UNAVAILABLE');
      wx.previewImage({ current: urls[0], urls });
    } catch (error) {
      wx.showToast({ title: '原文预览暂时无法打开', icon: 'none' });
    }
  },

  openRelated(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.redirectTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  },

  onShareAppMessage() {
    const item = this.data.item;
    return {
      title: item ? item.title : '知识更新',
      path: `/pages/feed-detail/index?id=${encodeURIComponent(this.itemId)}`
    };
  }
});
