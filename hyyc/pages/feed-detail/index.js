const { getKnowledgeItem } = require('../../utils/api');
const { DIRECT_WEBVIEW_HOSTS } = require('../../config/constants');
const { buildReadingGuide, buildRelatedItems, getOriginAction } = require('../../utils/editorial-detail');

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

function decorate(item, feedItems = []) {
  const related = item.relatedItems && item.relatedItems.length
    ? item.relatedItems
    : buildRelatedItems(feedItems, item);
  return {
    ...item,
    publishedLabel: formatDate(item.publishedAt),
    readingGuide: buildReadingGuide(item.summary),
    originAction: getOriginAction(item.url, DIRECT_WEBVIEW_HOSTS),
    relatedItems: related.map((entry) => ({
      ...entry,
      publishedLabel: formatDate(entry.publishedAt)
    }))
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
    const feedItems = (feed && feed.items) || [];
    const cached = feedItems.find((item) => item.id === this.itemId);
    if (cached) {
      this.setData({ item: decorate(cached, feedItems), loading: false });
      return;
    }
    try {
      const item = await getKnowledgeItem(this.itemId);
      this.setData({ item: decorate(item), loading: false });
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
