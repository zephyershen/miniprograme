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
  }
});
