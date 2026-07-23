const { BillingError } = require('../lib/errors');
const {
  MAX_MESSAGE_BYTES,
  verifyMessageSignature,
  decryptWechatMessage,
  encryptWechatResponse
} = require('../lib/wechat-message-crypto');

const IOS_REFUND_QUERY_EVENT = 'xpay_subscribe_ios_refund_query_notify';
const REFUND_NOTIFY_EVENT = 'xpay_refund_notify';

function httpResponse(statusCode, body, contentType = 'text/plain; charset=utf-8') {
  return {
    statusCode,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store'
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function requestMethod(event) {
  return String(
    event && (event.httpMethod
      || event.requestContext && event.requestContext.http && event.requestContext.http.method)
      || ''
  ).toUpperCase();
}

function requestQuery(event) {
  const query = event && (event.queryStringParameters || event.queryString || event.query);
  return query && typeof query === 'object' && !Array.isArray(query) ? query : {};
}

function requestBody(event) {
  let body = event && event.body;
  if (typeof body !== 'string') throw new BillingError('MESSAGE_PUSH_BODY_INVALID', '消息体无效', 400);
  if (event.isBase64Encoded === true) body = Buffer.from(body, 'base64').toString('utf8');
  if (!body || Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new BillingError('MESSAGE_PUSH_BODY_INVALID', '消息体无效', 400);
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch (error) {
    throw new BillingError('MESSAGE_PUSH_BODY_INVALID', '消息体无效', 400);
  }
}

function parseDecryptedEvent(encrypted, config) {
  let message;
  try {
    message = JSON.parse(decryptWechatMessage(encrypted, config));
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError('MESSAGE_PUSH_BODY_INVALID', '消息体无效', 400);
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || message.MsgType !== 'event' || typeof message.Event !== 'string') {
    throw new BillingError('MESSAGE_PUSH_EVENT_INVALID', '消息事件无效', 400);
  }
  return message;
}

function encryptedResponse(payload, config, query, options = {}) {
  return httpResponse(
    200,
    encryptWechatResponse(payload, config, { nonce: query.nonce, ...options }),
    'application/json; charset=utf-8'
  );
}

function createWechatMessagePushHandler({
  config,
  billingService,
  missingConfig = () => [],
  now = () => Date.now(),
  randomBytes
}) {
  function assertConfigured() {
    if (missingConfig(config).length) {
      throw new BillingError('MESSAGE_PUSH_NOT_READY', '消息推送尚未配置完成', 503);
    }
  }

  function verifyEncryptedRequest(query, encrypted) {
    if (query.encrypt_type !== 'aes' || !query.timestamp || !query.nonce
      || !query.msg_signature || !verifyMessageSignature(
        query.msg_signature,
        config.token,
        query.timestamp,
        query.nonce,
        encrypted
      )) {
      throw new BillingError('MESSAGE_PUSH_SIGNATURE_INVALID', '消息签名无效', 403);
    }
  }

  async function verifyEndpoint(query) {
    const echostr = String(query.echostr || '');
    if (!echostr || echostr.length > MAX_MESSAGE_BYTES) {
      throw new BillingError('MESSAGE_PUSH_VERIFY_INVALID', '消息验证无效', 400);
    }
    if (query.encrypt_type === 'aes' || query.msg_signature) {
      verifyEncryptedRequest(query, echostr);
      return httpResponse(200, decryptWechatMessage(echostr, config));
    }
    if (!query.signature || !query.timestamp || !query.nonce
      || !verifyMessageSignature(query.signature, config.token, query.timestamp, query.nonce)) {
      throw new BillingError('MESSAGE_PUSH_SIGNATURE_INVALID', '消息签名无效', 403);
    }
    return httpResponse(200, echostr);
  }

  async function handleNotification(event, query) {
    const body = requestBody(event);
    const encrypted = typeof body.Encrypt === 'string' ? body.Encrypt : '';
    verifyEncryptedRequest(query, encrypted);
    const message = parseDecryptedEvent(encrypted, config);
    const responseOptions = {
      timestamp: Math.floor(now() / 1000),
      randomBytes
    };

    if (message.Event === IOS_REFUND_QUERY_EVENT) {
      const decision = await billingService.evaluateIosRefundQuery(message);
      return encryptedResponse(decision, config, query, responseOptions);
    }
    if (message.Event === REFUND_NOTIFY_EVENT) {
      try {
        await billingService.processRefundNotification(message);
        return encryptedResponse({ ErrCode: 0, ErrMsg: 'success' }, config, query, responseOptions);
      } catch (error) {
        return encryptedResponse({ ErrCode: 1, ErrMsg: 'retry' }, config, query, responseOptions);
      }
    }
    throw new BillingError('MESSAGE_PUSH_EVENT_UNSUPPORTED', '消息事件不受支持', 400);
  }

  return async function handleWechatMessagePush(event = {}) {
    try {
      assertConfigured();
      const method = requestMethod(event);
      const query = requestQuery(event);
      if (method === 'GET') return await verifyEndpoint(query);
      if (method === 'POST') return await handleNotification(event, query);
      return httpResponse(405, 'method not allowed');
    } catch (error) {
      const statusCode = error instanceof BillingError ? error.statusCode : 500;
      return httpResponse(statusCode, statusCode === 503 ? 'unavailable' : 'forbidden');
    }
  };
}

module.exports = {
  IOS_REFUND_QUERY_EVENT,
  REFUND_NOTIFY_EVENT,
  httpResponse,
  requestMethod,
  requestQuery,
  requestBody,
  parseDecryptedEvent,
  createWechatMessagePushHandler
};
