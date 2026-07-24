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
  reconciliationRetryDelay,
  createBillingService
} = require('../cloudfunctions/membershipBilling/services/billing-service');
const {
  compareReconciliationOrders,
  createBillingRepository
} = require('../cloudfunctions/membershipBilling/repositories/billing-repository');
const {
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

test('maps every terminal virtual-payment state conservatively', () => {
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
  const repository = {
    async createOrder(order) { stored.set(order.id, order); return order; },
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
      orderType: 0, environmentType: 1
    }
  ), /支付金额校验失败/);
  assert.throws(() => service.validateProviderResult(
    { id: 'order', amountCents: 590 },
    {
      state: 'S', orderId: 'order', amountCents: 1090, paidAmountCents: 1090,
      orderType: 0, environmentType: 1
    }
  ), /支付金额校验失败/);
  assert.throws(() => service.validateProviderResult(
    { id: 'order', amountCents: 590 },
    {
      state: 'R', orderId: 'order', amountCents: 590, paidAmountCents: 1090,
      orderType: 7, environmentType: 1
    }
  ), /支付金额校验失败/);
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
