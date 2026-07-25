const { runtimeCloudEnvironment } = require('./config/runtime-environment.js');
const { refreshMembershipAccess } = require('./features/membership/session.js');
const {
  ensureViewerAccountSession
} = require('./features/account/session.js');

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
    this.initializeViewerSession(true);
  },

  onShow() {
    if (wx.cloud) {
      if (this.skipNextMembershipResumeRefresh) {
        this.skipNextMembershipResumeRefresh = false;
      } else {
        this.initializeViewerSession(true);
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

  async initializeViewerSession(force) {
    if (this.viewerAccountSessionPromise) return this.viewerAccountSessionPromise;
    const pending = (async () => {
      const access = await this.refreshMembershipAccess(force);
      if (!access) return null;
      const result = await ensureViewerAccountSession(access);
      this.globalData.accountSession = {
        verified: result && result.verified === true,
        authenticating: false
      };
      return result;
    })();
    this.viewerAccountSessionPromise = pending;
    try {
      return await pending;
    } catch (error) {
      this.globalData.accountSession = {
        verified: false,
        authenticating: false,
        errorCode: error && error.code || 'ACCOUNT_LOGIN_FAILED'
      };
      console.warn('微信账号暂时未登录', error && error.code ? error.code : error);
      return null;
    } finally {
      if (this.viewerAccountSessionPromise === pending) {
        this.viewerAccountSessionPromise = null;
      }
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
    accountSession: {
      verified: false,
      authenticating: false
    },
    runtimeEnvironment: null
  }
});
