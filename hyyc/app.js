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

    // 主动加载自定义字体（真机上仅写 @font-face 往往不会自动下载）
    // 注意：需要在小程序后台「downloadFile 合法域名」里配置 mrshenzf.top
    wx.loadFontFace({
      family: 'XiongKid',
      source: 'url("https://mrshenzf.top/front/XiongKid.ttf")',
      global: true,
      success(res) { console.log('XiongKid font loaded', res); },
      fail(err) { console.error('XiongKid font load fail', err); }
    });

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
