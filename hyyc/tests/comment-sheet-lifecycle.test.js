const test = require('node:test');
const assert = require('node:assert/strict');

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

function loadCommentSheet(getComments, media = {}) {
  const restores = [
    installModuleMock('../features/engagement/api', {
      getComments,
      addComment: async () => ({}),
      deleteComment: async () => ({}),
      reportComment: async () => ({}),
      appealComment: async () => ({}),
      restoreComment: async () => ({})
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

function commentsResult(comments) {
  return {
    comments,
    canParticipate: true,
    viewerProfile: {
      nickname: 'Viewer',
      avatarFileId: ''
    }
  };
}

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
