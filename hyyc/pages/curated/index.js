const {
  createColumnState,
  createColumnView,
  posterLoadWindow,
  posterPreviewUrls,
  validTrack
} = require('../../features/ai-column/model.js');
const { refreshMembershipAccess } = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');

Page({
  data: {
    ...createColumnState(),
    activePosterIndex: 0,
    posterLoads: posterLoadWindow(0),
    posterError: '',
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
      this.setData({
        loading: false,
        locked: !membership.isPrivileged,
        membership
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '专栏暂时无法加载' });
    }
  },

  selectTrack(event) {
    const trackKey = validTrack(event.currentTarget.dataset.key);
    if (trackKey === this.data.view.trackKey) return;
    this.setData({
      expandedId: '',
      activePosterIndex: 0,
      posterLoads: posterLoadWindow(0),
      posterError: '',
      view: createColumnView({ trackKey })
    });
  },

  toggleLesson(event) {
    if (this.data.locked) {
      this.openProfile();
      return;
    }
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const expandedId = this.data.expandedId === id ? '' : id;
    this.setData({
      expandedId,
      activePosterIndex: 0,
      posterLoads: posterLoadWindow(0),
      posterError: '',
      view: createColumnView({ trackKey: this.data.view.trackKey, expandedId })
    });
  },

  stopPropagation() {},

  handlePosterChange(event) {
    const activePosterIndex = Number(event.detail && event.detail.current) || 0;
    this.setData({
      activePosterIndex,
      posterLoads: posterLoadWindow(activePosterIndex),
      posterError: ''
    });
  },

  handlePosterError(event) {
    const posterKey = event.currentTarget.dataset.key || 'unknown';
    console.error('[ai-column] poster failed to load', posterKey, event.detail && event.detail.errMsg);
    this.setData({ posterError: posterKey });
    wx.showToast({ title: '海报加载失败，请重试', icon: 'none' });
  },

  previewPoster(event) {
    const lessonId = event.currentTarget.dataset.id;
    const requestedIndex = Number(event.currentTarget.dataset.index) || 0;
    const lesson = (this.data.view.lessons || []).find((item) => item.id === lessonId);
    const urls = posterPreviewUrls(lesson);
    if (!urls.length) {
      wx.showToast({ title: '高清图暂时不可用', icon: 'none' });
      return;
    }
    const currentIndex = Math.min(Math.max(requestedIndex, 0), urls.length - 1);
    wx.previewImage({
      current: urls[currentIndex],
      urls,
      fail: () => wx.showToast({ title: '高清图加载失败，请重试', icon: 'none' })
    });
  },

  openProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  retry() {
    this.resolveAccess();
  }
});
