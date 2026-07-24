const MINIMUM_VIRTUAL_PAYMENT_SDK = '2.19.2';
const PENDING_MEMBERSHIP_ORDER_KEY = 'billing.pendingMembershipOrder';
const VIRTUAL_PAYMENT_PLATFORMS = new Set([
  'android',
  'devtools',
  'harmony',
  'ios',
  'mac',
  'ohos',
  'unknown',
  'windows'
]);
const OFFICIAL_VIRTUAL_PAYMENT_ERROR_MESSAGES = Object.freeze({
  1001: '支付参数校验失败，请稍后重试',
  '-1': '微信收银台支付失败，请确认当前账号或系统支付方式可用后重试',
  '-2': '已取消支付',
  '-4': '支付被安全保护拦截，请稍后重试',
  '-5': '支付开通状态暂未确认，请稍后重试',
  '-15001': '支付参数校验失败，请稍后重试',
  '-15002': '这笔订单已失效，请重新发起支付',
  '-15003': '支付系统暂时繁忙，请稍后重试',
  '-15004': '支付币种配置异常，请稍后重试',
  '-15005': '登录签名已失效，请重新发起支付',
  '-15006': '支付签名配置异常，请稍后重试',
  '-15007': '登录状态已过期，请重新发起支付',
  '-15008': '商户支付配置尚未完成',
  '-15009': '支付商品尚未发布',
  '-15010': '会员商品尚未发布',
  '-15011': '当前正式版本不能使用沙箱支付',
  '-15012': '支付订单创建失败，请重新发起',
  '-15013': '商品原价与微信后台道具价格不一致，请联系管理员',
  '-15014': '会员商品发布尚未生效，请约 10 分钟后重试',
  '-15016': '支付订单格式异常，请重新发起',
  '-15017': '商户收款功能当前受限，请稍后重试',
  '-15018': '会员商品未通过平台审核',
  '-15019': '商户收款功能当前受限，请稍后重试',
  '-15020': '操作过快，请稍后重试',
  '-15021': '支付请求过于频繁，请稍后重试'
});
const OFFICIAL_VIRTUAL_PAYMENT_ERROR_CODES = new Set(
  Object.keys(OFFICIAL_VIRTUAL_PAYMENT_ERROR_MESSAGES).map(Number)
);
const SAFE_MEMBERSHIP_CHECKOUT_ERROR_MESSAGES = Object.freeze({
  PAYMENT_ACCOUNT_MISMATCH: '当前微信账号校验不一致，请重新登录后再试',
  PAYMENT_LOGIN_FAILED: '微信登录校验失败，请重新登录后再试',
  PAYMENT_LOGIN_REQUIRED: '请先登录当前微信账号',
  PAYMENT_NOT_READY: '会员购买正在开通，请稍后再试',
  PAYMENT_CREATION_IN_PROGRESS: '支付订单正在准备，请稍后重试',
  PAYMENT_CHECKOUT_TIMEOUT: '支付订单准备超时，请稍后重试',
  PAYMENT_PENDING_ORDER_MISMATCH: '已有订单正在确认，请勿重复付款，稍后再试',
  PAYMENT_PENDING_ORDER_BACKLOG: '已有订单正在确认，请勿重复付款，稍后再试',
  TEMPORARY_FAILURE: '会员开通服务暂时不可用，请稍后重试'
});

function currentWxApi() {
  return typeof wx === 'undefined' ? null : wx;
}

function assertVirtualPaymentAvailable(wxApi = currentWxApi()) {
  if (paymentPlatform(wxApi) === 'devtools') {
    const error = new Error('开发者工具模拟器不能发起虚拟支付，请使用微信真机预览或真机调试');
    error.code = 'VIRTUAL_PAYMENT_DEVTOOLS_UNSUPPORTED';
    throw error;
  }
  if (virtualPaymentAvailable(wxApi)) return;
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
  const wxApi = currentWxApi();
  assertVirtualPaymentAvailable(wxApi);
  const parameters = virtualPaymentParameters(payment);
  return new Promise((resolve, reject) => {
    wxApi.requestVirtualPayment({
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
  const code = officialVirtualPaymentErrorCode(error);
  if (code === -2) return true;
  const message = String(error && (error.errMsg || error.message) || '');
  return /(?:cancel|canceled|cancelled|用户取消|取消支付)/i.test(message);
}

function paymentFailureMessage(error) {
  if (error && error.code === 'VIRTUAL_PAYMENT_DEVTOOLS_UNSUPPORTED') return error.message;
  if (error && error.code === 'VIRTUAL_PAYMENT_UNSUPPORTED') return error.message;
  if (error && error.code === 'PAYMENT_STATE_UNAVAILABLE') return error.message;
  if (error && error.code === 'INVALID_VIRTUAL_PAYMENT') return error.message;
  const code = officialVirtualPaymentErrorCode(error);
  if (OFFICIAL_VIRTUAL_PAYMENT_ERROR_MESSAGES[code]) {
    return OFFICIAL_VIRTUAL_PAYMENT_ERROR_MESSAGES[code];
  }
  const rawCode = numericVirtualPaymentErrorCode(error);
  if (rawCode !== null) {
    return `支付暂时无法完成（微信错误码 ${rawCode}），请稍后重试`;
  }
  if (error && /^登录状态/.test(error.message || '')) return error.message;
  if (error && ['PAYMENT_ACCOUNT_MISMATCH', 'PAYMENT_LOGIN_FAILED', 'PAYMENT_LOGIN_REQUIRED']
    .includes(error.code)) return error.message;
  if (paymentPlatform(currentWxApi()) === 'ios') {
    return 'Apple 收银台未完成支付，请确认 iOS、微信版本和中国大陆 App Store 账号后重试';
  }
  return '支付暂时无法完成，请稍后重试';
}

function membershipCheckoutFailureMessage(error) {
  if (error && [
    'VIRTUAL_PAYMENT_DEVTOOLS_UNSUPPORTED',
    'VIRTUAL_PAYMENT_UNSUPPORTED',
    'PAYMENT_STATE_UNAVAILABLE'
  ].includes(error.code)) return error.message;
  if (error && /^登录状态/.test(error.message || '')) return error.message;
  if (error && error.message === '支付订单创建失败') return error.message;
  return SAFE_MEMBERSHIP_CHECKOUT_ERROR_MESSAGES[error && error.code]
    || '会员开通服务暂时不可用，请稍后重试';
}

function paymentConfirmationFailureMessage() {
  return '会员开通确认异常，请勿重复付款，稍后下拉刷新';
}

function officialVirtualPaymentErrorCode(error) {
  const code = numericVirtualPaymentErrorCode(error);
  return Number.isInteger(code) && OFFICIAL_VIRTUAL_PAYMENT_ERROR_CODES.has(code)
    ? code
    : null;
}

function numericVirtualPaymentErrorCode(error) {
  const candidates = error && [
    error.errCode,
    error.err_code,
    error.errno,
    error.code
  ] || [];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const code = Number(candidate);
    if (Number.isInteger(code) && code >= -999999 && code <= 999999) return code;
  }
  const message = String(error && (error.errMsg || error.message) || '');
  const labelled = message.match(/(?:err[_\s-]?code|errno)\s*[:=]?\s*(-?\d{1,6})/i);
  if (!labelled) return null;
  const code = Number(labelled[1]);
  return Number.isInteger(code) && code >= -999999 && code <= 999999 ? code : null;
}

function virtualPaymentFailureDiagnostic(error, wxApi = currentWxApi()) {
  const errCode = numericVirtualPaymentErrorCode(error);
  const failureKind = errCode === null
    ? 'no_numeric_code'
    : (OFFICIAL_VIRTUAL_PAYMENT_ERROR_CODES.has(errCode)
      ? 'official_code'
      : 'unrecognized_numeric_code');
  return {
    ...(errCode === null ? {} : { errCode }),
    failureKind,
    platform: paymentPlatform(wxApi),
    envVersion: paymentEnvironmentVersion(wxApi),
    sdkVersion: currentSdkVersion(wxApi)
  };
}

function rememberPendingMembershipOrder(orderId) {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) throw new Error('支付订单信息无效，请重新发起');
  try {
    wx.setStorageSync(PENDING_MEMBERSHIP_ORDER_KEY, {
      version: 1,
      orderId: normalizedOrderId,
      cashierCompleted: false
    });
  } catch (cause) {
    const error = new Error('当前设备状态异常，请重试');
    error.code = 'PAYMENT_STATE_UNAVAILABLE';
    throw error;
  }
}

function pendingMembershipOrderState() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null;
  try {
    const stored = wx.getStorageSync(PENDING_MEMBERSHIP_ORDER_KEY);
    const orderId = stored && typeof stored === 'object' ? stored.orderId : stored;
    const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : '';
    if (!normalizedOrderId) return null;
    return {
      orderId: normalizedOrderId,
      cashierCompleted: Boolean(
        stored && typeof stored === 'object' && stored.cashierCompleted === true
      )
    };
  } catch (error) {
    return null;
  }
}

function pendingMembershipOrderId() {
  const state = pendingMembershipOrderState();
  return state && state.orderId || '';
}

function pendingMembershipCashierCompleted(orderId) {
  const expectedOrderId = String(orderId || '').trim();
  const state = pendingMembershipOrderState();
  return Boolean(state
    && (!expectedOrderId || state.orderId === expectedOrderId)
    && state.cashierCompleted);
}

function markPendingMembershipCashierCompleted(orderId) {
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false;
  const expectedOrderId = String(orderId || '').trim();
  const state = pendingMembershipOrderState();
  if (!state || !expectedOrderId || state.orderId !== expectedOrderId) return false;
  try {
    wx.setStorageSync(PENDING_MEMBERSHIP_ORDER_KEY, {
      version: 1,
      orderId: expectedOrderId,
      cashierCompleted: true
    });
    return true;
  } catch (error) {
    return false;
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

function virtualPaymentAvailable(wxApi = currentWxApi()) {
  if (!wxApi || typeof wxApi.requestVirtualPayment !== 'function') return false;
  const sdkVersion = currentSdkVersion(wxApi);
  if (sdkVersion && compareVersions(sdkVersion, MINIMUM_VIRTUAL_PAYMENT_SDK) >= 0) return true;
  try {
    return typeof wxApi.canIUse === 'function' && wxApi.canIUse('requestVirtualPayment');
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

function currentSdkVersion(wxApi = currentWxApi()) {
  if (!wxApi || typeof wxApi.getSystemInfoSync !== 'function') return '';
  try {
    const system = wxApi.getSystemInfoSync();
    return system && typeof system.SDKVersion === 'string' ? system.SDKVersion : '';
  } catch (error) {
    return '';
  }
}

function paymentPlatform(wxApi = currentWxApi()) {
  if (!wxApi) return 'unknown';
  let value = '';
  try {
    const device = typeof wxApi.getDeviceInfo === 'function' && wxApi.getDeviceInfo();
    value = device && device.platform;
  } catch (error) {
    value = '';
  }
  if (!value) {
    try {
      const system = typeof wxApi.getSystemInfoSync === 'function' && wxApi.getSystemInfoSync();
      value = system && system.platform;
    } catch (error) {
      value = '';
    }
  }
  const normalized = String(value || '').trim().toLowerCase();
  return VIRTUAL_PAYMENT_PLATFORMS.has(normalized) ? normalized : 'unknown';
}

function paymentEnvironmentVersion(wxApi = currentWxApi()) {
  try {
    const account = wxApi
      && typeof wxApi.getAccountInfoSync === 'function'
      && wxApi.getAccountInfoSync();
    const value = account && account.miniProgram && account.miniProgram.envVersion;
    return ['develop', 'trial', 'release'].includes(value) ? value : 'unknown';
  } catch (error) {
    return 'unknown';
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
  membershipCheckoutFailureMessage,
  paymentConfirmationFailureMessage,
  officialVirtualPaymentErrorCode,
  virtualPaymentFailureDiagnostic,
  rememberPendingMembershipOrder,
  pendingMembershipOrderId,
  pendingMembershipCashierCompleted,
  markPendingMembershipCashierCompleted,
  forgetPendingMembershipOrder,
  virtualPaymentAvailable,
  paymentPlatform,
  paymentEnvironmentVersion
};
