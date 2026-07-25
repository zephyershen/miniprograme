const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
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
  virtualPaymentAvailable
} = require('../features/billing/payment.js');
const {
  verifyMembershipAccount,
  createMembershipPayment,
  reportMembershipPaymentFailure
} = require('../features/billing/api.js');
const {
  STORAGE_KEY: ACCOUNT_VERIFICATION_STORAGE_KEY,
  accountPartition,
  membershipAccountVerified,
  rememberMembershipAccountVerification,
  forgetMembershipAccountVerification
} = require('../features/billing/account-session.js');
const {
  loadBillingPlans
} = require('../features/billing/session.js');

const originalWx = global.wx;

afterEach(() => {
  if (originalWx === undefined) delete global.wx;
  else global.wx = originalWx;
});

function supportedWx(overrides = {}) {
  return {
    canIUse: (capability) => capability === 'requestVirtualPayment',
    getSystemInfoSync: () => ({ SDKVersion: '3.8.12' }),
    requestVirtualPayment: () => {},
    ...overrides
  };
}

test('checks the virtual-payment capability and minimum base-library version', () => {
  global.wx = supportedWx();
  assert.equal(virtualPaymentAvailable(), true);

  global.wx = supportedWx({
    getSystemInfoSync: () => ({ SDKVersion: '2.19.1' }),
    canIUse: () => false
  });
  assert.equal(virtualPaymentAvailable(), false);
  assert.throws(() => assertVirtualPaymentAvailable(), /升级微信/);

  global.wx = supportedWx({ getSystemInfoSync: () => ({ SDKVersion: '2.19.1' }) });
  assert.equal(virtualPaymentAvailable(), true);
});

test('rejects the developer-tools simulator with a true-device payment instruction', () => {
  global.wx = supportedWx({
    getDeviceInfo: () => ({ platform: 'devtools' })
  });
  assert.throws(
    () => assertVirtualPaymentAvailable(),
    (error) => error
      && error.code === 'VIRTUAL_PAYMENT_DEVTOOLS_UNSUPPORTED'
      && /真机预览或真机调试/.test(error.message)
  );
});

test('maps every documented virtual-payment error code to an actionable message', () => {
  const expectedMessages = new Map([
    [1001, '参数校验'],
    [-1, '支付失败'],
    [-2, '取消支付'],
    [-4, '安全保护'],
    [-5, '开通状态'],
    [-15001, '参数校验'],
    [-15002, '订单已失效'],
    [-15003, '系统暂时繁忙'],
    [-15004, '币种配置'],
    [-15005, '登录签名'],
    [-15006, '支付签名'],
    [-15007, '登录状态'],
    [-15008, '商户支付配置'],
    [-15009, '支付商品尚未发布'],
    [-15010, '会员商品尚未发布'],
    [-15011, '正式版本不能使用沙箱'],
    [-15012, '订单创建失败'],
    [-15013, '商品原价与微信后台道具价格不一致，请联系管理员'],
    [-15014, '约 10 分钟'],
    [-15016, '订单格式'],
    [-15017, '收款功能当前受限'],
    [-15018, '未通过平台审核'],
    [-15019, '收款功能当前受限'],
    [-15020, '操作过快'],
    [-15021, '请求过于频繁']
  ]);
  expectedMessages.forEach((fragment, errCode) => {
    assert.match(paymentFailureMessage({ errCode }), new RegExp(fragment));
  });
  assert.equal(
    paymentFailureMessage({ errCode: -99999 }),
    '支付暂时无法完成（微信错误码 -99999），请稍后重试'
  );
});

test('builds a strict non-sensitive diagnostic for coded and code-less payment errors', () => {
  global.wx = supportedWx({
    getDeviceInfo: () => ({ platform: 'ios', model: 'must-not-leak' }),
    getAccountInfoSync: () => ({
      miniProgram: { envVersion: 'develop', appId: 'must-not-leak' }
    })
  });
  assert.deepEqual(
    virtualPaymentFailureDiagnostic({
      errCode: -15013,
      errMsg: 'must-not-leak',
      signature: 'must-not-leak'
    }),
    {
      errCode: -15013,
      failureKind: 'official_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  );
  assert.deepEqual(
    virtualPaymentFailureDiagnostic({ err_code: -99999 }),
    {
      errCode: -99999,
      failureKind: 'unrecognized_numeric_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  );
  assert.deepEqual(
    virtualPaymentFailureDiagnostic({ errMsg: 'requestVirtualPayment:fail 支付无法完成' }),
    {
      failureKind: 'no_numeric_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  );
  assert.equal(
    officialVirtualPaymentErrorCode({ errMsg: 'requestVirtualPayment:fail err_code=-15013' }),
    -15013
  );
});

test('gets a fresh login code before a payment order is created', async () => {
  global.wx = supportedWx({
    login(options) {
      options.success({ code: ' temporary-code ' });
    }
  });
  assert.equal(await loginForPayment(), 'temporary-code');
});

test('remembers the explicit account step only for the current viewer partition', () => {
  const storage = new Map();
  global.wx = supportedWx({
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); }
  });
  const first = { viewer: { cachePartition: 'viewer-partition-a' } };
  const second = { viewer: { cachePartition: 'viewer-partition-b' } };
  assert.equal(accountPartition(first), 'viewer-partition-a');
  assert.equal(membershipAccountVerified(first), false);
  assert.equal(rememberMembershipAccountVerification(first), true);
  assert.equal(membershipAccountVerified(first), true);
  assert.equal(membershipAccountVerified(second), false);
  assert.equal(storage.get(ACCOUNT_VERIFICATION_STORAGE_KEY).verified, true);
  assert.equal(forgetMembershipAccountVerification(second), false);
  assert.equal(membershipAccountVerified(first), true);
  assert.equal(forgetMembershipAccountVerification(first), true);
  assert.equal(membershipAccountVerified(first), false);
  assert.equal(forgetMembershipAccountVerification(first), true);
});

test('keeps the account step intact when local logout cannot remove it', () => {
  const storage = new Map();
  global.wx = supportedWx({
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync() { throw new Error('storage unavailable'); }
  });
  const access = { viewer: { cachePartition: 'viewer-partition-a' } };
  assert.equal(rememberMembershipAccountVerification(access), true);
  assert.equal(forgetMembershipAccountVerification(access), false);
  assert.equal(membershipAccountVerified(access), true);
});

test('gives an actionable Apple cashier hint for a code-less iOS failure', () => {
  global.wx = supportedWx({
    getDeviceInfo: () => ({ platform: 'ios' })
  });
  assert.match(
    paymentFailureMessage({ errMsg: 'requestVirtualPayment:fail 支付无法完成' }),
    /Apple 收银台.*中国大陆 App Store/
  );
});

test('never mistakes a server failure for an Apple cashier failure', () => {
  global.wx = supportedWx({
    getDeviceInfo: () => ({ platform: 'ios' })
  });
  assert.equal(
    membershipCheckoutFailureMessage({
      code: 'TEMPORARY_FAILURE',
      message: '支付服务暂时不可用，请稍后重试'
    }),
    '会员开通服务暂时不可用，请稍后重试'
  );
  assert.equal(
    membershipCheckoutFailureMessage({
      code: 'FUNCTIONS_EXECUTE_FAIL',
      message: 'internal requestId must-not-leak'
    }),
    '会员开通服务暂时不可用，请稍后重试'
  );
  assert.equal(
    membershipCheckoutFailureMessage({
      code: 'PAYMENT_CREATION_IN_PROGRESS',
      message: 'must-not-leak'
    }),
    '支付订单正在准备，请稍后重试'
  );
  assert.equal(
    membershipCheckoutFailureMessage({
      code: 'PAYMENT_CHECKOUT_TIMEOUT',
      message: 'must-not-leak'
    }),
    '支付订单准备超时，请稍后重试'
  );
  assert.equal(
    membershipCheckoutFailureMessage({
      code: 'PAYMENT_PENDING_ORDER_MISMATCH',
      message: 'must-not-leak'
    }),
    '已有订单正在确认，请勿重复付款，稍后再试'
  );
  assert.equal(
    paymentConfirmationFailureMessage({
      code: 'PAYMENT_QUERY_FAILED',
      message: '微信支付结果暂时无法确认'
    }),
    '会员开通确认异常，请勿重复付款，稍后下拉刷新'
  );
});

test('passes only the signed virtual-payment fields to the WeChat cashier', async () => {
  let received;
  global.wx = supportedWx({
    requestVirtualPayment(options) {
      received = options;
      options.success({ errMsg: 'requestVirtualPayment:ok' });
    }
  });

  await requestMiniProgramVirtualPayment({
    signData: '{"outTradeNo":"MP1"}',
    paySig: 'pay-signature',
    signature: 'user-signature',
    mode: 'short_series_goods',
    ignored: 'must-not-leak'
  });

  assert.deepEqual({
    signData: received.signData,
    paySig: received.paySig,
    signature: received.signature,
    mode: received.mode
  }, {
    signData: '{"outTradeNo":"MP1"}',
    paySig: 'pay-signature',
    signature: 'user-signature',
    mode: 'short_series_goods'
  });
  assert.equal(received.ignored, undefined);
});

test('recognizes both the documented cancel code and cancel messages', () => {
  assert.equal(paymentCancelled({ errCode: -2 }), true);
  assert.equal(paymentCancelled({ errMsg: 'requestVirtualPayment:fail cancel' }), true);
  assert.equal(paymentCancelled({ errCode: -15003, errMsg: 'system error' }), false);
});

test('keeps an order pending until the matching server-confirmed order is cleared', () => {
  const storage = new Map();
  global.wx = supportedWx({
    setStorageSync(key, value) { storage.set(key, value); },
    getStorageSync(key) { return storage.get(key); },
    removeStorageSync(key) { storage.delete(key); }
  });

  rememberPendingMembershipOrder('MP202607190001');
  assert.equal(pendingMembershipOrderId(), 'MP202607190001');
  assert.equal(pendingMembershipCashierCompleted('MP202607190001'), false);
  assert.equal(markPendingMembershipCashierCompleted('MP-other'), false);
  assert.equal(markPendingMembershipCashierCompleted('MP202607190001'), true);
  assert.equal(pendingMembershipCashierCompleted('MP202607190001'), true);
  assert.equal(forgetPendingMembershipOrder('MP-other'), false);
  assert.equal(pendingMembershipOrderId(), 'MP202607190001');
  assert.equal(forgetPendingMembershipOrder('MP202607190001'), true);
  assert.equal(pendingMembershipOrderId(), '');
});

test('keeps purchase gates strict while account login remains independent of the product gate', async () => {
  const enabledAccess = {
    viewer: { role: 'free' },
    features: { memberPurchases: true }
  };
  const disabledAccess = {
    viewer: { role: 'free' },
    features: { memberPurchases: false }
  };
  assert.throws(
    () => createMembershipPayment('pro_30d', 'login-code', disabledAccess),
    (error) => error && error.code === 'PAYMENT_NOT_READY'
  );
  const calls = [];
  global.wx = supportedWx({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    cloud: {
      async callFunction(request) {
        calls.push(request);
        return {
          result: {
            ok: true,
            data: { verified: true }
          }
        };
      }
    }
  });
  assert.deepEqual(
    await verifyMembershipAccount('login-code', disabledAccess),
    { verified: true }
  );
  assert.equal(calls[0].data.action, 'verifyAccount');

  global.wx = supportedWx({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'unknown-build' } }),
    cloud: {
      async callFunction() {
        throw new Error('must not call cloud');
      }
    }
  });
  await assert.rejects(
    () => createMembershipPayment('pro_30d', 'login-code', enabledAccess),
    (error) => error && error.code === 'NON_RELEASE_MUTATION_BLOCKED'
  );
  await assert.rejects(
    () => verifyMembershipAccount('login-code', enabledAccess),
    (error) => error && error.code === 'NON_RELEASE_MUTATION_BLOCKED'
  );
});

test('shows and invokes purchasing only when product, provider and runtime gates all pass', async () => {
  const enabledAccess = {
    viewer: { role: 'free' },
    features: { memberPurchases: true }
  };
  const calls = [];
  global.wx = supportedWx({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    cloud: {
      async callFunction(request) {
        calls.push(request);
        if (request.data.action === 'plans') {
          return {
            result: {
              ok: true,
              data: {
                available: true,
                plan: { key: 'pro_30d', durationDays: 30, priceCents: 590 }
              }
            }
          };
        }
        if (request.data.action === 'verifyAccount') {
          return { result: { ok: true, data: { verified: true } } };
        }
        return { result: { ok: true, data: { order: { id: 'order' } } } };
      }
    }
  });

  assert.equal(
    (await loadBillingPlans({ force: true, access: enabledAccess, wxApi: global.wx })).available,
    true
  );
  assert.deepEqual(
    await verifyMembershipAccount('login-code', enabledAccess),
    { verified: true }
  );
  assert.deepEqual(calls.at(-1), {
    name: 'membershipBilling',
    data: {
      action: 'verifyAccount',
      loginCode: 'login-code'
    }
  });
  assert.deepEqual(
    await createMembershipPayment('pro_30d', 'login-code', enabledAccess),
    { order: { id: 'order' } }
  );
  assert.deepEqual(calls.at(-1), {
    name: 'membershipBilling',
    data: {
      action: 'createPayment',
      planKey: 'pro_30d',
      loginCode: 'login-code'
    }
  });

  global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'unsupported' } });
  assert.equal(
    (await loadBillingPlans({ force: true, access: enabledAccess, wxApi: global.wx })).available,
    false
  );
});

test('reports only the owner-bound payment diagnostic allowlist fields', async () => {
  let received;
  global.wx = supportedWx({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    cloud: {
      async callFunction(request) {
        received = request;
        return { result: { ok: true, data: { recorded: true } } };
      }
    }
  });
  assert.deepEqual(
    await reportMembershipPaymentFailure('MP20260724081033aaaaaaaaaaaaaaaa', {
      errCode: -15013,
      failureKind: 'official_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12',
      errMsg: 'must-not-leak',
      openId: 'must-not-leak',
      signature: 'must-not-leak'
    }),
    { recorded: true }
  );
  assert.deepEqual(received, {
    name: 'membershipBilling',
    data: {
      action: 'paymentFailure',
      orderId: 'MP20260724081033aaaaaaaaaaaaaaaa',
      errCode: -15013,
      failureKind: 'official_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  });

  await reportMembershipPaymentFailure('MP20260724081033bbbbbbbbbbbbbbbb', {
    failureKind: 'no_numeric_code',
    platform: 'ios',
    envVersion: 'develop',
    sdkVersion: '3.8.12',
    errMsg: 'must-not-leak'
  });
  assert.deepEqual(received, {
    name: 'membershipBilling',
    data: {
      action: 'paymentFailure',
      orderId: 'MP20260724081033bbbbbbbbbbbbbbbb',
      failureKind: 'no_numeric_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  });
});
