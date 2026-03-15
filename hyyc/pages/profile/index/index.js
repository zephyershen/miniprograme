const { isCloudFileID, resolveAvatarURL, saveAvatarTempURL } = require('../../../utils/avatarCache');

Page({
  data: {
    user: {},
    isLoading: false,
  },
  onShow(){
    const rawUser = wx.getStorageSync('hyyc_user') || {};
    const avatarDisplayUrl = resolveAvatarURL(rawUser.avatarFileID, rawUser.avatarUrl);
    this.setData({
      user: {
        ...rawUser,
        avatarDisplayUrl,
      },
      isLoading: false,
    });
    this._hydrateAvatar(rawUser);
  },
  async _hydrateAvatar(user = {}) {
    const avatarFileID = String(user && user.avatarFileID || '').trim();
    if (!avatarFileID || !isCloudFileID(avatarFileID)) return;
    if (resolveAvatarURL(avatarFileID)) return;

    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: [{ fileID: avatarFileID, maxAge: 60 * 30 }]
      });
      const file = res && res.fileList && res.fileList[0];
      const tempURL = file && file.tempFileURL ? file.tempFileURL : '';
      if (!tempURL) return;

      saveAvatarTempURL(avatarFileID, tempURL, 60 * 30);
      const currentUser = wx.getStorageSync('hyyc_user') || {};
      if (String(currentUser.avatarFileID || '').trim() !== avatarFileID) return;
      this.setData({
        'user.avatarDisplayUrl': tempURL
      });
    } catch (err) {
      console.warn('加载我的头像失败', err);
    }
  },
  // 点击“账户信息”卡片，进入账户详情页
  gotoAccount(){
    wx.navigateTo({ url: '/pages/profile/account/index' });
  },
  gotoMyTasks(){ wx.navigateTo({ url: '/pages/profile/tasks/index' }); },
  gotoMyGoods(){ wx.navigateTo({ url: '/pages/profile/goods/index' }); },
  gotoFavorites(){ wx.navigateTo({ url: '/pages/profile/favorites/index' }); },
  gotoWallet(){ wx.navigateTo({ url: '/pages/profile/wallet/index' }); },

  // 退出登录：清掉本地缓存的用户信息，并回到欢迎页
  logout(){
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录或注册才能继续使用完整功能。',
      confirmText: '退出',
      confirmColor: '#EF4444',
      success: (res)=>{
        if (!res.confirm) return;
        try {
          wx.removeStorageSync('hyyc_user');
        } catch (e) {
          console.error('清除本地用户信息失败', e);
        }
        // 清空页面栈，直接回到欢迎页（带 Lottie 动画）
        wx.reLaunch({ url: '/pages/welcome/index' });
      }
    });
  },
});
