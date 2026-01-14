// app.js
App({
  onLaunch() {
    // 初始化云开发环境，使用你的环境 ID
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云开发能力');
    } else {
      wx.cloud.init({
        env: 'hyyc-1gi3f5sqc5becabf', // 云开发环境 ID
        traceUser: true // 记录用户访问，方便在云开发控制台里统计
      });
    }

    // 主动加载自定义字体（真机上仅写 @font-face 往往不会自动下载）
    // 如需自定义字体，建议把字体文件放到小程序包里（不用走网络），再按需加载。

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
