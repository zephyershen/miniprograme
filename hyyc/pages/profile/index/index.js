Page({
  data: {
    user: {},
    isLoading: true,
  },
  onShow(){
    this.setData({ isLoading: true });
    setTimeout(() => {
      this.setData({
        user: wx.getStorageSync('hyyc_user')||{},
        isLoading: false,
      });
    }, 500);
  },
  // 点击“账户信息”卡片，进入账户详情页
  gotoAccount(){
    wx.navigateTo({ url: '/pages/profile/account/index' });
  },
  gotoMyTasks(){ wx.navigateTo({ url: '/pages/profile/tasks/index' }); },
  gotoMyGoods(){ wx.navigateTo({ url: '/pages/profile/goods/index' }); },
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
