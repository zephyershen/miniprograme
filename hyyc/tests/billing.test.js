const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPaySignature,
  createUserSignature,
  createDirectPurchasePayment
} = require('../cloudfunctions/membershipBilling/lib/virtual-payment-signature');
const {
  createWechatVirtualPayClient,
  mapOrderState
} = require('../cloudfunctions/membershipBilling/adapters/wechat-virtual-pay-client');
const {
  centsToAmount,
  centsToPriceLabel,
  createOrderId,
  createCheckoutLeaseToken,
  CHECKOUT_LEASE_MS,
  CHECKOUT_OPERATION_BUDGET_MS,
  runWithinCheckoutDeadline,
  reconciliationRetryDelay,
  createBillingService
} = require('../cloudfunctions/membershipBilling/services/billing-service');
const {
  compareReconciliationOrders,
  createBillingRepository
} = require('../cloudfunctions/membershipBilling/repositories/billing-repository');
const {
  MAX_PAYMENT_REQUEST_TIMEOUT_MS,
  paymentRequestTimeout,
  missingPaymentConfig
} = require('../cloudfunctions/membershipBilling/config');

const CONFIG = Object.freeze({
  memberPurchasesEnabled: true,
  enabled: true,
  releaseApproved: true,
  environment: 0,
  offerId: 'offer-123',
  appKey: 'virtual-app-key',
  productId: 'membership-30-days',
  miniProgramAppId: 'wx-test',
  miniProgramAppSecret: 'mini-program-secret',
  apiBaseUrl: 'https://api.weixin.qq.com',
  timeoutMs: 1000
});

const PLAN = Object.freeze({
  key: 'pro_30d',
  name: '30 天会员',
  durationDays: 30,
  priceCents: 590,
  goodsPriceCents: 590,
  compareAtPriceCents: 1090
});

function currentPendingOrder(actor, overrides = {}) {
  return {
    id: 'MP20260724160000abcdefabcdefabcd',
    ownerKey: actor.ownerKey,
    openId: actor.openId,
    planKey: PLAN.key,
    amountCents: PLAN.priceCents,
    goodsPriceCents: PLAN.goodsPriceCents,
    productId: CONFIG.productId,
    environment: CONFIG.environment,
    provider: 'wechat_virtual_pay',
    providerStatus: 1,
    providerTransactionId: '',
    deliveryStatus: 'not_paid',
    status: 'payment_pending',
    createdAt: new Date('2026-07-24T08:00:00.000Z'),
    updatedAt: new Date('2026-07-24T08:00:00.000Z'),
    ...overrides
  };
}

test('uses an unpredictable 90-second checkout lease token', () => {
  const first = createCheckoutLeaseToken();
  const second = createCheckoutLeaseToken();
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.match(second, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  assert.equal(CHECKOUT_LEASE_MS, 90 * 1000);
  assert.equal(CHECKOUT_OPERATION_BUDGET_MS, 22 * 1000);
});

test('caps provider requests and the complete checkout operation below the function timeout', async () => {
  assert.equal(MAX_PAYMENT_REQUEST_TIMEOUT_MS, 5000);
  assert.equal(paymentRequestTimeout(8000), 5000);
  assert.equal(paymentRequestTimeout(3000), 3000);
  await assert.rejects(
    () => runWithinCheckoutDeadline(
      () => new Promise(() => {}),
      Date.now() + 5
    ),
    (error) => error && error.code === 'PAYMENT_CHECKOUT_TIMEOUT'
  );
});

test('keeps new sales closed until the explicit release gate is approved', async () => {
  const service = createBillingService({
    repository: {},
    paymentClient: {},
    config: { ...CONFIG, releaseApproved: false },
    plan: PLAN,
    missingConfig: missingPaymentConfig
  });

  assert.equal(service.getPlans().available, false);
  await assert.rejects(
    () => service.createPayment('pro_30d', 'login-code', {
      ownerKey: 'owner',
      openId: 'openid'
    }),
    (error) => error && error.code === 'PAYMENT_NOT_READY'
  );
  assert.deepEqual(
    missingPaymentConfig(
      { ...CONFIG, releaseApproved: false },
      PLAN,
      { requireReleaseApproval: false }
    ),
    []
  );
});

test('requires the product purchase flag for plans and new orders without blocking old-order recovery', async () => {
  const closedOrder = {
    id: 'MP20260723120000abcdefabcdefabcd',
    ownerKey: 'owner',
    openId: 'openid',
    status: 'closed'
  };
  const service = createBillingService({
    repository: {
      async getOrder() { return closedOrder; }
    },
    paymentClient: {},
    config: { ...CONFIG, memberPurchasesEnabled: false },
    plan: PLAN,
    missingConfig: missingPaymentConfig
  });

  assert.equal(service.getPlans().available, false);
  await assert.rejects(
    () => service.createPayment('pro_30d', 'login-code', {
      ownerKey: 'owner',
      openId: 'openid'
    }),
    (error) => error && error.code === 'PAYMENT_NOT_READY'
  );
  assert.deepEqual(
    missingPaymentConfig(
      { ...CONFIG, memberPurchasesEnabled: false },
      PLAN,
      {
        requireMemberPurchases: false,
        requireReleaseApproval: false
      }
    ),
    []
  );
  assert.equal(
    (await service.queryOrder(closedOrder.id, {
      ownerKey: 'owner',
      openId: 'openid'
    })).order.status,
    'closed'
  );
});

test('requires a valid goods price at least as high as the charged price', async () => {
  assert.deepEqual(missingPaymentConfig(CONFIG, PLAN), []);
  assert.ok(missingPaymentConfig(CONFIG, {
    ...PLAN,
    goodsPriceCents: undefined
  }).includes('WECHAT_VIRTUAL_PAY_PRO_30D_GOODS_PRICE_CENTS'));
  assert.ok(missingPaymentConfig(CONFIG, {
    ...PLAN,
    goodsPriceCents: PLAN.priceCents - 1
  }).includes('WECHAT_VIRTUAL_PAY_PRO_30D_GOODS_PRICE_CENTS'));
  assert.ok(missingPaymentConfig(CONFIG, {
    ...PLAN,
    goodsPriceCents: 590.5
  }).includes('WECHAT_VIRTUAL_PAY_PRO_30D_GOODS_PRICE_CENTS'));
  assert.deepEqual(missingPaymentConfig(CONFIG, {
    ...PLAN,
    compareAtPriceCents: 9999
  }), []);

  const service = createBillingService({
    repository: {},
    paymentClient: {},
    config: CONFIG,
    plan: { ...PLAN, goodsPriceCents: PLAN.priceCents - 1 },
    missingConfig: missingPaymentConfig
  });
  assert.equal(service.getPlans().available, false);
  await assert.rejects(
    () => service.createPayment(PLAN.key, 'login-code', {
      ownerKey: 'owner',
      openId: 'openid'
    }),
    (error) => error && error.code === 'PAYMENT_NOT_READY'
  );
});

function pendingOrderRecoveryHarness(configOverrides) {
  const owner = { ownerKey: 'owner', openId: 'openid' };
  const orders = [
    {
      id: 'MP20260723120100aaaaaaaaaaaaaaaa',
      ownerKey: owner.ownerKey,
      openId: owner.openId,
      planKey: PLAN.key,
      amountCents: PLAN.priceCents,
      productId: CONFIG.productId,
      provider: 'wechat_virtual_pay',
      status: 'payment_pending',
      deliveryStatus: 'not_paid'
    },
    {
      id: 'MP20260723120200bbbbbbbbbbbbbbbb',
      ownerKey: owner.ownerKey,
      openId: owner.openId,
      planKey: PLAN.key,
      amountCents: PLAN.priceCents,
      productId: CONFIG.productId,
      provider: 'wechat_virtual_pay',
      status: 'payment_pending',
      deliveryStatus: 'not_paid'
    }
  ];
  const stored = new Map(orders.map((order) => [order.id, order]));
  const fulfilled = [];
  const repository = {
    async createOrder() { throw new Error('new sales must remain closed'); },
    async getOrder(orderId) { return stored.get(orderId) || null; },
    async updateOrder(orderId, fields) {
      const updated = { ...stored.get(orderId), ...fields };
      stored.set(orderId, updated);
      return updated;
    },
    async fulfill(orderId, payment) {
      fulfilled.push(orderId);
      const updated = {
        ...stored.get(orderId),
        status: 'paid',
        paidAt: payment.paidAt,
        providerStatus: payment.providerStatus,
        providerTransactionId: payment.providerTransactionId,
        deliveryStatus: 'pending'
      };
      stored.set(orderId, updated);
      return { order: updated, membership: { status: 'active' } };
    },
    async markRefunded() { throw new Error('not expected'); },
    async listReconciliationOrders() {
      return [...stored.values()].filter((order) => order.status === 'payment_pending');
    }
  };
  const paymentClient = {
    async createPayment() { throw new Error('new sales must remain closed'); },
    async queryPayment(order) {
      return {
        state: 'S',
        orderId: order.id,
        amountCents: PLAN.priceCents,
        paidAmountCents: PLAN.priceCents,
        providerStatus: 2,
        orderType: 0,
        environmentType: 1,
        providerTransactionId: `wx-${order.id}`,
        paidAt: new Date('2026-07-23T04:05:00.000Z'),
        delivered: true
      };
    },
    async confirmDelivery() { throw new Error('provider already marked the order delivered'); }
  };
  return {
    fulfilled,
    orders,
    owner,
    service: createBillingService({
      repository,
      paymentClient,
      config: { ...CONFIG, ...configOverrides },
      plan: PLAN,
      missingConfig: missingPaymentConfig,
      now: () => new Date('2026-07-23T04:06:00.000Z')
    }),
    stored
  };
}

for (const scenario of [
  {
    name: 'product purchase gate',
    config: { memberPurchasesEnabled: false, releaseApproved: true }
  },
  {
    name: 'release approval gate',
    config: { memberPurchasesEnabled: true, releaseApproved: false }
  }
]) {
  test(`recovers paid pending orders while the ${scenario.name} is closed`, async () => {
    const harness = pendingOrderRecoveryHarness(scenario.config);
    const [directOrder, reconciledOrder] = harness.orders;

    assert.equal(harness.service.getPlans().available, false);
    await assert.rejects(
      () => harness.service.createPayment(PLAN.key, 'login-code', harness.owner),
      (error) => error && error.code === 'PAYMENT_NOT_READY'
    );

    const queried = await harness.service.queryOrder(directOrder.id, harness.owner);
    assert.equal(queried.order.status, 'paid');
    assert.equal(harness.stored.get(directOrder.id).status, 'paid');

    assert.deepEqual(
      await harness.service.reconcilePending(20),
      { inspected: 1, updated: 1, failed: 0 }
    );
    assert.equal(harness.stored.get(reconciledOrder.id).status, 'paid');
    assert.deepEqual(harness.fulfilled, [directOrder.id, reconciledOrder.id]);
  });
}

function jsonResponse(document) {
  return { ok: true, text: async () => JSON.stringify(document) };
}

test('matches the official HMAC-SHA256 virtual-payment signature vectors', () => {
  const body = '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}';
  assert.equal(
    createPaySignature('/xpay/query_user_balance', body, '12345'),
    'c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5'
  );
  assert.equal(
    createUserSignature(body, '9hAb/NEYUlkaMBEsmFgzig=='),
    '089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7'
  );
});

test('verifies the current WeChat account without creating a payment order', async () => {
  let exchanges = 0;
  const service = createBillingService({
    repository: {
      async createOrder() {
        throw new Error('account verification must not create an order');
      }
    },
    paymentClient: {
      async exchangeLoginCode(loginCode) {
        exchanges += 1;
        assert.equal(loginCode, 'login_code_123');
        return { openId: 'open-id', sessionKey: 'must-not-leak' };
      }
    },
    config: CONFIG,
    plan: PLAN,
    missingConfig: missingPaymentConfig
  });

  assert.deepEqual(
    await service.verifyAccount('login_code_123', {
      ownerKey: 'owner-key',
      openId: 'open-id'
    }),
    { verified: true }
  );
  assert.equal(exchanges, 1);
  await assert.rejects(
    () => service.verifyAccount('login_code_123', {
      ownerKey: 'owner-key',
      openId: 'another-open-id'
    }),
    (error) => error && error.code === 'PAYMENT_ACCOUNT_MISMATCH'
  );
});

test('creates a direct-purchase payment without exposing the session key', () => {
  const payment = createDirectPurchasePayment({
    offerId: CONFIG.offerId,
    environment: 0,
    productId: CONFIG.productId,
    goodsPrice: 1090,
    activitySellingPrice: 590,
    orderId: 'MP20260719120000abcdefabcdefabcd',
    attach: 'membership:pro_30d',
    appKey: CONFIG.appKey,
    sessionKey: 'session-key'
  });
  assert.deepEqual(JSON.parse(payment.signData), {
    offerId: 'offer-123',
    buyQuantity: 1,
    env: 0,
    currencyType: 'CNY',
    productId: 'membership-30-days',
    goodsPrice: 1090,
    outTradeNo: 'MP20260719120000abcdefabcdefabcd',
    attach: 'membership:pro_30d',
    activitySellingPrice: 590
  });
  assert.equal(payment.mode, 'short_series_goods');
  assert.equal(JSON.stringify(payment).includes('session-key'), false);
});

test('exchanges a fresh login code and refuses a mismatched WeChat account', async () => {
  let requestedUrl = '';
  const client = createWechatVirtualPayClient({
    config: CONFIG,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({ openid: 'open-id', session_key: 'session-key' });
    }
  });
  const order = {
    id: 'MP20260719120000abcdefabcdefabcd',
    openId: 'open-id',
    amountCents: 590,
    goodsPriceCents: 590,
    planKey: 'pro_30d'
  };
  const payment = await client.createPayment(order, 'login_code_123');
  assert.match(requestedUrl, /\/sns\/jscode2session/);
  assert.equal(new URL(requestedUrl).searchParams.get('js_code'), 'login_code_123');
  assert.equal(JSON.stringify(payment).includes('open-id'), false);
  assert.equal(JSON.parse(payment.signData).goodsPrice, 590);
  assert.equal('activitySellingPrice' in JSON.parse(payment.signData), false);
  await assert.rejects(
    () => client.createPayment({ ...order, openId: 'another-open-id' }, 'login_code_123'),
    /支付账号与登录账号不一致/
  );
});

test('queries official XPay state with an exact body signature and confirms delivery', async () => {
  const requests = [];
  const client = createWechatVirtualPayClient({
    config: CONFIG,
    fetchImpl: async (url, options) => {
      const request = { url: String(url), options };
      requests.push(request);
      if (request.url.endsWith('/cgi-bin/stable_token')) {
        return jsonResponse({ access_token: 'access-token', expires_in: 7200 });
      }
      if (request.url.includes('/xpay/query_order')) {
        const body = options.body;
        const parsedUrl = new URL(request.url);
        assert.equal(
          parsedUrl.searchParams.get('pay_sig'),
          createPaySignature('/xpay/query_order', body, CONFIG.appKey)
        );
        assert.deepEqual(JSON.parse(body), {
          openid: 'open-id', env: 0, order_id: 'MP20260719120000abcdefabcdefabcd'
        });
        return jsonResponse({
          errcode: 0,
          order: {
            order_id: 'MP20260719120000abcdefabcdefabcd',
            status: 2,
            order_type: 0,
            env_type: 1,
            order_fee: 590,
            paid_fee: 590,
            paid_time: 1784433600,
            wx_order_id: 'wx-order-id'
          }
        });
      }
      if (request.url.includes('/xpay/notify_provide_goods')) {
        const body = options.body;
        const parsedUrl = new URL(request.url);
        assert.equal(
          parsedUrl.searchParams.get('pay_sig'),
          createPaySignature('/xpay/notify_provide_goods', body, CONFIG.appKey)
        );
        assert.deepEqual(JSON.parse(body), {
          order_id: 'MP20260719120000abcdefabcdefabcd',
          env: 0
        });
        return { ok: true, text: async () => '' };
      }
      throw new Error(`unexpected request: ${request.url}`);
    }
  });
  const order = {
    id: 'MP20260719120000abcdefabcdefabcd',
    openId: 'open-id',
    amountCents: 590
  };
  const result = await client.queryPayment(order);
  assert.equal(result.state, 'S');
  assert.equal(result.providerTransactionId, 'wx-order-id');
  assert.equal(result.amountCents, 590);
  await client.confirmDelivery(order);
  assert.equal(requests.filter((request) => request.url.endsWith('/cgi-bin/stable_token')).length, 1);
  assert.equal(requests.some((request) => request.url.includes('/xpay/notify_provide_goods')), true);
});

test('re-signs delivery confirmation after refreshing an expired access token', async () => {
  let tokenRequests = 0;
  const deliveryRequests = [];
  const client = createWechatVirtualPayClient({
    config: CONFIG,
    fetchImpl: async (url, options) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/cgi-bin/stable_token')) {
        tokenRequests += 1;
        return jsonResponse({
          access_token: tokenRequests === 1 ? 'expired-token' : 'fresh-token',
          expires_in: 7200
        });
      }
      if (requestUrl.includes('/xpay/notify_provide_goods')) {
        deliveryRequests.push({ url: requestUrl, options });
        return deliveryRequests.length === 1
          ? jsonResponse({ errcode: 40001, errmsg: 'access token expired' })
          : { ok: true, text: async () => '' };
      }
      throw new Error(`unexpected request: ${requestUrl}`);
    }
  });
  const order = {
    id: 'MP20260719120000abcdefabcdefabcd',
    openId: 'open-id',
    amountCents: 590
  };

  await client.confirmDelivery(order);

  assert.equal(tokenRequests, 2);
  assert.equal(deliveryRequests.length, 2);
  deliveryRequests.forEach((request, index) => {
    const body = request.options.body;
    const parsedUrl = new URL(request.url);
    assert.equal(
      parsedUrl.searchParams.get('access_token'),
      index === 0 ? 'expired-token' : 'fresh-token'
    );
    assert.equal(
      parsedUrl.searchParams.get('pay_sig'),
      createPaySignature('/xpay/notify_provide_goods', body, CONFIG.appKey)
    );
    assert.deepEqual(JSON.parse(body), {
      order_id: order.id,
      env: CONFIG.environment
    });
  });
});

test('maps a nonzero delivery business error to DELIVERY_CONFIRM_FAILED', async () => {
  const client = createWechatVirtualPayClient({
    config: CONFIG,
    fetchImpl: async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/cgi-bin/stable_token')) {
        return jsonResponse({ access_token: 'access-token', expires_in: 7200 });
      }
      if (requestUrl.includes('/xpay/notify_provide_goods')) {
        return jsonResponse({ errcode: 268490001, errmsg: 'delivery rejected' });
      }
      throw new Error(`unexpected request: ${requestUrl}`);
    }
  });

  await assert.rejects(
    () => client.confirmDelivery({
      id: 'MP20260719120000abcdefabcdefabcd',
      openId: 'open-id',
      amountCents: 590
    }),
    (error) => error
      && error.code === 'DELIVERY_CONFIRM_FAILED'
      && error.statusCode === 502
  );
});

test('maps every terminal virtual-payment state conservatively', () => {
  assert.equal(mapOrderState(0), 'F');
  assert.equal(mapOrderState(1), 'P');
  assert.equal(mapOrderState(2), 'S');
  assert.equal(mapOrderState(4), 'S');
  assert.equal(mapOrderState(5), 'R');
  assert.equal(mapOrderState(6), 'F');
  assert.equal(mapOrderState(7), 'P');
  assert.equal(mapOrderState(8), 'R');
});

test('only grants membership after an official paid query with an exact amount', async () => {
  const stored = new Map();
  let fulfilled = 0;
  let activeLeaseToken = '';
  const repository = {
    async findLatestPendingOrderByOwner() { return null; },
    async acquireCheckoutLease(ownerKey, leaseToken) {
      assert.equal(ownerKey, 'owner-key');
      activeLeaseToken = leaseToken;
      return { acquired: true };
    },
    async commitCheckoutOrder(ownerKey, openId, leaseToken, order) {
      assert.equal(ownerKey, 'owner-key');
      assert.equal(openId, 'open-id');
      assert.equal(leaseToken, activeLeaseToken);
      stored.set(order.id, order);
      return order;
    },
    async bindCheckoutOrder() {
      throw new Error('new checkout must not bind an old order');
    },
    async releaseCheckoutLease(ownerKey, leaseToken) {
      assert.equal(ownerKey, 'owner-key');
      assert.equal(leaseToken, activeLeaseToken);
      activeLeaseToken = '';
      return true;
    },
    async getOrder(orderId) { return stored.get(orderId) || null; },
    async updateOrder(orderId, fields) {
      const updated = { ...stored.get(orderId), ...fields };
      stored.set(orderId, updated);
      return updated;
    },
    async fulfill(orderId, payment) {
      fulfilled += 1;
      const order = { ...stored.get(orderId), status: 'paid', paidAt: payment.paidAt, deliveryStatus: 'pending' };
      stored.set(orderId, order);
      return { order, membership: { status: 'active' } };
    },
    async markRefunded() { throw new Error('not expected'); },
    async listReconciliationOrders() { return []; }
  };
  let signedOrder = null;
  const paymentClient = {
    async createPayment(order) {
      signedOrder = order;
      return { signData: JSON.stringify({ outTradeNo: order.id }), paySig: 'pay', signature: 'user', mode: 'short_series_goods' };
    },
    async queryPayment(order) {
      return {
        state: 'S', orderId: order.id, amountCents: 590, paidAmountCents: 590,
        providerStatus: 2, orderType: 0, environmentType: 1,
        providerTransactionId: 'wx-id', paidAt: new Date(), delivered: false
      };
    },
    async confirmDelivery() { return true; }
  };
  const service = createBillingService({
    repository,
    paymentClient,
    config: CONFIG,
    plan: {
      key: 'pro_30d', name: '30 天会员', durationDays: 30,
      priceCents: 590, goodsPriceCents: 590, compareAtPriceCents: 1090
    },
    missingConfig: () => [],
    now: () => new Date('2026-07-19T12:00:00.000Z')
  });
  assert.equal(centsToAmount(590), '5.90');
  assert.equal(centsToPriceLabel(590), '¥5.9');
  assert.match(createOrderId(new Date('2026-07-19T04:00:00.000Z')), /^MP\d{14}[a-f0-9]{16}$/);
  assert.deepEqual(service.getPlans().plan, {
    key: 'pro_30d',
    name: '30 天会员',
    durationDays: 30,
    priceCents: 590,
    priceLabel: '¥5.9',
    compareAtPriceCents: 1090,
    compareAtPriceLabel: '¥10.9'
  });

  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  const created = await service.createPayment('pro_30d', 'login_code_123', actor);
  assert.equal(created.order.status, 'payment_pending');
  assert.equal(created.order.amountCents, 590);
  assert.equal(signedOrder.goodsPriceCents, 590);
  assert.equal(signedOrder.amountCents, 590);
  assert.equal(JSON.stringify(created).includes('1090'), false);
  assert.equal(fulfilled, 0);
  const queried = await service.queryOrder(created.order.id, actor);
  assert.equal(queried.order.status, 'paid');
  assert.equal(fulfilled, 1);

  assert.throws(() => service.validateProviderResult(
    { id: 'order', amountCents: 590 },
    {
      state: 'S', orderId: 'order', amountCents: 590, paidAmountCents: 59,
      providerStatus: 2,
      orderType: 0, environmentType: 1
    }
  ), /支付金额校验失败/);
  assert.throws(() => service.validateProviderResult(
    { id: 'order', amountCents: 590 },
    {
      state: 'S', orderId: 'order', amountCents: 1090, paidAmountCents: 1090,
      providerStatus: 2,
      orderType: 0, environmentType: 1
    }
  ), /支付金额校验失败/);
  assert.throws(() => service.validateProviderResult(
    { id: 'order', amountCents: 590 },
    {
      state: 'R', orderId: 'order', amountCents: 590, paidAmountCents: 1090,
      providerStatus: 8,
      orderType: 7, environmentType: 1
    }
  ), /支付金额校验失败/);
  assert.throws(
    () => service.validateProviderResult(
      { id: 'order', amountCents: 590 },
      {
        state: 'P',
        providerStatus: 6,
        orderId: 'order',
        amountCents: 590,
        paidAmountCents: 0,
        orderType: 0,
        environmentType: 1
      }
    ),
    (error) => error && error.code === 'PAYMENT_RESULT_MISMATCH'
  );
});

test('queries and re-signs the same pending order without creating a second order id', async () => {
  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  let pending = {
    id: 'MP20260724160000abcdefabcdefabcd',
    ownerKey: actor.ownerKey,
    openId: actor.openId,
    planKey: PLAN.key,
    amountCents: PLAN.priceCents,
    goodsPriceCents: PLAN.goodsPriceCents,
    productId: CONFIG.productId,
    environment: CONFIG.environment,
    provider: 'wechat_virtual_pay',
    providerStatus: 1,
    providerTransactionId: '',
    deliveryStatus: 'not_paid',
    status: 'payment_pending',
    createdAt: new Date('2026-07-24T08:00:00.000Z')
  };
  let signed = 0;
  let committed = 0;
  let activeLeaseToken = '';
  const service = createBillingService({
    repository: {
      async acquireCheckoutLease(ownerKey, leaseToken) {
        assert.equal(ownerKey, actor.ownerKey);
        activeLeaseToken = leaseToken;
        return { acquired: true };
      },
      async findLatestPendingOrderByOwner(ownerKey) {
        assert.equal(ownerKey, actor.ownerKey);
        return pending;
      },
      async updateOrder(orderId, fields) {
        assert.equal(orderId, pending.id);
        pending = { ...pending, ...fields };
        return pending;
      },
      async getOrder(orderId) {
        return orderId === pending.id ? pending : null;
      },
      async bindCheckoutOrder(ownerKey, openId, leaseToken, orderId) {
        assert.equal(ownerKey, actor.ownerKey);
        assert.equal(openId, actor.openId);
        assert.equal(leaseToken, activeLeaseToken);
        assert.equal(orderId, pending.id);
        return pending;
      },
      async commitCheckoutOrder() {
        committed += 1;
        throw new Error('must not create a duplicate order');
      },
      async releaseCheckoutLease(ownerKey, leaseToken) {
        assert.equal(ownerKey, actor.ownerKey);
        assert.equal(leaseToken, activeLeaseToken);
        activeLeaseToken = '';
        return true;
      }
    },
    paymentClient: {
      async queryPayment(order) {
        assert.equal(order.id, pending.id);
        return {
          state: 'P',
          orderId: order.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: 0,
          providerStatus: 1,
          orderType: 0,
          environmentType: 1,
          providerTransactionId: ''
        };
      },
      async createPayment(order) {
        signed += 1;
        assert.equal(order.id, pending.id);
        return {
          signData: JSON.stringify({ outTradeNo: order.id }),
          paySig: 'pay',
          signature: 'user',
          mode: 'short_series_goods'
        };
      }
    },
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  const result = await service.createPayment(PLAN.key, 'login-code', actor);

  assert.equal(result.reused, true);
  assert.equal(JSON.parse(result.payment.signData).outTradeNo, pending.id);
  assert.equal(result.order.id, pending.id);
  assert.equal(result.order.status, 'payment_pending');
  assert.equal(signed, 1);
  assert.equal(committed, 0);
});

test('allows only one concurrent checkout per owner to generate payment parameters', async () => {
  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  let activeLeaseToken = '';
  let providerCalls = 0;
  let committedOrder = null;
  let enterProvider;
  let finishProvider;
  const providerEntered = new Promise((resolve) => { enterProvider = resolve; });
  const providerMayFinish = new Promise((resolve) => { finishProvider = resolve; });
  const repository = {
    async acquireCheckoutLease(ownerKey, leaseToken) {
      assert.equal(ownerKey, actor.ownerKey);
      if (activeLeaseToken) return { acquired: false };
      activeLeaseToken = leaseToken;
      return { acquired: true };
    },
    async findLatestPendingOrderByOwner() {
      return committedOrder && committedOrder.status === 'payment_pending'
        ? committedOrder
        : null;
    },
    async commitCheckoutOrder(ownerKey, openId, leaseToken, order) {
      assert.equal(ownerKey, actor.ownerKey);
      assert.equal(openId, actor.openId);
      assert.equal(leaseToken, activeLeaseToken);
      committedOrder = order;
      return order;
    },
    async bindCheckoutOrder() {
      throw new Error('no historical order should be bound');
    },
    async releaseCheckoutLease(ownerKey, leaseToken) {
      assert.equal(ownerKey, actor.ownerKey);
      if (leaseToken !== activeLeaseToken) return false;
      activeLeaseToken = '';
      return true;
    }
  };
  const paymentClient = {
    async createPayment(order) {
      providerCalls += 1;
      enterProvider();
      await providerMayFinish;
      return {
        signData: JSON.stringify({ outTradeNo: order.id }),
        paySig: 'pay',
        signature: 'user',
        mode: 'short_series_goods'
      };
    }
  };
  const service = createBillingService({
    repository,
    paymentClient,
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => [],
    now: () => new Date('2026-07-24T08:00:00.000Z')
  });

  const first = service.createPayment(PLAN.key, 'first-login-code', actor);
  await providerEntered;
  await assert.rejects(
    () => service.createPayment(PLAN.key, 'second-login-code', actor),
    (error) => error && error.code === 'PAYMENT_CREATION_IN_PROGRESS'
  );
  finishProvider();
  const result = await first;

  assert.equal(providerCalls, 1);
  assert.equal(result.order.id, committedOrder.id);
  assert.equal(result.order.status, 'payment_pending');
});

test('recovers an officially paid pending order without generating another payment', async () => {
  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  let pending = currentPendingOrder(actor);
  let activeLeaseToken = '';
  let generated = 0;
  const repository = {
    async acquireCheckoutLease(ownerKey, leaseToken) {
      activeLeaseToken = leaseToken;
      return { acquired: true };
    },
    async findLatestPendingOrderByOwner() {
      return pending && pending.status === 'payment_pending' ? pending : null;
    },
    async fulfill(orderId, payment) {
      assert.equal(orderId, pending.id);
      pending = {
        ...pending,
        status: 'paid',
        paidAt: payment.paidAt,
        deliveryStatus: 'delivered'
      };
      return { order: pending, membership: { status: 'active' } };
    },
    async updateOrder(orderId, fields) {
      assert.equal(orderId, pending.id);
      pending = { ...pending, ...fields };
      return pending;
    },
    async commitCheckoutOrder() {
      throw new Error('paid recovery must not create another order');
    },
    async bindCheckoutOrder() {
      throw new Error('paid recovery must not re-open the cashier');
    },
    async releaseCheckoutLease(ownerKey, leaseToken) {
      assert.equal(ownerKey, actor.ownerKey);
      assert.equal(leaseToken, activeLeaseToken);
      activeLeaseToken = '';
      return true;
    }
  };
  const service = createBillingService({
    repository,
    paymentClient: {
      async queryPayment(order) {
        return {
          state: 'S',
          orderId: order.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: PLAN.priceCents,
          providerStatus: 4,
          orderType: 0,
          environmentType: 1,
          providerTransactionId: 'wx-paid',
          paidAt: new Date('2026-07-24T08:01:00.000Z'),
          delivered: true
        };
      },
      async createPayment() {
        generated += 1;
        throw new Error('must not generate a second payment');
      }
    },
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  const result = await service.createPayment(PLAN.key, 'login-code', actor);

  assert.equal(result.reused, true);
  assert.equal(result.payment, null);
  assert.equal(result.order.status, 'paid');
  assert.equal(generated, 0);
});

for (const terminal of [
  { name: 'closes', providerStatus: 6, localStatus: 'closed' },
  { name: 'cannot initialize', providerStatus: 0, localStatus: 'failed' }
]) {
  test(`creates a new order only after the official provider ${terminal.name} the historical pending order`, async () => {
  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  let pending = currentPendingOrder(actor);
  let activeLeaseToken = '';
  let generatedOrder = null;
  let providerQueries = 0;
  const repository = {
    async acquireCheckoutLease(ownerKey, leaseToken) {
      activeLeaseToken = leaseToken;
      return { acquired: true };
    },
    async findLatestPendingOrderByOwner() {
      return pending && pending.status === 'payment_pending' ? pending : null;
    },
    async updateOrder(orderId, fields) {
      assert.equal(orderId, pending.id);
      pending = { ...pending, ...fields };
      return pending;
    },
    async commitCheckoutOrder(ownerKey, openId, leaseToken, order) {
      assert.equal(ownerKey, actor.ownerKey);
      assert.equal(openId, actor.openId);
      assert.equal(leaseToken, activeLeaseToken);
      assert.notEqual(order.id, pending.id);
      generatedOrder = order;
      return order;
    },
    async bindCheckoutOrder() {
      throw new Error('closed order must not be rebound');
    },
    async releaseCheckoutLease(ownerKey, leaseToken) {
      assert.equal(ownerKey, actor.ownerKey);
      assert.equal(leaseToken, activeLeaseToken);
      activeLeaseToken = '';
      return true;
    }
  };
  const service = createBillingService({
    repository,
    paymentClient: {
      async queryPayment(order) {
        providerQueries += 1;
        return {
          state: 'F',
          orderId: order.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: 0,
          providerStatus: terminal.providerStatus,
          orderType: 0,
          environmentType: 1,
          providerTransactionId: ''
        };
      },
      async createPayment(order) {
        assert.notEqual(order.id, pending.id);
        return {
          signData: JSON.stringify({ outTradeNo: order.id }),
          paySig: 'pay',
          signature: 'user',
          mode: 'short_series_goods'
        };
      }
    },
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => [],
    now: () => new Date('2026-07-24T08:02:00.000Z')
  });

  const result = await service.createPayment(PLAN.key, 'login-code', actor);

  assert.equal(providerQueries, 1);
  assert.equal(pending.status, terminal.localStatus);
  assert.equal(result.order.id, generatedOrder.id);
  assert.notEqual(result.order.id, pending.id);
  });
}

test('does not create a new order when a stale closed result races an already-paid transition', async () => {
  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  const pending = currentPendingOrder(actor);
  let activeLeaseToken = '';
  let generated = 0;
  let committed = 0;
  const service = createBillingService({
    repository: {
      async acquireCheckoutLease(ownerKey, leaseToken) {
        activeLeaseToken = leaseToken;
        return { acquired: true };
      },
      async findLatestPendingOrderByOwner() {
        return pending;
      },
      async transitionPendingOrder(orderId, fields) {
        assert.equal(orderId, pending.id);
        assert.equal(fields.status, 'closed');
        return {
          ...pending,
          status: 'paid',
          providerStatus: 4,
          paidAt: new Date('2026-07-24T08:01:00.000Z')
        };
      },
      async commitCheckoutOrder() {
        committed += 1;
        throw new Error('paid race must not commit a new order');
      },
      async bindCheckoutOrder() {
        throw new Error('paid race must not re-open the cashier');
      },
      async releaseCheckoutLease(ownerKey, leaseToken) {
        assert.equal(ownerKey, actor.ownerKey);
        assert.equal(leaseToken, activeLeaseToken);
        activeLeaseToken = '';
        return true;
      }
    },
    paymentClient: {
      async queryPayment(order) {
        return {
          state: 'F',
          orderId: order.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: 0,
          providerStatus: 6,
          orderType: 0,
          environmentType: 1,
          providerTransactionId: ''
        };
      },
      async createPayment() {
        generated += 1;
        throw new Error('paid race must not generate another payment');
      }
    },
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  const result = await service.createPayment(PLAN.key, 'login-code', actor);

  assert.equal(result.reused, true);
  assert.equal(result.payment, null);
  assert.equal(result.order.status, 'paid');
  assert.equal(generated, 0);
  assert.equal(committed, 0);
});

for (const scenario of [
  {
    name: 'belongs to another account',
    pending: (actor) => currentPendingOrder(actor, { openId: 'another-open-id' }),
    expectedCode: 'PAYMENT_ACCOUNT_MISMATCH',
    queryPayment: async () => {
      throw new Error('another account order must not reach the provider');
    }
  },
  {
    name: 'contract does not match',
    pending: (actor) => currentPendingOrder(actor, { goodsPriceCents: 1090 }),
    expectedCode: 'PAYMENT_PENDING_ORDER_MISMATCH',
    queryPayment: async () => {
      throw new Error('mismatched pending order must not reach the provider');
    }
  },
  {
    name: 'official query fails',
    pending: (actor) => currentPendingOrder(actor),
    expectedCode: 'PAYMENT_QUERY_FAILED',
    queryPayment: async () => {
      const error = new Error('temporary provider failure');
      error.code = 'PAYMENT_QUERY_FAILED';
      throw error;
    }
  },
  {
    name: 'official query returns an unknown status',
    pending: (actor) => currentPendingOrder(actor),
    expectedCode: 'PAYMENT_RESULT_MISMATCH',
    queryPayment: async (order) => ({
      state: 'P',
      orderId: order.id,
      amountCents: PLAN.priceCents,
      paidAmountCents: 0,
      providerStatus: 999,
      orderType: 0,
      environmentType: 1,
      providerTransactionId: ''
    })
  },
  {
    name: 'official query reports a failed refund',
    pending: (actor) => currentPendingOrder(actor),
    expectedCode: 'PAYMENT_RESULT_MISMATCH',
    queryPayment: async (order) => ({
      state: 'P',
      orderId: order.id,
      amountCents: PLAN.priceCents,
      paidAmountCents: PLAN.priceCents,
      providerStatus: 7,
      orderType: 0,
      environmentType: 1,
      providerTransactionId: 'refund-failed-order'
    })
  },
  {
    name: 'official pending state reports a nonzero paid amount',
    pending: (actor) => currentPendingOrder(actor),
    expectedCode: 'PAYMENT_AMOUNT_MISMATCH',
    queryPayment: async (order) => ({
      state: 'P',
      orderId: order.id,
      amountCents: PLAN.priceCents,
      paidAmountCents: PLAN.priceCents,
      providerStatus: 1,
      orderType: 0,
      environmentType: 1,
      providerTransactionId: 'inconsistent-pending-order'
    })
  }
]) {
  test(`fails closed without creating a new order when the historical pending ${scenario.name}`, async () => {
    const actor = { openId: 'open-id', ownerKey: 'owner-key' };
    const pending = scenario.pending(actor);
    let activeLeaseToken = '';
    let generated = 0;
    let committed = 0;
    const service = createBillingService({
      repository: {
        async acquireCheckoutLease(ownerKey, leaseToken) {
          activeLeaseToken = leaseToken;
          return { acquired: true };
        },
        async findLatestPendingOrderByOwner() {
          return pending;
        },
        async commitCheckoutOrder() {
          committed += 1;
          throw new Error('must not commit a new order');
        },
        async bindCheckoutOrder() {
          throw new Error('must not bind an unsafe order');
        },
        async releaseCheckoutLease(ownerKey, leaseToken) {
          assert.equal(ownerKey, actor.ownerKey);
          assert.equal(leaseToken, activeLeaseToken);
          activeLeaseToken = '';
          return true;
        }
      },
      paymentClient: {
        queryPayment: scenario.queryPayment,
        async createPayment() {
          generated += 1;
          throw new Error('must not generate payment parameters');
        }
      },
      config: CONFIG,
      plan: PLAN,
      missingConfig: () => []
    });

    await assert.rejects(
      () => service.createPayment(PLAN.key, 'login-code', actor),
      (error) => error && error.code === scenario.expectedCode
    );
    assert.equal(generated, 0);
    assert.equal(committed, 0);
  });
}

test('returns the refunded state when delivery confirmation races a refund', async () => {
  const actor = { openId: 'open-id', ownerKey: 'owner-key' };
  const paidOrder = currentPendingOrder(actor, {
    status: 'paid',
    providerStatus: 4,
    deliveryStatus: 'pending',
    paidAt: new Date('2026-07-24T08:01:00.000Z')
  });
  const refundedOrder = {
    ...paidOrder,
    status: 'refunded',
    providerStatus: 8,
    deliveryStatus: 'pending',
    refundedAt: new Date('2026-07-24T08:02:00.000Z'),
    nextCheckAt: null
  };
  let blindUpdates = 0;
  const service = createBillingService({
    repository: {
      async getOrder(orderId) {
        assert.equal(orderId, paidOrder.id);
        return paidOrder;
      },
      async transitionPaidOrder(orderId, fields) {
        assert.equal(orderId, paidOrder.id);
        assert.equal(fields.deliveryStatus, 'delivered');
        return refundedOrder;
      },
      async updateOrder() {
        blindUpdates += 1;
        throw new Error('a stale paid snapshot must use the paid-only transition');
      }
    },
    paymentClient: {
      async confirmDelivery(order) {
        assert.equal(order.id, paidOrder.id);
        return true;
      }
    },
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  const result = await service.queryOrder(paidOrder.id, actor);

  assert.equal(result.order.status, 'refunded');
  assert.equal(blindUpdates, 0);
});

test('hides a crossed-out comparison price unless it is above the charged price', () => {
  const service = createBillingService({
    repository: {},
    paymentClient: {},
    config: CONFIG,
    plan: {
      key: 'pro_30d', name: '30 天会员', durationDays: 30,
      priceCents: 590, goodsPriceCents: 590, compareAtPriceCents: 590
    },
    missingConfig: () => []
  });
  assert.equal(service.getPlans().plan.compareAtPriceCents, 0);
  assert.equal(service.getPlans().plan.compareAtPriceLabel, '');
});

test('selects only due reconciliation orders with a bounded oldest-first query', async () => {
  const calls = [];
  const dueAt = new Date('2026-07-20T04:00:00.000Z');
  const query = {
    where(filter) { calls.push(['where', filter]); return this; },
    orderBy(field, direction) { calls.push(['orderBy', field, direction]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
    async get() {
      return {
        data: [
          { id: 'paid-later', status: 'paid', nextCheckAt: new Date('2026-07-20T03:59:00.000Z') },
          { id: 'closed', status: 'closed', nextCheckAt: new Date('2026-07-20T03:57:00.000Z') },
          { id: 'pending-oldest', status: 'payment_pending', nextCheckAt: new Date('2026-07-20T03:58:00.000Z') }
        ]
      };
    }
  };
  const db = {
    command: {
      in: (value) => ({ $in: value }),
      lte: (value) => ({ $lte: value })
    },
    createCollection: async () => null,
    collection: () => query
  };
  const repository = createBillingRepository(db, {
    orders: 'knowledge_membership_orders', memberships: 'knowledge_memberships'
  });
  const result = await repository.listReconciliationOrders(20, dueAt);
  assert.deepEqual(result.map((order) => order.id), ['pending-oldest', 'paid-later']);
  assert.deepEqual(calls, [
    ['where', {
      status: { $in: ['payment_pending', 'paid'] },
      nextCheckAt: { $lte: dueAt }
    }],
    ['orderBy', 'nextCheckAt', 'asc'],
    ['limit', 20]
  ]);
  assert.equal(compareReconciliationOrders(
    { id: 'b', nextCheckAt: dueAt },
    { id: 'a', nextCheckAt: dueAt }
  ) > 0, true);
});

test('finds only the newest pending order for one owner before creating a payment', async () => {
  const calls = [];
  const pending = {
    id: 'MP20260724160000abcdefabcdefabcd',
    ownerKey: 'owner',
    status: 'payment_pending'
  };
  const query = {
    where(filter) { calls.push(['where', filter]); return this; },
    orderBy(field, direction) { calls.push(['orderBy', field, direction]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
    async get() { return { data: [pending] }; }
  };
  const repository = createBillingRepository({
    createCollection: async () => null,
    collection: () => query
  }, {
    orders: 'knowledge_membership_orders',
    memberships: 'knowledge_memberships'
  });

  assert.equal(await repository.findLatestPendingOrderByOwner('owner'), pending);
  assert.deepEqual(calls, [
    ['where', { ownerKey: 'owner', status: 'payment_pending' }],
    ['orderBy', 'createdAt', 'desc'],
    ['limit', 1]
  ]);
});

test('resolves a payment identifier only when it belongs to one order', async () => {
  const firstOrder = {
    id: 'MP20260720140000abcdefabcdefabcd',
    providerTransactionId: 'wx-order-id',
    channelOrderId: 'channel-bill-one'
  };
  const secondOrder = {
    id: 'MP20260720140100abcdefabcdefabcd',
    providerTransactionId: 'another-wx-order-id',
    channelOrderId: 'channel-bill-two'
  };
  const orders = [firstOrder, secondOrder];
  const db = {
    createCollection: async () => null,
    collection() {
      return {
        doc(orderId) {
          return {
            async get() {
              const order = orders.find((candidate) => candidate.id === orderId);
              if (!order) throw new Error('document not found');
              return { data: order };
            }
          };
        },
        where(filter) {
          return {
            limit() { return this; },
            async get() {
              const [field, value] = Object.entries(filter)[0];
              return { data: orders.filter((order) => order[field] === value) };
            }
          };
        }
      };
    }
  };
  const repository = createBillingRepository(db, {
    orders: 'knowledge_membership_orders', memberships: 'knowledge_memberships'
  });

  assert.equal(await repository.findOrderByPaymentId(firstOrder.id), firstOrder);
  assert.equal(await repository.findOrderByPaymentId('wx-order-id'), firstOrder);
  assert.equal(await repository.findOrderByPaymentId('missing'), null);

  secondOrder.wechatPayTransactionId = 'wx-order-id';
  assert.equal(await repository.findOrderByPaymentId('wx-order-id'), null);
});

test('backs off failed reconciliation orders so they cannot starve the due queue', async () => {
  const now = new Date('2026-07-20T04:00:00.000Z');
  const updates = [];
  const failedOrder = {
    id: 'MP20260720120000abcdefabcdefabcd',
    status: 'payment_pending',
    reconciliationFailures: 0
  };
  const repository = {
    async listReconciliationOrders() { return [failedOrder]; },
    async updateOrder(orderId, fields) { updates.push({ orderId, fields }); return { ...failedOrder, ...fields }; }
  };
  const failure = new Error('upstream details must not be persisted');
  failure.code = 'PAYMENT_PROVIDER_TIMEOUT';
  const service = createBillingService({
    repository,
    paymentClient: { async queryPayment() { throw failure; } },
    config: CONFIG,
    plan: {
      key: 'pro_30d',
      name: '30 天会员',
      durationDays: 30,
      priceCents: 590,
      goodsPriceCents: 590
    },
    missingConfig: () => [],
    now: () => now
  });
  const summary = await service.reconcilePending(20);
  assert.deepEqual(summary, { inspected: 1, updated: 0, failed: 1 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].fields.reconciliationFailures, 1);
  assert.equal(updates[0].fields.reconciliationErrorCode, 'PAYMENT_PROVIDER_TIMEOUT');
  assert.equal(
    updates[0].fields.nextCheckAt.getTime(),
    now.getTime() + reconciliationRetryDelay(1)
  );
  assert.equal(reconciliationRetryDelay(10), 6 * 60 * 60 * 1000);
  assert.equal(JSON.stringify(updates).includes('upstream details'), false);
});

test('records only safe owner-bound client payment diagnostics', async () => {
  const order = {
    id: 'MP20260724081033aaaaaaaaaaaaaaaa',
    ownerKey: 'owner-a',
    openId: 'openid-a',
    status: 'payment_pending',
    clientFailureReportCount: 2
  };
  let update = null;
  const service = createBillingService({
    repository: {
      async getOrder(orderId) {
        return orderId === order.id ? order : null;
      },
      async updateOrder(orderId, fields) {
        update = { orderId, fields };
        return { ...order, ...fields };
      }
    },
    paymentClient: {},
    config: CONFIG,
    plan: PLAN,
    missingConfig: () => [],
    now: () => new Date('2026-07-24T00:11:00.000Z')
  });
  const actor = { ownerKey: 'owner-a', openId: 'openid-a' };

  assert.deepEqual(
    await service.recordPaymentFailure(order.id, {
      errCode: -15013,
      failureKind: 'official_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12',
      errMsg: 'must-not-be-persisted',
      signature: 'must-not-be-persisted'
    }, actor),
    { recorded: true }
  );
  assert.deepEqual(update, {
    orderId: order.id,
    fields: {
      clientFailureCode: -15013,
      clientFailureKind: 'official_code',
      clientFailurePlatform: 'ios',
      clientFailureEnvVersion: 'develop',
      clientFailureSdkVersion: '3.8.12',
      clientFailureReportedAt: new Date('2026-07-24T00:11:00.000Z'),
      clientFailureReportCount: 3
    }
  });
  assert.equal(JSON.stringify(update).includes('must-not-be-persisted'), false);

  assert.deepEqual(
    await service.recordPaymentFailure(order.id, {
      failureKind: 'no_numeric_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12',
      errMsg: 'must-not-be-persisted'
    }, actor),
    { recorded: true }
  );
  assert.equal(update.fields.clientFailureCode, null);
  assert.equal(update.fields.clientFailureKind, 'no_numeric_code');
  assert.equal(JSON.stringify(update).includes('must-not-be-persisted'), false);

  assert.deepEqual(
    await service.recordPaymentFailure(order.id, {
      errCode: -99999,
      failureKind: 'unrecognized_numeric_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }, actor),
    { recorded: true }
  );
  assert.equal(update.fields.clientFailureCode, -99999);
  assert.equal(update.fields.clientFailureKind, 'unrecognized_numeric_code');

  await assert.rejects(
    () => service.recordPaymentFailure(order.id, {
      errCode: -99999,
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }, actor),
    (error) => error && error.code === 'PAYMENT_FAILURE_REPORT_INVALID'
  );
  await assert.rejects(
    () => service.recordPaymentFailure(order.id, {
      errCode: -15013,
      failureKind: 'official_code',
      platform: 'ios',
      envVersion: 'develop',
      sdkVersion: '3.8.12'
    }, { ownerKey: 'owner-b', openId: 'openid-b' }),
    (error) => error && error.code === 'ORDER_NOT_FOUND'
  );
});
