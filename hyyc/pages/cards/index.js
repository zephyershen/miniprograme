const { getDashboard, storeAction } = require('../../utils/api');
const { LIMITS } = require('../../config/constants');
const { formatDate } = require('../../utils/format');

Page({
  data: {
    loading: true,
    cardLimit: LIMITS.cards,
    cards: []
  },

  onShow() {
    this.loadCards();
  },

  onPullDownRefresh() {
    this.loadCards().finally(() => wx.stopPullDownRefresh());
  },

  async loadCards() {
    this.setData({ loading: true });
    try {
      const dashboard = await getDashboard();
      this.setData({
        cards: (dashboard.cards || []).map((card) => ({ ...card, createdLabel: formatDate(card.createdAt) }))
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  copySource(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.url });
  },

  async deleteCard(event) {
    const confirmation = await wx.showModal({
      title: '删除这张结论卡？',
      content: '删除后不会保留文章全文或其他副本。',
      confirmText: '删除',
      confirmColor: '#963f32'
    });
    if (!confirmation.confirm) return;

    try {
      await storeAction('deleteCard', { cardId: event.currentTarget.dataset.id });
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadCards();
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  }
});
