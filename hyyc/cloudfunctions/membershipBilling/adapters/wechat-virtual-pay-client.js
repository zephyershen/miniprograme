const { BillingError } = require('../lib/errors');
const {
  createPaySignature,
  createDirectPurchasePayment
} = require('../lib/virtual-payment-signature');

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function validLoginCode(value) {
  const code = String(value || '').trim();
  return code.length >= 8 && code.length <= 256 && !/[\u0000-\u001f\u007f]/.test(code) ? code : '';
}

function parseUnixSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function mapOrderState(status) {
  const value = Number(status);
  if ([2, 3, 4].includes(value)) return 'S';
  if ([5, 8].includes(value)) return 'R';
  if ([0, 6].includes(value)) return 'F';
  return 'P';
}

function createWechatVirtualPayClient({ config, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const apiBaseUrl = normalizedBaseUrl(config.apiBaseUrl);
  let tokenCache = null;

  async function fetchJson(url, options, errorCode, message, { allowEmpty = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      throw new BillingError(
        error && error.name === 'AbortError' ? 'PAYMENT_TIMEOUT' : errorCode,
        message,
        503
      );
    } finally {
      clearTimeout(timer);
    }
    let document;
    try {
      const bodyText = await response.text();
      document = bodyText ? JSON.parse(bodyText) : (allowEmpty ? {} : null);
    } catch (error) {
      throw new BillingError(errorCode, message, 502);
    }
    if (!response.ok || !document) throw new BillingError(errorCode, message, 502);
    return document;
  }

  async function exchangeLoginCode(loginCode) {
    const code = validLoginCode(loginCode);
    if (!code) throw new BillingError('PAYMENT_LOGIN_REQUIRED', '请重新发起支付', 400);
    const url = new URL(`${apiBaseUrl}/sns/jscode2session`);
    url.searchParams.set('appid', config.miniProgramAppId);
    url.searchParams.set('secret', config.miniProgramAppSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const result = await fetchJson(
      url.toString(),
      { method: 'GET' },
      'PAYMENT_LOGIN_FAILED',
      '登录状态校验失败，请重新发起支付'
    );
    if (Number(result.errcode || 0) !== 0 || !result.openid || !result.session_key) {
      throw new BillingError('PAYMENT_LOGIN_FAILED', '登录状态校验失败，请重新发起支付', 401);
    }
    return { openId: String(result.openid), sessionKey: String(result.session_key) };
  }

  async function getAccessToken(bypassCache = false) {
    if (!bypassCache && tokenCache && tokenCache.expiresAt > now() + 300000) {
      return tokenCache.value;
    }
    const result = await fetchJson(
      `${apiBaseUrl}/cgi-bin/stable_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credential',
          appid: config.miniProgramAppId,
          secret: config.miniProgramAppSecret,
          force_refresh: false
        })
      },
      'PAYMENT_TOKEN_FAILED',
      '支付结果暂时无法确认，请稍后刷新'
    );
    if (!result.access_token || Number(result.expires_in) <= 0) {
      throw new BillingError('PAYMENT_TOKEN_FAILED', '支付结果暂时无法确认，请稍后刷新', 502);
    }
    tokenCache = {
      value: String(result.access_token),
      expiresAt: now() + (Number(result.expires_in) * 1000)
    };
    return tokenCache.value;
  }

  async function callXpay(
    path,
    body,
    {
      signed = false,
      retry = true,
      allowEmpty = false,
      errorCode = 'PAYMENT_QUERY_FAILED',
      errorMessage = '支付结果暂时无法确认，请稍后刷新'
    } = {}
  ) {
    const bodyText = JSON.stringify(body);
    const token = await getAccessToken(false);
    const url = new URL(`${apiBaseUrl}${path}`);
    url.searchParams.set('access_token', token);
    if (signed) url.searchParams.set('pay_sig', createPaySignature(path, bodyText, config.appKey));
    const result = await fetchJson(
      url.toString(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText
      },
      errorCode,
      errorMessage,
      { allowEmpty }
    );
    if (retry && [40001, 40014, 42001].includes(Number(result.errcode))) {
      tokenCache = null;
      await getAccessToken(true);
      return callXpay(path, body, {
        signed,
        retry: false,
        allowEmpty,
        errorCode,
        errorMessage
      });
    }
    if (Number(result.errcode || 0) !== 0) {
      throw new BillingError(errorCode, errorMessage, 502);
    }
    return result;
  }

  async function createPayment(order, loginCode) {
    const session = await exchangeLoginCode(loginCode);
    if (session.openId !== order.openId) {
      throw new BillingError('PAYMENT_ACCOUNT_MISMATCH', '当前支付账号与登录账号不一致', 401);
    }
    return createDirectPurchasePayment({
      offerId: config.offerId,
      environment: config.environment,
      productId: config.productId,
      goodsPrice: order.goodsPriceCents,
      activitySellingPrice: order.goodsPriceCents > order.amountCents
        ? order.amountCents
        : undefined,
      orderId: order.id,
      attach: `membership:${order.planKey}`,
      appKey: config.appKey,
      sessionKey: session.sessionKey
    });
  }

  async function queryPayment(order) {
    const result = await callXpay('/xpay/query_order', {
      openid: order.openId,
      env: config.environment,
      order_id: order.id
    }, { signed: true });
    const providerOrder = result.order || {};
    const orderType = Number(providerOrder.order_type);
    const environmentType = Number(providerOrder.env_type);
    const expectedEnvironmentType = config.environment === 0 ? 1 : 2;
    if (![0, 7].includes(orderType) || environmentType !== expectedEnvironmentType) {
      throw new BillingError('PAYMENT_RESULT_MISMATCH', '支付订单校验失败', 409);
    }
    return {
      state: mapOrderState(providerOrder.status),
      orderId: String(providerOrder.order_id || ''),
      amountCents: Number(providerOrder.order_fee),
      paidAmountCents: Number(providerOrder.paid_fee),
      providerStatus: Number(providerOrder.status),
      orderType,
      environmentType,
      providerTransactionId: String(providerOrder.wx_order_id || ''),
      channelOrderId: String(providerOrder.channel_order_id || ''),
      wechatPayTransactionId: String(providerOrder.wxpay_order_id || ''),
      paidAt: parseUnixSeconds(providerOrder.paid_time),
      delivered: Number(providerOrder.status) === 4
    };
  }

  async function confirmDelivery(order) {
    await callXpay('/xpay/notify_provide_goods', {
      order_id: order.id,
      env: config.environment
    }, {
      signed: true,
      allowEmpty: true,
      errorCode: 'DELIVERY_CONFIRM_FAILED',
      errorMessage: '发货状态暂时无法确认'
    });
    return true;
  }

  return { createPayment, queryPayment, confirmDelivery, exchangeLoginCode, getAccessToken };
}

module.exports = {
  normalizedBaseUrl,
  validLoginCode,
  parseUnixSeconds,
  mapOrderState,
  createWechatVirtualPayClient
};
