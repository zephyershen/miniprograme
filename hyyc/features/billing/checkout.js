const {
  createMembershipPayment,
  getMembershipOrderStatus,
  reportMembershipPaymentFailure
} = require('./api.js');
const {
  assertVirtualPaymentAvailable,
  requestMiniProgramVirtualPayment,
  paymentCancelled,
  virtualPaymentFailureDiagnostic,
  rememberPendingMembershipOrder,
  pendingMembershipOrderId,
  pendingMembershipCashierCompleted,
  markPendingMembershipCashierCompleted
} = require('./payment.js');
const { requestWechatLoginCode } = require('../account/wechat-login.js');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function checkoutState(error) {
  return error && error.checkoutState || {
    cashierInvoked: false,
    cashierCompleted: false,
    paymentConfirmed: false
  };
}

function attachCheckoutState(error, state) {
  const target = error instanceof Error
    ? error
    : new Error(
      error && typeof error.errMsg === 'string' && error.errMsg.trim()
        ? error.errMsg.trim()
        : '支付暂时无法完成'
    );
  if (!(error instanceof Error) && error && typeof error === 'object') {
    if (Number.isFinite(Number(error.errCode))) target.errCode = Number(error.errCode);
    if (typeof error.code === 'string') target.code = error.code;
    if (typeof error.errMsg === 'string') target.errMsg = error.errMsg;
  }
  target.checkoutState = {
    cashierInvoked: state.cashierInvoked === true,
    cashierCompleted: state.cashierCompleted === true,
    paymentConfirmed: state.paymentConfirmed === true
  };
  return target;
}

async function confirmMembershipOrder(orderId) {
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
}

async function queryMembershipOrderOnce(orderId) {
  try {
    const latest = await getMembershipOrderStatus(orderId);
    return latest && latest.order || null;
  } catch (error) {
    return null;
  }
}

async function recordMembershipPaymentFailure(orderId, error) {
  if (!orderId || paymentCancelled(error)) return false;
  const diagnostic = virtualPaymentFailureDiagnostic(error);
  if (!diagnostic) return false;
  try {
    await reportMembershipPaymentFailure(orderId, diagnostic);
    return true;
  } catch (reportError) {
    return false;
  }
}

async function checkoutMembership({ planKey, access }) {
  const initialState = {
    cashierInvoked: false,
    cashierCompleted: false,
    paymentConfirmed: false
  };
  const pendingOrder = pendingMembershipOrderId();
  if (pendingOrder) {
    try {
      const recovered = await confirmMembershipOrder(pendingOrder);
      const pending = !recovered || recovered.status === 'payment_pending';
      if (!pending || pendingMembershipCashierCompleted(pendingOrder)) {
        return { order: recovered, recovered: true, ...initialState };
      }
    } catch (error) {
      throw attachCheckoutState(error, initialState);
    }
  }

  const state = { ...initialState };
  let orderId = '';
  try {
    assertVirtualPaymentAvailable();
    const loginCode = await requestWechatLoginCode();
    const created = await createMembershipPayment(planKey, loginCode, access);
    orderId = created && created.order && created.order.id || '';
    if (!orderId) throw new Error('支付订单创建失败');
    rememberPendingMembershipOrder(orderId);
    let order = created.order.status === 'paid' ? created.order : null;
    if (created.order.status !== 'paid' && created.payment) {
      state.cashierInvoked = true;
      try {
        await requestMiniProgramVirtualPayment(created.payment);
        state.cashierCompleted = true;
        markPendingMembershipCashierCompleted(orderId);
      } catch (paymentError) {
        order = await queryMembershipOrderOnce(orderId);
        if (!order || order.status !== 'paid') {
          await recordMembershipPaymentFailure(orderId, paymentError);
          throw paymentError;
        }
      }
    }
    if (!order) order = await confirmMembershipOrder(orderId);
    state.paymentConfirmed = Boolean(order && order.status === 'paid');
    return { order, orderId, recovered: false, ...state };
  } catch (error) {
    throw attachCheckoutState(error, state);
  }
}

module.exports = {
  checkoutMembership,
  checkoutState,
  confirmMembershipOrder,
  queryMembershipOrderOnce,
  recordMembershipPaymentFailure
};
