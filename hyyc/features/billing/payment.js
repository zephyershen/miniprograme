const MINIMUM_VIRTUAL_PAYMENT_SDK = '2.19.2';
const PENDING_MEMBERSHIP_ORDER_KEY = 'billing.pendingMembershipOrder';

function assertVirtualPaymentAvailable() {
  if (virtualPaymentAvailable()) return;
  const error = new Error('当前微信版本暂不支持支付，请升级微信后重试');
  error.code = 'VIRTUAL_PAYMENT_UNSUPPORTED';
  throw error;
}

function loginForPayment() {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
      reject(new Error('暂时无法连接支付服务，请稍后重试'));
      return;
    }
    wx.login({
      success(result) {
        const code = result && typeof result.code === 'string' ? result.code.trim() : '';
        if (code) resolve(code);
        else reject(new Error('登录状态获取失败，请重试'));
      },
      fail() {
        reject(new Error('登录状态获取失败，请重试'));
      }
    });
  });
}

function requestMiniProgramVirtualPayment(payment) {
  assertVirtualPaymentAvailable();
  const parameters = virtualPaymentParameters(payment);
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      signData: parameters.signData,
      paySig: parameters.paySig,
      signature: parameters.signature,
      mode: parameters.mode,
      success: resolve,
      fail: reject
    });
  });
}

function paymentCancelled(error) {
  const code = Number(error && (error.errCode !== undefined ? error.errCode : error.code));
  if (code === -2) return true;
  const message = String(error && (error.errMsg || error.message) || '');
  return /(?:cancel|canceled|cancelled|用户取消|取消支付)/i.test(message);
}

function paymentFailureMessage(error) {
  if (error && error.code === 'VIRTUAL_PAYMENT_UNSUPPORTED') return error.message;
  if (error && error.code === 'PAYMENT_STATE_UNAVAILABLE') return error.message;
  const code = Number(error && (error.errCode !== undefined ? error.errCode : error.code));
  if (code === -15007) return '登录状态已过期，请重新支付';
  if (code === -4 || code === -15017) return '当前支付暂不可用，请稍后重试';
  if (error && /^登录状态/.test(error.message || '')) return error.message;
  return '支付暂时无法完成，请稍后重试';
}

function rememberPendingMembershipOrder(orderId) {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) throw new Error('支付订单信息无效，请重新发起');
  try {
    wx.setStorageSync(PENDING_MEMBERSHIP_ORDER_KEY, normalizedOrderId);
  } catch (cause) {
    const error = new Error('当前设备状态异常，请重试');
    error.code = 'PAYMENT_STATE_UNAVAILABLE';
    throw error;
  }
}

function pendingMembershipOrderId() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return '';
  try {
    const stored = wx.getStorageSync(PENDING_MEMBERSHIP_ORDER_KEY);
    const orderId = stored && typeof stored === 'object' ? stored.orderId : stored;
    return typeof orderId === 'string' ? orderId.trim() : '';
  } catch (error) {
    return '';
  }
}

function forgetPendingMembershipOrder(orderId) {
  if (typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') return false;
  const expectedOrderId = String(orderId || '').trim();
  if (expectedOrderId && pendingMembershipOrderId() !== expectedOrderId) return false;
  try {
    wx.removeStorageSync(PENDING_MEMBERSHIP_ORDER_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function virtualPaymentAvailable() {
  if (typeof wx === 'undefined' || typeof wx.requestVirtualPayment !== 'function') return false;
  const sdkVersion = currentSdkVersion();
  if (sdkVersion && compareVersions(sdkVersion, MINIMUM_VIRTUAL_PAYMENT_SDK) >= 0) return true;
  try {
    return typeof wx.canIUse === 'function' && wx.canIUse('requestVirtualPayment');
  } catch (error) {
    return false;
  }
}

function virtualPaymentParameters(payment) {
  const source = payment && typeof payment === 'object' ? payment : {};
  const parameters = {
    signData: source.signData,
    paySig: source.paySig,
    signature: source.signature,
    mode: source.mode
  };
  if (!parameters.signData || typeof parameters.signData !== 'string'
    || !parameters.paySig || typeof parameters.paySig !== 'string'
    || !parameters.signature || typeof parameters.signature !== 'string'
    || !parameters.mode || typeof parameters.mode !== 'string') {
    const error = new Error('支付订单信息无效，请重新发起');
    error.code = 'INVALID_VIRTUAL_PAYMENT';
    throw error;
  }
  return parameters;
}

function currentSdkVersion() {
  if (typeof wx.getSystemInfoSync !== 'function') return '';
  try {
    const system = wx.getSystemInfoSync();
    return system && typeof system.SDKVersion === 'string' ? system.SDKVersion : '';
  } catch (error) {
    return '';
  }
}

function compareVersions(left, right) {
  const leftParts = String(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

module.exports = {
  assertVirtualPaymentAvailable,
  loginForPayment,
  requestMiniProgramVirtualPayment,
  paymentCancelled,
  paymentFailureMessage,
  rememberPendingMembershipOrder,
  pendingMembershipOrderId,
  forgetPendingMembershipOrder,
  virtualPaymentAvailable
};
