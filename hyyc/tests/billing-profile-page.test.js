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

function loadMembershipPage({
  checkoutMembership = async () => ({ order: null }),
  checkoutState = () => ({
    cashierInvoked: false,
    cashierCompleted: false,
    paymentConfirmed: false
  })
} = {}) {
  const mocks = [
    ['../features/membership/session', {
      refreshMembershipAccess: async () => ({
        viewer: { cachePartition: 'viewer-partition-a', role: 'free' }
      })
    }],
    ['../features/membership/presentation', {
      membershipPresentation: () => ({ purchaseMode: 'subscribe' })
    }],
    ['../features/user-profile/session', {
      loadUserProfile: async () => ({})
    }],
    ['../features/user-profile/model', {
      decorateUserProfile: () => ({})
    }],
    ['../features/account/session', {
      accountSessionPresentation: () => ({
        verified: true,
        authenticating: false
      }),
      waitForViewerAccountSession: async () => true
    }],
    ['../features/billing/session', {
      loadBillingPlans: async () => ({})
    }],
    ['../features/billing/recovery', {
      recoverPendingMembershipOrder: async () => null
    }],
    ['../features/billing/checkout', {
      checkoutMembership,
      checkoutState
    }]
  ];
  const restores = mocks.map(([request, exports]) => installModuleMock(request, exports));
  const filename = require.resolve('../pages/membership/index');
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

function purchaseContext(page, {
  verified = true,
  purchaseMode = 'subscribe',
  loadMembership = async () => ({ viewer: { role: 'member' } })
} = {}) {
  return {
    data: {
      account: {
        verified,
        authenticating: false
      },
      membership: { purchaseMode },
      billing: {
        purchasing: false,
        available: true,
        plan: { key: 'pro_30d' }
      }
    },
    membershipAccess: {
      viewer: { cachePartition: 'viewer-partition-a', role: 'free' },
      features: { memberPurchases: true }
    },
    setData(patch) {
      if (Object.prototype.hasOwnProperty.call(patch, 'billing.purchasing')) {
        this.data.billing.purchasing = patch['billing.purchasing'];
      }
    },
    loadMembership,
    applyMembershipOrderResult: page.applyMembershipOrderResult
  };
}

function installWx(events) {
  const previous = global.wx;
  global.wx = {
    showToast(options) {
      events.push(`toast:${options.title}`);
    }
  };
  return () => {
    if (previous) global.wx = previous;
    else delete global.wx;
  };
}

test('an unverified membership page never turns the purchase button into a login action', async () => {
  const events = [];
  const page = loadMembershipPage({
    checkoutMembership: async () => {
      events.push('checkout');
      throw new Error('must not start checkout');
    }
  });
  const restoreWx = installWx(events);
  try {
    await page.purchaseMembership.call(purchaseContext(page, { verified: false }));
  } finally {
    restoreWx();
  }

  assert.deepEqual(events, ['toast:微信账号尚未完成登录，请重新进入小程序']);
});

test('a verified purchase button only starts checkout and applies the paid result', async () => {
  const events = [];
  const order = { id: 'MP202607250001', status: 'paid' };
  const page = loadMembershipPage({
    checkoutMembership: async (request) => {
      events.push(`checkout:${request.planKey}`);
      return { order, orderId: order.id };
    }
  });
  const context = purchaseContext(page, {
    loadMembership: async () => {
      events.push('refresh-membership');
      return { viewer: { role: 'member' } };
    }
  });
  const restoreWx = installWx(events);
  try {
    await page.purchaseMembership.call(context);
  } finally {
    restoreWx();
  }

  assert.deepEqual(events, [
    'checkout:pro_30d',
    'refresh-membership',
    'toast:Pro 已开通'
  ]);
  assert.equal(context.data.billing.purchasing, false);
});

test('a renewal keeps the current button semantic and reports renewal success', async () => {
  const events = [];
  const order = { id: 'MP202607250002', status: 'paid' };
  const page = loadMembershipPage({
    checkoutMembership: async () => ({ order, orderId: order.id })
  });
  const context = purchaseContext(page, { purchaseMode: 'renew' });
  const restoreWx = installWx(events);
  try {
    await page.purchaseMembership.call(context);
  } finally {
    restoreWx();
  }

  assert.deepEqual(events, ['toast:续费成功']);
});

test('a synchronous double click starts only one checkout', async () => {
  const events = [];
  let releaseCheckout;
  const barrier = new Promise((resolve) => { releaseCheckout = resolve; });
  const page = loadMembershipPage({
    checkoutMembership: async () => {
      events.push('checkout');
      await barrier;
      return {
        order: { id: 'MP202607250003', status: 'payment_pending' },
        orderId: 'MP202607250003'
      };
    }
  });
  const context = purchaseContext(page);
  const restoreWx = installWx(events);
  try {
    const first = page.purchaseMembership.call(context);
    const second = page.purchaseMembership.call(context);
    releaseCheckout();
    await Promise.all([first, second]);
  } finally {
    restoreWx();
  }

  assert.equal(events.filter((event) => event === 'checkout').length, 1);
  assert.equal(
    events.filter((event) => event.includes('支付结果确认中')).length,
    1
  );
});

test('a post-cashier failure is presented as confirmation trouble', async () => {
  const events = [];
  const error = new Error('temporary');
  const page = loadMembershipPage({
    checkoutMembership: async () => { throw error; },
    checkoutState: () => ({
      cashierInvoked: true,
      cashierCompleted: true,
      paymentConfirmed: false
    })
  });
  const restoreWx = installWx(events);
  try {
    await page.purchaseMembership.call(purchaseContext(page));
  } finally {
    restoreWx();
  }

  assert.equal(events.length, 1);
  assert.match(events[0], /会员开通确认异常/);
});

test('a paid order remains recoverable until membership state refresh succeeds', async () => {
  const events = [];
  const order = { id: 'MP202607250004', status: 'paid' };
  const page = loadMembershipPage({
    checkoutMembership: async () => ({ order, orderId: order.id }),
    checkoutState: () => ({
      cashierInvoked: true,
      cashierCompleted: true,
      paymentConfirmed: true
    })
  });
  const context = purchaseContext(page, {
    loadMembership: async () => null
  });
  const restoreWx = installWx(events);
  try {
    await page.purchaseMembership.call(context);
  } finally {
    restoreWx();
  }

  assert.equal(events.length, 1);
  assert.match(events[0], /会员开通确认异常/);
});
