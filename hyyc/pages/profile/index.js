const {
  refreshMembershipAccess,
  changeMembershipRolePreview
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const { loadUserProfile } = require('../../features/user-profile/session.js');
const { decorateUserProfile } = require('../../features/user-profile/model.js');
const {
  createMembershipPayment,
  getMembershipOrderStatus
} = require('../../features/billing/api.js');
const { loadBillingPlans } = require('../../features/billing/session.js');
const {
  recoverPendingMembershipOrder: recoverPendingMembershipOrderSession
} = require('../../features/billing/recovery.js');
const {
  assertVirtualPaymentAvailable,
  loginForPayment,
  requestMiniProgramVirtualPayment,
  paymentCancelled,
  paymentFailureMessage,
  rememberPendingMembershipOrder,
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

Page({
  data: {
    loading: true,
    roleSwitching: false,
    switchingRole: '',
    error: '',
    membership: membershipPresentation(null),
    userProfile: decorateUserProfile(null),
    billing: { ...EMPTY_BILLING }
  },

  onLoad() {
    this.pageDisposed = false;
  },

  onShow() {
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.billingLoadRequestId = (this.billingLoadRequestId || 0) + 1;
    this.setData({ userProfile: decorateUserProfile(null) });
    this.refreshProfilePage({ force: true });
  },

  onUnload() {
    this.pageDisposed = true;
    this.membershipLoadRequestId = (this.membershipLoadRequestId || 0) + 1;
    this.profileLoadRequestId = (this.profileLoadRequestId || 0) + 1;
    this.billingLoadRequestId = (this.billingLoadRequestId || 0) + 1;
  },

  onPullDownRefresh() {
    this.refreshProfilePage({ force: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  async refreshProfilePage({ force = false } = {}) {
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
      if (this.pageDisposed || requestId !== this.membershipLoadRequestId) return null;
      this.membershipAccess = access;
      this.membershipLoaded = true;
      this.setData({
        loading: false,
        membership: membershipPresentation(access)
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

  async purchaseMembership() {
    if (this.data.billing.purchasing || !this.data.billing.available) return;
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
      if (created.order.status !== 'paid') {
        await requestMiniProgramVirtualPayment(created.payment);
      }
      const order = await this.confirmMembershipOrder(orderId);
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

  openProfileEditor() {
    wx.navigateTo({ url: '/pages/profile-edit/index' });
  },

  openFeed() {
    wx.switchTab({ url: '/pages/inbox/index' });
  }
});
