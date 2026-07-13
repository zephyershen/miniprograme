const { getDashboard, ingestLink } = require('../../utils/api');
const { LIMITS } = require('../../config/constants');
const { formatDate, relevanceMeta } = require('../../utils/format');

function decorateDashboard(dashboard) {
  const queue = (dashboard.queue || []).map((item) => {
    const meta = relevanceMeta(item.relevanceLevel);
    return {
      ...item,
      createdLabel: formatDate(item.createdAt),
      relevanceLabel: meta.label,
      relevanceTone: meta.tone
    };
  });

  return {
    ...dashboard,
    queue,
    pendingCount: queue.length,
    cardCount: (dashboard.cards || []).length,
    preferencesMissing: !(dashboard.preferences && dashboard.preferences.topics && dashboard.preferences.topics.length)
  };
}

Page({
  data: {
    loading: true,
    ingesting: false,
    showAdd: false,
    url: '',
    queueLimit: LIMITS.queue,
    dashboard: {
      queue: [],
      cards: [],
      pendingCount: 0,
      cardCount: 0,
      preferencesMissing: true
    }
  },

  onShow() {
    this.loadDashboard();
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => wx.stopPullDownRefresh());
  },

  async loadDashboard() {
    this.setData({ loading: true });
    try {
      const dashboard = decorateDashboard(await getDashboard());
      getApp().globalData.dashboard = dashboard;
      this.setData({ dashboard });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  openAdd() {
    const { dashboard } = this.data;
    if (dashboard.preferencesMissing) {
      wx.showToast({ title: '先选择最多 3 个关注方向', icon: 'none' });
      this.openSettings();
      return;
    }
    if (dashboard.pendingCount >= LIMITS.queue) {
      wx.showToast({ title: '先处理一条内容，再添加新的', icon: 'none' });
      return;
    }
    this.setData({ showAdd: true, url: '' });
  },

  closeAdd() {
    if (!this.data.ingesting) this.setData({ showAdd: false, url: '' });
  },

  stopPropagation() {},

  onUrlInput(event) {
    this.setData({ url: event.detail.value });
  },

  async pasteFromClipboard() {
    try {
      const result = await wx.getClipboardData();
      this.setData({ url: (result.data || '').trim() });
    } catch (error) {
      wx.showToast({ title: '没有读取到剪贴板内容', icon: 'none' });
    }
  },

  async submitLink() {
    const url = this.data.url.trim();
    if (!url) {
      wx.showToast({ title: '请粘贴文章链接', icon: 'none' });
      return;
    }

    this.setData({ ingesting: true });
    wx.showLoading({ title: '正在消化', mask: true });
    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await ingestLink(url, requestId);
      this.setData({ showAdd: false, url: '' });
      wx.navigateTo({ url: `/pages/digest/index?id=${encodeURIComponent(result.item._id)}` });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 2600 });
    } finally {
      wx.hideLoading();
      this.setData({ ingesting: false });
    }
  },

  openItem(event) {
    wx.navigateTo({ url: `/pages/digest/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  }
});
