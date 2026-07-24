const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBillingRepository,
  membershipMessageEvent
} = require('../cloudfunctions/membershipBilling/repositories/billing-repository');

const COLLECTIONS = Object.freeze({
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
            return { data: structuredClone(documents.get(id)) };
          },
          async set({ data }) {
            if (options.failSetCollection === name) {
              throw new Error('injected collection write failure');
            }
            documents.set(id, structuredClone(data));
          },
          async update({ data }) {
            if (!documents.has(id)) throw new Error('document not found');
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
  assert.equal(db.read(COLLECTIONS.memberships, OWNER).status, 'active');
  assert.deepEqual(db.read(COLLECTIONS.messageEvents, event.id), event.data);
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
