Page({
  data: { user: {}, isLoading: true },
  onShow(){
    this.setData({ isLoading: true });
    setTimeout(() => {
      this.setData({ user: wx.getStorageSync('hyyc_user')||{}, isLoading: false });
    }, 500);
  },
  gotoMyTasks(){ wx.navigateTo({ url: '/pages/my/tasks/index' }); },
  gotoWallet(){ wx.navigateTo({ url: '/pages/wallet/index/index' }); },
  gotoRealname(){ wx.navigateTo({ url: '/pages/auth/realname/index' }); }
});
