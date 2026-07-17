const { CLOUD_ENV_ID } = require('./config/constants.js');
const { refreshMembershipAccess } = require('./features/membership/session.js');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发能力');
      return;
    }

    wx.cloud.init({
      env: CLOUD_ENV_ID
    });
    this.refreshMembershipAccess(false);
  },

  onShow() {
    if (wx.cloud) this.refreshMembershipAccess(true);
  },

  async refreshMembershipAccess(force) {
    try {
      return await refreshMembershipAccess({ force });
    } catch (error) {
      console.warn('会员权益暂时未刷新', error && error.code ? error.code : error);
      return null;
    }
  },

  globalData: {
    dashboard: null,
    knowledgeFeed: null,
    membership: null,
    curatedFeed: null,
    briefing: null
  }
});
