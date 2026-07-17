const { getBriefing } = require('../../features/briefing/api.js');
const { BRIEFING_SAMPLE } = require('../../features/briefing/sample.js');
const {
  WINDOW_OPTIONS,
  TOPIC_FILTERS,
  normalizeBriefing,
  filterBriefing,
  createBriefingState
} = require('../../features/briefing/model.js');
const { refreshMembershipAccess } = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');

function activate(options, key) {
  return options.map((item) => ({ ...item, active: item.key === key }));
}

Page({
  data: {
    ...createBriefingState(),
    sample: normalizeBriefing(BRIEFING_SAMPLE),
    membership: membershipPresentation(null)
  },

  onShow() {
    this.resolveAccess();
  },

  async resolveAccess() {
    this.setData({ loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force: true });
      const membership = membershipPresentation(access);
      if (!membership.isPrivileged) {
        this.rawBriefing = null;
        this.setData({
          loading: false,
          locked: true,
          providerPending: false,
          membership,
          briefing: filterBriefing(normalizeBriefing(BRIEFING_SAMPLE), this.data.topicKey)
        });
        return;
      }
      this.setData({ locked: false, membership });
      await this.loadBriefing();
    } catch (error) {
      this.setData({ loading: false, error: error.message || '简报暂时无法加载' });
    }
  },

  async loadBriefing() {
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.setData({ loading: true, error: '' });
    try {
      const raw = await getBriefing(this.data.windowKey);
      if (requestId !== this.requestId) return;
      const payload = raw && (raw.digest || raw.briefing) || raw || {};
      const briefing = normalizeBriefing(payload);
      this.rawBriefing = briefing;
      const providerPending = briefing.status !== 'ready' && !briefing.conclusion;
      this.setData({
        loading: false,
        providerPending,
        briefing: filterBriefing(briefing, this.data.topicKey)
      });
      getApp().globalData.briefing = briefing;
    } catch (error) {
      if (requestId !== this.requestId) return;
      if (error.code === 'ENTITLEMENT_REQUIRED') {
        this.setData({ loading: false, locked: true });
        return;
      }
      this.setData({ loading: false, error: error.message || '简报暂时无法加载' });
    }
  },

  selectWindow(event) {
    const key = event.currentTarget.dataset.key;
    if (!WINDOW_OPTIONS.some((item) => item.key === key) || key === this.data.windowKey) return;
    this.setData({
      windowKey: key,
      windowOptions: activate(WINDOW_OPTIONS, key)
    }, () => {
      if (!this.data.locked) this.loadBriefing();
    });
  },

  selectTopic(event) {
    const key = event.currentTarget.dataset.key;
    if (!TOPIC_FILTERS.some((item) => item.key === key) || key === this.data.topicKey) return;
    const base = this.data.locked ? normalizeBriefing(BRIEFING_SAMPLE) : this.rawBriefing;
    this.setData({
      topicKey: key,
      topicOptions: activate(TOPIC_FILTERS, key),
      briefing: filterBriefing(base || normalizeBriefing(), key)
    });
  },

  openReference(event) {
    const itemId = event.currentTarget.dataset.id;
    const digestId = this.data.briefing.id;
    if (!itemId || this.data.locked) return;
    wx.navigateTo({
      url: `/pages/feed-detail/index?id=${encodeURIComponent(itemId)}&digestId=${encodeURIComponent(digestId || '')}`
    });
  },

  openProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  retry() {
    this.resolveAccess();
  }
});
