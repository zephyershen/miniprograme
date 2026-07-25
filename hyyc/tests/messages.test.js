const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  formatMessageDate,
  normalizeMessagesResult,
  removeMessageFromState
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
  assert.equal(result.messages[0].id, 'thread-1');
  assert.equal(result.messages[0].kind, 'thread_comment_published');
  assert.equal(result.messages[0].kindLabel, '讨论动态');
  assert.equal(result.messages[0].title, '你参与的资讯有新评论');
  assert.equal(result.messages[0].body, '打开资讯，看看讨论中的新观点。');
  assert.equal(result.messages[0].itemId, 'item/01');
  assert.equal(result.messages[0].openComments, true);
  assert.equal(result.messages[0].unread, true);
  assert.equal(result.messages[0].occurredLabel, '30 分钟前');
  assert.equal(result.messages[0].canOpenItem, true);
  assert.equal(result.messages[0].isInteraction, true);
  assert.equal(result.messages[0].interactionVerb, '参与了讨论');
  assert.equal(result.interactionCount, 1);
  assert.equal(result.systemCount, 1);
  assert.equal(result.messages[1].title, '资料审核通过');
  assert.equal(result.messages[1].unread, false);
  assert.equal(formatMessageDate('2025-12-01T00:00:00.000Z', now), '2025.12.01');
});

test('decorates a direct reply with actor, quote and source context', () => {
  const [message] = normalizeMessagesResult({
    messages: [{
      id: 'reply-message',
      type: 'comment_received',
      itemId: 'item-1',
      itemTitle: '一条值得继续讨论的资讯',
      commentId: 'reply-1',
      parentCommentId: 'root-1',
      replyToCommentId: 'target-1',
      commentPreview: '我补充一个具体案例',
      replyToPreview: '这个判断的依据是什么？',
      actorNickname: '小林',
      actorAvatarFileId: 'cloud://env/user-media/avatars/xiaolin.jpg'
    }]
  }).messages;

  assert.equal(message.isInteraction, true);
  assert.equal(message.interactionVerb, '回复了评论');
  assert.equal(message.actorNickname, '小林');
  assert.equal(message.actorInitial, '小');
  assert.equal(message.commentPreview, '我补充一个具体案例');
  assert.equal(message.replyToPreview, '这个判断的依据是什么？');
  assert.equal(message.itemTitle, '一条值得继续讨论的资讯');
});

test('removes a message while keeping category and unread counts consistent', () => {
  const state = normalizeMessagesResult({
    unreadCount: 2,
    messages: [
      { id: 'interaction', type: 'comment_received', unread: true },
      { id: 'system', type: 'profile_approved', unread: true }
    ]
  });

  const next = removeMessageFromState(state, 'interaction');

  assert.deepEqual(next.messages.map((message) => message.id), ['system']);
  assert.equal(next.interactionCount, 0);
  assert.equal(next.systemCount, 1);
  assert.equal(next.unreadCount, 1);
  assert.equal(next.hasUnread, true);
  assert.equal(removeMessageFromState(state, 'missing'), null);
});

test('uses the agreed knowledgeFeed actions for listing, read and delete mutations', async () => {
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
      deleteMessage,
      markAllMessagesRead
    } = require(apiPath);
    await getMessages();
    await markMessageRead('message/01', 'event-01');
    await deleteMessage('message/01');
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
    {
      name: 'knowledgeFeed',
      data: {
        action: 'deleteMessage',
        messageId: 'message/01'
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

test('opens delete only on a horizontal swipe and removes either message category', async () => {
  const rawMessages = [
    {
      id: 'interaction-1',
      type: 'comment_received',
      itemId: 'item-1',
      unread: true
    },
    {
      id: 'system-1',
      type: 'profile_approved',
      unread: true
    }
  ];
  const deletions = [];
  const loaded = loadMessagesPage({
    loadMessages: async () => ({ messages: rawMessages, unreadCount: 2 }),
    markMessageRead: async () => ({ messages: rawMessages, unreadCount: 2 }),
    deleteMessage: async (messageId) => {
      deletions.push(messageId);
      return {
        messages: rawMessages.filter((message) => message.id !== messageId),
        unreadCount: 1
      };
    },
    markAllMessagesRead: async () => ({ messages: rawMessages, unreadCount: 2 })
  });
  const previousWx = global.wx;
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375 }),
    showToast() {},
    stopPullDownRefresh() {}
  };
  try {
    const page = pageContext(loaded.definition);
    await page.onLoad.call(page);

    page.onMessageTouchStart.call(page, {
      currentTarget: { dataset: { messageId: 'system-1' } },
      touches: [{ clientX: 300, clientY: 100 }]
    });
    page.onMessageTouchMove.call(page, {
      touches: [{ clientX: 294, clientY: 160 }]
    });
    page.onMessageTouchEnd.call(page, {
      changedTouches: [{ clientX: 294, clientY: 160 }]
    });
    assert.equal(page.data.swipedMessageId, '');

    page.onMessageTouchStart.call(page, {
      currentTarget: { dataset: { messageId: 'interaction-1' } },
      touches: [{ clientX: 300, clientY: 100 }]
    });
    page.onMessageTouchMove.call(page, {
      touches: [{ clientX: 245, clientY: 104 }]
    });
    page.onMessageTouchEnd.call(page, {
      changedTouches: [{ clientX: 245, clientY: 104 }]
    });
    assert.equal(page.data.swipedMessageId, 'interaction-1');

    assert.equal(await page.deleteMessage.call(page, {
      currentTarget: { dataset: { messageId: 'interaction-1' } }
    }), true);
    assert.deepEqual(deletions, ['interaction-1']);
    assert.deepEqual(page.data.messages.map((message) => message.id), ['system-1']);
    assert.equal(page.data.interactionCount, 0);
    assert.equal(page.data.systemCount, 1);
    assert.equal(page.data.unreadCount, 1);
    assert.equal(page.data.deletingMessageId, '');
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
  assert.match(markup, /bindtouchmove="onMessageTouchMove"/);
  assert.match(markup, /catchtap="deleteMessage"/);
  assert.match(styles, /\.message-row-unread::before/);
  assert.match(styles, /\.message-swipe-content\.is-open/);
  assert.match(styles, /\.message-delete-action/);
});

test('refreshes messages while the page stays visible and stops polling when hidden', async () => {
  const loaded = loadMessagesPage({
    loadMessages: async () => ({ messages: [], unreadCount: 0 }),
    markMessageRead: async () => ({ messages: [], unreadCount: 0 }),
    deleteMessage: async () => ({ messages: [], unreadCount: 0 }),
    markAllMessagesRead: async () => ({ messages: [], unreadCount: 0 })
  });
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const scheduled = [];
  const cleared = [];
  let nextTimerId = 1;
  global.setTimeout = (callback, delay) => {
    const timer = { id: nextTimerId, callback, delay };
    nextTimerId += 1;
    scheduled.push(timer);
    return timer.id;
  };
  global.clearTimeout = (timerId) => {
    cleared.push(timerId);
  };

  try {
    const page = pageContext(loaded.definition);
    const refreshOptions = [];
    page.pageDisposed = false;
    page.messagesLoaded = true;
    page.loadMessages = async (options) => {
      refreshOptions.push(options);
      return true;
    };

    assert.equal(await page.onShow.call(page), true);
    assert.equal(page.messagesPageVisible, true);
    assert.deepEqual(refreshOptions, [{ force: true, preserveCurrent: true }]);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 10_000);

    await scheduled[0].callback();
    assert.deepEqual(refreshOptions, [
      { force: true, preserveCurrent: true },
      { force: true, preserveCurrent: true }
    ]);
    assert.equal(scheduled.length, 2);

    const activeTimerId = page.messagesRefreshTimer;
    page.onHide.call(page);
    assert.equal(page.messagesPageVisible, false);
    assert.equal(page.messagesRefreshTimer, null);
    assert.ok(cleared.includes(activeTimerId));
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
    loaded.restore();
  }
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

test('keeps a deleted message out of the shared cache when the page is reopened', async () => {
  const apiPath = require.resolve('../features/messages/api');
  const sessionPath = require.resolve('../features/messages/session');
  const calls = [];
  const restoreApi = replaceModule(apiPath, {
    getMessages: async () => {
      calls.push('load');
      return {
        messages: [{ id: 'message-one', type: 'profile_approved', unread: true }],
        unreadCount: 1
      };
    },
    markMessageRead: async () => ({ messages: [], unreadCount: 0 }),
    deleteMessage: async () => {
      calls.push('delete');
      return { messages: [], unreadCount: 0 };
    },
    markAllMessagesRead: async () => ({ messages: [], unreadCount: 0 })
  });
  const previousSession = require.cache[sessionPath];
  delete require.cache[sessionPath];
  try {
    const session = require(sessionPath);
    const loaded = await session.loadMessages({ force: true });
    assert.deepEqual(loaded.messages.map((message) => message.id), ['message-one']);

    await session.deleteMessage('message-one');
    const reopened = await session.loadMessages();

    assert.deepEqual(reopened.messages, []);
    assert.deepEqual(calls, ['load', 'delete']);
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
