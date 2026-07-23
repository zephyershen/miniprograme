const { runtimeCloudEnvironment } = require('./config/runtime-environment.js');
const { refreshMembershipAccess } = require('./features/membership/session.js');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发能力');
      return;
    }

    const runtime = runtimeCloudEnvironment(wx);
    wx.cloud.init({ env: runtime.cloudEnvironmentId });
    this.globalData.runtimeEnvironment = runtime;
    this.skipNextMembershipResumeRefresh = true;
    this.refreshMembershipAccess(true);
  },

  onShow() {
    if (wx.cloud) {
      if (this.skipNextMembershipResumeRefresh) {
        this.skipNextMembershipResumeRefresh = false;
      } else {
        this.refreshMembershipAccess(true);
      }
      this.scheduleMembershipOrderRecovery();
    }
  },

  onHide() {
    if (this.membershipRecoveryTimer) clearTimeout(this.membershipRecoveryTimer);
    this.membershipRecoveryTimer = null;
  },

  scheduleMembershipOrderRecovery() {
    if (this.membershipRecoveryTimer) return;
    this.membershipRecoveryTimer = setTimeout(() => {
      this.membershipRecoveryTimer = null;
      this.recoverPendingMembershipOrder();
    }, 300);
  },

  async refreshMembershipAccess(force) {
    try {
      return await refreshMembershipAccess({ force });
    } catch (error) {
      console.warn('会员权益暂时未刷新', error && error.code ? error.code : error);
      return null;
    }
  },

  async recoverPendingMembershipOrder() {
    try {
      const { recoverPendingMembershipOrder } = require('./features/billing/recovery.js');
      return await recoverPendingMembershipOrder();
    } catch (error) {
      console.warn('待确认订单暂时未刷新', error && error.code ? error.code : error);
      return null;
    }
  },

  globalData: {
    dashboard: null,
    knowledgeFeed: null,
    membership: null,
    curatedFeed: null,
    briefing: null,
    runtimeEnvironment: null
  }
});
