const { getDashboard, storeAction } = require('../../utils/api');
const { LIMITS } = require('../../config/constants');
const { formatDate, relevanceMeta } = require('../../utils/format');

Page({
  data: {
    id: '',
    item: null,
    cards: [],
    cardCount: 0,
    loading: true,
    resolving: false,
    showReplacement: false
  },

  onLoad(options) {
    this.setData({ id: decodeURIComponent(options.id || '') });
  },

  onShow() {
    this.loadItem();
  },

  async loadItem() {
    this.setData({ loading: true });
    try {
      const dashboard = await getDashboard();
      const item = (dashboard.queue || []).find((entry) => entry._id === this.data.id);
      if (!item) {
        this.setData({ item: null, cards: dashboard.cards || [], cardCount: (dashboard.cards || []).length });
        return;
      }
      const meta = relevanceMeta(item.relevanceLevel);
      this.setData({
        item: {
          ...item,
          createdLabel: formatDate(item.createdAt),
          relevanceLabel: meta.label,
          relevanceTone: meta.tone
        },
        cards: dashboard.cards || [],
        cardCount: (dashboard.cards || []).length
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  copySource() {
    if (!this.data.item) return;
    wx.setClipboardData({ data: this.data.item.normalizedUrl });
  },

  async discard() {
    const confirmation = await wx.showModal({
      title: '确认丢弃？',
      content: '这条内容不会留下结论卡。',
      confirmText: '丢弃',
      confirmColor: '#963f32'
    });
    if (confirmation.confirm) await this.resolve('discard');
  },

  keep() {
    if (this.data.cardCount >= LIMITS.cards) {
      this.setData({ showReplacement: true });
      return;
    }
    this.resolve('keep');
  },

  closeReplacement() {
    if (!this.data.resolving) this.setData({ showReplacement: false });
  },

  stopPropagation() {},

  async replaceCard(event) {
    await this.resolve('keep', event.currentTarget.dataset.id);
  },

  async resolve(decision, replaceCardId) {
    this.setData({ resolving: true });
    wx.showLoading({ title: decision === 'keep' ? '正在留下结论' : '正在清空', mask: true });
    try {
      await storeAction('resolve', {
        itemId: this.data.id,
        decision,
        replaceCardId: replaceCardId || undefined
      });
      wx.showToast({ title: decision === 'keep' ? '已留下结论卡' : '已丢弃', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: decision === 'keep' ? '/pages/cards/index' : '/pages/inbox/index' }), 450);
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ resolving: false, showReplacement: false });
    }
  }
});
