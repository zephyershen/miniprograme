const { CLOUD_ENV_ID } = require('./config/constants');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发能力');
      return;
    }

    wx.cloud.init({
      env: CLOUD_ENV_ID
    });
  },

  globalData: {
    dashboard: null,
    knowledgeFeed: null
  }
});
