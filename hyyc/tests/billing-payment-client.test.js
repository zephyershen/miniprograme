const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertVirtualPaymentAvailable,
  loginForPayment,
  requestMiniProgramVirtualPayment,
  paymentCancelled,
  paymentFailureMessage,
  virtualPaymentFailureDiagnostic,
  rememberPendingMembershipOrder,
  pendingMembershipOrderId,
  forgetPendingMembershipOrder,
  virtualPaymentAvailable
} = require('../features/billing/payment.js');
const {
  createMembershipPayment,
  reportMembershipPaymentFailure
} = require('../features/billing/api.js');
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
    [-15013, '商品价格配置不一致'],
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
    '支付暂时无法完成，请稍后重试'
  );
});

test('builds a strict non-sensitive diagnostic only for official payment errors', () => {
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
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  );
  assert.equal(virtualPaymentFailureDiagnostic({ errCode: -99999 }), null);
});

test('gets a fresh login code before a payment order is created', async () => {
  global.wx = supportedWx({
    login(options) {
      options.success({ code: ' temporary-code ' });
    }
  });
  assert.equal(await loginForPayment(), 'temporary-code');
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
  assert.equal(forgetPendingMembershipOrder('MP-other'), false);
  assert.equal(pendingMembershipOrderId(), 'MP202607190001');
  assert.equal(forgetPendingMembershipOrder('MP202607190001'), true);
  assert.equal(pendingMembershipOrderId(), '');
});

test('fails closed when the product gate or runtime environment is not verified', async () => {
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
        return { result: { ok: true, data: { order: { id: 'order' } } } };
      }
    }
  });

  assert.equal(
    (await loadBillingPlans({ force: true, access: enabledAccess, wxApi: global.wx })).available,
    true
  );
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
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  });
});
