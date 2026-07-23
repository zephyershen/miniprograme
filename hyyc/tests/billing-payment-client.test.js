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
