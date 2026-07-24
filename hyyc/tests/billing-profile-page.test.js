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

function loadProfilePage(billingApi) {
  const mocks = [
    ['../features/membership/session', {
      refreshMembershipAccess: async () => ({}),
      changeMembershipRolePreview: async () => ({})
    }],
    ['../features/membership/presentation', {
      membershipPresentation: () => ({})
    }],
    ['../features/user-profile/session', {
      loadUserProfile: async () => ({})
    }],
    ['../features/user-profile/model', {
      decorateUserProfile: () => ({})
    }],
    ['../features/billing/api', billingApi],
    ['../features/billing/session', {
      loadBillingPlans: async () => ({})
    }],
    ['../features/billing/recovery', {
      recoverPendingMembershipOrder: async () => null
    }]
  ];
  const restores = mocks.map(([request, exports]) => installModuleMock(request, exports));
  const filename = require.resolve('../pages/profile/index');
  const previousModule = require.cache[filename];
  const previousPage = global.Page;
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[filename];
  try {
    require(filename);
  } finally {
    if (previousModule) require.cache[filename] = previousModule;
    else delete require.cache[filename];
    restores.reverse().forEach((restore) => restore());
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return definition;
}

function paymentWx(events, paymentError, { completeProfile = false } = {}) {
  const storage = new Map();
  return {
    canIUse: (capability) => capability === 'requestVirtualPayment',
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    getDeviceInfo: () => ({ platform: 'ios' }),
    getSystemInfoSync: () => ({ SDKVersion: '3.8.12', platform: 'ios' }),
    login(options) {
      events.push('login');
      options.success({ code: 'login-code' });
    },
    showModal(options) {
      events.push('prompt-profile');
      options.success({ confirm: completeProfile, cancel: !completeProfile });
    },
    navigateTo(options) {
      events.push(`navigate:${options.url}`);
    },
    requestVirtualPayment(options) {
      events.push('request-payment');
      options.fail(paymentError);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
      events.push(key.includes('account_verification') ? 'remember-account' : 'remember-order');
    },
    getStorageSync(key) {
      return storage.get(key);
    },
    removeStorageSync(key) {
      storage.delete(key);
      events.push('forget-order');
    },
    showToast(options) {
      events.push(`toast:${options.title}`);
    }
  };
}

function purchaseContext(page, events, { accountVerified = true } = {}) {
  return {
    data: {
      billing: {
        purchasing: false,
        available: true,
        accountVerified,
        plan: {
          key: 'pro_30d',
          priceLabel: '¥5.9',
          durationDays: 30
        }
      },
      userProfile: {
        isComplete: false,
        reviewPending: false
      }
    },
    membershipAccess: {
      viewer: { role: 'free', cachePartition: 'viewer-partition-a' },
      features: { memberPurchases: true }
    },
    setData(patch) {
      if (Object.prototype.hasOwnProperty.call(patch, 'billing.purchasing')) {
        this.data.billing.purchasing = patch['billing.purchasing'];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'billing.accountVerified')) {
        this.data.billing.accountVerified = patch['billing.accountVerified'];
      }
    },
    queryMembershipOrderOnce: page.queryMembershipOrderOnce,
    recordMembershipPaymentFailure: page.recordMembershipPaymentFailure,
    promptProfileSetupAfterLogin: page.promptProfileSetupAfterLogin,
    confirmMembershipOrder() {
      events.push('confirm-loop');
      throw new Error('confirmation loop must not run after recovered payment');
    },
    async loadMembership() {
      events.push('refresh-membership');
    }
  };
}

test('queries once after a cashier failure and honors a server-confirmed paid order', async () => {
  const events = [];
  const paymentError = { errCode: -15003, errMsg: 'must-not-be-shown' };
  const orderId = 'MP20260724081033aaaaaaaaaaaaaaaa';
  const page = loadProfilePage({
    async createMembershipPayment() {
      events.push('create-order');
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
    async getMembershipOrderStatus(receivedOrderId) {
      events.push('query-once');
      assert.equal(receivedOrderId, orderId);
      return { order: { id: orderId, status: 'paid' } };
    },
    async reportMembershipPaymentFailure() {
      events.push('report-failure');
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, paymentError);
  try {
    await page.purchaseMembership.call(purchaseContext(page, events));
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'request-payment',
    'query-once',
    'forget-order',
    'refresh-membership',
    'toast:Pro 已开通'
  ]);
});

test('records a strict diagnostic only after the one-shot recovery remains unpaid', async () => {
  const events = [];
  const reports = [];
  const paymentError = {
    errCode: -15013,
    errMsg: 'price details must not leave the device',
    signature: 'must-not-leak'
  };
  const orderId = 'MP20260724081033bbbbbbbbbbbbbbbb';
  const page = loadProfilePage({
    async createMembershipPayment() {
      events.push('create-order');
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
      throw new Error('provider order not found');
    },
    async reportMembershipPaymentFailure(receivedOrderId, diagnostic) {
      events.push('report-failure');
      reports.push({ orderId: receivedOrderId, diagnostic });
      return { recorded: true };
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, paymentError);
  try {
    await page.purchaseMembership.call(purchaseContext(page, events));
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'request-payment',
    'query-once',
    'report-failure',
    'toast:商品原价与微信后台道具价格不一致，请联系管理员'
  ]);
  assert.deepEqual(reports, [{
    orderId,
    diagnostic: {
      errCode: -15013,
      failureKind: 'official_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }
  }]);
  assert.equal(JSON.stringify(reports).includes('price details'), false);
  assert.equal(JSON.stringify(reports).includes('signature'), false);
});

test('uses the first click only to verify the current account and offer optional profile setup', async () => {
  const events = [];
  const page = loadProfilePage({
    async verifyMembershipAccount(loginCode) {
      events.push('verify-account');
      assert.equal(loginCode, 'login-code');
      return { verified: true };
    },
    async createMembershipPayment() {
      events.push('create-order');
      throw new Error('must not create an order');
    },
    async getMembershipOrderStatus() {
      throw new Error('must not query an order');
    },
    async reportMembershipPaymentFailure() {
      throw new Error('must not report a failure');
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, { accountVerified: false });
  try {
    await page.purchaseMembership.call(context);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'verify-account',
    'remember-account',
    'prompt-profile',
    'toast:请再次点击订阅并支付'
  ]);
  assert.equal(context.data.billing.accountVerified, true);
  assert.equal(context.data.billing.purchasing, false);
});
