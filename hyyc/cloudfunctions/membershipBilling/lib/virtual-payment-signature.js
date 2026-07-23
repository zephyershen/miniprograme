const crypto = require('node:crypto');
const { BillingError } = require('./errors');

function hmacSha256Hex(key, message) {
  return crypto.createHmac('sha256', String(key || ''))
    .update(String(message || ''), 'utf8')
    .digest('hex');
}

function createPaySignature(uri, signData, appKey) {
  if (!uri || !signData || !appKey) {
    throw new BillingError('PAYMENT_CONFIG_INVALID', '支付服务尚未配置完成', 503);
  }
  return hmacSha256Hex(appKey, `${uri}&${signData}`);
}

function createUserSignature(signData, sessionKey) {
  if (!signData || !sessionKey) {
    throw new BillingError('PAYMENT_LOGIN_EXPIRED', '登录状态已过期，请重新发起支付', 401);
  }
  return hmacSha256Hex(sessionKey, signData);
}

function createDirectPurchasePayment({
  offerId,
  environment,
  productId,
  goodsPrice,
  activitySellingPrice,
  orderId,
  attach,
  appKey,
  sessionKey
}) {
  const paymentData = {
    offerId,
    buyQuantity: 1,
    env: environment,
    currencyType: 'CNY',
    productId,
    goodsPrice,
    outTradeNo: orderId,
    attach
  };
  if (Number.isInteger(activitySellingPrice)
    && activitySellingPrice > 0
    && activitySellingPrice < goodsPrice) {
    paymentData.activitySellingPrice = activitySellingPrice;
  }
  const signData = JSON.stringify(paymentData);
  return {
    signData,
    paySig: createPaySignature('requestVirtualPayment', signData, appKey),
    signature: createUserSignature(signData, sessionKey),
    mode: 'short_series_goods'
  };
}

module.exports = {
  hmacSha256Hex,
  createPaySignature,
  createUserSignature,
  createDirectPurchasePayment
};
