const { getKnowledgeItem } = require('../../utils/api');

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function decorate(item) {
  return {
    ...item,
    publishedLabel: formatDate(item.publishedAt),
    scoreLabel: Number.isFinite(Number(item.score)) ? `热度 ${item.score}` : '编辑精选'
  };
}

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
    const cached = feed && (feed.items || []).find((item) => item.id === this.itemId);
    if (cached) {
      this.setData({ item: decorate(cached), loading: false });
      return;
    }
    try {
      const item = await getKnowledgeItem(this.itemId);
      this.setData({ item: decorate(item), loading: false });
    } catch (error) {
      this.setData({ error: error.message, loading: false });
    }
  },

  copyOriginal() {
    if (!this.data.item) return;
    wx.setClipboardData({
      data: this.data.item.url,
      success: () => wx.showToast({ title: '原文链接已复制', icon: 'success' })
    });
  },

  onShareAppMessage() {
    const item = this.data.item;
    return {
      title: item ? item.title : '知识更新',
      path: `/pages/feed-detail/index?id=${encodeURIComponent(this.itemId)}`
    };
  }
});
