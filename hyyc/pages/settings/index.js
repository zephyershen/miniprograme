const { getDashboard, storeAction } = require('../../utils/api');
const { TOPICS, LIMITS } = require('../../config/constants');
const { formatMoney } = require('../../utils/format');

function decorateTopics(selected) {
  return TOPICS.map((topic) => ({ ...topic, selected: selected.includes(topic.key) }));
}

Page({
  data: {
    loading: true,
    saving: false,
    selectedTopics: [],
    topics: decorateTopics([]),
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostCny: 0, costLabel: '0.000' },
    stats: { addedCount: 0, processedCount: 0, processedWithin7DaysCount: 0, activeDays: 0 },
    monthlyLimit: LIMITS.monthlyAiCny
  },

  onShow() {
    this.loadSettings();
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const dashboard = await getDashboard();
      const selectedTopics = (dashboard.preferences && dashboard.preferences.topics) || [];
      const usage = dashboard.usage || {};
      this.setData({
        selectedTopics,
        topics: decorateTopics(selectedTopics),
        usage: { ...usage, costLabel: formatMoney(usage.estimatedCostCny) },
        stats: dashboard.stats || this.data.stats
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleTopic(event) {
    if (this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    const selected = [...this.data.selectedTopics];
    const index = selected.indexOf(key);
    if (index >= 0) {
      selected.splice(index, 1);
    } else if (selected.length >= 3) {
      wx.showToast({ title: '最多选择 3 个方向', icon: 'none' });
      return;
    } else {
      selected.push(key);
    }
    this.setData({ selectedTopics: selected, topics: decorateTopics(selected) });
  },

  async savePreferences() {
    if (!this.data.selectedTopics.length) {
      wx.showToast({ title: '至少选择 1 个方向', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await storeAction('savePreferences', { topics: this.data.selectedTopics });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async purgeMyData() {
    const confirmation = await wx.showModal({
      title: '清空我的全部数据？',
      content: '待消化内容、结论卡、关注方向和验证统计都会删除，且无法恢复。',
      confirmText: '全部清空',
      confirmColor: '#963f32'
    });
    if (!confirmation.confirm) return;

    try {
      await storeAction('purgeMyData');
      wx.showToast({ title: '已清空', icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/inbox/index' }), 450);
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  }
});
