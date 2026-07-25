const { refreshMembershipAccess } = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const { loadUserProfile } = require('../../features/user-profile/session.js');
const { decorateUserProfile } = require('../../features/user-profile/model.js');
const {
  accountSessionPresentation,
  waitForViewerAccountSession
} = require('../../features/account/session.js');
const { loadBillingPlans } = require('../../features/billing/session.js');
const {
  recoverPendingMembershipOrder: recoverPendingMembershipOrderSession
} = require('../../features/billing/recovery.js');
const {
  checkoutMembership,
  checkoutState
} = require('../../features/billing/checkout.js');
const {
  paymentCancelled,
  paymentFailureMessage,
  membershipCheckoutFailureMessage,
  paymentConfirmationFailureMessage,
  forgetPendingMembershipOrder
} = require('../../features/billing/payment.js');

const EMPTY_BILLING = Object.freeze({
  loading: true,
  available: false,
  purchasing: false,
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

Page({
  data: {
    loading: true,
    error: '',
    membership: membershipPresentation(null),
    userProfile: decorateUserProfile(null),
    account: {
      verified: false,
      authenticating: true
    },
    billing: { ...EMPTY_BILLING }
  },

  onLoad() {
    this.pageDisposed = false;
  },

  onShow() {
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.billingLoadRequestId = (this.billingLoadRequestId || 0) + 1;
    this.refreshMembershipPage({ force: true });
  },

  onUnload() {
    this.pageDisposed = true;
    this.membershipLoadRequestId = (this.membershipLoadRequestId || 0) + 1;
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.billingLoadRequestId = (this.billingLoadRequestId || 0) + 1;
  },

  onPullDownRefresh() {
    this.refreshMembershipPage({ force: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  async refreshMembershipPage({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const access = await this.loadMembership({ force });
    if (this.pageDisposed) return false;
    const tasks = [this.loadBilling({ force, access })];
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
      await waitForViewerAccountSession(access);
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.membershipAccess = access;
      this.membershipLoaded = true;
      this.setData({
        loading: false,
        membership: membershipPresentation(access),
        account: accountSessionPresentation(access)
      });
      return access;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.setData({ loading: false, error: error.message || '会员状态暂时无法加载' });
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
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.profileLoadRequestId) return false;
      console.warn('个人资料暂时未刷新', error && error.code ? error.code : error);
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
      this.billingLoaded = true;
      this.setData({
        billing: {
          loading: false,
          available: billing && billing.available === true,
          purchasing,
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
      if (order && order.status === 'paid') {
        await this.loadMembership({ force: true });
      }
      return order;
    } catch (error) {
      return null;
    } finally {
      this._recoveringMembershipOrder = false;
    }
  },

  async applyMembershipOrderResult(orderId, order) {
    if (order && order.status === 'paid') {
      const purchaseMode = this.data.membership
        && this.data.membership.purchaseMode === 'renew'
        ? 'renew'
        : 'subscribe';
      const access = await this.loadMembership({ force: true });
      if (!access) {
        const error = new Error('会员状态暂时无法刷新');
        error.code = 'MEMBERSHIP_CONFIRMATION_FAILED';
        throw error;
      }
      forgetPendingMembershipOrder(orderId);
      wx.showToast({
        title: purchaseMode === 'renew' ? '续费成功' : 'Pro 已开通',
        icon: 'success'
      });
      return 'paid';
    }
    if (order && ['failed', 'closed'].includes(order.status)) {
      forgetPendingMembershipOrder(orderId);
      wx.showToast({ title: '支付未完成，请重新发起', icon: 'none' });
      return order.status;
    }
    if (order && order.status === 'refunded') {
      forgetPendingMembershipOrder(orderId);
      wx.showToast({ title: '订单已退款', icon: 'none' });
      return 'refunded';
    }
    wx.showToast({
      title: '支付结果确认中，请勿重复付款，稍后下拉刷新',
      icon: 'none',
      duration: 3000
    });
    return 'payment_pending';
  },

  async purchaseMembership() {
    if (this.data.billing.purchasing
      || this.membershipPurchaseInFlight
      || !this.data.billing.available) return;
    if (!this.data.account.verified) {
      wx.showToast({
        title: '微信账号尚未完成登录，请重新进入小程序',
        icon: 'none'
      });
      return;
    }

    this.membershipPurchaseInFlight = true;
    this.setData({ 'billing.purchasing': true });
    try {
      const result = await checkoutMembership({
        planKey: this.data.billing.plan.key,
        access: this.membershipAccess
      });
      const order = result && result.order || null;
      const orderId = result && result.orderId || order && order.id || '';
      await this.applyMembershipOrderResult(orderId, order);
    } catch (error) {
      if (paymentCancelled(error)) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        const state = checkoutState(error);
        wx.showToast({
          title: state.cashierCompleted || state.paymentConfirmed
            ? paymentConfirmationFailureMessage(error)
            : (state.cashierInvoked
              ? paymentFailureMessage(error)
              : membershipCheckoutFailureMessage(error)),
          icon: 'none',
          duration: state.cashierCompleted || state.paymentConfirmed ? 3000 : 1500
        });
      }
    } finally {
      this.setData({ 'billing.purchasing': false });
      this.membershipPurchaseInFlight = false;
    }
  }
});
