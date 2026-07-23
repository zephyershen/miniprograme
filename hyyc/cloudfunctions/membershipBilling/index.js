const cloud = require('wx-server-sdk');
const {
  PLAN,
  WECHAT_VIRTUAL_PAY_CONFIG,
  WECHAT_MESSAGE_PUSH_CONFIG,
  COLLECTIONS,
  missingPaymentConfig,
  missingMessagePushConfig
} = require('./config');
const { createWechatVirtualPayClient } = require('./adapters/wechat-virtual-pay-client');
const { createWechatMessagePushHandler } = require('./adapters/wechat-message-push-handler');
const { createBillingRepository } = require('./repositories/billing-repository');
const { createBillingService } = require('./services/billing-service');
const { resolveActor } = require('./lib/identity');
const { BillingError, ok, fail } = require('./lib/errors');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createBillingRepository(cloud.database(), COLLECTIONS);
const paymentClient = createWechatVirtualPayClient({ config: WECHAT_VIRTUAL_PAY_CONFIG });
const billingService = createBillingService({
  repository,
  paymentClient,
  config: WECHAT_VIRTUAL_PAY_CONFIG,
  plan: PLAN,
  missingConfig: missingPaymentConfig
});
const handleWechatMessagePush = createWechatMessagePushHandler({
  config: WECHAT_MESSAGE_PUSH_CONFIG,
  billingService,
  missingConfig: missingMessagePushConfig
});

const RECONCILIATION_TRIGGER = 'membership-billing-reconcile';

function isReconciliationTrigger(event, triggerSource = process.env.TRIGGER_SRC) {
  return Boolean(
    event
    && event.Type === 'Timer'
    && event.TriggerName === RECONCILIATION_TRIGGER
    && triggerSource === 'timer'
  );
}

const ACTIONS = Object.freeze({
  plans: async () => billingService.getPlans(),
  createPayment: async (event) => billingService.createPayment(
    event.planKey,
    event.loginCode,
    resolveActor(() => cloud.getWXContext())
  ),
  orderStatus: async (event) => billingService.queryOrder(
    event.orderId,
    resolveActor(() => cloud.getWXContext())
  )
});

async function main(event = {}) {
  if (event && (event.httpMethod
    || event.requestContext && event.requestContext.http && event.requestContext.http.method)) {
    return handleWechatMessagePush(event);
  }
  try {
    if (isReconciliationTrigger(event)) return ok(await billingService.reconcilePending(20));
    if (event && event.Type === 'Timer') {
      throw new BillingError('INVALID_TRIGGER', '不支持的定时任务', 403);
    }
    const handler = ACTIONS[event.action || 'plans'];
    if (!handler) throw new BillingError('INVALID_REQUEST', '不支持的支付操作');
    return ok(await handler(event));
  } catch (error) {
    return fail(error);
  }
}

exports.main = main;
exports.isReconciliationTrigger = isReconciliationTrigger;
