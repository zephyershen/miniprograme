const { loadBriefing: loadBriefingContent } = require('../../features/briefing/session.js');
const { BRIEFING_SAMPLE } = require('../../features/briefing/sample.js');
const {
  WINDOW_OPTIONS,
  TOPIC_FILTERS,
  normalizeBriefing,
  filterBriefing,
  createBriefingState
} = require('../../features/briefing/model.js');
const {
  refreshMembershipAccess,
  membershipCacheScope
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const { finishPullDownRefresh } = require('../../features/runtime/pull-down-refresh.js');
const { consumeBriefingWindow } = require('../../features/briefing/navigation.js');

function activate(options, key) {
  return options.map((item) => ({ ...item, active: item.key === key }));
}

Page({
  data: {
    ...createBriefingState(),
    sample: normalizeBriefing(BRIEFING_SAMPLE),
    membership: membershipPresentation(null),
    membershipPromptVisible: false,
    membershipPromptFeature: 'digests'
  },

  onLoad(options = {}) {
    const windowKey = WINDOW_OPTIONS.some((item) => item.key === options.windowKey)
      ? options.windowKey
      : '24h';
    this.setData({
      windowKey,
      windowOptions: activate(WINDOW_OPTIONS, windowKey)
    });
  },

  onShow() {
    const intendedWindow = consumeBriefingWindow(getApp());
    const windowChanged = Boolean(intendedWindow && intendedWindow !== this.data.windowKey);
    const resolve = () => this.resolveAccess({
      force: true,
      preserveCurrent: !windowChanged && this.contentLoaded === true
    });
    if (!windowChanged) {
      resolve();
      return;
    }
    this.rawBriefing = null;
    this.contentLoaded = false;
    this.setData({
      windowKey: intendedWindow,
      windowOptions: activate(WINDOW_OPTIONS, intendedWindow)
    }, resolve);
  },

  onPullDownRefresh() {
    return finishPullDownRefresh(() => this.resolveAccess({
      force: true,
      preserveCurrent: this.contentLoaded === true
    }));
  },

  async resolveAccess({ force = false, preserveCurrent = false } = {}) {
    this.setData(preserveCurrent ? { error: '' } : { loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force });
      const membership = membershipPresentation(access);
      this.accessResolvedAt = Date.now();
      if (!membership.isPrivileged) {
        this.rawBriefing = null;
        this.contentLoaded = true;
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
      await this.loadBriefing(force, membershipCacheScope(access), { preserveCurrent });
    } catch (error) {
      if (!preserveCurrent) {
        this.setData({ loading: false, error: error.message || '简报暂时无法加载' });
      }
    }
  },

  async loadBriefing(
    force = false,
    scope = membershipCacheScope(),
    { preserveCurrent = false } = {}
  ) {
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    this.setData(preserveCurrent ? { error: '' } : { loading: true, error: '' });
    try {
      const raw = await loadBriefingContent(this.data.windowKey, { force, scope });
      if (requestId !== this.requestId) return;
      const payload = raw && (raw.digest || raw.briefing) || raw || {};
      const briefing = normalizeBriefing(payload);
      this.rawBriefing = briefing;
      this.contentLoaded = true;
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
      if (!preserveCurrent) {
        this.setData({ loading: false, error: error.message || '简报暂时无法加载' });
      }
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

  openMembershipPrompt() {
    this.setData({ membershipPromptVisible: true });
  },

  closeMembershipPrompt() {
    this.setData({ membershipPromptVisible: false });
  },

  openMembershipFromPrompt() {
    this.setData({ membershipPromptVisible: false }, () => this.openProfile());
  },

  retry() {
    this.resolveAccess({ force: true });
  },

  onShareAppMessage() {
    const windowKey = this.data.windowKey || '24h';
    const option = WINDOW_OPTIONS.find((item) => item.key === windowKey);
    return {
      title: `AI 知识简报｜${option ? option.label : '日报'}`,
      path: `/pages/briefing/index?windowKey=${windowKey}`
    };
  },

  onShareTimeline() {
    const windowKey = this.data.windowKey || '24h';
    const option = WINDOW_OPTIONS.find((item) => item.key === windowKey);
    return {
      title: `AI 知识简报｜${option ? option.label : '日报'}`,
      query: `windowKey=${windowKey}`
    };
  }
});
