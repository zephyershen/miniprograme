const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function installModuleMock(request, exports) {
  const filename = require.resolve(request);
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

function loadCommentSheet(getComments, media = {}, api = {}) {
  const restores = [
    installModuleMock('../features/engagement/api', {
      getComments,
      addComment: async () => ({}),
      deleteComment: async () => ({}),
      reportComment: async () => ({}),
      appealComment: async () => ({}),
      restoreComment: async () => ({}),
      ...api
    }),
    installModuleMock('../features/engagement/media', {
      chooseCommentImages: async () => [],
      uploadCommentImages: async () => [],
      previewLocalImages: () => {},
      resolveCommentMedia: async (comments) => comments,
      resolveFreshCommentMedia: async (comment) => comment,
      previewCommentImages: async (comment, currentFileId) => {
        const attachments = comment && comment.attachments || [];
        const urls = attachments.map((attachment) => attachment.url).filter(Boolean);
        const current = (attachments.find((attachment) => attachment.fileId === currentFileId) || {}).url
          || urls[0];
        wx.previewImage({ current, urls });
        return comment;
      },
      ...media
    }),
    installModuleMock('../features/user-profile/session', {
      loadUserProfile: async () => ({ nickname: 'Viewer' }),
      rememberUserProfile: async (profile) => profile
    })
  ];
  const filename = require.resolve('../components/comment-sheet/index');
  const previousComponent = global.Component;
  const previousModule = require.cache[filename];
  let definition;
  global.Component = (value) => { definition = value; };
  delete require.cache[filename];
  try {
    require(filename);
  } finally {
    if (previousModule) require.cache[filename] = previousModule;
    else delete require.cache[filename];
    if (previousComponent) global.Component = previousComponent;
    else delete global.Component;
    restores.reverse().forEach((restore) => restore());
  }
  return definition;
}

function createContext(definition) {
  const context = {
    data: JSON.parse(JSON.stringify(definition.data)),
    commentsLoaded: false,
    events: [],
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    triggerEvent(name, detail) {
      this.events.push({ name, detail });
    }
  };
  Object.assign(context, definition.methods);
  return context;
}

function setObservedProperty(definition, context, name, value) {
  context.data[name] = value;
  const observer = definition.observers && definition.observers[name];
  if (observer) observer.call(context, value);
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

function comment(id, content, attachments = []) {
  return {
    id,
    content,
    createdAt: '2026-07-25T01:00:00.000Z',
    author: {
      nickname: `Author ${id}`,
      initial: 'A',
      avatarFileId: ''
    },
    attachments
  };
}

function commentsResult(comments, commentCount) {
  return {
    comments,
    ...(commentCount === undefined ? {} : { commentCount }),
    canParticipate: true,
    viewerProfile: {
      nickname: 'Viewer',
      avatarFileId: ''
    }
  };
}

test('uses replies in the visible count and reports the authoritative server total', async () => {
  const definition = loadCommentSheet(async () => commentsResult([
    comment('root', 'Root'),
    {
      ...comment('reply-a', 'Reply A'),
      parentCommentId: 'root',
      replyToCommentId: 'root'
    },
    {
      ...comment('reply-b', 'Reply B'),
      parentCommentId: 'root',
      replyToCommentId: 'reply-a'
    }
  ], 3));
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {}
  };
  try {
    setObservedProperty(definition, context, 'itemId', 'item-count');
    setObservedProperty(definition, context, 'commentCount', 2);
    setObservedProperty(definition, context, 'visible', true);
    await flushTasks();
    await flushTasks();
    assert.equal(context.data.displayCommentCount, 3);
    assert.ok(context.events.some((event) => (
      event.name === 'changed' && event.detail.commentCount === 3
    )));
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('polls an owned pending comment until its review result is visible', async () => {
  const calls = [];
  const definition = loadCommentSheet(async () => {
    calls.push(calls.length + 1);
    return commentsResult([{
      ...comment('reviewed-comment', 'Review me'),
      isMine: true,
      reviewPending: calls.length === 1,
      statusLabel: calls.length === 1 ? '审核中' : ''
    }], calls.length === 1 ? 0 : 1);
  });
  const context = createContext(definition);
  const previousWx = global.wx;
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const scheduled = [];
  global.setTimeout = (callback, delay) => {
    const timer = { id: scheduled.length + 1, callback, delay };
    scheduled.push(timer);
    return timer.id;
  };
  global.clearTimeout = () => {};
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage() {}
  };

  try {
    setObservedProperty(definition, context, 'itemId', 'item-review');
    setObservedProperty(definition, context, 'visible', true);
    await flushTasks();
    await flushTasks();

    assert.deepEqual(calls, [1]);
    assert.equal(context.data.comments[0].reviewPending, true);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 2500);

    await scheduled[0].callback();
    await flushTasks();
    assert.deepEqual(calls, [1, 2]);
    assert.equal(context.data.comments[0].reviewPending, false);
    assert.equal(context.data.displayCommentCount, 1);
    assert.equal(context.commentReviewRefreshTimer, null);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('rebinding the same item id keeps an already loaded comment list intact', async () => {
  const calls = [];
  const definition = loadCommentSheet(async (itemId) => {
    calls.push(itemId);
    return commentsResult([comment('comment-a', 'Comment A')]);
  });
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage() {}
  };

  try {
    setObservedProperty(definition, context, 'itemId', 'item-a');
    setObservedProperty(definition, context, 'visible', true);
    await flushTasks();
    await flushTasks();

    assert.deepEqual(calls, ['item-a']);
    assert.equal(context.commentsLoaded, true);
    assert.deepEqual(context.data.comments.map((entry) => entry.id), ['comment-a']);
    const mediaRequestId = context.commentMediaRequestId;

    setObservedProperty(definition, context, 'itemId', 'item-a');
    await flushTasks();

    assert.equal(context.commentsLoaded, true);
    assert.deepEqual(context.data.comments.map((entry) => entry.id), ['comment-a']);
    assert.equal(context.data.commentsResolved, true);
    assert.equal(context.commentMediaRequestId, mediaRequestId);
    assert.deepEqual(calls, ['item-a']);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('an older comment request cannot overwrite a newer item after responses arrive out of order', async () => {
  const requests = [];
  const definition = loadCommentSheet((itemId) => {
    const request = deferred();
    requests.push({ itemId, ...request });
    return request.promise;
  });
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage() {}
  };

  try {
    setObservedProperty(definition, context, 'itemId', 'item-a');
    setObservedProperty(definition, context, 'visible', true);
    assert.deepEqual(requests.map((entry) => entry.itemId), ['item-a']);

    setObservedProperty(definition, context, 'itemId', 'item-b');
    if (!requests.some((entry) => entry.itemId === 'item-b')) {
      void context.loadComments();
    }
    await flushTasks();
    assert.deepEqual(requests.map((entry) => entry.itemId), ['item-a', 'item-b']);

    const requestA = requests.find((entry) => entry.itemId === 'item-a');
    const requestB = requests.find((entry) => entry.itemId === 'item-b');
    requestB.resolve(commentsResult([comment('comment-b', 'Comment B')]));
    await flushTasks();
    await flushTasks();
    assert.deepEqual(context.data.comments.map((entry) => entry.id), ['comment-b']);

    requestA.resolve(commentsResult([comment('comment-a', 'Late Comment A')]));
    await flushTasks();
    await flushTasks();
    assert.equal(context.data.itemId, 'item-b');
    assert.deepEqual(context.data.comments.map((entry) => entry.id), ['comment-b']);
    assert.equal(context.commentsLoaded, true);
    assert.equal(context.data.commentsLoading, false);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('returning from image preview preserves comments when detail hydration rebinds the same item id', async () => {
  const calls = [];
  const previews = [];
  const image = {
    fileId: 'file-a',
    url: 'https://media.example/comment-a.jpg',
    width: 800,
    height: 600
  };
  const definition = loadCommentSheet(async (itemId) => {
    calls.push(itemId);
    return commentsResult([comment('comment-a', 'Comment with image', [image])]);
  });
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage(options) {
      previews.push(options);
    }
  };

  try {
    setObservedProperty(definition, context, 'itemId', 'item-a');
    setObservedProperty(definition, context, 'visible', true);
    await flushTasks();
    await flushTasks();

    await context.previewCommentImage({
      currentTarget: {
        dataset: {
          commentId: 'comment-a',
          fileId: 'file-a'
        }
      }
    });
    assert.deepEqual(previews, [{
      current: image.url,
      urls: [image.url]
    }]);

    await definition.pageLifetimes.show.call(context);
    setObservedProperty(definition, context, 'itemId', 'item-a');
    await flushTasks();

    assert.equal(context.data.visible, true);
    assert.equal(context.commentsLoaded, true);
    assert.deepEqual(context.data.comments.map((entry) => ({
      id: entry.id,
      content: entry.content,
      imageUrl: entry.attachments[0].url
    })), [{
      id: 'comment-a',
      content: 'Comment with image',
      imageUrl: image.url
    }]);
    assert.deepEqual(calls, ['item-a']);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('renders replies inside one root group and rebuilds the visible slice when expanded', async () => {
  const root = comment('root-comment', 'Root comment');
  const replies = [1, 2, 3].map((number) => ({
    ...comment(`reply-${number}`, `Reply ${number}`),
    parentCommentId: root.id,
    replyToCommentId: number === 1 ? root.id : `reply-${number - 1}`,
    replyToNickname: number === 1 ? root.author.nickname : `Author reply-${number - 1}`,
    createdAt: `2026-07-25T01:0${number}:00.000Z`
  }));
  const definition = loadCommentSheet(async () => commentsResult([
    replies[2],
    root,
    replies[0],
    replies[1]
  ]));
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage() {}
  };

  try {
    setObservedProperty(definition, context, 'itemId', 'item-a');
    setObservedProperty(definition, context, 'visible', true);
    await flushTasks();
    await flushTasks();

    assert.equal(context.data.commentThreads.length, 1);
    assert.equal(context.data.commentThreads[0].root.id, root.id);
    assert.deepEqual(
      context.data.commentThreads[0].visibleReplies.map((entry) => entry.id),
      ['reply-1', 'reply-2']
    );
    assert.equal(context.data.commentThreads[0].hiddenReplyCount, 1);

    context.expandReplies({
      currentTarget: { dataset: { rootId: root.id } }
    });
    assert.deepEqual(
      context.data.commentThreads[0].visibleReplies.map((entry) => entry.id),
      ['reply-1', 'reply-2', 'reply-3']
    );
    assert.equal(context.data.commentThreads[0].isExpanded, true);

    context.collapseReplies({
      currentTarget: { dataset: { rootId: root.id } }
    });
    assert.deepEqual(context.data.commentThreads[0].visibleReplies, []);
    assert.equal(context.data.commentThreads[0].isExpanded, false);
    assert.equal(context.data.commentThreads[0].isCollapsed, true);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('lets a root collapse and reopen even when it has only one reply', async () => {
  const root = comment('root-single', 'Root comment');
  const reply = {
    ...comment('reply-single', 'Only reply'),
    parentCommentId: root.id,
    replyToCommentId: root.id
  };
  const definition = loadCommentSheet(async () => commentsResult([root, reply]));
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage() {}
  };

  try {
    setObservedProperty(definition, context, 'itemId', 'item-single');
    setObservedProperty(definition, context, 'visible', true);
    await flushTasks();
    await flushTasks();
    assert.deepEqual(
      context.data.commentThreads[0].visibleReplies.map((entry) => entry.id),
      [reply.id]
    );

    context.collapseReplies({
      currentTarget: { dataset: { rootId: root.id } }
    });
    assert.deepEqual(context.data.commentThreads[0].visibleReplies, []);
    assert.equal(context.data.commentThreads[0].hiddenReplyCount, 1);

    context.expandReplies({
      currentTarget: { dataset: { rootId: root.id } }
    });
    assert.deepEqual(
      context.data.commentThreads[0].visibleReplies.map((entry) => entry.id),
      [reply.id]
    );

    const markup = fs.readFileSync(
      path.resolve(__dirname, '../components/comment-sheet/index.wxml'),
      'utf8'
    );
    assert.match(markup, /item\.visibleReplies\.length && !item\.isCollapsed/);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('keeps a submitted reply under its root after the optimistic row is accepted', async () => {
  const root = {
    ...comment('root-comment', 'Root comment'),
    canReply: true
  };
  const definition = loadCommentSheet(
    async () => commentsResult([root]),
    {},
    {
      addComment: async (_itemId, payload) => ({
        comment: {
          id: 'server-reply',
          content: payload.content,
          attachments: [],
          createdAt: '2026-07-25T01:01:00.000Z'
        },
        commentCount: 2
      })
    }
  );
  const context = createContext(definition);
  const previousWx = global.wx;
  global.wx = {
    hideKeyboard() {},
    showToast() {},
    previewImage() {}
  };

  try {
    context.data.itemId = 'item-a';
    context.data.comments = [root];
    context.data.commentThreads = [];
    context.data.commentDraft = 'Submitted reply';
    context.data.replyTarget = {
      id: root.id,
      parentCommentId: root.id,
      nickname: root.author.nickname,
      preview: root.content
    };
    context.data.viewerProfile = {
      isComplete: true,
      nickname: 'Reply author',
      initial: 'R'
    };

    await context.submitComment();

    assert.equal(context.data.commentThreads.length, 1);
    assert.equal(context.data.commentThreads[0].root.id, root.id);
    assert.deepEqual(
      context.data.commentThreads[0].replies.map((entry) => entry.id),
      ['server-reply']
    );
    assert.equal(
      context.data.commentThreads[0].replies[0].parentCommentId,
      root.id
    );
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});
