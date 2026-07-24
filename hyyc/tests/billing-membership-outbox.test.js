const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBillingRepository,
  membershipMessageEvent
} = require('../cloudfunctions/membershipBilling/repositories/billing-repository');

const COLLECTIONS = Object.freeze({
  checkoutLocks: 'knowledge_membership_checkout_locks',
  orders: 'knowledge_membership_orders',
  memberships: 'knowledge_memberships',
  messageEvents: 'knowledge_message_events'
});
const OWNER = 'a'.repeat(64);
const ORDER_ID = 'MP20260724160000abcdefabcdefabcd';
const NOW = new Date('2026-07-24T08:00:00.000Z');
const PLAN = { durationDays: 30 };
const PAYMENT = {
  providerStatus: 'paid',
  providerTransactionId: 'provider-transaction',
  channelOrderId: 'channel-order',
  wechatPayTransactionId: 'wechat-transaction',
  delivered: true,
  paidAt: NOW
};

function cloneCollections(source) {
  return new Map([...source].map(([name, documents]) => [
    name,
    new Map([...documents].map(([id, value]) => [id, structuredClone(value)]))
  ]));
}

function createMemoryDatabase(seed = {}, options = {}) {
  const collections = new Map(Object.entries(seed).map(([name, documents]) => [
    name,
    new Map(Object.entries(documents).map(([id, value]) => [id, structuredClone(value)]))
  ]));

  function collectionFrom(store, name) {
    if (!store.has(name)) store.set(name, new Map());
    const documents = store.get(name);
    return {
      doc(id) {
        return {
          async get() {
            if (!documents.has(id)) throw new Error('document not found');
            return {
              data: {
                ...structuredClone(documents.get(id)),
                _id: id
              }
            };
          },
          async set({ data }) {
            if (options.failSetCollection === name) {
              throw new Error('injected collection write failure');
            }
            if (Object.prototype.hasOwnProperty.call(data, '_id')) {
              throw new Error('cannot update database-managed _id');
            }
            documents.set(id, structuredClone(data));
          },
          async update({ data }) {
            if (!documents.has(id)) throw new Error('document not found');
            if (Object.prototype.hasOwnProperty.call(data, '_id')) {
              throw new Error('cannot update database-managed _id');
            }
            documents.set(id, {
              ...documents.get(id),
              ...structuredClone(data)
            });
          }
        };
      }
    };
  }

  return {
    async createCollection(name) {
      if (!collections.has(name)) collections.set(name, new Map());
    },
    collection(name) {
      return collectionFrom(collections, name);
    },
    async runTransaction(callback) {
      const staged = cloneCollections(collections);
      const result = await callback({
        collection(name) {
          return collectionFrom(staged, name);
        }
      });
      collections.clear();
      staged.forEach((documents, name) => collections.set(name, documents));
      return result;
    },
    read(name, id) {
      const value = collections.get(name) && collections.get(name).get(id);
      return value ? structuredClone(value) : null;
    }
  };
}

function pendingOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    ownerKey: OWNER,
    planKey: 'pro_30d',
    status: 'payment_pending',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

test('does not make payment-order creation depend on the message collection', async () => {
  const createdCollections = [];
  let storedOrder = null;
  const db = {
    async createCollection(name) {
      createdCollections.push(name);
      if (name === COLLECTIONS.messageEvents) {
        throw new Error('message collection unavailable');
      }
    },
    collection(name) {
      assert.equal(name, COLLECTIONS.orders);
      return {
        doc() {
          return {
            async set({ data }) {
              storedOrder = data;
            }
          };
        }
      };
    }
  };
  const repository = createBillingRepository(db, COLLECTIONS);
  const order = pendingOrder();

  await repository.createOrder(order);

  assert.deepEqual(createdCollections, [COLLECTIONS.orders]);
  assert.deepEqual(storedOrder, order);
});

test('commits membership, paid order, and success outbox event atomically', async () => {
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: pendingOrder() }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);
  const event = membershipMessageEvent(pendingOrder(), NOW);

  assert.equal(result.alreadyPaid, false);
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).status, 'paid');
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).reconciliationFailures, 0);
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).reconciliationErrorCode, '');
  assert.equal(db.read(COLLECTIONS.memberships, OWNER).status, 'active');
  assert.deepEqual(db.read(COLLECTIONS.messageEvents, event.id), event.data);
});

test('extends an active membership by 30 days from its future period end', async () => {
  const currentPeriodEnd = new Date('2026-09-22T08:00:00.000Z');
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: pendingOrder() },
    [COLLECTIONS.memberships]: {
      [OWNER]: {
        ownerKey: OWNER,
        planCode: 'pro',
        status: 'active',
        startsAt: new Date('2026-07-24T08:00:00.000Z'),
        currentPeriodEnd,
        source: 'wechat_virtual_pay',
        version: 2,
        updatedAt: NOW
      }
    }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);

  assert.equal(result.alreadyPaid, false);
  assert.equal(
    db.read(COLLECTIONS.memberships, OWNER).currentPeriodEnd.toISOString(),
    '2026-10-22T08:00:00.000Z'
  );
  assert.equal(db.read(COLLECTIONS.memberships, OWNER).version, 3);
});

test('starts a new 30-day period from now when the previous membership has expired', async () => {
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: pendingOrder() },
    [COLLECTIONS.memberships]: {
      [OWNER]: {
        ownerKey: OWNER,
        planCode: 'pro',
        status: 'expired',
        startsAt: new Date('2026-06-01T08:00:00.000Z'),
        currentPeriodEnd: new Date('2026-07-20T08:00:00.000Z'),
        source: 'wechat_virtual_pay',
        version: 1,
        updatedAt: NOW
      }
    }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);

  assert.equal(
    db.read(COLLECTIONS.memberships, OWNER).currentPeriodEnd.toISOString(),
    '2026-08-23T08:00:00.000Z'
  );
  assert.equal(db.read(COLLECTIONS.memberships, OWNER).status, 'active');
});

test('does not extend membership twice when the same paid order is replayed', async () => {
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: pendingOrder() }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);
  const periodEndAfterFirstFulfillment = db.read(
    COLLECTIONS.memberships,
    OWNER
  ).currentPeriodEnd.toISOString();
  const replay = await repository.fulfill(
    ORDER_ID,
    PAYMENT,
    PLAN,
    new Date(NOW.getTime() + (24 * 60 * 60 * 1000))
  );

  assert.equal(replay.alreadyPaid, true);
  assert.equal(
    db.read(COLLECTIONS.memberships, OWNER).currentPeriodEnd.toISOString(),
    periodEndAfterFirstFulfillment
  );
  assert.equal(periodEndAfterFirstFulfillment, '2026-08-23T08:00:00.000Z');
});

test('rolls back membership and order when the success event cannot be written', async () => {
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: pendingOrder() }
  }, {
    failSetCollection: COLLECTIONS.messageEvents
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  await assert.rejects(
    () => repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW),
    /injected collection write failure/
  );

  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).status, 'payment_pending');
  assert.equal(db.read(COLLECTIONS.memberships, OWNER), null);
});

test('backfills a missing success event for an already-paid order', async () => {
  const paidAt = new Date('2026-07-24T07:59:00.000Z');
  const order = pendingOrder({ status: 'paid', paidAt });
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: order }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);
  const event = membershipMessageEvent(order, paidAt);

  assert.equal(result.alreadyPaid, true);
  assert.deepEqual(db.read(COLLECTIONS.messageEvents, event.id), event.data);
});

test('never reopens an existing membership event during paid-order reconciliation', async () => {
  const order = pendingOrder({ status: 'paid', paidAt: NOW });
  const event = membershipMessageEvent(order, NOW);
  const completedEvent = {
    ...event.data,
    status: 'completed',
    attemptCount: 4,
    nextAttemptAt: null,
    claimId: '',
    completedAt: new Date('2026-07-24T08:01:00.000Z'),
    updatedAt: new Date('2026-07-24T08:01:00.000Z')
  };
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: order },
    [COLLECTIONS.messageEvents]: { [event.id]: completedEvent }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);

  assert.equal(result.alreadyPaid, true);
  assert.deepEqual(db.read(COLLECTIONS.messageEvents, event.id), completedEvent);
});

test('refunds a paid order and adjusts an existing membership without writing database-managed ids', async () => {
  const currentPeriodEnd = new Date('2026-09-22T08:00:00.000Z');
  const order = pendingOrder({ status: 'paid', paidAt: NOW });
  const membership = {
    ownerKey: OWNER,
    planCode: 'pro',
    status: 'active',
    startsAt: NOW,
    currentPeriodEnd,
    source: 'wechat_virtual_pay',
    version: 1,
    updatedAt: NOW
  };
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: order },
    [COLLECTIONS.memberships]: { [OWNER]: membership }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.markRefunded(
    ORDER_ID,
    { providerStatus: 'refunded', providerTransactionId: 'provider-transaction' },
    PLAN,
    NOW
  );

  assert.equal(result.alreadyRefunded, false);
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).status, 'refunded');
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).reconciliationFailures, 0);
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).reconciliationErrorCode, '');
  assert.equal(db.read(COLLECTIONS.memberships, OWNER).status, 'active');
  assert.equal(db.read(COLLECTIONS.memberships, OWNER).version, 2);
  assert.equal(
    db.read(COLLECTIONS.memberships, OWNER).currentPeriodEnd.toISOString(),
    '2026-08-23T08:00:00.000Z'
  );
});

test('never re-grants membership when a stale paid result arrives after a refund', async () => {
  const refundedOrder = pendingOrder({
    status: 'refunded',
    providerStatus: 8,
    refundedAt: NOW,
    nextCheckAt: null
  });
  const refundedMembership = {
    ownerKey: OWNER,
    planCode: 'pro',
    status: 'expired',
    startsAt: new Date(NOW.getTime() - (30 * 24 * 60 * 60 * 1000)),
    currentPeriodEnd: NOW,
    source: 'wechat_virtual_pay',
    version: 2,
    updatedAt: NOW
  };
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: refundedOrder },
    [COLLECTIONS.memberships]: { [OWNER]: refundedMembership }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.fulfill(ORDER_ID, PAYMENT, PLAN, new Date(NOW.getTime() + 1000));

  assert.equal(result.alreadyRefunded, true);
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).status, 'refunded');
  assert.deepEqual(db.read(COLLECTIONS.memberships, OWNER), refundedMembership);
  assert.equal(
    db.read(COLLECTIONS.messageEvents, membershipMessageEvent(refundedOrder, NOW).id),
    null
  );
});

test('converges on refunded when fulfillment commits before the refund and paid state is replayed', async () => {
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: pendingOrder() }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  await repository.fulfill(ORDER_ID, PAYMENT, PLAN, NOW);
  await repository.markRefunded(
    ORDER_ID,
    { providerStatus: 8, providerTransactionId: 'provider-transaction' },
    PLAN,
    new Date(NOW.getTime() + 1000)
  );
  const membershipAfterRefund = db.read(COLLECTIONS.memberships, OWNER);
  await repository.fulfill(
    ORDER_ID,
    PAYMENT,
    PLAN,
    new Date(NOW.getTime() + 2000)
  );

  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).status, 'refunded');
  assert.deepEqual(db.read(COLLECTIONS.memberships, OWNER), membershipAfterRefund);
});

test('never lets a stale paid-state update rewrite a refunded order', async () => {
  const refundedOrder = pendingOrder({
    status: 'refunded',
    providerStatus: 8,
    providerTransactionId: 'refund-transaction',
    nextCheckAt: null
  });
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: refundedOrder }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.transitionPaidOrder(ORDER_ID, {
    providerStatus: 1,
    providerTransactionId: 'stale-pending-transaction',
    nextCheckAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    updatedAt: new Date(NOW.getTime() + 1000)
  });

  assert.equal(result.status, 'refunded');
  assert.equal(result.providerStatus, 8);
  assert.equal(result.providerTransactionId, 'refund-transaction');
  assert.equal(result.nextCheckAt, null);
  assert.deepEqual(db.read(COLLECTIONS.orders, ORDER_ID), refundedOrder);
});

test('never lets a stale pending-provider result overwrite an already-paid order', async () => {
  const paidOrder = pendingOrder({
    status: 'paid',
    providerStatus: 4,
    paidAt: NOW
  });
  const db = createMemoryDatabase({
    [COLLECTIONS.orders]: { [ORDER_ID]: paidOrder }
  });
  const repository = createBillingRepository(db, COLLECTIONS);

  const result = await repository.transitionPendingOrder(ORDER_ID, {
    status: 'closed',
    providerStatus: 6,
    nextCheckAt: null,
    updatedAt: new Date(NOW.getTime() + 1000)
  });

  assert.equal(result.status, 'paid');
  assert.equal(result.providerStatus, 4);
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).status, 'paid');
  assert.equal(db.read(COLLECTIONS.orders, ORDER_ID).providerStatus, 4);
});

test('serializes checkout creation per owner and commits only with the active lease token', async () => {
  const db = createMemoryDatabase();
  const repository = createBillingRepository(db, COLLECTIONS);
  const firstToken = '1'.repeat(32);
  const secondToken = '2'.repeat(32);
  const expiresAt = new Date(NOW.getTime() + 90 * 1000);
  const order = pendingOrder({
    openId: 'open-id',
    provider: 'wechat_virtual_pay',
    amountCents: 590,
    goodsPriceCents: 590,
    productId: 'membership-30-days',
    environment: 0
  });

  assert.equal(
    (await repository.acquireCheckoutLease(OWNER, firstToken, NOW, expiresAt)).acquired,
    true
  );
  assert.equal(
    (await repository.acquireCheckoutLease(OWNER, secondToken, NOW, expiresAt)).acquired,
    false
  );
  await assert.rejects(
    () => repository.commitCheckoutOrder(
      OWNER,
      order.openId,
      secondToken,
      order,
      NOW
    ),
    (error) => error && error.code === 'PAYMENT_CHECKOUT_LEASE_LOST'
  );

  assert.equal(
    (await repository.commitCheckoutOrder(
      OWNER,
      order.openId,
      firstToken,
      order,
      NOW
    )).id,
    order.id
  );
  assert.equal(db.read(COLLECTIONS.orders, order.id).status, 'payment_pending');
  assert.equal(await repository.releaseCheckoutLease(OWNER, secondToken, NOW), false);
  assert.equal(await repository.releaseCheckoutLease(OWNER, firstToken, NOW), true);
});

test('lets an expired checkout lease be replaced without allowing the old token to overwrite it', async () => {
  const db = createMemoryDatabase();
  const repository = createBillingRepository(db, COLLECTIONS);
  const firstToken = 'a'.repeat(32);
  const secondToken = 'b'.repeat(32);
  const firstExpiry = new Date(NOW.getTime() + 90 * 1000);
  const takeoverAt = new Date(firstExpiry.getTime() + 1);
  const secondExpiry = new Date(takeoverAt.getTime() + 90 * 1000);
  const order = pendingOrder({
    openId: 'open-id',
    provider: 'wechat_virtual_pay',
    amountCents: 590,
    goodsPriceCents: 590,
    productId: 'membership-30-days',
    environment: 0
  });

  await repository.acquireCheckoutLease(OWNER, firstToken, NOW, firstExpiry);
  assert.equal(
    (await repository.acquireCheckoutLease(
      OWNER,
      secondToken,
      takeoverAt,
      secondExpiry
    )).acquired,
    true
  );
  assert.equal(await repository.releaseCheckoutLease(OWNER, firstToken, takeoverAt), false);
  await assert.rejects(
    () => repository.commitCheckoutOrder(
      OWNER,
      order.openId,
      firstToken,
      order,
      takeoverAt
    ),
    (error) => error && error.code === 'PAYMENT_CHECKOUT_LEASE_LOST'
  );
  assert.equal(
    (await repository.commitCheckoutOrder(
      OWNER,
      order.openId,
      secondToken,
      order,
      takeoverAt
    )).id,
    order.id
  );
});
