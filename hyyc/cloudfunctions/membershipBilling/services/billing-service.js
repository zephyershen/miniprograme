const crypto = require('node:crypto');
const { BillingError } = require('../lib/errors');
const { compactShanghaiDateTime } = require('../lib/time');
const { safeEqualText } = require('../lib/wechat-message-crypto');

const ORDER_ID_PATTERN = /^MP\d{14}[a-f0-9]{16}$/;
const OFFICIAL_VIRTUAL_PAYMENT_ERROR_CODES = new Set([
  1001,
  -1,
  -2,
  -4,
  -5,
  -15001,
  -15002,
  -15003,
  -15004,
  -15005,
  -15006,
  -15007,
  -15008,
  -15009,
  -15010,
  -15011,
  -15012,
  -15013,
  -15014,
  -15016,
  -15017,
  -15018,
  -15019,
  -15020,
  -15021
]);
const PAYMENT_FAILURE_PLATFORMS = new Set([
  'android',
  'devtools',
  'harmony',
  'ios',
  'mac',
  'ohos',
  'unknown',
  'windows'
]);
const PAYMENT_FAILURE_ENVIRONMENTS = new Set(['develop', 'trial', 'release', 'unknown']);
const PAYMENT_FAILURE_KINDS = new Set([
  'official_code',
  'unrecognized_numeric_code',
  'no_numeric_code'
]);

function centsToAmount(cents) {
  return (Math.max(0, Number(cents) || 0) / 100).toFixed(2);
}

function centsToPriceLabel(cents) {
  return `¥${centsToAmount(cents).replace(/\.?(?:0+)$/, '')}`;
}

function createOrderId(date = new Date()) {
  return `MP${compactShanghaiDateTime(date)}${crypto.randomBytes(8).toString('hex')}`;
}

function reconciliationRetryDelay(attempt) {
  const safeAttempt = Math.max(1, Math.min(10, Math.floor(Number(attempt) || 1)));
  return Math.min(6 * 60 * 60 * 1000, (15 * 60 * 1000) * (2 ** (safeAttempt - 1)));
}

function boundedText(value, maximum = 128, { required = true } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/.test(normalized)) return '';
  return normalized;
}

function positiveIntegerString(value) {
  const normalized = boundedText(value, 20);
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? Number(normalized) : 0;
}

function normalizePaymentFailureDiagnostic(value = {}) {
  const hasErrCode = value.errCode !== undefined
    && value.errCode !== null
    && value.errCode !== '';
  const errCode = hasErrCode ? Number(value.errCode) : null;
  const failureKind = boundedText(value.failureKind, 40);
  const platform = boundedText(value.platform, 24);
  const envVersion = boundedText(value.envVersion, 12);
  const sdkVersion = boundedText(value.sdkVersion, 20, { required: false });
  const codeMatchesKind = (
    failureKind === 'official_code'
      && Number.isInteger(errCode)
      && OFFICIAL_VIRTUAL_PAYMENT_ERROR_CODES.has(errCode)
  ) || (
    failureKind === 'unrecognized_numeric_code'
      && Number.isInteger(errCode)
      && errCode >= -999999
      && errCode <= 999999
      && !OFFICIAL_VIRTUAL_PAYMENT_ERROR_CODES.has(errCode)
  ) || (
    failureKind === 'no_numeric_code'
      && !hasErrCode
  );
  const valid = PAYMENT_FAILURE_KINDS.has(failureKind)
    && codeMatchesKind
    && PAYMENT_FAILURE_PLATFORMS.has(platform)
    && PAYMENT_FAILURE_ENVIRONMENTS.has(envVersion)
    && (!sdkVersion || /^\d{1,3}(?:\.\d{1,3}){1,3}$/.test(sdkVersion));
  if (!valid) {
    throw new BillingError('PAYMENT_FAILURE_REPORT_INVALID', '支付诊断信息无效', 400);
  }
  return { errCode, failureKind, platform, envVersion, sdkVersion };
}

function publicOrder(order) {
  return {
    id: order.id,
    planKey: order.planKey,
    status: order.status,
    amountCents: order.amountCents,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null
  };
}

function createBillingService({ repository, paymentClient, config, plan, missingConfig, now = () => new Date() }) {
  const nextCheckAt = (milliseconds) => new Date(now().getTime() + milliseconds);
  function available({
    requireMemberPurchases = true,
    requireReleaseApproval = true
  } = {}) {
    return missingConfig(config, plan, {
      requireMemberPurchases,
      requireReleaseApproval
    }).length === 0;
  }

  function getPlans() {
    const compareAtPriceCents = Number(plan.compareAtPriceCents) > Number(plan.priceCents)
      ? Number(plan.compareAtPriceCents)
      : 0;
    return {
      available: available(),
      plan: {
        key: plan.key,
        name: plan.name,
        durationDays: plan.durationDays,
        priceCents: plan.priceCents,
        priceLabel: plan.priceCents ? centsToPriceLabel(plan.priceCents) : '',
        compareAtPriceCents,
        compareAtPriceLabel: compareAtPriceCents ? centsToPriceLabel(compareAtPriceCents) : ''
      }
    };
  }

  function assertSalesAvailable() {
    if (!available()) {
      throw new BillingError('PAYMENT_NOT_READY', '会员购买正在开通，请稍后再试', 503);
    }
  }

  function assertProviderReady() {
    if (!available({
      requireMemberPurchases: false,
      requireReleaseApproval: false
    })) {
      throw new BillingError('PAYMENT_NOT_READY', '支付状态暂时无法确认，请稍后再试', 503);
    }
  }

  function assertPlan(planKey) {
    if (planKey !== plan.key) throw new BillingError('PLAN_INVALID', '请选择有效的会员方案');
  }

  function orderMatchesPlan(order) {
    return Boolean(order
      && order.provider === 'wechat_virtual_pay'
      && order.planKey === plan.key
      && Number(order.amountCents) === Number(plan.priceCents)
      && safeEqualText(order.productId || config.productId, config.productId));
  }

  function matchesKnownPaymentId(order, paymentId, { allowMerchantOrderId = true } = {}) {
    const normalized = boundedText(paymentId, 128);
    if (!normalized || !order) return false;
    return [
      allowMerchantOrderId ? order.id : '',
      order.providerTransactionId,
      order.channelOrderId,
      order.wechatPayTransactionId
    ].some((value) => value && safeEqualText(value, normalized));
  }

  function expectedGoodsPrice(order) {
    if (Number.isInteger(order && order.goodsPriceCents) && order.goodsPriceCents > 0) {
      return order.goodsPriceCents;
    }
    return Number(plan.goodsPriceCents);
  }

  function assertGoodsDeliveryNotification(notification, order) {
    const openId = boundedText(notification.OpenId, 128);
    const goodsInfo = notification.GoodsInfo;
    const productId = goodsInfo && !Array.isArray(goodsInfo)
      ? boundedText(goodsInfo.ProductId, 128)
      : '';
    const validShape = orderMatchesPlan(order)
      && openId
      && safeEqualText(order.openId, openId)
      && Number.isInteger(notification.Env)
      && notification.Env === config.environment
      && goodsInfo
      && typeof goodsInfo === 'object'
      && !Array.isArray(goodsInfo)
      && safeEqualText(productId, config.productId)
      && goodsInfo.Quantity === 1
      && goodsInfo.OrigPrice === expectedGoodsPrice(order)
      && goodsInfo.ActualPrice === order.amountCents;
    if (!validShape) {
      throw new BillingError('GOODS_DELIVERY_NOTIFICATION_MISMATCH', '发货通知与订单不匹配', 409);
    }
  }

  async function evaluateIosRefundQuery(notification = {}) {
    const payOrderId = boundedText(notification.pay_order_id, 128);
    const channelBill = boundedText(notification.channel_bill, 512);
    const productId = boundedText(notification.product_id, 128);
    const bundleId = boundedText(notification.bundleid, 256);
    const refundTime = positiveIntegerString(notification.refund_time);
    const orderTime = positiveIntegerString(notification.order_time);
    const quantity = positiveIntegerString(notification.p_count);
    const provideStatus = String(notification.provide_status ?? '');
    const validShape = payOrderId && channelBill && productId && bundleId
      && refundTime && orderTime && quantity === 1 && ['0', '1', '2'].includes(provideStatus);
    if (!validShape || !safeEqualText(productId, config.productId)) {
      return {
        result_code: 1,
        result_info: '订单校验未通过',
        evidence: '无法绑定本小程序已支付且已发放的会员订单'
      };
    }

    const [payOrder, channelOrder] = await Promise.all([
      repository.findOrderByPaymentId(payOrderId),
      repository.findOrderByPaymentId(channelBill)
    ]);
    if (payOrder && channelOrder && payOrder.id !== channelOrder.id) {
      return {
        result_code: 1,
        result_info: '订单校验未通过',
        evidence: '退款票据与支付订单无法唯一绑定'
      };
    }
    const order = payOrder || channelOrder;
    const validOrder = orderMatchesPlan(order)
      && ['paid', 'refunded'].includes(order.status)
      && matchesKnownPaymentId(order, payOrderId)
      && (!order.channelOrderId || safeEqualText(order.channelOrderId, channelBill));
    if (!validOrder) {
      return {
        result_code: 1,
        result_info: '订单校验未通过',
        evidence: '无法绑定本小程序已支付且已发放的会员订单'
      };
    }
    return {
      result_code: 0,
      result_info: '建议退款',
      evidence: '订单已核验；退款完成通知到达后将幂等回收对应30天权益'
    };
  }

  async function processGoodsDeliveryNotification(notification = {}) {
    assertProviderReady();
    const merchantOrderId = boundedText(notification.OutTradeNo, 64);
    if (!ORDER_ID_PATTERN.test(merchantOrderId)) {
      throw new BillingError('GOODS_DELIVERY_NOTIFICATION_INVALID', '发货通知无效', 400);
    }
    const order = await repository.getOrder(merchantOrderId);
    if (!order) {
      throw new BillingError('GOODS_DELIVERY_ORDER_NOT_FOUND', '没有找到这笔支付订单', 404);
    }
    assertGoodsDeliveryNotification(notification, order);

    const providerResult = await paymentClient.queryPayment(order);
    validateProviderResult(order, providerResult);
    if (providerResult.state !== 'S') {
      await applyProviderResult(order, providerResult);
      if (['F', 'R'].includes(providerResult.state)) {
        return { acknowledged: true, delivered: false };
      }
      throw new BillingError('GOODS_DELIVERY_NOT_CONFIRMED', '支付结果尚未确认', 409);
    }

    const deliveredOrder = await fulfillProviderOrder(order, providerResult);
    if (!deliveredOrder || deliveredOrder.deliveryStatus !== 'delivered') {
      throw new BillingError('GOODS_DELIVERY_CONFIRM_FAILED', '发货状态尚未确认', 503);
    }
    return { acknowledged: true, delivered: true };
  }

  async function processRefundNotification(notification = {}) {
    const merchantOrderId = boundedText(notification.MchOrderId, 64);
    const openId = boundedText(notification.OpenId, 128);
    const wechatOrderId = boundedText(notification.WxOrderId, 128);
    const refundFee = notification.RefundFee;
    const returnCode = notification.RetCode;
    if (!ORDER_ID_PATTERN.test(merchantOrderId) || !openId || !wechatOrderId
      || !Number.isInteger(refundFee) || refundFee <= 0 || !Number.isInteger(returnCode)) {
      throw new BillingError('REFUND_NOTIFICATION_INVALID', '退款通知无效', 400);
    }

    const order = await repository.getOrder(merchantOrderId);
    if (!orderMatchesPlan(order)
      || !safeEqualText(order.openId, openId)
      || !matchesKnownPaymentId(order, wechatOrderId, { allowMerchantOrderId: false })
      || refundFee !== order.amountCents) {
      throw new BillingError('REFUND_NOTIFICATION_MISMATCH', '退款通知与订单不匹配', 409);
    }
    if (returnCode !== 0) return { acknowledged: true, refunded: false };
    if (order.status === 'refunded') return { acknowledged: true, refunded: true };
    if (order.status !== 'paid') {
      throw new BillingError('REFUND_NOTIFICATION_MISMATCH', '退款通知与订单不匹配', 409);
    }

    const providerResult = await paymentClient.queryPayment(order);
    validateProviderResult(order, providerResult);
    if (providerResult.state !== 'R') {
      throw new BillingError('REFUND_NOT_CONFIRMED', '退款结果尚未确认', 409);
    }
    await applyProviderResult(order, providerResult);
    return { acknowledged: true, refunded: true };
  }

  function validateProviderResult(order, result) {
    if (!result || result.orderId !== order.id) {
      throw new BillingError('PAYMENT_RESULT_MISMATCH', '支付订单校验失败', 409);
    }
    if (!Number.isInteger(result.amountCents) || result.amountCents !== order.amountCents) {
      throw new BillingError('PAYMENT_AMOUNT_MISMATCH', '支付金额校验失败', 409);
    }
    if (![0, 7].includes(result.orderType)
      || result.environmentType !== (config.environment === 0 ? 1 : 2)) {
      throw new BillingError('PAYMENT_RESULT_MISMATCH', '支付订单校验失败', 409);
    }
    if (['S', 'R'].includes(result.state)
      && (!Number.isInteger(result.paidAmountCents) || result.paidAmountCents !== order.amountCents)) {
      throw new BillingError('PAYMENT_AMOUNT_MISMATCH', '支付金额校验失败', 409);
    }
  }

  async function markDelivery(order, delivered) {
    if (delivered || order.deliveryStatus === 'delivered') {
      return repository.updateOrder(order.id, {
        deliveryStatus: 'delivered',
        deliveryErrorCode: '',
        deliveredAt: order.deliveredAt || now(),
        nextCheckAt: nextCheckAt(24 * 60 * 60 * 1000),
        updatedAt: now()
      });
    }
    try {
      await paymentClient.confirmDelivery(order);
      return repository.updateOrder(order.id, {
        deliveryStatus: 'delivered',
        deliveryErrorCode: '',
        deliveredAt: now(),
        nextCheckAt: nextCheckAt(24 * 60 * 60 * 1000),
        updatedAt: now()
      });
    } catch (error) {
      await repository.updateOrder(order.id, {
        deliveryStatus: 'retry',
        deliveryErrorCode: error && error.code || 'DELIVERY_CONFIRM_FAILED',
        nextCheckAt: nextCheckAt(5 * 60 * 1000),
        updatedAt: now()
      }).catch(() => null);
      return order;
    }
  }

  async function fulfillProviderOrder(order, providerResult) {
    const fulfilled = await repository.fulfill(order.id, providerResult, plan, now());
    return markDelivery(fulfilled.order, providerResult.delivered);
  }

  async function applyProviderResult(order, providerResult) {
    validateProviderResult(order, providerResult);
    if (providerResult.state === 'S') {
      return { order: publicOrder(await fulfillProviderOrder(order, providerResult)) };
    }
    if (providerResult.state === 'R') {
      const refunded = await repository.markRefunded(order.id, providerResult, plan, now());
      return { order: publicOrder(refunded.order || refunded) };
    }
    if (order.status === 'paid') {
      const preserved = await repository.updateOrder(order.id, {
        providerStatus: providerResult.providerStatus,
        providerTransactionId: providerResult.providerTransactionId || order.providerTransactionId || '',
        nextCheckAt: nextCheckAt(60 * 60 * 1000),
        updatedAt: now()
      });
      return { order: publicOrder(preserved) };
    }
    if (providerResult.state === 'F') {
      const closed = await repository.updateOrder(order.id, {
        status: providerResult.providerStatus === 6 ? 'closed' : 'failed',
        providerStatus: providerResult.providerStatus,
        providerTransactionId: providerResult.providerTransactionId || order.providerTransactionId || '',
        nextCheckAt: null,
        updatedAt: now()
      });
      return { order: publicOrder(closed) };
    }
    const pending = await repository.updateOrder(order.id, {
      status: 'payment_pending',
      providerStatus: providerResult.providerStatus,
      providerTransactionId: providerResult.providerTransactionId || order.providerTransactionId || '',
      nextCheckAt: nextCheckAt(2 * 60 * 1000),
      updatedAt: now()
    });
    return { order: publicOrder(pending) };
  }

  async function createPayment(planKey, loginCode, actor) {
    assertSalesAvailable();
    assertPlan(planKey);
    const createdAt = now();
    const order = {
      id: createOrderId(createdAt),
      ownerKey: actor.ownerKey,
      openId: actor.openId,
      planKey: plan.key,
      amountCents: plan.priceCents,
      goodsPriceCents: plan.goodsPriceCents,
      goodsDescription: plan.name,
      productId: config.productId,
      environment: config.environment,
      provider: 'wechat_virtual_pay',
      providerStatus: 0,
      providerTransactionId: '',
      deliveryStatus: 'not_paid',
      status: 'created',
      createdAt,
      updatedAt: createdAt,
      nextCheckAt: createdAt,
      paidAt: null
    };
    let payment;
    try {
      payment = await paymentClient.createPayment(order, loginCode);
    } catch (error) {
      throw error;
    }
    await repository.createOrder({ ...order, status: 'payment_pending' });
    return { order: publicOrder({ ...order, status: 'payment_pending' }), payment };
  }

  async function getOwnedOrder(orderId, actor) {
    if (!ORDER_ID_PATTERN.test(String(orderId || ''))) {
      throw new BillingError('ORDER_INVALID', '支付订单无效');
    }
    const order = await repository.getOrder(orderId);
    if (!order || order.ownerKey !== actor.ownerKey || order.openId !== actor.openId) {
      throw new BillingError('ORDER_NOT_FOUND', '没有找到这笔支付订单', 404);
    }
    return order;
  }

  async function recordPaymentFailure(orderId, diagnostic, actor) {
    const normalized = normalizePaymentFailureDiagnostic(diagnostic);
    const order = await getOwnedOrder(orderId, actor);
    const reportedAt = now();
    await repository.updateOrder(order.id, {
      clientFailureCode: normalized.errCode,
      clientFailureKind: normalized.failureKind,
      clientFailurePlatform: normalized.platform,
      clientFailureEnvVersion: normalized.envVersion,
      clientFailureSdkVersion: normalized.sdkVersion,
      clientFailureReportedAt: reportedAt,
      clientFailureReportCount: Math.min(
        10,
        Math.max(0, Number(order.clientFailureReportCount) || 0) + 1
      )
    });
    return { recorded: true };
  }

  async function queryOrder(orderId, actor) {
    assertProviderReady();
    const order = await getOwnedOrder(orderId, actor);
    if (order.status === 'paid') {
      if (order.deliveryStatus !== 'delivered') await markDelivery(order, false);
      return { order: publicOrder(order) };
    }
    if (['failed', 'closed', 'refunded'].includes(order.status)) {
      return { order: publicOrder(order) };
    }
    return applyProviderResult(order, await paymentClient.queryPayment(order));
  }

  async function reconcileOrder(order) {
    if (!order || !order.id) return null;
    if (['failed', 'closed', 'refunded'].includes(order.status)) return order;
    const result = await applyProviderResult(order, await paymentClient.queryPayment(order));
    if (Number(order.reconciliationFailures) > 0) {
      await repository.updateOrder(order.id, {
        reconciliationFailures: 0,
        reconciliationErrorCode: '',
        updatedAt: now()
      }).catch(() => null);
    }
    return result.order;
  }

  async function reconcilePending(limit = 20) {
    assertProviderReady();
    const orders = await repository.listReconciliationOrders(
      Math.max(1, Math.min(50, Number(limit) || 20)),
      now()
    );
    const summary = { inspected: orders.length, updated: 0, failed: 0 };
    for (const order of orders) {
      try {
        await reconcileOrder(order);
        summary.updated += 1;
      } catch (error) {
        const reconciliationFailures = Math.min(
          10,
          Math.max(0, Math.floor(Number(order.reconciliationFailures) || 0)) + 1
        );
        await repository.updateOrder(order.id, {
          reconciliationFailures,
          reconciliationErrorCode: /^[A-Z0-9_]{3,80}$/.test(String(error && error.code || ''))
            ? error.code
            : 'PAYMENT_RECONCILIATION_FAILED',
          nextCheckAt: nextCheckAt(reconciliationRetryDelay(reconciliationFailures)),
          updatedAt: now()
        }).catch(() => null);
        summary.failed += 1;
      }
    }
    return summary;
  }

  return {
    getPlans,
    createPayment,
    queryOrder,
    reconcileOrder,
    reconcilePending,
    recordPaymentFailure,
    validateProviderResult,
    evaluateIosRefundQuery,
    processGoodsDeliveryNotification,
    processRefundNotification
  };
}

module.exports = {
  centsToAmount,
  centsToPriceLabel,
  createOrderId,
  reconciliationRetryDelay,
  publicOrder,
  boundedText,
  positiveIntegerString,
  normalizePaymentFailureDiagnostic,
  createBillingService
};
