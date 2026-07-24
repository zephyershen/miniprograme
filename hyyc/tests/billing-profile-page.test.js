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

function loadProfilePage(billingApi, billingSession = {
  loadBillingPlans: async () => ({})
}) {
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
    ['../features/billing/session', billingSession],
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
      if (paymentError) options.fail(paymentError);
      else options.success({ errMsg: 'requestVirtualPayment:ok' });
    },
    setStorageSync(key, value) {
      storage.set(key, value);
      if (key.includes('account_verification')) events.push('remember-account');
      else if (!value || value.cashierCompleted !== true) events.push('remember-order');
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

function purchaseContext(page, events, {
  accountVerified = true,
  confirmMembershipOrder = null,
  loadMembership = null,
  purchaseMode = 'subscribe'
} = {}) {
  return {
    data: {
      accountAuthenticating: false,
      accountLoggingOut: false,
      membership: { purchaseMode },
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
      if (Object.prototype.hasOwnProperty.call(patch, 'accountAuthenticating')) {
        this.data.accountAuthenticating = patch.accountAuthenticating;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'accountLoggingOut')) {
        this.data.accountLoggingOut = patch.accountLoggingOut;
      }
    },
    queryMembershipOrderOnce: page.queryMembershipOrderOnce,
    applyMembershipOrderResult: page.applyMembershipOrderResult,
    resumePendingMembershipPurchase: page.resumePendingMembershipPurchase,
    recordMembershipPaymentFailure: page.recordMembershipPaymentFailure,
    promptProfileSetupAfterLogin: page.promptProfileSetupAfterLogin,
    loginWechatAccount: page.loginWechatAccount,
    confirmMembershipOrder: confirmMembershipOrder || (() => {
      events.push('confirm-loop');
      throw new Error('confirmation loop must not run after recovered payment');
    }),
    loadMembership: loadMembership || (async () => {
      events.push('refresh-membership');
      return { viewer: { role: 'member' } };
    })
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
    'refresh-membership',
    'forget-order',
    'toast:Pro 已开通'
  ]);
});

test('labels a paid result as renewal when an active member started checkout', async () => {
  const events = [];
  const orderId = 'MP20260724081033a1a1a1a1a1a1a1a1';
  const page = loadProfilePage({
    async getMembershipOrderStatus() {
      throw new Error('not expected');
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    purchaseMode: 'renew',
    loadMembership: async () => {
      events.push('refresh-membership');
      return {
        viewer: {
          role: 'member',
          membershipStatus: 'active',
          currentPeriodEnd: '2026-10-22T08:00:00.000Z'
        }
      };
    }
  });
  try {
    const result = await page.applyMembershipOrderResult.call(
      context,
      orderId,
      { id: orderId, status: 'paid' }
    );
    assert.equal(result, 'paid');
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'refresh-membership',
    'toast:续费成功'
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

test('keeps a successful cashier order pending without inviting another payment', async () => {
  const events = [];
  const orderId = 'MP20260724081033cccccccccccccccc';
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
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    confirmMembershipOrder: async () => {
      events.push('confirm-loop');
      return { id: orderId, status: 'payment_pending' };
    }
  });
  try {
    await page.purchaseMembership.call(context);
    await page.purchaseMembership.call(context);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'request-payment',
    'confirm-loop',
    'toast:支付结果确认中，请勿重复付款，稍后下拉刷新',
    'confirm-loop',
    'toast:支付结果确认中，请勿重复付款，稍后下拉刷新'
  ]);
  assert.equal(events.filter((event) => event === 'create-order').length, 1);
  assert.equal(events.filter((event) => event === 'request-payment').length, 1);
  assert.equal(events.some((event) => event.includes('Apple')), false);
  assert.equal(events.includes('forget-order'), false);
});

test('synchronously blocks a concurrent double click before login or order creation', async () => {
  const events = [];
  const orderId = 'MP20260724081033abababababababab';
  let releaseCreation;
  const creationBarrier = new Promise((resolve) => {
    releaseCreation = resolve;
  });
  const page = loadProfilePage({
    async createMembershipPayment() {
      events.push('create-order');
      await creationBarrier;
      return {
        order: { id: orderId, status: 'payment_pending' },
        payment: {
          signData: '{}',
          paySig: 'pay',
          signature: 'user',
          mode: 'short_series_goods'
        }
      };
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    confirmMembershipOrder: async () => {
      events.push('confirm-loop');
      return { id: orderId, status: 'payment_pending' };
    }
  });
  try {
    const first = page.purchaseMembership.call(context);
    const second = page.purchaseMembership.call(context);
    releaseCreation();
    await Promise.all([first, second]);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(events.filter((event) => event === 'login').length, 1);
  assert.equal(events.filter((event) => event === 'create-order').length, 1);
  assert.equal(events.filter((event) => event === 'request-payment').length, 1);
});

test('reports a post-cashier server error as a confirmation problem and preserves recovery', async () => {
  const events = [];
  const orderId = 'MP20260724081033dddddddddddddddd';
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
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    confirmMembershipOrder: async () => {
      events.push('confirm-loop');
      const error = new Error('支付服务暂时不可用，请稍后重试');
      error.code = 'TEMPORARY_FAILURE';
      throw error;
    }
  });
  try {
    await page.purchaseMembership.call(context);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'request-payment',
    'confirm-loop',
    'toast:会员开通确认异常，请勿重复付款，稍后下拉刷新'
  ]);
  assert.equal(events.some((event) => event.includes('Apple')), false);
  assert.equal(events.includes('forget-order'), false);
});

test('recovers a server-reused pending order without opening a second cashier', async () => {
  const events = [];
  const orderId = 'MP20260724081033ffffffffffffffff';
  const page = loadProfilePage({
    async createMembershipPayment() {
      events.push('create-order');
      return {
        order: { id: orderId, status: 'payment_pending' },
        payment: null,
        reused: true
      };
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    confirmMembershipOrder: async () => {
      events.push('confirm-loop');
      return { id: orderId, status: 'payment_pending' };
    }
  });
  try {
    await page.purchaseMembership.call(context);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'confirm-loop',
    'toast:支付结果确认中，请勿重复付款，稍后下拉刷新'
  ]);
  assert.equal(events.includes('request-payment'), false);
});

test('opens the cashier when the server safely resumes the same pending order', async () => {
  const events = [];
  const orderId = 'MP20260724081033cdcdcdcdcdcdcdcd';
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
        },
        reused: true
      };
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    confirmMembershipOrder: async () => {
      events.push('confirm-loop');
      return { id: orderId, status: 'payment_pending' };
    }
  });
  try {
    await page.purchaseMembership.call(context);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'request-payment',
    'confirm-loop',
    'toast:支付结果确认中，请勿重复付款，稍后下拉刷新'
  ]);
});

test('does not label an order-creation server failure as an Apple cashier failure', async () => {
  const events = [];
  const page = loadProfilePage({
    async createMembershipPayment() {
      events.push('create-order');
      const error = new Error('支付服务暂时不可用，请稍后重试');
      error.code = 'TEMPORARY_FAILURE';
      throw error;
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  try {
    await page.purchaseMembership.call(purchaseContext(page, events));
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'toast:会员开通服务暂时不可用，请稍后重试'
  ]);
  assert.equal(events.some((event) => event.includes('Apple')), false);
});

test('keeps the paid order recoverable until membership state refresh succeeds', async () => {
  const events = [];
  const orderId = 'MP20260724081033eeeeeeeeeeeeeeee';
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
    }
  });
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  const context = purchaseContext(page, events, {
    confirmMembershipOrder: async () => {
      events.push('confirm-loop');
      return { id: orderId, status: 'paid' };
    },
    loadMembership: async () => {
      events.push('refresh-membership');
      return null;
    }
  });
  try {
    await page.purchaseMembership.call(context);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'login',
    'create-order',
    'remember-order',
    'request-payment',
    'confirm-loop',
    'refresh-membership',
    'toast:会员开通确认异常，请勿重复付款，稍后下拉刷新'
  ]);
  assert.equal(events.includes('forget-order'), false);
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

test('logs out only the current local account step after explicit confirmation', async () => {
  const events = [];
  const storage = new Map([[
    'membership_account_verification_v1',
    {
      version: 1,
      cachePartition: 'viewer-partition-a',
      verified: true
    }
  ]]);
  const page = loadProfilePage({});
  const context = purchaseContext(page, events);
  context.membershipLoadRequestId = 3;
  context.billingLoadRequestId = 5;
  const previousWx = global.wx;
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    removeStorageSync(key) {
      events.push('forget-account');
      storage.delete(key);
    },
    showModal(options) {
      events.push(`modal:${options.title}`);
      assert.match(options.content, /不会退出手机微信、取消会员/);
      options.success({ confirm: true });
    },
    showToast(options) {
      events.push(`toast:${options.title}`);
    }
  };
  try {
    assert.equal(await page.logoutWechatAccount.call(context), true);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.deepEqual(events, [
    'modal:退出订阅登录？',
    'forget-account',
    'toast:已退出订阅登录'
  ]);
  assert.equal(context.data.billing.accountVerified, false);
  assert.equal(context.data.accountLoggingOut, false);
  assert.equal(context.membershipLoadRequestId, 3);
  assert.equal(context.billingLoadRequestId, 5);
  assert.equal(storage.has('membership_account_verification_v1'), false);
});

test('cancelled or failed local logout never fakes a signed-out state', async () => {
  const page = loadProfilePage({});
  const previousWx = global.wx;
  const cancelled = purchaseContext(page, []);
  global.wx = {
    showModal(options) {
      assert.equal(cancelled.data.accountLoggingOut, true);
      options.success({ confirm: false });
    }
  };
  try {
    assert.equal(await page.logoutWechatAccount.call(cancelled), false);
    assert.equal(cancelled.data.billing.accountVerified, true);

    const failed = purchaseContext(page, []);
    global.wx = {
      getStorageSync() {
        return {
          version: 1,
          cachePartition: 'viewer-partition-a',
          verified: true
        };
      },
      removeStorageSync() { throw new Error('storage unavailable'); },
      showModal(options) { options.success({ confirm: true }); },
      showToast() {}
    };
    assert.equal(await page.logoutWechatAccount.call(failed), false);
    assert.equal(failed.data.billing.accountVerified, true);
    assert.equal(failed.data.accountLoggingOut, false);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('a login finishing after the page hides does not reopen account UI', async () => {
  const events = [];
  let resolveVerification;
  const page = loadProfilePage({
    verifyMembershipAccount() {
      events.push('verify-account');
      return new Promise((resolve) => { resolveVerification = resolve; });
    }
  });
  const context = purchaseContext(page, events, { accountVerified: false });
  context.pageDisposed = false;
  context.pageHidden = false;
  context.accountOperationGeneration = 0;
  context.refreshProfilePage = () => {
    events.push('refresh-page');
    return Promise.resolve(true);
  };
  const previousWx = global.wx;
  global.wx = paymentWx(events, null);
  try {
    const pending = page.loginWechatAccount.call(context);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(typeof resolveVerification, 'function');

    page.onHide.call(context);
    resolveVerification({ verified: true });
    assert.equal(await pending, true);
    assert.deepEqual(events, [
      'login',
      'verify-account',
      'remember-account'
    ]);
    assert.equal(context.data.billing.accountVerified, false);

    page.onShow.call(context);
    assert.equal(context.pageHidden, false);
    assert.equal(context.data.accountAuthenticating, false);
    assert.equal(context.data.accountLoggingOut, false);
    assert.equal(events.at(-1), 'refresh-page');
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('a delayed billing response settles loading without restoring login after logout', async () => {
  let resolvePlans;
  const page = loadProfilePage({}, {
    loadBillingPlans: () => new Promise((resolve) => { resolvePlans = resolve; })
  });
  const storage = new Map([[
    'membership_account_verification_v1',
    {
      version: 1,
      cachePartition: 'viewer-partition-a',
      verified: true
    }
  ]]);
  const writes = [];
  const context = {
    pageDisposed: false,
    pageHidden: false,
    accountOperationGeneration: 0,
    billingLoaded: false,
    billingLoadRequestId: 0,
    data: {
      accountAuthenticating: false,
      accountLoggingOut: false,
      billing: {
        purchasing: false,
        accountVerified: true,
        loading: false
      }
    },
    membershipAccess: {
      viewer: { cachePartition: 'viewer-partition-a' }
    },
    setData(patch) {
      writes.push(patch);
      if (patch.billing) this.data.billing = patch.billing;
      if (Object.prototype.hasOwnProperty.call(patch, 'billing.loading')) {
        this.data.billing.loading = patch['billing.loading'];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'billing.accountVerified')) {
        this.data.billing.accountVerified = patch['billing.accountVerified'];
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'accountLoggingOut')) {
        this.data.accountLoggingOut = patch.accountLoggingOut;
      }
    },
    recoverPendingMembershipOrder: async () => null
  };
  const previousWx = global.wx;
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    removeStorageSync(key) { storage.delete(key); },
    showModal(options) { options.success({ confirm: true }); },
    showToast() {}
  };
  try {
    const pending = page.loadBilling.call(context, {
      access: context.membershipAccess
    });
    assert.equal(context.data.billing.loading, true);
    assert.equal(await page.logoutWechatAccount.call(context), true);

    resolvePlans({
      available: true,
      plan: { key: 'pro_30d' }
    });
    assert.equal(await pending, true);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }

  assert.equal(context.billingLoadRequestId, 1);
  assert.equal(context.data.billing.loading, false);
  assert.equal(context.data.billing.available, true);
  assert.equal(context.data.billing.accountVerified, false);
  assert.equal(writes.some((patch) => patch.billing && patch.billing.accountVerified === true), false);
});
