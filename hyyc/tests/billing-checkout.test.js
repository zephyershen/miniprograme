const test = require('node:test');
const assert = require('node:assert/strict');

function installModuleMock(request, exports) {
  const filename = require.resolve(request);
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports
  };
  return () => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  };
}

function loadCheckout(api) {
  const restores = [
    installModuleMock('../features/billing/api', api),
    installModuleMock('../features/account/wechat-login', {
      requestWechatLoginCode: async () => 'fresh-login-code'
    })
  ];
  const filename = require.resolve('../features/billing/checkout');
  const previous = require.cache[filename];
  delete require.cache[filename];
  let checkout;
  try {
    checkout = require(filename);
  } finally {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
    restores.reverse().forEach((restore) => restore());
  }
  return checkout;
}

function installPaymentWx(events, paymentError = null) {
  const storage = new Map();
  const previous = global.wx;
  global.wx = {
    canIUse: (capability) => capability === 'requestVirtualPayment',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getDeviceInfo: () => ({ platform: 'ios' }),
    getSystemInfoSync: () => ({ SDKVersion: '3.8.12', platform: 'ios' }),
    requestVirtualPayment(options) {
      events.push('cashier');
      if (paymentError) options.fail(paymentError);
      else options.success({ errMsg: 'requestVirtualPayment:ok' });
    },
    setStorageSync(key, value) {
      storage.set(key, value);
      events.push(value && value.cashierCompleted ? 'cashier-complete' : 'remember-order');
    },
    getStorageSync(key) {
      return storage.get(key);
    },
    removeStorageSync(key) {
      storage.delete(key);
    }
  };
  return () => {
    if (previous) global.wx = previous;
    else delete global.wx;
  };
}

const ACCESS = {
  viewer: { role: 'free', cachePartition: 'viewer-partition-a' },
  features: { memberPurchases: true }
};

test('checkout gets a fresh login code only to bind and create the payment order', async () => {
  const events = [];
  const orderId = 'MP202607250101';
  const checkout = loadCheckout({
    async createMembershipPayment(planKey, loginCode, access) {
      events.push(`create:${planKey}:${loginCode}`);
      assert.equal(access, ACCESS);
      return {
        order: { id: orderId, status: 'payment_pending' },
        payment: {
          signData: '{}',
          paySig: 'pay',
          signature: 'user',
          mode: 'short_series_goods'
        }
      };
    },
    async getMembershipOrderStatus(received) {
      events.push(`query:${received}`);
      return { order: { id: orderId, status: 'paid' } };
    },
    async reportMembershipPaymentFailure() {
      throw new Error('must not report');
    }
  });
  const restoreWx = installPaymentWx(events);
  try {
    const result = await checkout.checkoutMembership({
      planKey: 'pro_30d',
      access: ACCESS
    });
    assert.equal(result.order.status, 'paid');
    assert.equal(result.cashierInvoked, true);
    assert.equal(result.cashierCompleted, true);
    assert.equal(result.paymentConfirmed, true);
  } finally {
    restoreWx();
  }

  assert.deepEqual(events, [
    'create:pro_30d:fresh-login-code',
    'remember-order',
    'cashier',
    'cashier-complete',
    `query:${orderId}`
  ]);
});

test('a failed cashier honors a server-confirmed paid order', async () => {
  const events = [];
  const orderId = 'MP202607250102';
  const checkout = loadCheckout({
    async createMembershipPayment() {
      events.push('create');
      return {
        order: { id: orderId, status: 'payment_pending' },
        payment: {
          signData: '{}',
          paySig: 'pay',
          signature: 'user',
          mode: 'short_series_goods'
        }
      };
    },
    async getMembershipOrderStatus() {
      events.push('query-once');
      return { order: { id: orderId, status: 'paid' } };
    },
    async reportMembershipPaymentFailure() {
      events.push('report');
    }
  });
  const restoreWx = installPaymentWx(events, {
    errCode: -15003,
    errMsg: 'requestVirtualPayment:fail'
  });
  try {
    const result = await checkout.checkoutMembership({
      planKey: 'pro_30d',
      access: ACCESS
    });
    assert.equal(result.order.status, 'paid');
    assert.equal(result.paymentConfirmed, true);
  } finally {
    restoreWx();
  }

  assert.equal(events.includes('report'), false);
  assert.equal(events.includes('query-once'), true);
});

test('a failed cashier records only the safe diagnostic after recovery remains unpaid', async () => {
  const events = [];
  const reports = [];
  const orderId = 'MP202607250103';
  const paymentError = {
    errCode: -15013,
    errMsg: 'private price details',
    signature: 'must-not-leak'
  };
  const checkout = loadCheckout({
    async createMembershipPayment() {
      return {
        order: { id: orderId, status: 'payment_pending' },
        payment: {
          signData: '{}',
          paySig: 'pay',
          signature: 'user',
          mode: 'short_series_goods'
        }
      };
    },
    async getMembershipOrderStatus() {
      events.push('query-once');
      throw new Error('not found');
    },
    async reportMembershipPaymentFailure(receivedOrderId, diagnostic) {
      reports.push({ receivedOrderId, diagnostic });
    }
  });
  const restoreWx = installPaymentWx(events, paymentError);
  try {
    await assert.rejects(
      () => checkout.checkoutMembership({
        planKey: 'pro_30d',
        access: ACCESS
      }),
      (error) => error.errCode === paymentError.errCode
        && error.checkoutState
        && error.checkoutState.cashierInvoked === true
    );
  } finally {
    restoreWx();
  }

  assert.equal(reports.length, 1);
  assert.equal(reports[0].receivedOrderId, orderId);
  assert.equal(reports[0].diagnostic.errCode, -15013);
  assert.equal(JSON.stringify(reports).includes('private price'), false);
  assert.equal(JSON.stringify(reports).includes('must-not-leak'), false);
});

test('an order creation failure is marked as pre-cashier', async () => {
  const checkout = loadCheckout({
    async createMembershipPayment() {
      const error = new Error('temporary');
      error.code = 'TEMPORARY_FAILURE';
      throw error;
    }
  });
  const restoreWx = installPaymentWx([]);
  try {
    await assert.rejects(
      () => checkout.checkoutMembership({
        planKey: 'pro_30d',
        access: ACCESS
      }),
      (error) => error.code === 'TEMPORARY_FAILURE'
        && error.checkoutState.cashierInvoked === false
    );
  } finally {
    restoreWx();
  }
});
