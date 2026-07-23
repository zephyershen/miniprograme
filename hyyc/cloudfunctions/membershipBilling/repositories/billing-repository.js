function alreadyExists(error) {
  return /already exists|exist|DATABASE_COLLECTION_EXIST/i.test(
    `${error && error.errCode || ''} ${error && error.code || ''} ${error && error.message || ''}`
  );
}

function notFound(error) {
  return Boolean(error && (
    error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || '')
  ));
}

const RECONCILABLE_STATUS_VALUES = Object.freeze(['payment_pending', 'paid']);
const RECONCILABLE_STATUSES = Object.freeze(new Set(RECONCILABLE_STATUS_VALUES));

function reconciliationTimestamp(order) {
  const value = order && order.nextCheckAt;
  const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : Number.POSITIVE_INFINITY;
}

function compareReconciliationOrders(left, right) {
  const timeDifference = reconciliationTimestamp(left) - reconciliationTimestamp(right);
  if (timeDifference) return timeDifference;
  return String(left && (left.id || left._id) || '')
    .localeCompare(String(right && (right.id || right._id) || ''));
}

function createBillingRepository(db, collections) {
  let ready = null;
  async function ensureCollections() {
    if (!ready) {
      ready = Promise.all(Object.values(collections).map((name) => db.createCollection(name)
        .catch((error) => { if (!alreadyExists(error)) throw error; })))
        .catch((error) => { ready = null; throw error; });
    }
    return ready;
  }

  async function createOrder(order) {
    await ensureCollections();
    await db.collection(collections.orders).doc(order.id).set({ data: order });
    return order;
  }

  async function getOrder(orderId) {
    await ensureCollections();
    try {
      return (await db.collection(collections.orders).doc(orderId).get()).data;
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  }

  async function updateOrder(orderId, fields) {
    await ensureCollections();
    await db.collection(collections.orders).doc(orderId).update({ data: fields });
    return getOrder(orderId);
  }

  async function findOrderByPaymentId(paymentId) {
    await ensureCollections();
    const normalized = String(paymentId || '').trim();
    if (!normalized || normalized.length > 128) return null;

    const direct = /^MP\d{14}[a-f0-9]{16}$/.test(normalized)
      ? await getOrder(normalized)
      : null;
    if (direct) return direct;

    const fields = ['providerTransactionId', 'channelOrderId', 'wechatPayTransactionId'];
    const responses = await Promise.all(fields.map((field) => db.collection(collections.orders)
      .where({ [field]: normalized })
      .limit(2)
      .get()));
    const unique = new Map();
    responses.forEach((response) => {
      ((response && response.data) || []).forEach((order) => {
        const key = String(order && (order.id || order._id) || '');
        if (key) unique.set(key, order);
      });
    });
    return unique.size === 1 ? [...unique.values()][0] : null;
  }

  async function fulfill(orderId, payment, plan, now = new Date()) {
    await ensureCollections();
    const transactionResult = await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(collections.orders).doc(orderId);
      const currentOrder = (await orderRef.get()).data;
      if (!currentOrder) throw new Error('ORDER_NOT_FOUND');
      if (currentOrder.status === 'paid') return { order: currentOrder, alreadyPaid: true };
      const membershipRef = transaction.collection(collections.memberships).doc(currentOrder.ownerKey);
      let currentMembership = null;
      try {
        currentMembership = (await membershipRef.get()).data;
      } catch (error) {
        if (!notFound(error)) throw error;
      }
      const currentEnd = currentMembership && currentMembership.currentPeriodEnd;
      const currentEndDate = currentEnd && typeof currentEnd.toDate === 'function'
        ? currentEnd.toDate()
        : new Date(currentEnd || 0);
      const baseMs = Number.isFinite(currentEndDate.getTime()) && currentEndDate.getTime() > now.getTime()
        ? currentEndDate.getTime()
        : now.getTime();
      const currentPeriodEnd = new Date(baseMs + (plan.durationDays * 24 * 60 * 60 * 1000));
      const paidOrder = {
        ...currentOrder,
        status: 'paid',
        providerStatus: payment.providerStatus,
        providerTransactionId: payment.providerTransactionId || currentOrder.providerTransactionId || '',
        channelOrderId: payment.channelOrderId || currentOrder.channelOrderId || '',
        wechatPayTransactionId: payment.wechatPayTransactionId || currentOrder.wechatPayTransactionId || '',
        deliveryStatus: payment.delivered ? 'delivered' : 'pending',
        deliveredAt: payment.delivered ? now : currentOrder.deliveredAt || null,
        paidAt: payment.paidAt || now,
        updatedAt: now
      };
      const membership = {
        ownerKey: currentOrder.ownerKey,
        planCode: 'pro',
        status: 'active',
        startsAt: currentMembership && currentMembership.startsAt || now,
        currentPeriodEnd,
        graceUntil: null,
        renewalState: 'none',
        source: 'wechat_virtual_pay',
        lastOrderId: currentOrder.id,
        version: Math.max(0, Number(currentMembership && currentMembership.version) || 0) + 1,
        updatedAt: now
      };
      await membershipRef.set({ data: membership });
      await orderRef.set({ data: paidOrder });
      return { order: paidOrder, membership, alreadyPaid: false };
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function markRefunded(orderId, payment, plan, now = new Date()) {
    await ensureCollections();
    const transactionResult = await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(collections.orders).doc(orderId);
      const currentOrder = (await orderRef.get()).data;
      if (!currentOrder) throw new Error('ORDER_NOT_FOUND');
      if (currentOrder.status === 'refunded') return { order: currentOrder, alreadyRefunded: true };

      const refundedOrder = {
        ...currentOrder,
        status: 'refunded',
        providerStatus: payment.providerStatus,
        providerTransactionId: payment.providerTransactionId || currentOrder.providerTransactionId || '',
        refundedAt: now,
        nextCheckAt: null,
        updatedAt: now
      };
      await orderRef.set({ data: refundedOrder });

      if (currentOrder.status !== 'paid') {
        return { order: refundedOrder, alreadyRefunded: false };
      }

      const membershipRef = transaction.collection(collections.memberships).doc(currentOrder.ownerKey);
      let membership = null;
      try {
        membership = (await membershipRef.get()).data;
      } catch (error) {
        if (!notFound(error)) throw error;
      }
      if (!membership || membership.source !== 'wechat_virtual_pay') {
        return { order: refundedOrder, membership, alreadyRefunded: false };
      }

      const currentEnd = membership.currentPeriodEnd && typeof membership.currentPeriodEnd.toDate === 'function'
        ? membership.currentPeriodEnd.toDate()
        : new Date(membership.currentPeriodEnd || 0);
      const reducedEndMs = Math.max(
        now.getTime(),
        (Number.isFinite(currentEnd.getTime()) ? currentEnd.getTime() : now.getTime())
          - (plan.durationDays * 24 * 60 * 60 * 1000)
      );
      const adjustedMembership = {
        ...membership,
        status: reducedEndMs > now.getTime() ? 'active' : 'expired',
        currentPeriodEnd: new Date(reducedEndMs),
        lastRefundedOrderId: currentOrder.id,
        version: Math.max(0, Number(membership.version) || 0) + 1,
        updatedAt: now
      };
      await membershipRef.set({ data: adjustedMembership });
      return { order: refundedOrder, membership: adjustedMembership, alreadyRefunded: false };
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function listReconciliationOrders(limit = 20, referenceNow = new Date()) {
    await ensureCollections();
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const response = await db.collection(collections.orders)
      .where({
        status: db.command.in(RECONCILABLE_STATUS_VALUES),
        nextCheckAt: db.command.lte(referenceNow)
      })
      .orderBy('nextCheckAt', 'asc')
      .limit(safeLimit)
      .get();
    return ((response && response.data) || [])
      .filter((order) => RECONCILABLE_STATUSES.has(order && order.status))
      .sort(compareReconciliationOrders)
      .slice(0, safeLimit);
  }

  return {
    ensureCollections,
    createOrder,
    getOrder,
    findOrderByPaymentId,
    updateOrder,
    fulfill,
    markRefunded,
    listReconciliationOrders
  };
}

module.exports = {
  RECONCILABLE_STATUS_VALUES,
  RECONCILABLE_STATUSES,
  reconciliationTimestamp,
  compareReconciliationOrders,
  alreadyExists,
  notFound,
  createBillingRepository
};
