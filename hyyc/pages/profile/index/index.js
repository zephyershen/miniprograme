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
  gotoRealname(){ wx.navigateTo({ url: '/pages/auth/realname/index' }); },

  // 测试云函数 login 是否正常工作
  async testCloudFunction(){
    this.setData({ isLoading: true });
    try{
      const res = await wx.cloud.callFunction({ name: 'login' });
      console.log('云函数 login 返回：', res);
      const openid = res && res.result && res.result.openid;
      wx.showToast({
        title: openid ? ('openid: ' + openid.substring(0, 8) + '...') : '调用成功',
        icon: 'none'
      });
    }catch(err){
      console.error('调用云函数 login 失败', err);
      wx.showToast({ title: '调用失败', icon: 'none' });
    }finally{
      this.setData({ isLoading: false });
    }
  },

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
        wx.reLaunch({ url: '/pages/auth/welcome/index' });
      }
    });
  }
});
