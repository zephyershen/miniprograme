const test = require('node:test');
const assert = require('node:assert/strict');
const {
  messageSignature,
  verifyMessageSignature,
  decryptWechatMessage,
  encryptWechatMessage,
  encryptWechatResponse
} = require('../cloudfunctions/membershipBilling/lib/wechat-message-crypto');
const {
  IOS_REFUND_QUERY_EVENT,
  GOODS_DELIVERY_EVENT,
  REFUND_NOTIFY_EVENT,
  createWechatMessagePushHandler
} = require('../cloudfunctions/membershipBilling/adapters/wechat-message-push-handler');
const {
  createBillingService
} = require('../cloudfunctions/membershipBilling/services/billing-service');

const MESSAGE_CONFIG = Object.freeze({
  token: 'AAAAA',
  encodingAesKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  miniProgramAppId: 'wxba5fad812f8e6fb9'
});

const PAYMENT_CONFIG = Object.freeze({
  enabled: true,
  environment: 0,
  offerId: 'offer-123',
  appKey: 'payment-app-key',
  productId: 'pro_30d',
  miniProgramAppId: MESSAGE_CONFIG.miniProgramAppId,
  miniProgramAppSecret: 'app-secret',
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

const ORDER = Object.freeze({
  id: 'MP20260720140000abcdefabcdefabcd',
  openId: 'open-id',
  ownerKey: 'owner-key',
  provider: 'wechat_virtual_pay',
  providerTransactionId: 'wx-order-id',
  channelOrderId: 'apple-channel-bill',
  wechatPayTransactionId: 'wechat-pay-id',
  planKey: PLAN.key,
  productId: PAYMENT_CONFIG.productId,
  amountCents: PLAN.priceCents,
  goodsPriceCents: PLAN.goodsPriceCents,
  status: 'paid',
  deliveryStatus: 'delivered'
});

const OFFICIAL_ENCRYPTED_MESSAGE = '+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=';

function encryptedEvent(message, { timestamp = '1714112445', nonce = '415670741' } = {}) {
  const encrypted = encryptWechatMessage(JSON.stringify(message), {
    ...MESSAGE_CONFIG,
    randomBytes: () => Buffer.from('1234567890abcdef')
  });
  return {
    httpMethod: 'POST',
    queryStringParameters: {
      encrypt_type: 'aes',
      timestamp,
      nonce,
      msg_signature: messageSignature(MESSAGE_CONFIG.token, timestamp, nonce, encrypted)
    },
    body: JSON.stringify({ ToUserName: 'gh_test', Encrypt: encrypted })
  };
}

function decryptHandlerResponse(response) {
  assert.equal(response.statusCode, 200);
  const envelope = JSON.parse(response.body);
  assert.equal(verifyMessageSignature(
    envelope.MsgSignature,
    MESSAGE_CONFIG.token,
    envelope.TimeStamp,
    envelope.Nonce,
    envelope.Encrypt
  ), true);
  return JSON.parse(decryptWechatMessage(envelope.Encrypt, MESSAGE_CONFIG));
}

function refundQuery(overrides = {}) {
  return {
    MsgType: 'event',
    Event: IOS_REFUND_QUERY_EVENT,
    refund_time: '1784534400',
    order_time: '1784448000',
    channel_bill: ORDER.channelOrderId,
    bundleid: 'com.tencent.xin',
    product_id: PAYMENT_CONFIG.productId,
    p_count: '1',
    refund_request_reason: '用户申请退款',
    provide_status: '1',
    pay_order_id: ORDER.providerTransactionId,
    ...overrides
  };
}

function goodsDeliveryNotification(overrides = {}) {
  return {
    MsgType: 'event',
    Event: GOODS_DELIVERY_EVENT,
    OpenId: ORDER.openId,
    OutTradeNo: ORDER.id,
    Env: PAYMENT_CONFIG.environment,
    WeChatPayInfo: {
      MchOrderNo: 'wechat-merchant-order',
      TransactionId: ORDER.wechatPayTransactionId,
      PaidTime: 1784534400
    },
    GoodsInfo: {
      ProductId: PAYMENT_CONFIG.productId,
      Quantity: 1,
      OrigPrice: PLAN.goodsPriceCents,
      ActualPrice: PLAN.priceCents,
      Attach: `membership:${PLAN.key}`
    },
    ...overrides
  };
}

function refundNotification(overrides = {}) {
  return {
    MsgType: 'event',
    Event: REFUND_NOTIFY_EVENT,
    OpenId: ORDER.openId,
    WxRefundId: 'refund-id',
    MchRefundId: 'merchant-refund-id',
    WxOrderId: ORDER.providerTransactionId,
    MchOrderId: ORDER.id,
    RefundFee: PLAN.priceCents,
    RetCode: 0,
    RetMsg: 'success',
    RefundStartTimestamp: 1784534400,
    RefundSuccTimestamp: 1784534460,
    RetryTimes: 0,
    ...overrides
  };
}

test('matches the official WeChat secure-message request and response vectors', () => {
  assert.equal(verifyMessageSignature(
    '046e02f8204d34f8ba5fa3b1db94908f3df2e9b3',
    MESSAGE_CONFIG.token,
    '1714112445',
    '415670741',
    OFFICIAL_ENCRYPTED_MESSAGE
  ), true);
  assert.deepEqual(JSON.parse(decryptWechatMessage(OFFICIAL_ENCRYPTED_MESSAGE, MESSAGE_CONFIG)), {
    ToUserName: 'gh_97417a04a28d',
    FromUserName: 'o9AgO5Kd5ggOC-bXrbNODIiE3bGY',
    CreateTime: 1714112445,
    MsgType: 'event',
    Event: 'debug_demo',
    debug_str: 'hello world'
  });
  assert.throws(
    () => decryptWechatMessage(OFFICIAL_ENCRYPTED_MESSAGE, {
      ...MESSAGE_CONFIG,
      miniProgramAppId: 'wx-another-app'
    }),
    /消息来源无效/
  );

  assert.deepEqual(encryptWechatResponse(
    { demo_resp: 'good luck' },
    MESSAGE_CONFIG,
    {
      timestamp: 1713424427,
      nonce: '415670741',
      randomBytes: () => Buffer.from('707722b803182950')
    }
  ), {
    Encrypt: 'ELGduP2YcVatjqIS+eZbp80MNLoAUWvzzyJxgGzxZO/5sAvd070Bs6qrLARC9nVHm48Y4hyRbtzve1L32tmxSQ==',
    MsgSignature: '1b9339964ed2e271e7c7b6ff2b0ef902fc94dea1',
    TimeStamp: 1713424427,
    Nonce: '415670741'
  });
});

test('matches the official WeChat endpoint-verification vector', async () => {
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    billingService: {}
  });
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: {
      signature: 'f464b24fc39322e44b38aa78f5edd27bd1441696',
      echostr: '4375120948345356249',
      timestamp: '1714036504',
      nonce: '1514711492'
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '4375120948345356249');
});

test('rejects a forged message before any refund service runs', async () => {
  let calls = 0;
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    billingService: {
      async evaluateIosRefundQuery() { calls += 1; },
      async processRefundNotification() { calls += 1; }
    }
  });
  const event = encryptedEvent(refundQuery());
  event.queryStringParameters.msg_signature = '0'.repeat(40);
  const response = await handler(event);
  assert.equal(response.statusCode, 403);
  assert.equal(calls, 0);
});

test('returns an encrypted iOS refund recommendation only after service validation', async () => {
  const decision = {
    result_code: 0,
    result_info: '建议退款',
    evidence: '订单已核验；退款完成通知到达后将幂等回收对应30天权益'
  };
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    now: () => 1713424427000,
    randomBytes: () => Buffer.from('707722b803182950'),
    billingService: {
      async evaluateIosRefundQuery(message) {
        assert.equal(message.pay_order_id, ORDER.providerTransactionId);
        return decision;
      }
    }
  });
  assert.deepEqual(decryptHandlerResponse(await handler(encryptedEvent(refundQuery()))), decision);
});

test('acknowledges verified goods delivery only after service processing and requests retry on failure', async () => {
  let shouldFail = false;
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    now: () => 1713424427000,
    randomBytes: () => Buffer.from('707722b803182950'),
    billingService: {
      async processGoodsDeliveryNotification(message) {
        assert.equal(message.OutTradeNo, ORDER.id);
        if (shouldFail) throw new Error('temporary');
      }
    }
  });
  assert.deepEqual(
    decryptHandlerResponse(await handler(encryptedEvent(goodsDeliveryNotification()))),
    { ErrCode: 0, ErrMsg: 'success' }
  );
  shouldFail = true;
  assert.deepEqual(
    decryptHandlerResponse(await handler(encryptedEvent(goodsDeliveryNotification()))),
    { ErrCode: 1, ErrMsg: 'retry' }
  );
});

test('acknowledges a verified refund event in the encrypted response and requests retry on failure', async () => {
  let shouldFail = false;
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    now: () => 1713424427000,
    randomBytes: () => Buffer.from('707722b803182950'),
    billingService: {
      async processRefundNotification(message) {
        assert.equal(message.MchOrderId, ORDER.id);
        if (shouldFail) throw new Error('temporary');
      }
    }
  });
  assert.deepEqual(
    decryptHandlerResponse(await handler(encryptedEvent(refundNotification()))),
    { ErrCode: 0, ErrMsg: 'success' }
  );
  shouldFail = true;
  assert.deepEqual(
    decryptHandlerResponse(await handler(encryptedEvent(refundNotification()))),
    { ErrCode: 1, ErrMsg: 'retry' }
  );
});

test('refuses plaintext POST callbacks even when their basic token signature is valid', async () => {
  let calls = 0;
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    billingService: {
      async processRefundNotification() { calls += 1; }
    }
  });
  const timestamp = '1714112445';
  const nonce = '415670741';
  const response = await handler({
    httpMethod: 'POST',
    queryStringParameters: {
      timestamp,
      nonce,
      signature: messageSignature(MESSAGE_CONFIG.token, timestamp, nonce)
    },
    body: JSON.stringify(refundNotification())
  });
  assert.equal(response.statusCode, 403);
  assert.equal(calls, 0);
});

test('binds an iOS refund inquiry to one paid product and payment record', async () => {
  const repository = {
    async findOrderByPaymentId(value) {
      return [ORDER.providerTransactionId, ORDER.channelOrderId].includes(value) ? ORDER : null;
    }
  };
  const service = createBillingService({
    repository,
    paymentClient: {},
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });
  assert.equal((await service.evaluateIosRefundQuery(refundQuery())).result_code, 0);
  assert.equal((await service.evaluateIosRefundQuery(refundQuery({ product_id: 'another-product' }))).result_code, 1);
  assert.equal((await service.evaluateIosRefundQuery(refundQuery({ p_count: '2' }))).result_code, 1);
});

test('queries the official order before idempotent fulfillment and acknowledges the callback', async () => {
  const pendingOrder = {
    ...ORDER,
    goodsPriceCents: PLAN.goodsPriceCents,
    status: 'payment_pending',
    deliveryStatus: 'not_paid'
  };
  const calls = [];
  const repository = {
    async getOrder(orderId) {
      calls.push('get-order');
      return orderId === pendingOrder.id ? pendingOrder : null;
    },
    async fulfill(orderId) {
      calls.push('fulfill');
      return {
        order: {
          ...pendingOrder,
          id: orderId,
          status: 'paid',
          deliveryStatus: 'pending'
        }
      };
    },
    async updateOrder() { throw new Error('must not write after fulfillment'); }
  };
  const paymentClient = {
    async queryPayment(order) {
      calls.push('query-order');
      assert.equal(order.id, pendingOrder.id);
      return {
        state: 'S',
        orderId: pendingOrder.id,
        amountCents: PLAN.priceCents,
        paidAmountCents: PLAN.priceCents,
        providerStatus: 3,
        orderType: 7,
        environmentType: 1,
        providerTransactionId: ORDER.providerTransactionId,
        delivered: false
      };
    },
    async confirmDelivery() { throw new Error('must remain a background fallback'); }
  };
  const service = createBillingService({
    repository,
    paymentClient,
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  assert.deepEqual(
    await service.processGoodsDeliveryNotification(goodsDeliveryNotification()),
    { acknowledged: true, delivered: true }
  );
  assert.deepEqual(calls, [
    'get-order',
    'query-order',
    'fulfill'
  ]);
});

test('rejects mismatched goods delivery fields before querying or granting membership', async () => {
  const pendingOrder = {
    ...ORDER,
    goodsPriceCents: PLAN.goodsPriceCents,
    status: 'payment_pending',
    deliveryStatus: 'not_paid'
  };
  let queryCalls = 0;
  let fulfillCalls = 0;
  const service = createBillingService({
    repository: {
      async getOrder() { return pendingOrder; },
      async fulfill() { fulfillCalls += 1; }
    },
    paymentClient: {
      async queryPayment() {
        queryCalls += 1;
        return {};
      }
    },
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  await assert.rejects(
    () => service.processGoodsDeliveryNotification(goodsDeliveryNotification({
      OutTradeNo: 'invalid-order'
    })),
    /发货通知无效/
  );
  await assert.rejects(
    () => service.processGoodsDeliveryNotification(goodsDeliveryNotification({
      OpenId: 'another-user'
    })),
    /发货通知与订单不匹配/
  );
  await assert.rejects(
    () => service.processGoodsDeliveryNotification(goodsDeliveryNotification({
      GoodsInfo: {
        ProductId: PAYMENT_CONFIG.productId,
        Quantity: 1,
        OrigPrice: PLAN.goodsPriceCents,
        ActualPrice: 1090
      }
    })),
    /发货通知与订单不匹配/
  );
  assert.equal(queryCalls, 0);
  assert.equal(fulfillCalls, 0);
});

test('requests goods-delivery retry when the official order is not yet paid', async () => {
  const pendingOrder = {
    ...ORDER,
    goodsPriceCents: PLAN.goodsPriceCents,
    status: 'payment_pending',
    deliveryStatus: 'not_paid'
  };
  let fulfillCalls = 0;
  let updatedStatus = '';
  const service = createBillingService({
    repository: {
      async getOrder() { return pendingOrder; },
      async fulfill() { fulfillCalls += 1; },
      async updateOrder(orderId, fields) {
        updatedStatus = fields.status;
        return { ...pendingOrder, ...fields, id: orderId };
      }
    },
    paymentClient: {
      async queryPayment() {
        return {
          state: 'P',
          orderId: pendingOrder.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: 0,
          providerStatus: 1,
          orderType: 7,
          environmentType: 1,
          providerTransactionId: ORDER.providerTransactionId,
          delivered: false
        };
      }
    },
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  await assert.rejects(
    () => service.processGoodsDeliveryNotification(goodsDeliveryNotification()),
    /支付结果尚未确认/
  );
  assert.equal(updatedStatus, 'payment_pending');
  assert.equal(fulfillCalls, 0);
});

test('does not block a successful goods callback on any post-fulfillment fallback', async () => {
  const pendingOrder = {
    ...ORDER,
    goodsPriceCents: PLAN.goodsPriceCents,
    status: 'payment_pending',
    deliveryStatus: 'not_paid'
  };
  const service = createBillingService({
    repository: {
      async getOrder() { return pendingOrder; },
      async fulfill() {
        return {
          order: {
            ...pendingOrder,
            status: 'paid',
            deliveryStatus: 'pending'
          }
        };
      },
      async updateOrder() { throw new Error('must not write after fulfillment'); }
    },
    paymentClient: {
      async queryPayment() {
        return {
          state: 'S',
          orderId: pendingOrder.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: PLAN.priceCents,
          providerStatus: 3,
          orderType: 7,
          environmentType: 1,
          providerTransactionId: ORDER.providerTransactionId,
          delivered: false
        };
      },
      async confirmDelivery() {
        throw new Error('temporary');
      }
    },
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });

  assert.deepEqual(
    await service.processGoodsDeliveryNotification(goodsDeliveryNotification()),
    { acknowledged: true, delivered: true }
  );
});

test('returns an encrypted retry when the entitlement transaction fails', async () => {
  const pendingOrder = {
    ...ORDER,
    goodsPriceCents: PLAN.goodsPriceCents,
    status: 'payment_pending',
    deliveryStatus: 'not_paid'
  };
  let manualDeliveryCalls = 0;
  const service = createBillingService({
    repository: {
      async getOrder() { return pendingOrder; },
      async fulfill() { throw new Error('transaction failed'); }
    },
    paymentClient: {
      async queryPayment() {
        return {
          state: 'S',
          orderId: pendingOrder.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: PLAN.priceCents,
          providerStatus: 3,
          orderType: 7,
          environmentType: 1,
          providerTransactionId: ORDER.providerTransactionId,
          delivered: false
        };
      },
      async confirmDelivery() { manualDeliveryCalls += 1; }
    },
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    billingService: service
  });

  assert.deepEqual(
    decryptHandlerResponse(await handler(encryptedEvent(goodsDeliveryNotification()))),
    { ErrCode: 1, ErrMsg: 'retry' }
  );
  assert.equal(manualDeliveryCalls, 0);
});

test('acknowledges a repeated paid callback without granting membership twice', async () => {
  let currentOrder = {
    ...ORDER,
    goodsPriceCents: PLAN.goodsPriceCents,
    status: 'payment_pending',
    deliveryStatus: 'not_paid'
  };
  let membershipGrants = 0;
  let manualDeliveryCalls = 0;
  const service = createBillingService({
    repository: {
      async getOrder() { return currentOrder; },
      async fulfill() {
        if (currentOrder.status === 'paid') {
          return { order: currentOrder, alreadyPaid: true };
        }
        membershipGrants += 1;
        currentOrder = {
          ...currentOrder,
          status: 'paid',
          deliveryStatus: 'pending'
        };
        return { order: currentOrder, alreadyPaid: false };
      }
    },
    paymentClient: {
      async queryPayment() {
        return {
          state: 'S',
          orderId: currentOrder.id,
          amountCents: PLAN.priceCents,
          paidAmountCents: PLAN.priceCents,
          providerStatus: 3,
          orderType: 7,
          environmentType: 1,
          providerTransactionId: ORDER.providerTransactionId,
          delivered: false
        };
      },
      async confirmDelivery() { manualDeliveryCalls += 1; }
    },
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });
  const handler = createWechatMessagePushHandler({
    config: MESSAGE_CONFIG,
    missingConfig: () => [],
    billingService: service
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.deepEqual(
      decryptHandlerResponse(await handler(encryptedEvent(goodsDeliveryNotification()))),
      { ErrCode: 0, ErrMsg: 'success' }
    );
  }
  assert.equal(membershipGrants, 1);
  assert.equal(manualDeliveryCalls, 0);
});

test('confirms a refund with the official order API before idempotent entitlement recovery', async () => {
  let queryCalls = 0;
  let refundedOrderId = '';
  const repository = {
    async getOrder(orderId) { return orderId === ORDER.id ? ORDER : null; },
    async markRefunded(orderId) {
      refundedOrderId = orderId;
      return { order: { ...ORDER, status: 'refunded' } };
    }
  };
  const paymentClient = {
    async queryPayment() {
      queryCalls += 1;
      return {
        state: 'R',
        orderId: ORDER.id,
        amountCents: PLAN.priceCents,
        paidAmountCents: PLAN.priceCents,
        providerStatus: 8,
        orderType: 7,
        environmentType: 1,
        providerTransactionId: ORDER.providerTransactionId
      };
    }
  };
  const service = createBillingService({
    repository,
    paymentClient,
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });
  assert.deepEqual(await service.processRefundNotification(refundNotification()), {
    acknowledged: true,
    refunded: true
  });
  assert.equal(queryCalls, 1);
  assert.equal(refundedOrderId, ORDER.id);

  await assert.rejects(
    () => service.processRefundNotification(refundNotification({ OpenId: 'another-user' })),
    /退款通知与订单不匹配/
  );
  await assert.rejects(
    () => service.processRefundNotification(refundNotification({ RefundFee: 1090 })),
    /退款通知与订单不匹配/
  );
  assert.equal(queryCalls, 1);
});

test('acknowledges repeated and failed refund notices without recovering twice', async () => {
  let queryCalls = 0;
  const paymentClient = { async queryPayment() { queryCalls += 1; } };
  const failedService = createBillingService({
    repository: { async getOrder() { return ORDER; } },
    paymentClient,
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });
  assert.deepEqual(await failedService.processRefundNotification(
    refundNotification({ RetCode: 1 })
  ), { acknowledged: true, refunded: false });

  const repeatedService = createBillingService({
    repository: { async getOrder() { return { ...ORDER, status: 'refunded' }; } },
    paymentClient,
    config: PAYMENT_CONFIG,
    plan: PLAN,
    missingConfig: () => []
  });
  assert.deepEqual(await repeatedService.processRefundNotification(refundNotification()), {
    acknowledged: true,
    refunded: true
  });
  assert.equal(queryCalls, 0);
});
