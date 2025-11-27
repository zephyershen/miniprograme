// app.js
App({
  onLaunch() {
    // 初始化云开发环境，使用你的环境 ID
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云开发能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-1g5aegr5eb60ce96', // 云开发环境 ID
        traceUser: true // 记录用户访问，方便在云开发控制台里统计
      });
    }

    console.log('HYYC UI app launch');

    this.globalData = {
      user: null,
      community: null
    };
  },
  globalData: {
    user: null,
    community: null
  }
});
