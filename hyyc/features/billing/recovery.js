const { getMembershipOrderStatus } = require('./api.js');
const {
  pendingMembershipOrderId,
  forgetPendingMembershipOrder
} = require('./payment.js');
const { refreshMembershipAccess } = require('../membership/session.js');

let recovery = null;

async function performRecovery() {
  const orderId = pendingMembershipOrderId();
  if (!orderId) return null;
  const result = await getMembershipOrderStatus(orderId);
  const order = result && result.order;
  if (!order || (order.id && order.id !== orderId)) return null;
  if (order.status === 'paid') {
    await refreshMembershipAccess({ force: true });
    forgetPendingMembershipOrder(orderId);
  } else if (['failed', 'closed', 'refunded'].includes(order.status)) {
    forgetPendingMembershipOrder(orderId);
  }
  return order;
}

function recoverPendingMembershipOrder() {
  if (!recovery) {
    recovery = performRecovery().finally(() => {
      recovery = null;
    });
  }
  return recovery;
}

module.exports = { recoverPendingMembershipOrder };
