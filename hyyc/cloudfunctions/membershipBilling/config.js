function localRuntimeConfig() {
  try {
    return require('./config.local');
  } catch (error) {
    return {};
  }
}

function enabled(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function integer(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function paymentEnvironment(value) {
  const parsed = Number(value);
  return [0, 1].includes(parsed) ? parsed : -1;
}

const runtime = localRuntimeConfig();
const value = (environmentKey, localKey, fallback = '') => (
  process.env[environmentKey] || runtime[localKey] || fallback
);

const PLAN = Object.freeze({
  key: 'pro_30d',
  name: '30 天会员',
  durationDays: 30,
  priceCents: integer(value(
    'WECHAT_VIRTUAL_PAY_PRO_30D_PRICE_CENTS',
    'wechatVirtualPayPro30dPriceCents',
    590
  )),
  compareAtPriceCents: integer(value(
    'WECHAT_VIRTUAL_PAY_PRO_30D_COMPARE_AT_PRICE_CENTS',
    'wechatVirtualPayPro30dCompareAtPriceCents',
    1090
  ))
});

const WECHAT_VIRTUAL_PAY_CONFIG = Object.freeze({
  memberPurchasesEnabled: enabled(value(
    'KNOWLEDGE_MEMBER_PURCHASES_ENABLED',
    'knowledgeMemberPurchasesEnabled'
  )),
  enabled: enabled(value('WECHAT_VIRTUAL_PAY_ENABLED', 'wechatVirtualPayEnabled')),
  releaseApproved: enabled(value(
    'WECHAT_VIRTUAL_PAY_RELEASE_APPROVED',
    'wechatVirtualPayReleaseApproved'
  )),
  environment: paymentEnvironment(value('WECHAT_VIRTUAL_PAY_ENV', 'wechatVirtualPayEnvironment', 0)),
  offerId: value('WECHAT_VIRTUAL_PAY_OFFER_ID', 'wechatVirtualPayOfferId'),
  appKey: value('WECHAT_VIRTUAL_PAY_APP_KEY', 'wechatVirtualPayAppKey'),
  productId: value('WECHAT_VIRTUAL_PAY_PRODUCT_ID', 'wechatVirtualPayProductId'),
  miniProgramAppId: value('WECHAT_MINIPROGRAM_APP_ID', 'wechatMiniProgramAppId', 'wxcb0f641838abf6e6'),
  miniProgramAppSecret: value('WECHAT_MINIPROGRAM_APP_SECRET', 'wechatMiniProgramAppSecret'),
  apiBaseUrl: value(
    'WECHAT_VIRTUAL_PAY_API_BASE_URL',
    'wechatVirtualPayApiBaseUrl',
    'https://api.weixin.qq.com'
  ),
  timeoutMs: integer(value('WECHAT_VIRTUAL_PAY_TIMEOUT_MS', 'wechatVirtualPayTimeoutMs'), 8000)
});

const WECHAT_MESSAGE_PUSH_CONFIG = Object.freeze({
  token: value('WECHAT_MESSAGE_PUSH_TOKEN', 'wechatMessagePushToken'),
  encodingAesKey: value(
    'WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY',
    'wechatMessagePushEncodingAesKey'
  ),
  miniProgramAppId: WECHAT_VIRTUAL_PAY_CONFIG.miniProgramAppId
});

function missingPaymentConfig(
  config = WECHAT_VIRTUAL_PAY_CONFIG,
  plan = PLAN,
  {
    requireMemberPurchases = true,
    requireReleaseApproval = true
  } = {}
) {
  const required = {
    ...(requireMemberPurchases
      ? { KNOWLEDGE_MEMBER_PURCHASES_ENABLED: config.memberPurchasesEnabled }
      : {}),
    WECHAT_VIRTUAL_PAY_ENABLED: config.enabled,
    ...(requireReleaseApproval
      ? { WECHAT_VIRTUAL_PAY_RELEASE_APPROVED: config.releaseApproved }
      : {}),
    WECHAT_VIRTUAL_PAY_OFFER_ID: config.offerId,
    WECHAT_VIRTUAL_PAY_APP_KEY: config.appKey,
    WECHAT_VIRTUAL_PAY_PRODUCT_ID: config.productId,
    WECHAT_MINIPROGRAM_APP_ID: config.miniProgramAppId,
    WECHAT_MINIPROGRAM_APP_SECRET: config.miniProgramAppSecret,
    WECHAT_VIRTUAL_PAY_PRO_30D_PRICE_CENTS: plan.priceCents
  };
  if (![0, 1].includes(config.environment)) required.WECHAT_VIRTUAL_PAY_ENV = config.environment;
  return Object.entries(required).filter(([, item]) => !item).map(([key]) => key);
}

function missingMessagePushConfig(config = WECHAT_MESSAGE_PUSH_CONFIG) {
  const required = {
    WECHAT_MESSAGE_PUSH_TOKEN: config.token,
    WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY: config.encodingAesKey,
    WECHAT_MINIPROGRAM_APP_ID: config.miniProgramAppId
  };
  return Object.entries(required).filter(([, item]) => !item).map(([key]) => key);
}

const COLLECTIONS = Object.freeze({
  orders: 'knowledge_membership_orders',
  memberships: 'knowledge_memberships'
});

module.exports = {
  PLAN,
  WECHAT_VIRTUAL_PAY_CONFIG,
  WECHAT_MESSAGE_PUSH_CONFIG,
  COLLECTIONS,
  missingPaymentConfig,
  missingMessagePushConfig,
  paymentEnvironment
};
