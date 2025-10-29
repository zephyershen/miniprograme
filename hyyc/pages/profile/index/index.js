Page({
  data: { user: {} },
  onShow(){ this.setData({ user: wx.getStorageSync('hyyc_user')||{} }); },
  gotoMyTasks(){ wx.navigateTo({ url: '/pages/my/tasks/index' }); },
  gotoWallet(){ wx.navigateTo({ url: '/pages/wallet/index/index' }); },
  gotoRealname(){ wx.navigateTo({ url: '/pages/auth/realname/index' }); }
});
