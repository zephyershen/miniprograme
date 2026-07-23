const { callCloudFunction } = require('../../services/cloud-functions.js');
const { memberPurchasesEnabled } = require('../membership/access.js');

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

function getMembershipOrderStatus(orderId) {
  return callCloudFunction('membershipBilling', { action: 'orderStatus', orderId });
}

module.exports = { getBillingPlans, createMembershipPayment, getMembershipOrderStatus };
