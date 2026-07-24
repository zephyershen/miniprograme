const {
  refreshMembershipAccess,
  changeMembershipRolePreview
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const { loadUserProfile } = require('../../features/user-profile/session.js');
const { decorateUserProfile } = require('../../features/user-profile/model.js');
const {
  verifyMembershipAccount,
  createMembershipPayment,
  getMembershipOrderStatus,
  reportMembershipPaymentFailure
} = require('../../features/billing/api.js');
const {
  membershipAccountVerified,
  rememberMembershipAccountVerification,
  forgetMembershipAccountVerification
} = require('../../features/billing/account-session.js');
const { loadBillingPlans } = require('../../features/billing/session.js');
const { loadMessages } = require('../../features/messages/session.js');
const {
  recoverPendingMembershipOrder: recoverPendingMembershipOrderSession
} = require('../../features/billing/recovery.js');
const {
  assertVirtualPaymentAvailable,
  loginForPayment,
  requestMiniProgramVirtualPayment,
  paymentCancelled,
  paymentFailureMessage,
  virtualPaymentFailureDiagnostic,
  rememberPendingMembershipOrder,
  forgetPendingMembershipOrder
} = require('../../features/billing/payment.js');

const EMPTY_BILLING = Object.freeze({
  loading: true,
  available: false,
  purchasing: false,
  accountVerified: false,
  plan: {
    key: '',
    name: '',
    durationDays: 30,
    priceCents: 0,
    priceLabel: '',
    compareAtPriceCents: 0,
    compareAtPriceLabel: ''
  }
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function accountOperationActive(context, generation) {
  return !context.pageDisposed
    && !context.pageHidden
    && generation === context.accountOperationGeneration;
}

Page({
  data: {
    loading: true,
    roleSwitching: false,
    switchingRole: '',
    accountAuthenticating: false,
    accountLoggingOut: false,
    error: '',
    membership: membershipPresentation(null),
    userProfile: decorateUserProfile(null),
    messageCenter: { unreadCount: 0, hasUnread: false, loading: true },
    billing: { ...EMPTY_BILLING }
  },

  onLoad() {
    this.pageDisposed = false;
    this.pageHidden = false;
    this.accountOperationGeneration = 0;
  },

  onShow() {
    this.pageHidden = false;
    this.setData({
      accountAuthenticating: false,
      accountLoggingOut: false
    });
    if (typeof this.stopProfileReviewPolling === 'function') {
      this.stopProfileReviewPolling();
    }
    this.profileReviewPollCount = 0;
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.billingLoadRequestId = (this.billingLoadRequestId || 0) + 1;
    this.refreshProfilePage({ force: true });
  },

  onUnload() {
    this.pageDisposed = true;
    this.pageHidden = true;
    this.accountOperationGeneration = (this.accountOperationGeneration || 0) + 1;
    if (typeof this.stopProfileReviewPolling === 'function') {
      this.stopProfileReviewPolling();
    }
    this.membershipLoadRequestId = (this.membershipLoadRequestId || 0) + 1;
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.billingLoadRequestId = (this.billingLoadRequestId || 0) + 1;
    this.messageLoadRequestId = (this.messageLoadRequestId || 0) + 1;
  },

  onHide() {
    this.pageHidden = true;
    this.accountOperationGeneration = (this.accountOperationGeneration || 0) + 1;
    if (typeof this.stopProfileReviewPolling === 'function') {
      this.stopProfileReviewPolling();
    }
  },

  stopProfileReviewPolling() {
    if (this.profileReviewPollTimer) clearTimeout(this.profileReviewPollTimer);
    this.profileReviewPollTimer = null;
  },

  scheduleProfileReviewPolling(profile) {
    this.stopProfileReviewPolling();
    if (this.pageDisposed
      || !profile
      || profile.reviewPending !== true
      || (this.profileReviewPollCount || 0) >= 15) return;
    this.profileReviewPollTimer = setTimeout(() => {
      this.profileReviewPollTimer = null;
      this.profileReviewPollCount = (this.profileReviewPollCount || 0) + 1;
      this.loadProfile({ force: true });
    }, 8000);
  },

  onPullDownRefresh() {
    this.refreshProfilePage({ force: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  async refreshProfilePage({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const access = await this.loadMembership({ force });
    if (this.pageDisposed) return false;
    const tasks = [
      this.loadBilling({ force, access }),
      this.loadMessageCenter({ force })
    ];
    if (access) tasks.push(this.loadProfile({ force }));
    await Promise.all(tasks);
    return Boolean(access);
  },

  async loadMembership({ force = false } = {}) {
    if (this.pageDisposed) return null;
    const requestId = (this.membershipLoadRequestId || 0) + 1;
    this.membershipLoadRequestId = requestId;
    this.setData(this.membershipLoaded ? { error: '' } : { loading: true, error: '' });
    try {
      const access = await refreshMembershipAccess({ force });
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.membershipAccess = access;
      this.membershipLoaded = true;
      this.setData({
        loading: false,
        membership: membershipPresentation(access),
        'billing.accountVerified': membershipAccountVerified(access)
      });
      return access;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.setData({ loading: false, error: error.message || '身份状态暂时无法加载' });
      return null;
    }
  },

  async loadProfile({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const requestId = (this.profileLoadRequestId || 0) + 1;
    this.profileLoadRequestId = requestId;
    try {
      const userProfile = await loadUserProfile({ force });
      if (this.pageDisposed || requestId !== this.profileLoadRequestId) return false;
      this.setData({ userProfile });
      if (typeof this.scheduleProfileReviewPolling === 'function') {
        this.scheduleProfileReviewPolling(userProfile);
      }
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.profileLoadRequestId) return false;
      console.warn('个人资料暂时未刷新', error && error.code ? error.code : error);
      return false;
    }
  },

  async loadMessageCenter({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const requestId = (this.messageLoadRequestId || 0) + 1;
    this.messageLoadRequestId = requestId;
    try {
      const result = await loadMessages({ force });
      if (this.pageDisposed || requestId !== this.messageLoadRequestId) return false;
      this.setData({
        messageCenter: {
          unreadCount: Math.max(0, Number(result && result.unreadCount) || 0),
          hasUnread: Boolean(result && result.hasUnread),
          loading: false
        }
      });
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.messageLoadRequestId) return false;
      this.setData({ 'messageCenter.loading': false });
      return false;
    }
  },

  async loadBilling({ force = false, access = this.membershipAccess } = {}) {
    if (this.pageDisposed) return false;
    const requestId = (this.billingLoadRequestId || 0) + 1;
    this.billingLoadRequestId = requestId;
    const purchasing = this.data.billing.purchasing === true;
    if (!this.billingLoaded) this.setData({ 'billing.loading': true });
    try {
      const billing = await loadBillingPlans({ force, access });
      if (this.pageDisposed || requestId !== this.billingLoadRequestId) return false;
      const accountVerified = membershipAccountVerified(access);
      this.billingLoaded = true;
      this.setData({
        billing: {
          loading: false,
          available: billing && billing.available === true,
          purchasing,
          accountVerified,
          plan: billing && billing.plan || EMPTY_BILLING.plan
        }
      });
    } catch (error) {
      if (this.pageDisposed || requestId !== this.billingLoadRequestId) return false;
      if (!this.billingLoaded) {
        this.setData({ billing: { ...EMPTY_BILLING, loading: false, purchasing } });
      }
    } finally {
      if (!this.pageDisposed && requestId === this.billingLoadRequestId) {
        await this.recoverPendingMembershipOrder();
      }
    }
    return true;
  },

  async recoverPendingMembershipOrder() {
    if (this._recoveringMembershipOrder || this.data.billing.purchasing) return null;
    this._recoveringMembershipOrder = true;
    try {
      const order = await recoverPendingMembershipOrderSession();
      if (!order) return null;
      if (order.status === 'paid') {
        await this.loadMembership();
      }
      return order;
    } catch (error) {
      return null;
    } finally {
      this._recoveringMembershipOrder = false;
    }
  },

  async confirmMembershipOrder(orderId) {
    let latest = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt) await delay(900 + (attempt * 300));
      try {
        latest = await getMembershipOrderStatus(orderId);
      } catch (error) {
        if (attempt === 5) throw error;
        continue;
      }
      const status = latest && latest.order && latest.order.status;
      if (['paid', 'failed', 'closed', 'refunded'].includes(status)) return latest.order;
    }
    return latest && latest.order || null;
  },

  async queryMembershipOrderOnce(orderId) {
    try {
      const latest = await getMembershipOrderStatus(orderId);
      return latest && latest.order || null;
    } catch (error) {
      return null;
    }
  },

  async recordMembershipPaymentFailure(orderId, error) {
    if (!orderId || paymentCancelled(error)) return false;
    const diagnostic = virtualPaymentFailureDiagnostic(error);
    if (!diagnostic) return false;
    try {
      await reportMembershipPaymentFailure(orderId, diagnostic);
      return true;
    } catch (reportError) {
      return false;
    }
  },

  async promptProfileSetupAfterLogin(operationGeneration) {
    if (!accountOperationActive(this, operationGeneration)) return false;
    const profile = this.data.userProfile || {};
    if (profile.isComplete || profile.reviewPending) {
      wx.showToast({
        title: '登录成功，请再次点击订阅',
        icon: 'none'
      });
      return false;
    }
    return new Promise((resolve) => {
      wx.showModal({
        title: '已登录当前微信账号',
        content: '微信不允许小程序自动读取真实头像昵称。你可以主动选择微信头像和昵称，也可以稍后设置；这不会影响会员与当前微信账号绑定。',
        confirmText: '完善资料',
        cancelText: '稍后设置',
        success: (result) => {
          if (!accountOperationActive(this, operationGeneration)) {
            resolve(false);
            return;
          }
          if (result && result.confirm) {
            wx.navigateTo({ url: '/pages/profile-edit/index?from=membership' });
            resolve(true);
            return;
          }
          wx.showToast({
            title: '请再次点击订阅并支付',
            icon: 'none'
          });
          resolve(false);
        },
        fail: () => {
          if (!accountOperationActive(this, operationGeneration)) {
            resolve(false);
            return;
          }
          wx.showToast({
            title: '登录成功，请再次点击订阅',
            icon: 'none'
          });
          resolve(false);
        }
      });
    });
  },

  async loginWechatAccount() {
    if (this.data.accountAuthenticating
      || this.data.accountLoggingOut
      || this.data.billing.purchasing
      || this.data.billing.accountVerified
      || !this.data.billing.available) return false;
    const operationGeneration = (this.accountOperationGeneration || 0) + 1;
    this.accountOperationGeneration = operationGeneration;
    this.setData({ accountAuthenticating: true });
    try {
      assertVirtualPaymentAvailable();
      const loginCode = await loginForPayment();
      const verified = await verifyMembershipAccount(loginCode, this.membershipAccess);
      if (!verified || verified.verified !== true) {
        const error = new Error('登录状态校验失败，请重试');
        error.code = 'PAYMENT_LOGIN_FAILED';
        throw error;
      }
      if (!rememberMembershipAccountVerification(this.membershipAccess)) {
        const error = new Error('当前设备无法保存登录状态，请重试');
        error.code = 'PAYMENT_LOGIN_FAILED';
        throw error;
      }
      if (!accountOperationActive(this, operationGeneration)) return true;
      this.setData({ 'billing.accountVerified': true });
      await this.promptProfileSetupAfterLogin(operationGeneration);
      return true;
    } catch (error) {
      if (accountOperationActive(this, operationGeneration)) {
        wx.showToast({ title: paymentFailureMessage(error), icon: 'none' });
      }
      return false;
    } finally {
      if (accountOperationActive(this, operationGeneration)) {
        this.setData({ accountAuthenticating: false });
      }
    }
  },

  async logoutWechatAccount() {
    if (this.data.accountAuthenticating
      || this.data.accountLoggingOut
      || this.data.billing.purchasing
      || !this.data.billing.accountVerified) return false;
    const operationGeneration = (this.accountOperationGeneration || 0) + 1;
    this.accountOperationGeneration = operationGeneration;
    this.setData({ accountLoggingOut: true });
    try {
      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: '退出订阅登录？',
          content: '将退出小程序内的订阅登录。不会退出手机微信、取消会员、删除头像昵称或清除未完成订单；下次订阅前需要重新验证当前微信账号。',
          confirmText: '确认退出',
          confirmColor: '#b5534c',
          cancelText: '取消',
          success: (result) => resolve(Boolean(result && result.confirm)),
          fail: () => resolve(false)
        });
      });
      if (!accountOperationActive(this, operationGeneration) || !confirmed) return false;
      if (!forgetMembershipAccountVerification(this.membershipAccess)) {
        wx.showToast({ title: '退出失败，请重试', icon: 'none' });
        return false;
      }
      this.setData({ 'billing.accountVerified': false });
      wx.showToast({ title: '已退出订阅登录', icon: 'success' });
      return true;
    } catch (error) {
      if (accountOperationActive(this, operationGeneration)) {
        wx.showToast({ title: '退出失败，请重试', icon: 'none' });
      }
      return false;
    } finally {
      if (accountOperationActive(this, operationGeneration)) {
        this.setData({ accountLoggingOut: false });
      }
    }
  },

  async purchaseMembership() {
    if (this.data.accountAuthenticating
      || this.data.accountLoggingOut
      || this.data.billing.purchasing
      || !this.data.billing.available) return;
    if (!this.data.billing.accountVerified) {
      await this.loginWechatAccount();
      return;
    }
    this.setData({ 'billing.purchasing': true });
    let orderId = '';
    try {
      assertVirtualPaymentAvailable();
      const loginCode = await loginForPayment();
      const created = await createMembershipPayment(
        this.data.billing.plan.key,
        loginCode,
        this.membershipAccess
      );
      orderId = created && created.order && created.order.id || '';
      if (!orderId) throw new Error('支付订单创建失败');
      rememberPendingMembershipOrder(orderId);
      let order = created.order.status === 'paid' ? created.order : null;
      if (created.order.status !== 'paid') {
        try {
          await requestMiniProgramVirtualPayment(created.payment);
        } catch (paymentError) {
          order = await this.queryMembershipOrderOnce(orderId);
          if (!order || order.status !== 'paid') {
            await this.recordMembershipPaymentFailure(orderId, paymentError);
            throw paymentError;
          }
        }
      }
      if (!order) order = await this.confirmMembershipOrder(orderId);
      if (order && order.status === 'paid') {
        forgetPendingMembershipOrder(orderId);
        await this.loadMembership({ force: true });
        wx.showToast({ title: 'Pro 已开通', icon: 'success' });
      } else if (order && ['failed', 'closed'].includes(order.status)) {
        forgetPendingMembershipOrder(orderId);
        wx.showToast({ title: '支付未完成，请重新发起', icon: 'none' });
      } else if (order && order.status === 'refunded') {
        forgetPendingMembershipOrder(orderId);
        wx.showToast({ title: '订单已退款', icon: 'none' });
      } else {
        wx.showToast({ title: '支付结果确认中，请稍后下拉刷新', icon: 'none', duration: 2600 });
      }
    } catch (error) {
      if (paymentCancelled(error)) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        wx.showToast({ title: paymentFailureMessage(error), icon: 'none' });
      }
    } finally {
      this.setData({ 'billing.purchasing': false });
    }
  },

  async selectRolePreview(event) {
    const role = event.currentTarget.dataset.role;
    if (this.data.roleSwitching || !this.data.membership.canPreviewRoles
      || !this.data.membership.roleOptions.some((item) => item.key === role)
      || role === this.data.membership.role) return;
    this.setData({ roleSwitching: true, switchingRole: role });
    try {
      const access = await changeMembershipRolePreview(role);
      this.membershipAccess = access;
      this.setData({
        membership: membershipPresentation(access)
      });
      wx.showToast({ title: '预览身份已切换', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '切换失败', icon: 'none' });
    } finally {
      this.setData({ roleSwitching: false, switchingRole: '' });
    }
  },

  openCards() {
    wx.navigateTo({ url: '/pages/cards/index' });
  },

  openMessages() {
    wx.navigateTo({ url: '/pages/messages/index' });
  },

  openProfileEditor() {
    wx.navigateTo({ url: '/pages/profile-edit/index' });
  },

  openFeed() {
    wx.switchTab({ url: '/pages/inbox/index' });
  }
});
