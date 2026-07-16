const { getKnowledgeItem } = require('../../features/knowledge-feed/api.js');
const { decorateKnowledgeItem } = require('../../features/knowledge-feed/detail-model.js');

Page({
  data: {
    loading: true,
    error: '',
    item: null
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
      this.setData({ item: decorateKnowledgeItem(cached, feedItems), loading: false });
      return;
    }
    try {
      const item = await getKnowledgeItem(this.itemId);
      this.setData({ item: decorateKnowledgeItem(item), loading: false });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
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
