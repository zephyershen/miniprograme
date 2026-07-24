const { loadUserProfile, updateUserProfile } = require('../../features/user-profile/session.js');
const { uploadAvatar } = require('../../features/user-profile/media.js');

Page({
  data: {
    loading: true,
    saving: false,
    nickname: '',
    avatarUrl: '',
    avatarFileId: '',
    avatarChanged: false,
    reviewPending: false,
    reviewMessage: '',
    membershipSetup: false,
    canSave: false
  },

  onLoad(options = {}) {
    this.pageDisposed = false;
    this.saveCompleted = false;
    this.returnTimer = null;
    this.returnToComments = options.from === 'comments';
    this.setData({ membershipSetup: options.from === 'membership' });
    this.loadProfile();
  },

  onUnload() {
    this.pageDisposed = true;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = null;
  },

  async loadProfile() {
    try {
      const profile = await loadUserProfile();
      this.setData({
        loading: false,
        nickname: profile.displayNickname,
        avatarUrl: profile.displayAvatarUrl,
        avatarFileId: profile.displayAvatarFileId,
        avatarChanged: false,
        reviewPending: profile.reviewPending,
        reviewMessage: profile.review && profile.review.message || ''
      }, () => this.updateCanSave());
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '资料暂时无法读取', icon: 'none' });
    }
  },

  onChooseAvatar(event) {
    const avatarUrl = event && event.detail && event.detail.avatarUrl;
    if (!avatarUrl) return;
    this.setData({
      avatarUrl,
      avatarChanged: true,
      reviewPending: false,
      reviewMessage: ''
    }, () => this.updateCanSave());
  },

  onNicknameInput(event) {
    this.setData({ nickname: event.detail.value || '' }, () => this.updateCanSave());
  },

  updateCanSave() {
    this.setData({ canSave: Boolean(this.data.nickname.trim() && this.data.avatarUrl) });
  },

  skipProfileSetup() {
    if (!this.data.membershipSetup || this.data.saving) return;
    wx.navigateBack();
  },

  async saveProfile() {
    if (!this.data.canSave || this.data.saving || this.saveCompleted) return;
    this.setData({ saving: true });
    try {
      const avatarFileId = this.data.avatarChanged
        ? await uploadAvatar(this.data.avatarUrl)
        : this.data.avatarFileId;
      await updateUserProfile({ nickname: this.data.nickname.trim(), avatarFileId });
      this.saveCompleted = true;
      if (this.pageDisposed) return;
      wx.showToast({
        title: this.data.membershipSetup ? '资料已提交，可继续订阅' : '已提交审核',
        icon: 'success'
      });
      this.returnTimer = setTimeout(() => {
        this.returnTimer = null;
        if (!this.pageDisposed) wx.navigateBack();
      }, 320);
    } catch (error) {
      if (!this.pageDisposed) {
        wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' });
      }
    } finally {
      if (!this.pageDisposed) this.setData({ saving: false });
    }
  }
});
