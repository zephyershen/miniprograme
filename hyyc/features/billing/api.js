const { callCloudFunction } = require('../../services/cloud-functions.js');

function getBillingPlans() {
  return callCloudFunction('membershipBilling', { action: 'plans' });
}

function createMembershipPayment(planKey, loginCode) {
  return callCloudFunction('membershipBilling', { action: 'createPayment', planKey, loginCode });
}

function getMembershipOrderStatus(orderId) {
  return callCloudFunction('membershipBilling', { action: 'orderStatus', orderId });
}

module.exports = { getBillingPlans, createMembershipPayment, getMembershipOrderStatus };
