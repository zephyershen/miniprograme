const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  formatMessageDate,
  normalizeMessagesResult
} = require('../features/messages/model');

function replaceModule(filename, exports) {
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports
  };
  return () => {
    if (previous) require.cache[filename] = previous;
    else delete require.cache[filename];
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadMessagesPage(session) {
  const sessionPath = require.resolve('../features/messages/session');
  const pagePath = require.resolve('../pages/messages/index');
  const restoreSession = replaceModule(sessionPath, session);
  const previousPageModule = require.cache[pagePath];
  const previousPage = global.Page;
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[pagePath];
  require(pagePath);
  return {
    definition,
    restore() {
      restoreSession();
      if (previousPageModule) require.cache[pagePath] = previousPageModule;
      else delete require.cache[pagePath];
      if (previousPage) global.Page = previousPage;
      else delete global.Page;
    }
  };
}

function pageContext(definition) {
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([pathKey, value]) => {
        const parts = [...pathKey.matchAll(/([^[.\]]+)|\[(\d+)\]/g)]
          .map((match) => (match[2] === undefined ? match[1] : Number(match[2])));
        let target = this.data;
        parts.slice(0, -1).forEach((part) => { target = target[part]; });
        target[parts[parts.length - 1]] = value;
      });
      if (callback) callback();
    }
  };
}

test('normalizes message kinds, unread state and safe feed-detail routes', () => {
  const now = new Date('2026-07-24T08:00:00.000Z').getTime();
  const result = normalizeMessagesResult({
    unreadCount: 1,
    messages: [
      {
        _id: 'thread-1',
        type: 'thread_comment_published',
        route: { itemId: 'item/01', openComments: true },
        occurredAt: '2026-07-24T07:30:00.000Z',
        isRead: false
      },
      {
        id: 'profile-1',
        kind: 'profile_review_approved',
        occurredAt: '2026-07-23T08:00:00.000Z',
        readAt: '2026-07-23T09:00:00.000Z'
      },
      { kind: 'comment_review_rejected' }
    ]
  }, now);

  assert.equal(result.messages.length, 2);
  assert.equal(result.unreadCount, 1);
  assert.equal(result.hasUnread, true);
  assert.deepEqual(result.messages[0], {
    id: 'thread-1',
    version: '',
    kind: 'thread_comment_published',
    kindLabel: '讨论动态',
    glyph: '讯',
    tone: 'info',
    title: '你参与的资讯有新评论',
    body: '打开资讯，看看讨论中的新观点。',
    itemId: 'item/01',
    openComments: true,
    isRead: false,
    unread: true,
    occurredAt: '2026-07-24T07:30:00.000Z',
    occurredLabel: '30 分钟前',
    canOpenItem: true
  });
  assert.equal(result.messages[1].title, '资料审核通过');
  assert.equal(result.messages[1].unread, false);
  assert.equal(formatMessageDate('2025-12-01T00:00:00.000Z', now), '2025.12.01');
});

test('uses the agreed knowledgeFeed actions for listing and read mutations', async () => {
  const cloudPath = require.resolve('../services/cloud-functions');
  const apiPath = require.resolve('../features/messages/api');
  const calls = [];
  const restoreCloud = replaceModule(cloudPath, {
    callCloudFunction: async (name, data) => {
      calls.push({ name, data });
      return { messages: [], unreadCount: 0 };
    }
  });
  const previousApi = require.cache[apiPath];
  delete require.cache[apiPath];
  try {
    const {
      getMessages,
      markMessageRead,
      markAllMessagesRead
    } = require(apiPath);
    await getMessages();
    await markMessageRead('message/01', 'event-01');
    await markAllMessagesRead();
  } finally {
    if (previousApi) require.cache[apiPath] = previousApi;
    else delete require.cache[apiPath];
    restoreCloud();
  }

  assert.deepEqual(calls, [
    { name: 'knowledgeFeed', data: { action: 'messages' } },
    {
      name: 'knowledgeFeed',
      data: {
        action: 'markMessageRead',
        messageId: 'message/01',
        messageVersion: 'event-01'
      }
    },
    { name: 'knowledgeFeed', data: { action: 'markAllMessagesRead' } }
  ]);
});

test('loads the page, marks a row read and opens its related feed item', async () => {
  const rawMessages = [{
    id: 'message-1',
    kind: 'thread_activity',
    title: '讨论有新进展',
    body: '看看新观点',
    itemId: 'item/01',
    version: 'event-01',
    occurredAt: '2026-07-24T07:30:00.000Z',
    isRead: false
  }];
  const calls = [];
  const loaded = loadMessagesPage({
    loadMessages: async (options) => {
      calls.push({ type: 'load', options });
      return { messages: rawMessages, unreadCount: 1 };
    },
    markMessageRead: async (messageId, messageVersion) => {
      calls.push({ type: 'read', messageId, messageVersion });
      return {
        messages: rawMessages.map((message) => ({ ...message, isRead: true })),
        unreadCount: 0
      };
    },
    markAllMessagesRead: async () => ({ messages: [], unreadCount: 0 })
  });
  const previousWx = global.wx;
  const navigations = [];
  global.wx = {
    navigateTo: (options) => navigations.push(options),
    showToast() {},
    stopPullDownRefresh() {}
  };
  try {
    const page = pageContext(loaded.definition);
    await page.onLoad.call(page);
    assert.equal(page.data.loading, false);
    assert.equal(page.data.unreadCount, 1);
    assert.equal(page.data.messages[0].unread, true);

    await page.openMessage.call(page, {
      currentTarget: { dataset: { messageId: 'message-1' } }
    });
    assert.equal(page.data.unreadCount, 0);
    assert.equal(page.data.messages[0].isRead, true);
    assert.deepEqual(navigations, [{
      url: '/pages/feed-detail/index?id=item%2F01'
    }]);
    assert.deepEqual(calls.map((call) => call.type), ['load', 'read']);
    assert.equal(calls[1].messageVersion, 'event-01');
  } finally {
    loaded.restore();
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('supports all-read, loading, error, empty and unread visual states', async () => {
  const rawMessages = [
    { id: 'one', kind: 'membership_activated', isRead: false },
    { id: 'two', kind: 'comment_review_approved', isRead: false }
  ];
  let markAllCalls = 0;
  const loaded = loadMessagesPage({
    loadMessages: async () => ({ messages: rawMessages, unreadCount: 2 }),
    markMessageRead: async () => ({ messages: rawMessages, unreadCount: 2 }),
    markAllMessagesRead: async () => {
      markAllCalls += 1;
      return {
        messages: rawMessages.map((message) => ({ ...message, isRead: true })),
        unreadCount: 0
      };
    }
  });
  try {
    const page = pageContext(loaded.definition);
    await page.onLoad.call(page);
    assert.equal(await page.markAllMessages.call(page), true);
    assert.equal(markAllCalls, 1);
    assert.equal(page.data.markingAll, false);
    assert.equal(page.data.hasUnread, false);
    assert.ok(page.data.messages.every((message) => message.isRead));
  } finally {
    loaded.restore();
  }

  const markup = fs.readFileSync(
    path.resolve(__dirname, '../pages/messages/index.wxml'),
    'utf8'
  );
  const styles = fs.readFileSync(
    path.resolve(__dirname, '../pages/messages/index.wxss'),
    'utf8'
  );
  assert.match(markup, /wx:if="\{\{loading\}\}"/);
  assert.match(markup, /wx:elif="\{\{error\}\}"/);
  assert.match(markup, /wx:elif="\{\{!messages\.length\}\}"/);
  assert.match(markup, /class="message-unread-dot"/);
  assert.match(markup, /bindtap="markAllMessages"/);
  assert.match(styles, /\.message-row-unread::before/);
});

test('ignores an older single-read response after a newer message mutation finishes', async () => {
  const first = deferred();
  const second = deferred();
  const rawMessages = [
    { id: 'one', version: 'event-one', kind: 'comment_received', isRead: false },
    { id: 'two', version: 'event-two', kind: 'comment_received', isRead: false }
  ];
  let readCalls = 0;
  const loaded = loadMessagesPage({
    loadMessages: async () => ({ messages: rawMessages, unreadCount: 2 }),
    markMessageRead: async () => {
      readCalls += 1;
      return readCalls === 1 ? first.promise : second.promise;
    },
    markAllMessagesRead: async () => ({ messages: [], unreadCount: 0 })
  });
  try {
    const page = pageContext(loaded.definition);
    await page.onLoad.call(page);
    const firstRequest = page.syncMessageRead.call(page, page.data.messages[0]);
    const secondRequest = page.syncMessageRead.call(page, page.data.messages[1]);
    second.resolve({
      messages: rawMessages.map((message) => ({ ...message, isRead: true })),
      unreadCount: 0
    });
    await secondRequest;
    first.resolve({
      messages: [
        { ...rawMessages[0], isRead: true },
        rawMessages[1]
      ],
      unreadCount: 1
    });
    await firstRequest;

    assert.equal(page.data.unreadCount, 0);
    assert.ok(page.data.messages.every((message) => message.isRead));
  } finally {
    loaded.restore();
  }
});

test('serializes message reads and mark-all before updating the shared cache', async () => {
  const apiPath = require.resolve('../features/messages/api');
  const sessionPath = require.resolve('../features/messages/session');
  const first = deferred();
  const calls = [];
  const restoreApi = replaceModule(apiPath, {
    getMessages: async () => ({ messages: [], unreadCount: 0 }),
    markMessageRead: async () => {
      calls.push('read');
      return first.promise;
    },
    markAllMessagesRead: async () => {
      calls.push('all');
      return { messages: [], unreadCount: 0 };
    }
  });
  const previousSession = require.cache[sessionPath];
  delete require.cache[sessionPath];
  try {
    const session = require(sessionPath);
    const readRequest = session.markMessageRead('message-one', 'event-one');
    const allRequest = session.markAllMessagesRead();
    await Promise.resolve();
    assert.deepEqual(calls, ['read']);
    first.resolve({ messages: [], unreadCount: 0 });
    await readRequest;
    await allRequest;
    assert.deepEqual(calls, ['read', 'all']);
  } finally {
    if (previousSession) require.cache[sessionPath] = previousSession;
    else delete require.cache[sessionPath];
    restoreApi();
  }
});

test('cancels queued and in-flight message operations when the viewer changes', async () => {
  const apiPath = require.resolve('../features/messages/api');
  const membershipPath = require.resolve('../features/membership/session');
  const registryPath = require.resolve('../features/runtime/viewer-cache-registry');
  const sessionPath = require.resolve('../features/messages/session');
  const inFlight = deferred();
  const calls = [];
  let scope = 'viewer-a';
  let clearViewerCache = null;
  const restoreApi = replaceModule(apiPath, {
    getMessages: async () => {
      calls.push('load');
      return { messages: [{ id: scope, kind: 'comment_received' }], unreadCount: 1 };
    },
    markMessageRead: async () => {
      calls.push('read');
      return inFlight.promise;
    },
    markAllMessagesRead: async () => ({ messages: [], unreadCount: 0 })
  });
  const restoreMembership = replaceModule(membershipPath, {
    membershipCacheScope: () => scope
  });
  const restoreRegistry = replaceModule(registryPath, {
    registerViewerCache: (clear) => {
      clearViewerCache = clear;
    }
  });
  const previousSession = require.cache[sessionPath];
  delete require.cache[sessionPath];
  try {
    const session = require(sessionPath);
    const readRequest = session.markMessageRead('message-a', 'event-a');
    const queuedLoad = session.loadMessages({ force: true });
    await Promise.resolve();
    assert.deepEqual(calls, ['read']);

    scope = 'viewer-b';
    clearViewerCache();
    inFlight.resolve({ messages: [{ id: 'viewer-a', kind: 'comment_received' }], unreadCount: 1 });
    const results = await Promise.allSettled([readRequest, queuedLoad]);
    assert.deepEqual(results.map((result) => result.status), ['rejected', 'rejected']);
    assert.ok(results.every((result) => result.reason.code === 'VIEWER_CHANGED'));
    assert.deepEqual(calls, ['read']);

    const viewerB = await session.loadMessages({ force: true });
    assert.equal(viewerB.messages[0].id, 'viewer-b');
    assert.deepEqual(calls, ['read', 'load']);
  } finally {
    if (previousSession) require.cache[sessionPath] = previousSession;
    else delete require.cache[sessionPath];
    restoreRegistry();
    restoreMembership();
    restoreApi();
  }
});
