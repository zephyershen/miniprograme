const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUserMessageRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/user-message');
const {
  messageEventDocument
} = require('../cloudfunctions/knowledgeFeed/lib/message-event');

const OWNER = 'a'.repeat(64);
const PARTICIPANT = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);
const EVENT_AT = new Date('2026-07-24T08:00:00.000Z');

function notFound() {
  const error = new Error('document not found');
  error.errCode = -1;
  return error;
}

function createMemoryDb(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, documents]) => [
    name,
    new Map(Object.entries(documents).map(([id, value]) => [id, structuredClone(value)]))
  ]));
  const queryLog = [];
  let transactionHook = null;

  function store(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  function matches(document, filters) {
    return Object.entries(filters).every(([field, expected]) => {
      const actual = document[field];
      if (expected && expected.operator === 'lte') {
        return new Date(actual).getTime() <= new Date(expected.value).getTime();
      }
      if (expected && expected.operator === 'lt') {
        return new Date(actual).getTime() < new Date(expected.value).getTime();
      }
      return actual === expected;
    });
  }

  function collection(name) {
    return {
      doc(id) {
        return {
          async get() {
            const value = store(name).get(id);
            if (!value) throw notFound();
            return { data: structuredClone(value) };
          },
          async set({ data }) {
            store(name).set(id, structuredClone(data));
          },
          async update({ data }) {
            const value = store(name).get(id);
            if (!value) throw notFound();
            store(name).set(id, { ...value, ...structuredClone(data) });
          },
          async remove() {
            if (!store(name).has(id)) throw notFound();
            store(name).delete(id);
          }
        };
      },
      where(filters) {
        const orders = [];
        let offset = 0;
        let take = 100;
        queryLog.push({ name, filters, orders });
        return {
          orderBy(field, direction) {
            orders.push({ field, direction });
            return this;
          },
          skip(value) {
            offset = value;
            return this;
          },
          limit(value) {
            take = value;
            return this;
          },
          async get() {
            const rows = [...store(name)].map(([id, value]) => ({ _id: id, ...value }))
              .filter((document) => matches(document, filters))
              .sort((left, right) => {
                for (const order of orders) {
                  const leftValue = left[order.field] instanceof Date
                    ? left[order.field].getTime()
                    : left[order.field];
                  const rightValue = right[order.field] instanceof Date
                    ? right[order.field].getTime()
                    : right[order.field];
                  if (leftValue === rightValue) continue;
                  const result = leftValue < rightValue ? -1 : 1;
                  return order.direction === 'desc' ? -result : result;
                }
                return 0;
              });
            return { data: rows.slice(offset, offset + take) };
          },
          async count() {
            return {
              total: [...store(name).values()].filter((document) => (
                matches(document, filters)
              )).length
            };
          }
        };
      }
    };
  }

  return {
    stores,
    queryLog,
    setTransactionHook(hook) {
      transactionHook = hook;
    },
    command: {
      lte: (value) => ({ operator: 'lte', value }),
      lt: (value) => ({ operator: 'lt', value })
    },
    async createCollection(name) {
      store(name);
    },
    collection,
    async runTransaction(callback) {
      if (transactionHook) {
        const hook = transactionHook;
        transactionHook = null;
        await hook({ stores });
      }
      return callback({ collection });
    }
  };
}

function repository(db, overrides = {}) {
  return createUserMessageRepository(db, {
    messageEventsCollectionName: 'events',
    userMessagesCollectionName: 'messages',
    commentsCollectionName: 'comments',
    messageParticipantLimit: 10,
    messageParticipantScanLimit: 1000,
    userMessagePageSize: 50,
    ...overrides
  });
}

async function stageClaimedEvent(db, event, claimId = 'delivery-claim') {
  const { _id, ...document } = event;
  const claimed = {
    ...document,
    status: 'processing',
    claimId,
    deliveredOwnerKeys: []
  };
  await db.collection('events').doc(_id).set({ data: claimed });
  return { _id, ...claimed };
}

test('pushes the event-time cutoff into the participant query before applying its scan limit', async () => {
  const comments = {};
  for (let index = 0; index < 1005; index += 1) {
    comments[`after-${index}`] = {
      itemId: 'item-1',
      authorKey: OTHER,
      status: 'active',
      moderation: { status: 'approved' },
      createdAt: new Date(EVENT_AT.getTime() + 1000 + index)
    };
  }
  comments.before = {
    itemId: 'item-1',
    authorKey: PARTICIPANT,
    status: 'active',
    moderation: { status: 'approved' },
    createdAt: new Date(EVENT_AT.getTime() - 1000)
  };
  const db = createMemoryDb({ comments });

  const owners = await repository(db).participantOwnerKeys(
    'item-1',
    OWNER,
    10,
    EVENT_AT
  );

  assert.deepEqual(owners, [PARTICIPANT]);
  assert.equal(db.queryLog[0].filters.createdAt.operator, 'lte');
  assert.equal(db.queryLog[0].filters.createdAt.value.toISOString(), EVENT_AT.toISOString());
});

test('finds visible system messages beyond a full page of excluded comment notifications', async () => {
  const storedMessages = {};
  for (let index = 0; index < 120; index += 1) {
    storedMessages[`comment-${index}`] = {
      ownerKey: OWNER,
      category: 'comments',
      type: 'comment_received',
      unread: true,
      createdAt: new Date(EVENT_AT.getTime() + 1000 + index)
    };
  }
  storedMessages.profile = {
    ownerKey: OWNER,
    category: 'profile',
    type: 'profile_approved',
    unread: true,
    createdAt: EVENT_AT
  };
  storedMessages.membership = {
    ownerKey: OWNER,
    category: 'membership',
    type: 'membership_succeeded',
    unread: false,
    createdAt: new Date(EVENT_AT.getTime() - 1000)
  };
  const db = createMemoryDb({ messages: storedMessages });

  const listed = await repository(db).listOwnerMessages(OWNER, 50, {
    excludeCategories: ['COMMENTS']
  });

  assert.deepEqual(listed.map((message) => message._id), ['profile', 'membership']);
  assert.equal(db.queryLog.length, 2);
});

test('returns an empty list after reaching the end of only legacy comment messages', async () => {
  const db = createMemoryDb({
    messages: {
      current: {
        ownerKey: OWNER,
        category: 'comments',
        type: 'comment_received',
        createdAt: EVENT_AT
      },
      legacy: {
        ownerKey: OWNER,
        type: 'thread_comment_published',
        createdAt: new Date(EVENT_AT.getTime() - 1000)
      },
      activity: {
        ownerKey: OWNER,
        type: 'thread_activity',
        createdAt: new Date(EVENT_AT.getTime() - 2000)
      },
      discussion: {
        ownerKey: OWNER,
        category: 'discussion',
        type: 'legacy',
        createdAt: new Date(EVENT_AT.getTime() - 3000)
      },
      identifiers: {
        ownerKey: OWNER,
        type: 'legacy',
        commentId: 'legacy-comment',
        createdAt: new Date(EVENT_AT.getTime() - 4000)
      },
      nested: {
        ownerKey: OWNER,
        type: 'legacy',
        payload: {
          route: 'legacy',
          replyToCommentId: 'legacy-reply'
        },
        createdAt: new Date(EVENT_AT.getTime() - 5000)
      }
    }
  });

  const listed = await repository(db).listOwnerMessages(OWNER, 50, {
    excludeCategories: ['comments']
  });

  assert.deepEqual(listed, []);
  assert.equal(db.queryLog.length, 1);
});

test('keeps visible messages globally ordered and capped after multi-page filtering', async () => {
  const storedMessages = {};
  for (let index = 0; index < 110; index += 1) {
    storedMessages[`comment-${index}`] = {
      ownerKey: OWNER,
      category: 'comments',
      type: 'comment_received',
      createdAt: new Date(EVENT_AT.getTime() + 1000 + index)
    };
  }
  for (let index = 0; index < 60; index += 1) {
    storedMessages[`system-${index}`] = {
      ownerKey: OWNER,
      category: 'profile',
      type: 'profile_approved',
      createdAt: new Date(EVENT_AT.getTime() - index)
    };
  }
  const db = createMemoryDb({ messages: storedMessages });

  const listed = await repository(db).listOwnerMessages(OWNER, 50, {
    excludeCategories: ['comments']
  });

  assert.equal(listed.length, 50);
  assert.deepEqual(
    listed.map((message) => message._id),
    Array.from({ length: 50 }, (_, index) => `system-${index}`)
  );
  assert.equal(db.queryLog.length, 2);
});

test('fails explicitly instead of timing out or returning a partial filtered message list', async () => {
  const storedMessages = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
    `comment-${index}`,
    {
      ownerKey: OWNER,
      category: index === 100 ? undefined : 'comments',
      type: index === 100 ? 'thread_comment_published' : 'comment_received',
      unread: true,
      createdAt: new Date(EVENT_AT.getTime() + index)
    }
  ]));
  const db = createMemoryDb({ messages: storedMessages });

  await assert.rejects(
    () => repository(db, { userMessageListScanPageLimit: 1 })
      .listOwnerMessages(OWNER, 50, { excludeCategories: ['comments'] }),
    (error) => error && error.code === 'MESSAGE_LIST_SCAN_LIMIT'
  );
  assert.equal(db.queryLog.length, 1);
});

test('keeps replayed direct events read and uses the business event time', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const event = {
    ...messageEventDocument('membership_succeeded', 'order-1', {
      ownerKey: OWNER
    }, EVENT_AT)
  };
  const source = { type: 'membership_succeeded', category: 'membership', title: '会员已开通' };
  const deliveredAt = new Date(EVENT_AT.getTime() + 60000);

  const created = await messages.upsertDirectMessage(OWNER, event, source, deliveredAt);
  await messages.markRead(
    OWNER,
    created._id,
    event._id,
    new Date(deliveredAt.getTime() + 1000)
  );
  const replayed = await messages.upsertDirectMessage(OWNER, event, source, deliveredAt);

  assert.equal(replayed.unread, false);
  assert.equal(new Date(replayed.createdAt).toISOString(), EVENT_AT.toISOString());
  await assert.rejects(
    () => messages.markRead(OTHER, created._id, event._id, deliveredAt),
    (error) => error && error.code === 'MESSAGE_NOT_FOUND'
  );
});

test('deletes only the current owner message and updates unread totals', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const event = {
    ...messageEventDocument('profile_approved', 'delete-revision', {
      ownerKey: OWNER
    }, EVENT_AT)
  };
  const created = await messages.upsertDirectMessage(
    OWNER,
    event,
    { type: 'profile_approved', category: 'profile', title: '资料已通过' },
    EVENT_AT
  );

  await assert.rejects(
    () => messages.deleteMessage(OTHER, created._id),
    (error) => error && error.code === 'MESSAGE_NOT_FOUND'
  );
  assert.equal((await messages.listOwnerMessages(OWNER, 50)).length, 1);
  assert.equal(await messages.unreadCount(OWNER), 1);

  const removed = await messages.deleteMessage(OWNER, created._id);
  assert.equal(removed._id, created._id);
  assert.equal((await messages.listOwnerMessages(OWNER, 50)).length, 0);
  assert.equal(await messages.unreadCount(OWNER), 0);
  assert.equal(
    (await messages.deleteMessage(OWNER, created._id)).alreadyDeleted,
    true
  );
});

test('keeps each received comment as a distinct replay-safe interaction', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const first = {
    ...messageEventDocument('comment_approved', 'comment-1', {
      ownerKey: OWNER,
      itemId: 'item-1',
      itemTitle: '第一条资讯'
    }, EVENT_AT)
  };
  const secondAt = new Date(EVENT_AT.getTime() + 1000);
  const second = {
    ...messageEventDocument('comment_approved', 'comment-2', {
      ownerKey: OWNER,
      itemId: 'item-1',
      itemTitle: '第一条资讯'
    }, secondAt)
  };

  const claimedFirst = await stageClaimedEvent(db, first, 'first-claim');
  const firstMessage = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedFirst,
    EVENT_AT
  );
  await messages.markRead(
    PARTICIPANT,
    firstMessage._id,
    first._id,
    new Date(EVENT_AT.getTime() + 500)
  );
  const replayed = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedFirst,
    secondAt
  );
  const claimedSecond = await stageClaimedEvent(db, second, 'second-claim');
  const secondMessage = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedSecond,
    secondAt
  );
  const oldReplayAfterNew = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedFirst,
    new Date(secondAt.getTime() + 50)
  );
  const staleRead = await messages.markRead(
    PARTICIPANT,
    secondMessage._id,
    first._id,
    new Date(secondAt.getTime() + 100)
  );
  const listed = await messages.listOwnerMessages(PARTICIPANT, 50);

  assert.equal(replayed.unread, false);
  assert.notEqual(firstMessage._id, secondMessage._id);
  assert.equal(secondMessage.sourceEventId, second._id);
  assert.equal(oldReplayAfterNew.sourceEventId, first._id);
  assert.equal(oldReplayAfterNew.unread, false);
  assert.equal(staleRead.unread, true);
  assert.deepEqual(
    listed.map((message) => message._id),
    [secondMessage._id, firstMessage._id]
  );
  assert.deepEqual(
    db.stores.get('events').get(first._id).deliveredOwnerKeys,
    [PARTICIPANT]
  );
  assert.deepEqual(
    db.stores.get('events').get(second._id).deliveredOwnerKeys,
    [PARTICIPANT]
  );
  assert.equal(await messages.unreadCount(PARTICIPANT), 1);

  await messages.markRead(
    PARTICIPANT,
    secondMessage._id,
    second._id,
    new Date(secondAt.getTime() + 200)
  );
  assert.equal(await messages.unreadCount(PARTICIPANT), 0);
});

test('keeps a distinct same-millisecond received-comment event unread regardless of hash order', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const first = {
    ...messageEventDocument('comment_approved', 'same-ms-first', {
      ownerKey: OWNER,
      itemId: 'item-1'
    }, EVENT_AT)
  };
  const second = {
    ...messageEventDocument('comment_approved', 'same-ms-second', {
      ownerKey: OWNER,
      itemId: 'item-1'
    }, EVENT_AT)
  };
  const claimedFirst = await stageClaimedEvent(db, first, 'same-ms-first-claim');
  const firstMessage = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedFirst,
    EVENT_AT
  );
  await messages.markRead(
    PARTICIPANT,
    firstMessage._id,
    first._id,
    new Date(EVENT_AT.getTime() + 1)
  );
  const claimedSecond = await stageClaimedEvent(db, second, 'same-ms-second-claim');
  const secondMessage = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedSecond,
    new Date(EVENT_AT.getTime() + 2)
  );

  assert.equal(secondMessage.sourceEventId, second._id);
  assert.equal(secondMessage.unread, true);
  assert.deepEqual(
    db.stores.get('events').get(second._id).deliveredOwnerKeys,
    [PARTICIPANT]
  );
});

test('keeps an old interaction replay idempotent after more than sixty-four newer events', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const claimedEvents = [];
  let latestMessage = null;
  for (let index = 0; index < 65; index += 1) {
    const event = {
      ...messageEventDocument('comment_approved', `many-${index}`, {
        ownerKey: OWNER,
        itemId: 'item-1'
      }, new Date(EVENT_AT.getTime() + index))
    };
    const claimed = await stageClaimedEvent(db, event, `many-claim-${index}`);
    claimedEvents.push(claimed);
    latestMessage = await messages.upsertCommentThreadMessage(
      PARTICIPANT,
      claimed,
      new Date(EVENT_AT.getTime() + 1000 + index)
    );
  }
  await messages.markRead(
    PARTICIPANT,
    latestMessage._id,
    claimedEvents[64]._id,
    new Date(EVENT_AT.getTime() + 2000)
  );

  const replayed = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedEvents[0],
    new Date(EVENT_AT.getTime() + 3000)
  );
  assert.equal(replayed.sourceEventId, claimedEvents[0]._id);
  assert.equal(replayed.unread, true);
  assert.equal((await messages.listOwnerMessages(PARTICIPANT, 100)).length, 65);
});

test('marks unread messages only when their current version was delivered before the action', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const earlierAt = new Date(EVENT_AT.getTime() - 1000);
  const laterAt = new Date(EVENT_AT.getTime() + 1000);
  const source = { type: 'profile_approved', category: 'profile', title: '资料已通过' };
  await messages.upsertDirectMessage(OWNER, {
    ...messageEventDocument('profile_approved', 'revision-1', {
      ownerKey: OWNER
    }, earlierAt)
  }, source, earlierAt);
  const later = await messages.upsertDirectMessage(OWNER, {
    ...messageEventDocument('profile_approved', 'revision-2', {
      ownerKey: OWNER
    }, laterAt)
  }, source, laterAt);

  assert.equal(await messages.markAllRead(OWNER, EVENT_AT), 1);
  assert.equal(await messages.unreadCount(OWNER), 1);
  assert.equal((await messages.listOwnerMessages(OWNER, 50))
    .find((message) => message._id === later._id).unread, true);
});

test('does not clear a newer aggregate version that arrives after mark-all takes its snapshot', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const first = {
    ...messageEventDocument('comment_approved', 'comment-1', {
      ownerKey: OWNER,
      itemId: 'item-1'
    }, new Date(EVENT_AT.getTime() - 1000))
  };
  const secondAt = new Date(EVENT_AT.getTime() + 1000);
  const second = {
    ...messageEventDocument('comment_approved', 'comment-2', {
      ownerKey: OWNER,
      itemId: 'item-1'
    }, secondAt)
  };
  const claimedFirst = await stageClaimedEvent(db, first, 'race-first-claim');
  const current = await messages.upsertCommentThreadMessage(
    PARTICIPANT,
    claimedFirst,
    new Date(EVENT_AT.getTime() - 500)
  );
  db.setTransactionHook(({ stores }) => {
    const document = stores.get('messages').get(current._id);
    stores.get('messages').set(current._id, {
      ...document,
      sourceEventId: second._id,
      lastEventId: second._id,
      lastEventAt: secondAt,
      deliveredAt: secondAt,
      createdAt: secondAt,
      updatedAt: secondAt,
      unread: true
    });
  });

  assert.equal(await messages.markAllRead(PARTICIPANT, EVENT_AT), 0);
  const [listed] = await messages.listOwnerMessages(PARTICIPANT, 50);
  assert.equal(listed.sourceEventId, second._id);
  assert.equal(listed.unread, true);
});

test('does not mark a delayed old business event read when it is delivered after the action', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const delayed = {
    ...messageEventDocument('profile_approved', 'revision-delayed', {
      ownerKey: OWNER
    }, new Date(EVENT_AT.getTime() - 60000))
  };
  const source = { type: 'profile_approved', category: 'profile', title: '资料已通过' };
  await messages.upsertDirectMessage(
    OWNER,
    delayed,
    source,
    new Date(EVENT_AT.getTime() + 1000)
  );

  assert.equal(await messages.markAllRead(OWNER, EVENT_AT), 0);
  assert.equal(await messages.unreadCount(OWNER), 1);
});

test('uses the database commit timestamp for the delivery boundary', async () => {
  const db = createMemoryDb();
  const committedAt = new Date(EVENT_AT.getTime() + 1000);
  db.serverDate = () => committedAt;
  const messages = repository(db);
  const event = {
    ...messageEventDocument('profile_approved', 'revision-commit-time', {
      ownerKey: OWNER
    }, new Date(EVENT_AT.getTime() - 60000))
  };
  await messages.upsertDirectMessage(
    OWNER,
    event,
    { type: 'profile_approved', category: 'profile', title: '资料已通过' },
    new Date(EVENT_AT.getTime() - 1000)
  );

  const [stored] = await messages.listOwnerMessages(OWNER, 50);
  assert.equal(new Date(stored.deliveredAt).toISOString(), committedAt.toISOString());
  assert.equal(await messages.markAllRead(OWNER, EVENT_AT), 0);
});

test('keeps a message delivered in the same millisecond as mark-all unread', async () => {
  const db = createMemoryDb();
  const messages = repository(db);
  const event = {
    ...messageEventDocument('profile_approved', 'revision-same-ms', {
      ownerKey: OWNER
    }, new Date(EVENT_AT.getTime() - 1000))
  };
  await messages.upsertDirectMessage(
    OWNER,
    event,
    { type: 'profile_approved', category: 'profile', title: '资料已通过' },
    EVENT_AT
  );

  assert.equal(await messages.markAllRead(OWNER, EVENT_AT), 0);
  assert.equal(await messages.unreadCount(OWNER), 1);
});

test('marks more than one thousand eligible messages read with bounded transaction concurrency', async () => {
  const deliveredAt = new Date(EVENT_AT.getTime() - 1000);
  const initialMessages = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [
    `message-${String(index).padStart(4, '0')}`,
    {
      ownerKey: OWNER,
      type: 'profile_approved',
      category: 'profile',
      title: '资料已通过',
      sourceEventId: `event-${index}`,
      unread: true,
      deliveredAt,
      createdAt: deliveredAt,
      updatedAt: deliveredAt
    }
  ]));
  const db = createMemoryDb({ messages: initialMessages });
  const messages = repository(db);

  assert.equal(await messages.markAllRead(OWNER, EVENT_AT), 1001);
  assert.equal(await messages.unreadCount(OWNER), 0);
});
