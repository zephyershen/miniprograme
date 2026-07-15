const { markGuideSeen } = require('../../utils/guide');
const { getStoredUser } = require('../../utils/userIdentity');

Page({
  data: {
    entry: '',
    showGuestActions: true,
  },

  onLoad(options = {}) {
    this.setData({
      entry: String(options.entry || '').trim(),
    });
    this._syncActionVisibility();
  },

  onShow() {
    this._syncActionVisibility();
  },

  _syncActionVisibility() {
    const user = getStoredUser();
    this.setData({
      showGuestActions: !(user && user.id),
    });
  },

  _finishGuide() {
    markGuideSeen();
  },

  onBrowseTap() {
    this._finishGuide();
    wx.switchTab({ url: '/pages/home/index/index' });
  },

  onRegisterTap() {
    this._finishGuide();
    wx.navigateTo({ url: '/pages/auth/register/index' });
  },

  onWhyRealnameTap() {
    wx.showModal({
      title: '为什么交易前还需要实名',
      content: '因为这是熟人社区场景。浏览可以先放开，但真正发生购买、接单、聊天、发布和后续收款时，平台仍然要保护双方身份、沟通安全和资金路径。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onBackTap() {
    this._finishGuide();
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: '/pages/welcome/index' });
  },
});
