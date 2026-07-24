const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyResolvedFeedMedia,
  applyResolvedItemMedia,
  collectFeedMediaFileIds,
  createResolvedFeedMediaPatch,
  createKnowledgeMediaSession,
  knowledgeMediaSession,
  resolvedUrlExpiresAt
} = require('../features/knowledge-feed/cloud-media-session');
const {
  isUsableCloudMediaUrl,
  resolveCloudFileUrls,
  successfulTempFileEntry,
  temporaryUrlMaxAgeMs
} = require('../services/cloud-media');
const {
  createPageMediaRecovery
} = require('../features/knowledge-feed/cloud-media-recovery');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function loadPage(relativePath) {
  let definition;
  const previousPage = global.Page;
  global.Page = (value) => { definition = value; };
  try {
    const entrypoint = require.resolve(relativePath);
    delete require.cache[entrypoint];
    require(entrypoint);
  } finally {
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return definition;
}

test('batches cloud ids, merges concurrent requests and caches successful urls', async () => {
  let currentTime = 1_000;
  let calls = 0;
  const batches = [];
  const requested = [];
  const session = createKnowledgeMediaSession({
    now: () => currentTime,
    positiveTtlMs: 2_000,
    negativeTtlMs: 1_000,
    resolveFileUrls: async (fileIds) => {
      calls += 1;
      requested.push(fileIds);
      const batch = deferred();
      batches.push(batch);
      return batch.promise;
    }
  });
  const first = session.resolveFileIds(['cloud://one', 'cloud://two', 'cloud://one']);
  const second = session.resolveFileIds(['cloud://two']);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(requested[0], ['cloud://one', 'cloud://two']);
  assert.equal(session.pendingSize(), 2);

  batches[0].resolve([
    { fileId: 'cloud://one', url: 'https://temp.example/one' },
    { fileId: 'cloud://two', url: 'https://temp.example/two' }
  ]);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.get('cloud://one'), 'https://temp.example/one');
  assert.equal(secondResult.get('cloud://two'), 'https://temp.example/two');
  assert.equal(session.pendingSize(), 0);

  assert.equal((await session.resolveFileIds(['cloud://one'])).get('cloud://one'),
    'https://temp.example/one');
  assert.equal(calls, 1);
  currentTime += 2_001;
  const refreshed = session.resolveFileIds(['cloud://one']);
  await Promise.resolve();
  assert.equal(calls, 2);
  batches[1].resolve([{ fileId: 'cloud://one', url: 'https://temp.example/one-refreshed' }]);
  assert.equal((await refreshed).get('cloud://one'), 'https://temp.example/one-refreshed');
});

test('expires signed cloud urls before the provider lifetime ends', async () => {
  let currentTime = 10_000;
  let calls = 0;
  const session = createKnowledgeMediaSession({
    now: () => currentTime,
    positiveTtlMs: 30 * 60 * 1000,
    resolveFileUrls: async () => {
      calls += 1;
      return [{
        fileId: 'cloud://signed',
        url: `https://temp.example/signed-${calls}`,
        maxAgeMs: 2 * 60 * 1000
      }];
    }
  });

  assert.equal(temporaryUrlMaxAgeMs(600), 600_000);
  assert.equal(temporaryUrlMaxAgeMs(7_200_000), 7_200_000);
  assert.equal(resolvedUrlExpiresAt({ maxAgeMs: 120_000 }, currentTime, 1_800_000),
    currentTime + 90_000);
  assert.equal((await session.resolveFileIds(['cloud://signed'])).get('cloud://signed'),
    'https://temp.example/signed-1');
  currentTime += 89_999;
  await session.resolveFileIds(['cloud://signed']);
  assert.equal(calls, 1);
  currentTime += 2;
  assert.equal((await session.resolveFileIds(['cloud://signed'])).get('cloud://signed'),
    'https://temp.example/signed-2');
  assert.equal(calls, 2);
});

test('accepts freshly issued tcb urls because t is the signing time, not the expiry time', () => {
  const freshlyIssued = 'https://env.tcb.qcloud.la/file.jpg?sign=fresh&t=1700000000';
  assert.equal(isUsableCloudMediaUrl(freshlyIssued), true);
  assert.equal(applyResolvedItemMedia({
    listVisualFileId: 'cloud://list',
    listVisualUrl: freshlyIssued
  }, new Map()).listVisualUrl, freshlyIssued);
});

test('normalizes successful temp-file responses from current and compatible sdk shapes', async () => {
  assert.equal(successfulTempFileEntry({
    status: 0,
    errMsg: 'ok',
    tempFileURL: 'https://temp.example/current'
  }), true);
  assert.equal(successfulTempFileEntry({
    code: 'SUCCESS',
    tempFileURL: 'https://temp.example/compatible'
  }), true);
  assert.equal(successfulTempFileEntry({
    status: -1,
    errMsg: 'ok',
    tempFileURL: 'https://temp.example/rejected'
  }), false);

  const previousWx = global.wx;
  global.wx = {
    cloud: {
      async getTempFileURL() {
        return {
          fileList: [{
            fileID: 'cloud://current',
            tempFileURL: 'https://env.tcb.qcloud.la/current.jpg?sign=fresh&t=1700000000',
            status: 0,
            errMsg: 'ok'
          }]
        };
      }
    }
  };
  try {
    assert.deepEqual(await resolveCloudFileUrls(['cloud://current']), [{
      fileId: 'cloud://current',
      url: 'https://env.tcb.qcloud.la/current.jpg?sign=fresh&t=1700000000',
      maxAgeMs: 0
    }]);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('uses a short negative cache and retries after it expires', async () => {
  let currentTime = 5_000;
  let calls = 0;
  const session = createKnowledgeMediaSession({
    now: () => currentTime,
    positiveTtlMs: 2_000,
    negativeTtlMs: 1_000,
    logger: { warn() {} },
    resolveFileUrls: async () => {
      calls += 1;
      return [];
    }
  });
  assert.equal((await session.resolveFileIds(['cloud://missing'])).size, 0);
  assert.equal((await session.resolveFileIds(['cloud://missing'])).size, 0);
  assert.equal(calls, 1);
  currentTime += 1_001;
  await session.resolveFileIds(['cloud://missing']);
  assert.equal(calls, 2);
});

test('keeps a valid cached url when a forced batch only resolves its other entries', async () => {
  let calls = 0;
  const session = createKnowledgeMediaSession({
    resolveFileUrls: async () => {
      calls += 1;
      if (calls === 1) {
        return [{ fileId: 'cloud://stable', url: 'https://temp.example/stable' }];
      }
      return [{ fileId: 'cloud://fresh', url: 'https://temp.example/fresh' }];
    }
  });
  assert.equal((await session.resolveFileIds(['cloud://stable'])).get('cloud://stable'),
    'https://temp.example/stable');
  const partial = await session.resolveFileIds(
    ['cloud://stable', 'cloud://fresh'],
    { force: true }
  );
  assert.equal(partial.get('cloud://stable'), 'https://temp.example/stable');
  assert.equal(partial.get('cloud://fresh'), 'https://temp.example/fresh');
});

test('hydrates all feed and detail media without mutating durable cloud ids', () => {
  const item = {
    id: 'item-1',
    sourceAuthor: {
      displayName: 'Rohan Paul',
      avatarFileId: 'cloud://avatar',
      avatarUrl: ''
    },
    listVisualFileId: 'cloud://list',
    coverFileId: 'cloud://cover',
    previewFileIds: ['cloud://preview'],
    previewSlides: [{ fileId: 'cloud://preview', url: '', shouldLoad: true }],
    relatedItems: [{
      id: 'related-1',
      sourceAuthor: { avatarFileId: 'cloud://related-avatar', avatarUrl: '' },
      listVisualFileId: 'cloud://related-list'
    }]
  };
  const urls = new Map([
    ['cloud://avatar', 'https://temp.example/avatar'],
    ['cloud://list', 'https://temp.example/list'],
    ['cloud://cover', 'https://temp.example/cover'],
    ['cloud://preview', 'https://temp.example/preview'],
    ['cloud://related-avatar', 'https://temp.example/related-avatar'],
    ['cloud://related-list', 'https://temp.example/related-list']
  ]);
  const hydrated = applyResolvedItemMedia(item, urls);

  assert.equal(hydrated.sourceAuthor.avatarUrl, 'https://temp.example/avatar');
  assert.equal(hydrated.listVisualUrl, 'https://temp.example/list');
  assert.equal(hydrated.coverUrl, 'https://temp.example/cover');
  assert.equal(hydrated.previewSlides[0].url, 'https://temp.example/preview');
  assert.equal(hydrated.relatedItems[0].sourceAuthor.avatarUrl,
    'https://temp.example/related-avatar');
  assert.equal(hydrated.relatedItems[0].listVisualUrl, 'https://temp.example/related-list');
  assert.equal(hydrated.sourceAuthor.avatarFileId, 'cloud://avatar');
  assert.equal(item.sourceAuthor.avatarUrl, '');
  assert.equal(item.listVisualUrl, undefined);

  const feed = { leadItem: item, remainingItems: [] };
  assert.deepEqual(collectFeedMediaFileIds(feed).sort(), [
    'cloud://avatar',
    'cloud://cover',
    'cloud://list',
    'cloud://preview'
  ]);
  assert.equal(applyResolvedFeedMedia(feed, urls).leadItem.listVisualUrl,
    'https://temp.example/list');
});

test('builds leaf-only feed media patches for stable list nodes', () => {
  const feed = {
    leadItem: {
      id: 'lead',
      listVisualFileId: 'cloud://lead',
      listVisualUrl: ''
    },
    remainingItems: [],
    dayGroups: [{
      dateKey: '2026-07-23',
      items: [{
        id: 'row',
        listVisualFileId: 'cloud://row',
        listVisualUrl: '',
        sourceAuthor: {
          avatarFileId: 'cloud://avatar',
          avatarUrl: ''
        }
      }]
    }]
  };
  const patch = createResolvedFeedMediaPatch(feed, new Map([
    ['cloud://lead', 'https://temp.example/lead'],
    ['cloud://row', 'https://temp.example/row'],
    ['cloud://avatar', 'https://temp.example/avatar']
  ]));
  assert.deepEqual(patch, {
    'feed.leadItem.listVisualUrl': 'https://temp.example/lead',
    'feed.dayGroups[0].items[0].sourceAuthor.avatarUrl': 'https://temp.example/avatar',
    'feed.dayGroups[0].items[0].listVisualUrl': 'https://temp.example/row'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'feed'), false);
});

test('fails open when cloud media resolution throws', async () => {
  const session = createKnowledgeMediaSession({
    logger: { warn() {} },
    resolveFileUrls: async () => { throw new Error('network down'); }
  });
  const resolved = await session.resolveFileIds(['cloud://avatar']);
  const item = applyResolvedItemMedia({
    sourceAuthor: {
      displayName: '小互',
      avatarFileId: 'cloud://avatar',
      avatarUrl: '',
      avatarInitial: '小'
    }
  }, resolved);
  assert.equal(item.sourceAuthor.avatarUrl, '');
  assert.equal(item.sourceAuthor.displayName, '小互');
  assert.equal(item.sourceAuthor.avatarInitial, '小');
});

test('keeps existing https media when one entry in a partial resolution is missing', () => {
  const item = {
    sourceAuthor: {
      avatarFileId: 'cloud://avatar',
      avatarUrl: 'https://temp.example/avatar-existing'
    },
    listVisualFileId: 'cloud://list',
    listVisualUrl: 'https://temp.example/list-existing',
    coverFileId: 'cloud://cover',
    coverUrl: 'https://temp.example/cover-existing',
    previewFileIds: ['cloud://preview'],
    previewFileUrls: ['https://temp.example/preview-existing'],
    previewSlides: [{
      fileId: 'cloud://preview',
      url: 'https://temp.example/preview-existing'
    }]
  };
  const hydrated = applyResolvedItemMedia(item, new Map([
    ['cloud://list', 'https://temp.example/list-new']
  ]));

  assert.equal(hydrated.sourceAuthor.avatarUrl, 'https://temp.example/avatar-existing');
  assert.equal(hydrated.listVisualUrl, 'https://temp.example/list-new');
  assert.equal(hydrated.coverUrl, 'https://temp.example/cover-existing');
  assert.equal(hydrated.previewSlides[0].url, 'https://temp.example/preview-existing');
  assert.equal(hydrated.previewFileUrls[0], 'https://temp.example/preview-existing');
});

test('retries a failed image once then clears it without a loop', async () => {
  let resolveCalls = 0;
  let invalidated = '';
  const page = {
    data: { item: { coverUrl: 'https://temp.example/expired' } },
    setData(patch, callback) {
      if (Object.prototype.hasOwnProperty.call(patch, 'item.coverUrl')) {
        this.data.item.coverUrl = patch['item.coverUrl'];
      }
      if (callback) callback();
    }
  };
  const recovery = createPageMediaRecovery(page, {
    session: {
      invalidate(fileId) { invalidated = fileId; },
      async resolveFileIds() {
        resolveCalls += 1;
        return new Map([['cloud://cover', 'https://temp.example/refreshed']]);
      }
    }
  });
  const eventFor = (url) => ({
    currentTarget: {
      dataset: {
        mediaKey: 'detail:item-1:cover',
        fileId: 'cloud://cover',
        mediaUrl: url,
        mediaPath: 'item.coverUrl'
      }
    }
  });

  assert.equal(await recovery.handleError(eventFor(page.data.item.coverUrl)), true);
  assert.equal(invalidated, 'cloud://cover');
  assert.equal(resolveCalls, 1);
  assert.equal(page.data.item.coverUrl, 'https://temp.example/refreshed');

  assert.equal(await recovery.handleError(eventFor(page.data.item.coverUrl)), false);
  assert.equal(resolveCalls, 1);
  assert.equal(page.data.item.coverUrl, '');
});

test('uses the product avatar when a source avatar cannot be renewed', async () => {
  const productAvatar = '/assets/brand/product-avatar.png';
  const page = {
    data: { item: { sourceAuthor: { avatarUrl: 'https://temp.example/expired-avatar' } } },
    setData(patch) {
      this.data.item.sourceAuthor.avatarUrl = patch['item.sourceAuthor.avatarUrl'];
    }
  };
  const recovery = createPageMediaRecovery(page, {
    session: {
      invalidate() {},
      async resolveFileIds() {
        return new Map();
      }
    }
  });

  assert.equal(await recovery.handleError({
    currentTarget: {
      dataset: {
        mediaKey: 'detail:item-1:avatar',
        fileId: 'cloud://avatar',
        mediaUrl: page.data.item.sourceAuthor.avatarUrl,
        mediaFallback: productAvatar,
        mediaPath: 'item.sourceAuthor.avatarUrl'
      }
    }
  }), false);
  assert.equal(page.data.item.sourceAuthor.avatarUrl, productAvatar);
});

test('renews tracked page media before expiry and pauses while the page is hidden', async () => {
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const applied = [];
  const recovery = createPageMediaRecovery({ data: {}, setData() {} }, {
    session: {
      refreshDelayForFileIds(fileIds) {
        assert.deepEqual(fileIds, ['cloud://list']);
        return 12_000;
      },
      async resolveFileIds(fileIds, options) {
        calls.push({ fileIds, options });
        return new Map([['cloud://list', 'https://temp.example/renewed']]);
      },
      invalidate() {}
    },
    setTimer(callback, delay) {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimer(id) { timers.delete(id); }
  });
  recovery.track(['cloud://list'], (urls) => applied.push(urls.get('cloud://list')));
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 12_000);
  const firstTimer = [...timers.values()][0];
  timers.clear();
  assert.equal(await firstTimer.callback(), true);
  assert.deepEqual(calls, [{ fileIds: ['cloud://list'], options: { force: true } }]);
  assert.deepEqual(applied, ['https://temp.example/renewed']);
  assert.equal(timers.size, 1);
  recovery.pause();
  assert.equal(timers.size, 0);
  recovery.resume();
  assert.equal(timers.size, 1);
  recovery.dispose();
  assert.equal(timers.size, 0);
});

test('does not let a recovery from an old page generation write back', async () => {
  const pending = deferred();
  const page = {
    data: { item: { coverUrl: 'https://temp.example/expired' } },
    setData(patch) { this.data.item.coverUrl = patch['item.coverUrl']; }
  };
  const recovery = createPageMediaRecovery(page, {
    session: {
      invalidate() {},
      resolveFileIds: () => pending.promise
    }
  });
  const request = recovery.handleError({
    currentTarget: {
      dataset: {
        mediaKey: 'detail:item-1:cover',
        fileId: 'cloud://cover',
        mediaUrl: page.data.item.coverUrl,
        mediaPath: 'item.coverUrl'
      }
    }
  });
  recovery.reset();
  page.data.item.coverUrl = 'https://temp.example/new-item';
  pending.resolve(new Map([['cloud://cover', 'https://temp.example/old-retry']]));

  assert.equal(await request, false);
  assert.equal(page.data.item.coverUrl, 'https://temp.example/new-item');
});

test('cards ignores an older favorites response that completes last', async () => {
  const favoritesSession = require('../features/engagement/favorites-session');
  const originalLoadFavorites = favoritesSession.loadFavorites;
  const first = deferred();
  const second = deferred();
  let calls = 0;
  favoritesSession.loadFavorites = () => {
    calls += 1;
    return calls === 1 ? first.promise : second.promise;
  };
  const cardsPath = require.resolve('../pages/cards/index');
  delete require.cache[cardsPath];
  const cards = loadPage('../pages/cards/index');
  favoritesSession.loadFavorites = originalLoadFavorites;
  const context = {
    ...cards,
    data: { ...cards.data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  cards.onLoad.call(context);

  const older = cards.loadFavorites.call(context);
  const newer = cards.loadFavorites.call(context);
  second.resolve({ items: [{ id: 'newest', title: 'Newest' }] });
  assert.equal(await newer, true);
  first.resolve({ items: [{ id: 'stale', title: 'Stale' }] });
  assert.equal(await older, false);
  assert.deepEqual(context.data.favorites.map((item) => item.id), ['newest']);
});

test('inbox applies resolved media as leaf patches without replacing the feed', async () => {
  const inbox = loadPage('../pages/inbox/index');
  const originalResolveForFeed = knowledgeMediaSession.resolveForFeed;
  knowledgeMediaSession.resolveForFeed = async () => new Map([
    ['cloud://lead', 'https://temp.example/lead']
  ]);
  const patches = [];
  let tracked = 0;
  const context = {
    feedMediaRequestId: 1,
    data: {
      feed: {
        leadItem: {
          id: 'lead',
          listVisualFileId: 'cloud://lead',
          listVisualUrl: ''
        },
        remainingItems: [],
        dayGroups: []
      }
    },
    mediaRecovery: {
      track() { tracked += 1; }
    },
    setData(patch) { patches.push(patch); }
  };
  try {
    assert.equal(await inbox.resolveVisibleFeedMedia.call(context, context.data.feed, 1), true);
  } finally {
    knowledgeMediaSession.resolveForFeed = originalResolveForFeed;
  }
  assert.deepEqual(patches, [{
    'feed.leadItem.listVisualUrl': 'https://temp.example/lead'
  }]);
  assert.equal(tracked, 1);
});

test('list and detail pages discard stale asynchronous media results', async () => {
  const inbox = loadPage('../pages/inbox/index');
  const detail = loadPage('../pages/feed-detail/index');
  const originalResolveForFeed = knowledgeMediaSession.resolveForFeed;
  const originalResolveForItem = knowledgeMediaSession.resolveForItem;
  const feedPending = deferred();
  const itemPending = deferred();
  knowledgeMediaSession.resolveForFeed = () => feedPending.promise;
  knowledgeMediaSession.resolveForItem = () => itemPending.promise;
  try {
    const listPatches = [];
    const listContext = {
      feedMediaRequestId: 1,
      data: { feed: { leadItem: { id: 'new' }, remainingItems: [] } },
      setData(patch) { listPatches.push(patch); }
    };
    const oldFeed = {
      leadItem: { id: 'old', listVisualFileId: 'cloud://old' },
      remainingItems: []
    };
    const listRequest = inbox.resolveVisibleFeedMedia.call(listContext, oldFeed, 1);
    listContext.feedMediaRequestId = 2;
    feedPending.resolve(new Map([['cloud://old', 'https://temp.example/old']]));
    assert.equal(await listRequest, false);
    assert.deepEqual(listPatches, []);

    const detailPatches = [];
    const detailContext = {
      detailMediaRequestId: 3,
      data: { item: { id: 'new' } },
      setData(patch) { detailPatches.push(patch); }
    };
    const oldItem = { id: 'old', coverFileId: 'cloud://old-cover' };
    const detailRequest = detail.resolveVisibleItemMedia.call(detailContext, oldItem, 3);
    detailContext.detailMediaRequestId = 4;
    itemPending.resolve(new Map([
      ['cloud://old-cover', 'https://temp.example/old-cover']
    ]));
    assert.equal(await detailRequest, false);
    assert.deepEqual(detailPatches, []);
  } finally {
    knowledgeMediaSession.resolveForFeed = originalResolveForFeed;
    knowledgeMediaSession.resolveForItem = originalResolveForItem;
  }
});

test('long-lived knowledge pages renew signed media only while visible', () => {
  const root = path.join(__dirname, '..');
  [
    'pages/inbox/index.js',
    'pages/feed-detail/index.js',
    'pages/featured/index.js',
    'pages/cards/index.js'
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /mediaRecovery\.track\(/);
    assert.match(source, /mediaRecovery\.pause\(\)/);
    assert.match(source, /mediaRecovery\.resume\(\)/);
  });
});
