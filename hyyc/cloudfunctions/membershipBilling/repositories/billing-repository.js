const crypto = require('node:crypto');

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

function withoutDocumentId(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
  const { _id, ...data } = document;
  return data;
}

function checkoutLockId(ownerKey) {
  return crypto.createHash('sha256')
    .update(`membership_checkout:${String(ownerKey || '').trim()}`)
    .digest('hex');
}

function repositoryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function dateValue(value) {
  const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function assertActiveCheckoutLease(lock, ownerKey, leaseToken, referenceNow) {
  const expiresAt = dateValue(lock && lock.leaseExpiresAt);
  if (!lock
    || lock.ownerKey !== ownerKey
    || lock.leaseToken !== leaseToken
    || !expiresAt
    || expiresAt.getTime() <= referenceNow.getTime()) {
    throw repositoryError('PAYMENT_CHECKOUT_LEASE_LOST');
  }
}

async function documentOrNull(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
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

function membershipMessageEvent(order, createdAt) {
  const type = 'membership_succeeded';
  const sourceId = order.id || order._id;
  const id = crypto.createHash('sha256').update(`${type}:${sourceId}`).digest('hex');
  return {
    id,
    data: {
      type,
      sourceId,
      ownerKey: order.ownerKey,
      itemId: '',
      itemTitle: '',
      commentId: '',
      planKey: order.planKey || '',
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: createdAt,
      claimId: '',
      claimedAt: null,
      claimExpiresAt: null,
      createdAt,
      updatedAt: createdAt
    }
  };
}

function createBillingRepository(db, collections) {
  const readiness = new Map();

  async function ensureCollection(name) {
    if (!name) return null;
    if (!readiness.has(name)) {
      const pending = db.createCollection(name)
        .catch((error) => {
          if (!alreadyExists(error)) throw error;
          return null;
        })
        .catch((error) => {
          readiness.delete(name);
          throw error;
        });
      readiness.set(name, pending);
    }
    return readiness.get(name);
  }

  async function ensureCollections(names = Object.values(collections)) {
    return Promise.all([...new Set(names.filter(Boolean))].map(ensureCollection));
  }

  async function createOrder(order) {
    await ensureCollections([collections.orders]);
    await db.collection(collections.orders).doc(order.id).set({
      data: withoutDocumentId(order)
    });
    return order;
  }

  async function getOrder(orderId) {
    await ensureCollections([collections.orders]);
    try {
      return (await db.collection(collections.orders).doc(orderId).get()).data;
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  }

  async function updateOrder(orderId, fields) {
    await ensureCollections([collections.orders]);
    await db.collection(collections.orders).doc(orderId).update({
      data: withoutDocumentId(fields)
    });
    return getOrder(orderId);
  }

  async function transitionOrderFromStatus(orderId, expectedStatus, fields) {
    await ensureCollections([collections.orders]);
    const normalizedOrderId = String(orderId || '').trim();
    const normalizedExpectedStatus = String(expectedStatus || '').trim();
    if (!normalizedOrderId || !normalizedExpectedStatus
      || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw repositoryError('PAYMENT_ORDER_TRANSITION_INVALID');
    }
    const transactionResult = await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(collections.orders).doc(normalizedOrderId);
      const currentOrder = await documentOrNull(orderRef);
      if (!currentOrder) throw repositoryError('ORDER_NOT_FOUND');
      if (currentOrder.status !== normalizedExpectedStatus) return currentOrder;
      const transitionedOrder = {
        ...currentOrder,
        ...withoutDocumentId(fields)
      };
      await orderRef.set({ data: withoutDocumentId(transitionedOrder) });
      return transitionedOrder;
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function transitionPendingOrder(orderId, fields) {
    return transitionOrderFromStatus(orderId, 'payment_pending', fields);
  }

  async function transitionPaidOrder(orderId, fields) {
    return transitionOrderFromStatus(orderId, 'paid', fields);
  }

  async function acquireCheckoutLease(
    ownerKey,
    leaseToken,
    acquiredAt,
    leaseExpiresAt
  ) {
    await ensureCollections([collections.checkoutLocks]);
    const normalizedOwner = String(ownerKey || '').trim();
    const normalizedToken = String(leaseToken || '').trim();
    const nowDate = dateValue(acquiredAt);
    const expiryDate = dateValue(leaseExpiresAt);
    if (!normalizedOwner || !normalizedToken || !nowDate || !expiryDate
      || expiryDate.getTime() <= nowDate.getTime()) {
      throw repositoryError('PAYMENT_CHECKOUT_LEASE_INVALID');
    }
    const transactionResult = await db.runTransaction(async (transaction) => {
      const lockRef = transaction.collection(collections.checkoutLocks)
        .doc(checkoutLockId(normalizedOwner));
      const currentLock = await documentOrNull(lockRef);
      if (currentLock && currentLock.ownerKey && currentLock.ownerKey !== normalizedOwner) {
        throw repositoryError('PAYMENT_CHECKOUT_OWNER_MISMATCH');
      }
      const currentExpiry = dateValue(currentLock && currentLock.leaseExpiresAt);
      if (currentLock
        && currentLock.leaseToken
        && currentExpiry
        && currentExpiry.getTime() > nowDate.getTime()) {
        return {
          acquired: false,
          orderId: String(currentLock.orderId || ''),
          leaseExpiresAt: currentExpiry
        };
      }
      const lock = {
        ...withoutDocumentId(currentLock || {}),
        ownerKey: normalizedOwner,
        state: 'leased',
        leaseToken: normalizedToken,
        leaseExpiresAt: expiryDate,
        orderId: String(currentLock && currentLock.orderId || ''),
        createdAt: currentLock && currentLock.createdAt || nowDate,
        updatedAt: nowDate
      };
      await lockRef.set({ data: withoutDocumentId(lock) });
      return {
        acquired: true,
        orderId: lock.orderId,
        leaseExpiresAt: expiryDate
      };
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function commitCheckoutOrder(
    ownerKey,
    openId,
    leaseToken,
    order,
    referenceNow = new Date()
  ) {
    await ensureCollections([collections.checkoutLocks, collections.orders]);
    const normalizedOwner = String(ownerKey || '').trim();
    const normalizedOpenId = String(openId || '').trim();
    const normalizedToken = String(leaseToken || '').trim();
    const nowDate = dateValue(referenceNow);
    if (!normalizedOwner || !normalizedOpenId || !normalizedToken || !nowDate
      || !order || order.ownerKey !== normalizedOwner || order.openId !== normalizedOpenId
      || order.status !== 'payment_pending') {
      throw repositoryError('PAYMENT_CHECKOUT_COMMIT_INVALID');
    }
    const transactionResult = await db.runTransaction(async (transaction) => {
      const lockRef = transaction.collection(collections.checkoutLocks)
        .doc(checkoutLockId(normalizedOwner));
      const lock = await documentOrNull(lockRef);
      assertActiveCheckoutLease(lock, normalizedOwner, normalizedToken, nowDate);
      const orderRef = transaction.collection(collections.orders).doc(order.id);
      const existingOrder = await documentOrNull(orderRef);
      if (existingOrder) throw repositoryError('PAYMENT_CHECKOUT_ORDER_EXISTS');
      await orderRef.set({ data: withoutDocumentId(order) });
      await lockRef.set({
        data: withoutDocumentId({
          ...lock,
          state: 'committed',
          orderId: order.id,
          updatedAt: nowDate
        })
      });
      return order;
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function bindCheckoutOrder(
    ownerKey,
    openId,
    leaseToken,
    orderId,
    referenceNow = new Date()
  ) {
    await ensureCollections([collections.checkoutLocks, collections.orders]);
    const normalizedOwner = String(ownerKey || '').trim();
    const normalizedOpenId = String(openId || '').trim();
    const normalizedToken = String(leaseToken || '').trim();
    const normalizedOrderId = String(orderId || '').trim();
    const nowDate = dateValue(referenceNow);
    if (!normalizedOwner || !normalizedOpenId || !normalizedToken || !normalizedOrderId || !nowDate) {
      throw repositoryError('PAYMENT_CHECKOUT_BIND_INVALID');
    }
    const transactionResult = await db.runTransaction(async (transaction) => {
      const lockRef = transaction.collection(collections.checkoutLocks)
        .doc(checkoutLockId(normalizedOwner));
      const lock = await documentOrNull(lockRef);
      assertActiveCheckoutLease(lock, normalizedOwner, normalizedToken, nowDate);
      const orderRef = transaction.collection(collections.orders).doc(normalizedOrderId);
      const order = await documentOrNull(orderRef);
      if (!order
        || order.ownerKey !== normalizedOwner
        || order.openId !== normalizedOpenId
        || order.status !== 'payment_pending') {
        throw repositoryError('PAYMENT_CHECKOUT_ORDER_MISMATCH');
      }
      await lockRef.set({
        data: withoutDocumentId({
          ...lock,
          state: 'committed',
          orderId: normalizedOrderId,
          updatedAt: nowDate
        })
      });
      return order;
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function releaseCheckoutLease(
    ownerKey,
    leaseToken,
    releasedAt = new Date()
  ) {
    await ensureCollections([collections.checkoutLocks]);
    const normalizedOwner = String(ownerKey || '').trim();
    const normalizedToken = String(leaseToken || '').trim();
    const nowDate = dateValue(releasedAt);
    if (!normalizedOwner || !normalizedToken || !nowDate) return false;
    const transactionResult = await db.runTransaction(async (transaction) => {
      const lockRef = transaction.collection(collections.checkoutLocks)
        .doc(checkoutLockId(normalizedOwner));
      const lock = await documentOrNull(lockRef);
      if (!lock) return false;
      if (lock.ownerKey !== normalizedOwner) {
        throw repositoryError('PAYMENT_CHECKOUT_OWNER_MISMATCH');
      }
      if (lock.leaseToken !== normalizedToken) return false;
      await lockRef.set({
        data: withoutDocumentId({
          ...lock,
          state: 'idle',
          leaseToken: '',
          leaseExpiresAt: null,
          updatedAt: nowDate
        })
      });
      return true;
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function findLatestPendingOrderByOwner(ownerKey) {
    await ensureCollections([collections.orders]);
    const normalized = String(ownerKey || '').trim();
    if (!normalized) return null;
    const response = await db.collection(collections.orders)
      .where({
        ownerKey: normalized,
        status: 'payment_pending'
      })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    return response && response.data && response.data[0] || null;
  }

  async function findOrderByPaymentId(paymentId) {
    await ensureCollections([collections.orders]);
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
    await ensureCollections([
      collections.orders,
      collections.memberships,
      collections.messageEvents
    ]);
    const transactionResult = await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(collections.orders).doc(orderId);
      const currentOrder = (await orderRef.get()).data;
      if (!currentOrder) throw new Error('ORDER_NOT_FOUND');
      if (currentOrder.status === 'refunded') {
        return {
          order: currentOrder,
          alreadyPaid: false,
          alreadyRefunded: true
        };
      }
      const messageEvent = collections.messageEvents
        ? membershipMessageEvent(
          currentOrder,
          currentOrder.status === 'paid'
            ? (currentOrder.paidAt || currentOrder.updatedAt || now)
            : now
        )
        : null;
      const messageEventRef = messageEvent
        ? transaction.collection(collections.messageEvents).doc(messageEvent.id)
        : null;
      const currentMessageEvent = messageEventRef
        ? await documentOrNull(messageEventRef)
        : null;
      if (currentOrder.status === 'paid') {
        if (messageEventRef && !currentMessageEvent) {
          await messageEventRef.set({ data: withoutDocumentId(messageEvent.data) });
        }
        return { order: currentOrder, alreadyPaid: true };
      }
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
      const paidOrderUpdate = {
        status: 'paid',
        providerStatus: payment.providerStatus,
        providerTransactionId: payment.providerTransactionId || currentOrder.providerTransactionId || '',
        channelOrderId: payment.channelOrderId || currentOrder.channelOrderId || '',
        wechatPayTransactionId: payment.wechatPayTransactionId || currentOrder.wechatPayTransactionId || '',
        deliveryStatus: payment.delivered ? 'delivered' : 'pending',
        deliveredAt: payment.delivered ? now : currentOrder.deliveredAt || null,
        paidAt: payment.paidAt || now,
        reconciliationFailures: 0,
        reconciliationErrorCode: '',
        updatedAt: now
      };
      const paidOrder = {
        ...currentOrder,
        ...paidOrderUpdate
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
      await membershipRef.set({ data: withoutDocumentId(membership) });
      await orderRef.set({ data: withoutDocumentId(paidOrder) });
      if (messageEventRef && !currentMessageEvent) {
        await messageEventRef.set({ data: withoutDocumentId(messageEvent.data) });
      }
      return { order: paidOrder, membership, alreadyPaid: false };
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function markRefunded(orderId, payment, plan, now = new Date()) {
    await ensureCollections([collections.orders, collections.memberships]);
    const transactionResult = await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(collections.orders).doc(orderId);
      const currentOrder = (await orderRef.get()).data;
      if (!currentOrder) throw new Error('ORDER_NOT_FOUND');
      if (currentOrder.status === 'refunded') return { order: currentOrder, alreadyRefunded: true };

      const refundedOrderUpdate = {
        status: 'refunded',
        providerStatus: payment.providerStatus,
        providerTransactionId: payment.providerTransactionId || currentOrder.providerTransactionId || '',
        refundedAt: now,
        reconciliationFailures: 0,
        reconciliationErrorCode: '',
        nextCheckAt: null,
        updatedAt: now
      };
      const refundedOrder = {
        ...currentOrder,
        ...refundedOrderUpdate
      };
      await orderRef.set({ data: withoutDocumentId(refundedOrder) });

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
      const adjustedMembershipUpdate = {
        status: reducedEndMs > now.getTime() ? 'active' : 'expired',
        currentPeriodEnd: new Date(reducedEndMs),
        lastRefundedOrderId: currentOrder.id,
        version: Math.max(0, Number(membership.version) || 0) + 1,
        updatedAt: now
      };
      const adjustedMembership = {
        ...membership,
        ...adjustedMembershipUpdate
      };
      await membershipRef.set({ data: withoutDocumentId(adjustedMembership) });
      return { order: refundedOrder, membership: adjustedMembership, alreadyRefunded: false };
    });
    return transactionResult && Object.prototype.hasOwnProperty.call(transactionResult, 'result')
      ? transactionResult.result
      : transactionResult;
  }

  async function listReconciliationOrders(limit = 20, referenceNow = new Date()) {
    await ensureCollections([collections.orders]);
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
    transitionPendingOrder,
    transitionPaidOrder,
    acquireCheckoutLease,
    commitCheckoutOrder,
    bindCheckoutOrder,
    releaseCheckoutLease,
    findLatestPendingOrderByOwner,
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
  membershipMessageEvent,
  withoutDocumentId,
  checkoutLockId,
  alreadyExists,
  notFound,
  createBillingRepository
};
