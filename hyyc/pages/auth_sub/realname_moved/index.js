Page({
  onLoad(){
    // 兼容旧路径缓存：把用户引导到新的实名注册页
    wx.redirectTo({
      url: "/pages/auth/realname/index",
      fail: () => wx.navigateTo({ url: "/pages/auth/realname/index" })
    });
  }
});
