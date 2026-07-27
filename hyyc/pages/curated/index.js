const {
  sectionTabs,
  previewColumnHome,
  normalizeColumnHome,
  hasReadableColumnContract
} = require('../../features/ai-column/model.js');
const {
  loadColumnHome,
  clearColumnCache
} = require('../../features/ai-column/session.js');
const {
  refreshMembershipAccess,
  membershipCacheScope
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const { finishPullDownRefresh } = require('../../features/runtime/pull-down-refresh.js');
const { getColumnProgress } = require('../../features/ai-column/api.js');
const { applyColumnProgress } = require('../../features/ai-column/progress.js');

function accessScope(access) {
  return membershipCacheScope(access);
}

Page({
  data: {
    loading: true,
    error: '',
    homeNotice: '',
    locked: false,
    activeSection: 'courses',
    sectionTabs: sectionTabs('courses'),
    home: previewColumnHome(),
    membership: membershipPresentation(null),
    membershipPromptVisible: false,
    membershipPromptFeature: 'ai_column'
  },

  onShow() {
    this.resolveAccess({ force: true, preserveCurrent: this.contentLoaded === true });
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
      const locked = !membership.isPrivileged;
      const scope = accessScope(access);
      let usedFallback = false;
      if (locked) clearColumnCache();
      let home;
      try {
        home = normalizeColumnHome(await loadColumnHome({ force, scope }));
        if (!locked && !hasReadableColumnContract(home)) {
          throw new Error('专栏服务版本暂不支持正文读取');
        }
      } catch (error) {
        if (!locked) throw new Error('专栏服务正在更新，请稍后重新读取');
        home = previewColumnHome();
        usedFallback = true;
      }
      if (locked) {
        this.columnProgress = null;
      } else {
        try {
          this.columnProgress = await getColumnProgress();
        } catch (error) {
          this.columnProgress = this.columnProgress || { items: [] };
        }
      }
      home = applyColumnProgress(home, this.columnProgress || { items: [] });
      this.columnAccessScope = scope;
      this.accessResolvedAt = Date.now();
      this.contentLoaded = true;
      this.setData({
        loading: false,
        locked,
        membership,
        home,
        homeNotice: usedFallback ? '当前先展示课程目录，稍后可以重新读取完整目录。' : ''
      });
    } catch (error) {
      if (!preserveCurrent) {
        this.setData({ loading: false, error: error.message || '专栏暂时无法加载' });
      }
    }
  },

  selectSection(event) {
    const key = event.currentTarget.dataset.key;
    if (!['courses', 'practicals'].includes(key) || key === this.data.activeSection) return;
    this.setData({ activeSection: key, sectionTabs: sectionTabs(key) });
  },

  openLesson(event) {
    this.openReader('lesson', event.currentTarget.dataset.id);
  },

  openPractical(event) {
    this.openReader('practical', event.currentTarget.dataset.id);
  },

  resumeLearning() {
    const summary = this.data.home && this.data.home.progressSummary;
    const resume = summary && summary.resume;
    if (!resume) return;
    this.openReader(resume.type, resume.id, resume.lastPosterIndex);
  },

  openReader(type, id, posterIndex = 0) {
    const readerContractReady = this.data.locked || hasReadableColumnContract(this.data.home);
    if (!readerContractReady) {
      wx.showToast({ title: '专栏服务正在更新，请稍后重新读取', icon: 'none' });
      return;
    }
    if (this.data.locked) {
      this.openMembershipPrompt();
      return;
    }
    if (!id) return;
    const resumeQuery = Number(posterIndex) > 0
      ? `&poster=${Math.floor(Number(posterIndex))}`
      : '';
    wx.navigateTo({
      url: `/pages/column-reader/index?type=${type}&id=${encodeURIComponent(id)}${resumeQuery}`
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
    return {
      title: 'AI 会员专栏｜基础知识与应用操作持续更新',
      path: '/pages/curated/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'AI 会员专栏｜基础知识与应用操作持续更新',
      query: ''
    };
  }
});
