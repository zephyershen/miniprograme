const test = require('node:test');
const assert = require('node:assert/strict');

const { createQueryCache } = require('../features/runtime/query-cache');
const {
  IDLE_DELAYS_MS,
  FAILURE_DELAYS_MS,
  createUpdatePollState,
  updatePollDelay,
  recordUpdatePollSuccess,
  recordUpdatePollFailure
} = require('../features/knowledge-feed/update-polling');

test('deduplicates concurrent reads and refreshes a bounded value after its ttl', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = createQueryCache({ ttlMs: 500, maxEntries: 2, now: () => now });
  const loader = async () => ({ call: ++calls });

  const first = cache.load('profile', loader);
  const duplicate = cache.load('profile', loader);
  assert.equal(first, duplicate);
  assert.deepEqual(await first, { call: 1 });
  assert.deepEqual(await cache.load('profile', loader), { call: 1 });

  now += 501;
  assert.deepEqual(await cache.load('profile', loader), { call: 2 });
  assert.equal(calls, 2);
});

test('keeps the request cache within its lru entry limit', () => {
  const cache = createQueryCache({ ttlMs: 1_000, maxEntries: 2, now: () => 100 });
  cache.remember('briefing:24h', { id: 'daily' });
  cache.remember('briefing:7d', { id: 'weekly' });
  cache.peek('briefing:24h');
  cache.remember('briefing:30d', { id: 'monthly' });

  assert.equal(cache.size(), 2);
  assert.equal(cache.peek('briefing:7d'), undefined);
  assert.deepEqual(cache.peek('briefing:24h'), { id: 'daily' });
});

test('backs off idle and failed feed checks while returning to the base delay for new items', () => {
  let state = createUpdatePollState();
  assert.equal(updatePollDelay(state), IDLE_DELAYS_MS[0]);

  state = recordUpdatePollSuccess(state, 0);
  assert.equal(updatePollDelay(state), IDLE_DELAYS_MS[1]);
  state = recordUpdatePollSuccess(state, 0);
  assert.equal(updatePollDelay(state), IDLE_DELAYS_MS[2]);

  state = recordUpdatePollFailure(state);
  assert.equal(updatePollDelay(state), FAILURE_DELAYS_MS[0]);
  state = recordUpdatePollFailure(state);
  assert.equal(updatePollDelay(state), FAILURE_DELAYS_MS[1]);

  state = recordUpdatePollSuccess(state, 3);
  assert.equal(updatePollDelay(state), IDLE_DELAYS_MS[0]);
});

test('patches only the tapped feed row when engagement changes', () => {
  let inboxPage;
  const previousPage = global.Page;
  global.Page = (definition) => { inboxPage = definition; };
  try {
    delete require.cache[require.resolve('../pages/inbox/index')];
    require('../pages/inbox/index');
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }

  const patches = [];
  const context = {
    loadedItems: [
      { id: 'lead', engagement: { liked: false } },
      { id: 'row', engagement: { liked: false } }
    ],
    rawFeed: {
      items: [
        { id: 'lead', engagement: { liked: false } },
        { id: 'row', engagement: { liked: false } }
      ]
    },
    setData(patch) { patches.push(patch); }
  };

  inboxPage.applyEngagementResult.call(context, {
    itemId: 'row',
    engagement: { liked: true, likeCount: 4, favorited: false }
  });

  assert.deepEqual(Object.keys(patches[0]), ['feed.remainingItems[0].engagement']);
  assert.equal(context.loadedItems[1].engagement.liked, true);
  assert.equal(context.rawFeed.items[1].engagement.likeCount, 4);
});

test('patches a latest timeline engagement leaf without rebuilding feed media', () => {
  let inboxPage;
  const previousPage = global.Page;
  global.Page = (definition) => { inboxPage = definition; };
  try {
    delete require.cache[require.resolve('../pages/inbox/index')];
    require('../pages/inbox/index');
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }

  const patches = [];
  let presentCalls = 0;
  let mediaResets = 0;
  const context = {
    data: {
      sortMode: 'latest',
      activeChannel: 'all',
      flatFeedMode: false,
      feed: {
        dayGroups: [{
          dateKey: '2026-07-23',
          items: [{ id: 'row', engagement: { liked: false } }]
        }]
      }
    },
    loadedItems: [{ id: 'row', engagement: { liked: false } }],
    rawFeed: { items: [{ id: 'row', engagement: { liked: false } }] },
    mediaRecovery: { reset() { mediaResets += 1; } },
    present() { presentCalls += 1; },
    setData(patch) { patches.push(patch); }
  };

  inboxPage.applyEngagementResult.call(context, {
    itemId: 'row',
    engagement: { liked: true, likeCount: 4, favorited: false }
  });

  assert.deepEqual(Object.keys(patches[0]), [
    'feed.dayGroups[0].items[0].engagement'
  ]);
  assert.equal(presentCalls, 0);
  assert.equal(mediaResets, 0);
});

test('batches remembered timeline engagement into one leaf-only setData', () => {
  const {
    rememberEngagement,
    clearEngagement
  } = require('../features/engagement/session');
  let inboxPage;
  const previousPage = global.Page;
  global.Page = (definition) => { inboxPage = definition; };
  try {
    delete require.cache[require.resolve('../pages/inbox/index')];
    require('../pages/inbox/index');
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }

  const patches = [];
  const context = {
    data: {
      sortMode: 'latest',
      activeChannel: 'all',
      flatFeedMode: false,
      feed: {
        dayGroups: [{
          dateKey: '2026-07-23',
          items: [{ id: 'one' }, { id: 'two' }]
        }]
      }
    },
    loadedItems: [{ id: 'one' }, { id: 'two' }],
    rawFeed: { items: [{ id: 'one' }, { id: 'two' }] },
    setData(patch) { patches.push(patch); }
  };
  try {
    rememberEngagement('one', { liked: true, likeCount: 1 });
    rememberEngagement('two', { favorited: true, favoriteCount: 1 });
    inboxPage.syncRememberedEngagement.call(context);
  } finally {
    clearEngagement();
  }

  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0]).sort(), [
    'feed.dayGroups[0].items[0].engagement',
    'feed.dayGroups[0].items[1].engagement'
  ]);
  assert.equal(context.loadedItems[0].engagement.liked, true);
  assert.equal(context.rawFeed.items[1].engagement.favorited, true);
});
