const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertVirtualPaymentAvailable,
  loginForPayment,
  requestMiniProgramVirtualPayment,
  paymentCancelled,
  rememberPendingMembershipOrder,
  pendingMembershipOrderId,
  forgetPendingMembershipOrder,
  virtualPaymentAvailable
} = require('../features/billing/payment.js');
const {
  createMembershipPayment
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
