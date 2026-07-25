const { callCloudFunction } = require('../../services/cloud-functions.js');
const { memberPurchasesEnabled } = require('../membership/access.js');
const { verifyViewerAccount } = require('../account/api.js');

function getBillingPlans() {
  return callCloudFunction('membershipBilling', { action: 'plans' });
}

function createMembershipPayment(planKey, loginCode, access) {
  if (!memberPurchasesEnabled(access)) {
    const error = new Error('会员购买正在开通，请稍后再试');
    error.code = 'PAYMENT_NOT_READY';
    throw error;
  }
  return callCloudFunction('membershipBilling', { action: 'createPayment', planKey, loginCode });
}

function verifyMembershipAccount(loginCode) {
  return verifyViewerAccount(loginCode);
}

function getMembershipOrderStatus(orderId) {
  return callCloudFunction('membershipBilling', { action: 'orderStatus', orderId });
}

function reportMembershipPaymentFailure(orderId, diagnostic) {
  const source = diagnostic && typeof diagnostic === 'object' ? diagnostic : {};
  return callCloudFunction('membershipBilling', {
    action: 'paymentFailure',
    orderId,
    ...(Number.isInteger(source.errCode) ? { errCode: source.errCode } : {}),
    failureKind: source.failureKind,
    platform: source.platform,
    envVersion: source.envVersion,
    sdkVersion: source.sdkVersion
  });
}

module.exports = {
  getBillingPlans,
  verifyMembershipAccount,
  createMembershipPayment,
  getMembershipOrderStatus,
  reportMembershipPaymentFailure
};
