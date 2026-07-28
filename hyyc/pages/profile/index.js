const {
  cachedMembershipAccess,
  refreshMembershipAccess,
  changeMembershipRolePreview
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const {
  cachedUserProfile,
  loadUserProfile
} = require('../../features/user-profile/session.js');
const {
  decorateUserProfile,
  preserveUserProfileAvatar
} = require('../../features/user-profile/model.js');
const { loadMessages } = require('../../features/messages/session.js');
const {
  waitForViewerAccountSession
} = require('../../features/account/session.js');
const { isProductFeatureEnabled } = require('../../config/product-features.js');

function sameProfilePresentation(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

Page({
  data: {
    loading: true,
    roleSwitching: false,
    switchingRole: '',
    error: '',
    commentsEnabled: isProductFeatureEnabled('comments'),
    membership: membershipPresentation(null),
    userProfile: decorateUserProfile(null),
    messageCenter: { unreadCount: 0, hasUnread: false, loading: true }
  },

  onLoad() {
    this.pageDisposed = false;
    this.hydrateCachedProfilePage();
  },

  onShow() {
    if (typeof this.stopProfileReviewPolling === 'function') {
      this.stopProfileReviewPolling();
    }
    this.profileReviewPollCount = 0;
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.refreshProfilePage({ force: true });
  },

  onUnload() {
    this.pageDisposed = true;
    if (typeof this.stopProfileReviewPolling === 'function') {
      this.stopProfileReviewPolling();
    }
    this.membershipLoadRequestId = (this.membershipLoadRequestId || 0) + 1;
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.messageLoadRequestId = (this.messageLoadRequestId || 0) + 1;
  },

  onHide() {
    if (typeof this.stopProfileReviewPolling === 'function') {
      this.stopProfileReviewPolling();
    }
  },

  stopProfileReviewPolling() {
    if (this.profileReviewPollTimer) clearTimeout(this.profileReviewPollTimer);
    this.profileReviewPollTimer = null;
  },

  hydrateCachedProfilePage() {
    const access = typeof cachedMembershipAccess === 'function'
      ? cachedMembershipAccess()
      : null;
    const userProfile = typeof cachedUserProfile === 'function'
      ? cachedUserProfile()
      : null;
    const patch = {};
    if (access) {
      this.membershipAccess = access;
      this.membershipLoaded = true;
      patch.loading = false;
      patch.membership = membershipPresentation(access);
    }
    if (userProfile) patch.userProfile = userProfile;
    if (Object.keys(patch).length) this.setData(patch);
    return Boolean(access || userProfile);
  },

  scheduleProfileReviewPolling(profile) {
    this.stopProfileReviewPolling();
    if (this.pageDisposed
      || !profile
      || profile.reviewPending !== true
      || (this.profileReviewPollCount || 0) >= 15) return;
    this.profileReviewPollTimer = setTimeout(() => {
      this.profileReviewPollTimer = null;
      this.profileReviewPollCount = (this.profileReviewPollCount || 0) + 1;
      this.loadProfile({ force: true });
    }, 8000);
  },

  onPullDownRefresh() {
    this.refreshProfilePage({ force: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  async refreshProfilePage({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const access = await this.loadMembership({ force });
    if (this.pageDisposed) return false;
    const tasks = [this.loadMessageCenter({ force })];
    if (access) tasks.push(this.loadProfile({ force }));
    await Promise.all(tasks);
    return Boolean(access);
  },

  async loadMembership({ force = false } = {}) {
    if (this.pageDisposed) return null;
    const requestId = (this.membershipLoadRequestId || 0) + 1;
    this.membershipLoadRequestId = requestId;
    this.setData(this.membershipLoaded ? { error: '' } : { loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force });
      await waitForViewerAccountSession(access);
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.membershipAccess = access;
      this.membershipLoaded = true;
      this.setData({
        loading: false,
        membership: membershipPresentation(access)
      });
      return access;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.setData({ loading: false, error: error.message || '身份状态暂时无法加载' });
      return null;
    }
  },

  async loadProfile({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const requestId = (this.profileLoadRequestId || 0) + 1;
    this.profileLoadRequestId = requestId;
    try {
      const refreshedProfile = await loadUserProfile({ force });
      if (this.pageDisposed || requestId !== this.profileLoadRequestId) return false;
      const userProfile = preserveUserProfileAvatar(
        refreshedProfile,
        this.data.userProfile
      );
      if (!sameProfilePresentation(this.data.userProfile, userProfile)) {
        this.setData({ userProfile });
      }
      if (typeof this.scheduleProfileReviewPolling === 'function') {
        this.scheduleProfileReviewPolling(userProfile);
      }
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.profileLoadRequestId) return false;
      console.warn('个人资料暂时未刷新', error && error.code ? error.code : error);
      return false;
    }
  },

  async loadMessageCenter({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const requestId = (this.messageLoadRequestId || 0) + 1;
    this.messageLoadRequestId = requestId;
    try {
      const result = await loadMessages({ force });
      if (this.pageDisposed || requestId !== this.messageLoadRequestId) return false;
      this.setData({
        messageCenter: {
          unreadCount: Math.max(0, Number(result && result.unreadCount) || 0),
          hasUnread: Boolean(result && result.hasUnread),
          loading: false
        }
      });
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.messageLoadRequestId) return false;
      this.setData({ 'messageCenter.loading': false });
      return false;
    }
  },

  async selectRolePreview(event) {
    const role = event.currentTarget.dataset.role;
    if (this.data.roleSwitching || !this.data.membership.canPreviewRoles
      || !this.data.membership.roleOptions.some((item) => item.key === role)
      || role === this.data.membership.role) return;
    this.setData({ roleSwitching: true, switchingRole: role });
    try {
      const access = await changeMembershipRolePreview(role);
      this.membershipAccess = access;
      this.setData({
        membership: membershipPresentation(access)
      });
      wx.showToast({ title: '预览身份已切换', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '切换失败', icon: 'none' });
    } finally {
      this.setData({ roleSwitching: false, switchingRole: '' });
    }
  },

  openCards() {
    wx.navigateTo({ url: '/pages/cards/index' });
  },

  openMessages() {
    wx.navigateTo({ url: '/pages/messages/index' });
  },

  openProfileEditor() {
    wx.navigateTo({ url: '/pages/profile-edit/index' });
  },

  openMembership() {
    wx.navigateTo({ url: '/pages/membership/index' });
  },

  openColumnAdmin() {
    if (!this.data.membership.isActualAdmin) return;
    wx.navigateTo({ url: '/pages/column-admin/index' });
  },

  openFeed() {
    wx.switchTab({ url: '/pages/inbox/index' });
  }
});
