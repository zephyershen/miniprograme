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

function loadPage(request, mocks = []) {
  const restores = mocks.map(([moduleRequest, exports]) => installModuleMock(moduleRequest, exports));
  const filename = require.resolve(request);
  const previousModule = require.cache[filename];
  const previousPage = global.Page;
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[filename];
  try {
    require(filename);
  } finally {
    if (previousModule) require.cache[filename] = previousModule;
    else delete require.cache[filename];
    restores.reverse().forEach((restore) => restore());
    if (previousPage) global.Page = previousPage;
    else delete global.Page;
  }
  return definition;
}

function membership(role, {
  cachePartition = 'actor-a',
  currentPeriodEnd = '2099-08-23T00:00:00.000Z'
} = {}) {
  const privileged = role !== 'free';
  return {
    viewer: {
      role,
      cachePartition,
      membershipStatus: privileged ? 'active' : 'inactive',
      currentPeriodEnd: privileged ? currentPeriodEnd : null
    },
    entitlements: {
      history: { mode: 'rolling', days: privileged ? 30 : 1 },
      allowedTimeRanges: privileged ? ['1d', '7d', '30d'] : ['1d'],
      curatedFeed: privileged,
      aiColumn: privileged,
      comments: privileged,
      digests: privileged ? ['24h', '7d'] : []
    }
  };
}

test('partitions item details by entitlement revision and never serves stale protected detail', async () => {
  const membershipApiPath = '../features/membership/api';
  const knowledgeApiPath = '../features/knowledge-feed/api';
  const membershipSessionPath = '../features/membership/session';
  const itemSessionPath = '../features/knowledge-feed/item-session';
  const priorMembershipSession = require.cache[require.resolve(membershipSessionPath)];
  const priorItemSession = require.cache[require.resolve(itemSessionPath)];
  const previousGetApp = global.getApp;
  const app = {
    globalData: {
      membership: null,
      knowledgeFeed: { items: [{ id: 'protected' }] },
      curatedFeed: { items: [] },
      briefing: { items: [] }
    }
  };
  let currentMembership = membership('member');
  let itemResult = { item: { id: 'protected', body: 'member detail' } };
  let itemError = null;
  let itemCalls = 0;
  const restoreMembershipApi = installModuleMock(membershipApiPath, {
    getMembershipStatus: async () => currentMembership,
    setMembershipRolePreview: async () => currentMembership
  });
  const restoreKnowledgeApi = installModuleMock(knowledgeApiPath, {
    getKnowledgeItem: async () => {
      itemCalls += 1;
      if (itemError) throw itemError;
      return itemResult;
    }
  });
  delete require.cache[require.resolve(membershipSessionPath)];
  delete require.cache[require.resolve(itemSessionPath)];
  global.getApp = () => app;

  try {
    const membershipSession = require(membershipSessionPath);
    const itemSession = require(itemSessionPath);
    await membershipSession.refreshMembershipAccess({ force: true });

    const first = await itemSession.loadKnowledgeItem('protected');
    assert.equal(first.item.body, 'member detail');
    itemError = Object.assign(new Error('offline'), { code: 'TEMPORARY_FAILURE' });
    await assert.rejects(
      () => itemSession.loadKnowledgeItem('protected'),
      (error) => error.code === 'TEMPORARY_FAILURE'
    );

    currentMembership = membership('member');
    currentMembership.entitlements.history.days = 7;
    currentMembership.entitlements.allowedTimeRanges = ['1d', '7d'];
    await membershipSession.refreshMembershipAccess({ force: true });
    assert.equal(membershipSession.membershipRevision(), 1);
    await assert.rejects(
      () => itemSession.loadKnowledgeItem('protected'),
      (error) => error.code === 'TEMPORARY_FAILURE'
    );
    itemError = null;
    itemResult = { item: { id: 'protected', body: 'seven-day member detail' } };
    await itemSession.loadKnowledgeItem('protected');

    currentMembership = membership('free');
    await membershipSession.refreshMembershipAccess({ force: true });
    assert.equal(membershipSession.membershipRevision(), 2);
    assert.equal(app.globalData.knowledgeFeed, null);
    itemError = Object.assign(new Error('upgrade required'), { code: 'ENTITLEMENT_REQUIRED' });
    await assert.rejects(
      () => itemSession.loadKnowledgeItem('protected'),
      (error) => error.code === 'ENTITLEMENT_REQUIRED'
    );

    currentMembership = membership('member');
    await membershipSession.refreshMembershipAccess({ force: true });
    itemError = null;
    itemResult = { item: { id: 'protected', body: 'fresh member detail' } };
    await itemSession.loadKnowledgeItem('protected');
    itemError = Object.assign(new Error('deleted'), { code: 'ITEM_NOT_FOUND' });
    await assert.rejects(
      () => itemSession.loadKnowledgeItem('protected'),
      (error) => error.code === 'ITEM_NOT_FOUND'
    );
    itemError = Object.assign(new Error('offline again'), { code: 'TEMPORARY_FAILURE' });
    await assert.rejects(
      () => itemSession.loadKnowledgeItem('protected'),
      (error) => error.code === 'TEMPORARY_FAILURE'
    );
    assert.equal(itemCalls, 8);
  } finally {
    restoreKnowledgeApi();
    restoreMembershipApi();
    if (priorMembershipSession) require.cache[require.resolve(membershipSessionPath)] = priorMembershipSession;
    else delete require.cache[require.resolve(membershipSessionPath)];
    if (priorItemSession) require.cache[require.resolve(itemSessionPath)] = priorItemSession;
    else delete require.cache[require.resolve(itemSessionPath)];
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('locally expired membership is downgraded before protected caches can be reused', async () => {
  const membershipApiPath = '../features/membership/api';
  const knowledgeApiPath = '../features/knowledge-feed/api';
  const membershipSessionPath = '../features/membership/session';
  const itemSessionPath = '../features/knowledge-feed/item-session';
  const priorMembershipSession = require.cache[require.resolve(membershipSessionPath)];
  const priorItemSession = require.cache[require.resolve(itemSessionPath)];
  const previousGetApp = global.getApp;
  const previousDateNow = Date.now;
  const baseTime = Date.parse('2026-07-23T00:00:00.000Z');
  let currentTime = baseTime;
  let itemError = null;
  const app = {
    globalData: {
      membership: null,
      knowledgeFeed: { items: [{ id: 'expiring-item' }] },
      curatedFeed: { items: [] },
      briefing: { items: [] }
    }
  };
  const access = membership('member', {
    cachePartition: 'expiring-actor',
    currentPeriodEnd: new Date(baseTime + 1000).toISOString()
  });
  const restoreMembershipApi = installModuleMock(membershipApiPath, {
    getMembershipStatus: async () => access,
    setMembershipRolePreview: async () => access
  });
  const restoreKnowledgeApi = installModuleMock(knowledgeApiPath, {
    getKnowledgeItem: async () => {
      if (itemError) throw itemError;
      return { item: { id: 'expiring-item', body: 'protected' } };
    }
  });
  Date.now = () => currentTime;
  global.getApp = () => app;
  delete require.cache[require.resolve(membershipSessionPath)];
  delete require.cache[require.resolve(itemSessionPath)];

  try {
    const membershipSession = require(membershipSessionPath);
    const itemSession = require(itemSessionPath);
    await membershipSession.refreshMembershipAccess({ force: true });
    assert.equal((await itemSession.loadKnowledgeItem('expiring-item')).item.body, 'protected');

    currentTime = baseTime + 2000;
    itemError = Object.assign(new Error('offline'), { code: 'TEMPORARY_FAILURE' });
    assert.equal(membershipSession.cachedMembershipAccess().viewer.role, 'free');
    assert.equal(membershipSession.cachedMembershipAccess().viewer.membershipStatus, 'expired');
    assert.equal(membershipSession.membershipRevision(), 1);
    assert.equal(app.globalData.knowledgeFeed, null);
    await assert.rejects(
      () => itemSession.loadKnowledgeItem('expiring-item'),
      (error) => error.code === 'TEMPORARY_FAILURE'
    );
  } finally {
    Date.now = previousDateNow;
    restoreKnowledgeApi();
    restoreMembershipApi();
    if (priorMembershipSession) require.cache[require.resolve(membershipSessionPath)] = priorMembershipSession;
    else delete require.cache[require.resolve(membershipSessionPath)];
    if (priorItemSession) require.cache[require.resolve(itemSessionPath)] = priorItemSession;
    else delete require.cache[require.resolve(itemSessionPath)];
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('local period expiry does not downgrade an administrator member preview', () => {
  const { membershipCacheScope } = require('../features/membership/session');
  const preview = membership('member', {
    cachePartition: 'admin-preview',
    currentPeriodEnd: '2026-07-22T00:00:00.000Z'
  });
  preview.viewer.actualRole = 'admin';
  preview.viewer.isActualAdmin = true;
  preview.viewer.canPreviewRoles = true;
  preview.viewer.isRolePreview = true;
  const scope = JSON.parse(membershipCacheScope(
    preview,
    Date.parse('2026-07-23T00:00:00.000Z')
  ));
  assert.equal(scope.role, 'member');
  assert.equal(scope.aiColumn, true);
});

test('viewer-scoped profile cache does not cross account boundaries', async () => {
  const membershipApiPath = '../features/membership/api';
  const profileApiPath = '../features/user-profile/api';
  const membershipSessionPath = '../features/membership/session';
  const profileSessionPath = '../features/user-profile/session';
  const priorMembershipSession = require.cache[require.resolve(membershipSessionPath)];
  const priorProfileSession = require.cache[require.resolve(profileSessionPath)];
  const previousGetApp = global.getApp;
  const app = { globalData: { membership: null } };
  let currentAccess = membership('member', { cachePartition: 'actor-a' });
  let nickname = 'Alice';
  let profileCalls = 0;
  const restoreMembershipApi = installModuleMock(membershipApiPath, {
    getMembershipStatus: async () => currentAccess,
    setMembershipRolePreview: async () => currentAccess
  });
  const restoreProfileApi = installModuleMock(profileApiPath, {
    getUserProfile: async () => {
      profileCalls += 1;
      return { profile: { nickname } };
    },
    saveUserProfile: async (profile) => ({ profile })
  });
  global.getApp = () => app;
  delete require.cache[require.resolve(membershipSessionPath)];
  delete require.cache[require.resolve(profileSessionPath)];

  try {
    const membershipSession = require(membershipSessionPath);
    const profileSession = require(profileSessionPath);
    await membershipSession.refreshMembershipAccess({ force: true });
    assert.equal((await profileSession.loadUserProfile()).nickname, 'Alice');

    currentAccess = membership('member', { cachePartition: 'actor-b' });
    nickname = 'Bob';
    await membershipSession.refreshMembershipAccess({ force: true });
    assert.equal((await profileSession.loadUserProfile()).nickname, 'Bob');
    assert.equal(profileCalls, 2);
  } finally {
    restoreProfileApi();
    restoreMembershipApi();
    if (priorMembershipSession) require.cache[require.resolve(membershipSessionPath)] = priorMembershipSession;
    else delete require.cache[require.resolve(membershipSessionPath)];
    if (priorProfileSession) require.cache[require.resolve(profileSessionPath)] = priorProfileSession;
    else delete require.cache[require.resolve(profileSessionPath)];
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('profile page ignores an older account response after a viewer boundary', async () => {
  let resolveFirstProfile;
  let calls = 0;
  const page = loadPage('../pages/profile/index', [[
    '../features/user-profile/session',
    {
      loadUserProfile: async () => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve) => { resolveFirstProfile = resolve; });
        }
        return { nickname: 'Bob' };
      }
    }
  ]]);
  const context = {
    data: { userProfile: null },
    pageDisposed: false,
    profileLoadRequestId: 0,
    setData(patch) { Object.assign(this.data, patch); }
  };
  const olderLoad = page.loadProfile.call(context);
  context.profileLoadRequestId += 1;
  assert.equal(await page.loadProfile.call(context), true);
  assert.equal(context.data.userProfile.nickname, 'Bob');
  resolveFirstProfile({ nickname: 'Alice' });
  assert.equal(await olderLoad, false);
  assert.equal(context.data.userProfile.nickname, 'Bob');
});

test('an older membership refresh cannot overwrite a newer role preview', async () => {
  const membershipApiPath = '../features/membership/api';
  const membershipSessionPath = '../features/membership/session';
  const priorMembershipSession = require.cache[require.resolve(membershipSessionPath)];
  const previousGetApp = global.getApp;
  const app = {
    globalData: {
      membership: membership('admin', { cachePartition: 'admin-actor' })
    }
  };
  let resolveRefresh;
  const previewAccess = membership('free', { cachePartition: 'admin-actor' });
  const restoreMembershipApi = installModuleMock(membershipApiPath, {
    getMembershipStatus: () => new Promise((resolve) => { resolveRefresh = resolve; }),
    setMembershipRolePreview: async () => previewAccess
  });
  global.getApp = () => app;
  delete require.cache[require.resolve(membershipSessionPath)];

  try {
    const membershipSession = require(membershipSessionPath);
    const pendingRefresh = membershipSession.refreshMembershipAccess({ force: true });
    const preview = await membershipSession.changeMembershipRolePreview('free');
    assert.equal(preview.viewer.role, 'free');
    resolveRefresh(membership('member', { cachePartition: 'admin-actor' }));
    const staleResult = await pendingRefresh;
    assert.equal(staleResult.viewer.role, 'free');
    assert.equal(app.globalData.membership.viewer.role, 'free');
  } finally {
    restoreMembershipApi();
    if (priorMembershipSession) require.cache[require.resolve(membershipSessionPath)] = priorMembershipSession;
    else delete require.cache[require.resolve(membershipSessionPath)];
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('server-issued client cache partitions are stable, opaque, and actor-specific', () => {
  const {
    clientCachePartition
  } = require('../cloudfunctions/knowledgeFeed/services/feed-entitlement-service');
  const first = clientCachePartition('openid:actor-a');
  const repeated = clientCachePartition('openid:actor-a');
  const second = clientCachePartition('openid:actor-b');
  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /actor-a|openid/);
});

test('detail hydration preserves the latest locally confirmed engagement', () => {
  const { rememberEngagement } = require('../features/engagement/session');
  rememberEngagement('hydration-item', {
    liked: true,
    favorited: true,
    canComment: true,
    likeCount: 8,
    favoriteCount: 3,
    commentCount: 1
  });
  const page = loadPage('../pages/feed-detail/index');
  const context = {
    data: { item: null },
    detailMediaRequestId: 0,
    mediaRecovery: null,
    openCommentsAfterLoad: false,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    resolveVisibleItemMedia() {}
  };

  page.showItem.call(context, {
    id: 'hydration-item',
    title: 'Server detail',
    summary: 'Summary',
    url: 'https://example.com/detail',
    publishedAt: '2026-07-23T01:00:00.000Z',
    engagement: {
      liked: false,
      favorited: false,
      likeCount: 1,
      favoriteCount: 0,
      commentCount: 1
    }
  });

  assert.equal(context.data.item.engagement.liked, true);
  assert.equal(context.data.item.engagement.favorited, true);
  assert.equal(context.data.item.engagement.likeCount, 8);
});

test('an authoritative detail denial never exposes an item from the feed cache', async () => {
  const denial = Object.assign(new Error('upgrade required'), { code: 'ENTITLEMENT_REQUIRED' });
  const page = loadPage('../pages/feed-detail/index', [[
    '../features/knowledge-feed/item-session',
    { loadKnowledgeItem: async () => { throw denial; } }
  ]]);
  const previousGetApp = global.getApp;
  global.getApp = () => ({
    globalData: {
      knowledgeFeed: {
        items: [{
          id: 'locked-item',
          title: 'Cached title',
          summary: 'Cached summary',
          url: 'https://example.com/locked',
          publishedAt: '2026-07-22T01:00:00.000Z'
        }]
      }
    }
  });
  const context = {
    data: { item: null },
    itemId: 'locked-item',
    digestId: '',
    pageDisposed: false,
    detailLoadRequestId: 0,
    detailMediaRequestId: 0,
    mediaRecovery: null,
    showCalls: 0,
    showItem(item) {
      this.showCalls += 1;
      this.data.item = item;
    },
    setData(patch) { Object.assign(this.data, patch); }
  };

  try {
    await page.loadItem.call(context);
    assert.equal(context.data.item, null);
    assert.equal(context.showCalls, 0);
    assert.equal(context.data.entitlementRequired, true);
    assert.equal(context.data.error, 'upgrade required');
  } finally {
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('returning to an open detail revalidates access and clears denied content', async () => {
  const denial = Object.assign(new Error('membership expired'), { code: 'ENTITLEMENT_REQUIRED' });
  const page = loadPage('../pages/feed-detail/index', [[
    '../features/knowledge-feed/item-session',
    { loadKnowledgeItem: async () => { throw denial; } }
  ]]);
  const previousGetApp = global.getApp;
  global.getApp = () => ({ globalData: { knowledgeFeed: { items: [] } } });
  const context = {
    data: {
      item: {
        id: 'protected-open-item',
        title: 'Previously authorized'
      }
    },
    itemId: 'protected-open-item',
    digestId: '',
    pageDisposed: false,
    detailLoadRequestId: 0,
    detailMediaRequestId: 0,
    skipNextDetailRevalidation: false,
    mediaRecovery: { resume() {}, reset() {} },
    setData(patch) { Object.assign(this.data, patch); },
    loadItem: page.loadItem
  };

  try {
    await page.onShow.call(context);
    assert.equal(context.data.item, null);
    assert.equal(context.data.entitlementRequired, true);
    assert.equal(context.data.error, 'membership expired');
  } finally {
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('transient detail failures preserve content only inside the same entitlement scope', async () => {
  const transient = Object.assign(new Error('offline'), { code: 'TEMPORARY_FAILURE' });
  let currentScope = 'actor-a:member';
  const page = loadPage('../pages/feed-detail/index', [
    [
      '../features/knowledge-feed/item-session',
      { loadKnowledgeItem: async () => { throw transient; } }
    ],
    [
      '../features/membership/session',
      {
        membershipCacheScope: () => currentScope,
        cachedMembershipAccess: () => ({
          viewer: { role: 'admin' },
          entitlements: { history: { mode: 'all' } }
        })
      }
    ]
  ]);
  const previousGetApp = global.getApp;
  global.getApp = () => ({ globalData: { knowledgeFeed: { items: [] } } });
  const context = {
    data: { item: { id: 'protected-open-item', title: 'Authorized content' } },
    itemId: 'protected-open-item',
    digestId: '',
    authorizedDetailScope: 'actor-a:member',
    pageDisposed: false,
    detailLoadRequestId: 0,
    detailMediaRequestId: 0,
    mediaRecovery: { reset() {} },
    setData(patch) { Object.assign(this.data, patch); }
  };

  try {
    assert.equal(await page.loadItem.call(context, { preserveCurrent: true }), false);
    assert.equal(context.data.item.title, 'Authorized content');
    currentScope = 'actor-a:free';
    assert.equal(await page.loadItem.call(context, { preserveCurrent: true }), false);
    assert.equal(context.data.item, null);
    assert.equal(context.data.error, 'offline');
  } finally {
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('a transient failure cannot preserve an item that aged beyond the current history window', async () => {
  const transient = Object.assign(new Error('offline'), { code: 'TEMPORARY_FAILURE' });
  const page = loadPage('../pages/feed-detail/index', [
    [
      '../features/knowledge-feed/item-session',
      { loadKnowledgeItem: async () => { throw transient; } }
    ],
    [
      '../features/membership/session',
      {
        membershipCacheScope: () => 'actor-a:free',
        cachedMembershipAccess: () => ({
          viewer: { role: 'free' },
          entitlements: { history: { mode: 'rolling', days: 1 } }
        })
      }
    ]
  ]);
  const previousGetApp = global.getApp;
  global.getApp = () => ({ globalData: { knowledgeFeed: { items: [] } } });
  const context = {
    data: {
      item: {
        id: 'aged-out-item',
        title: 'No longer authorized',
        publishedAt: '2020-01-01T00:00:00.000Z'
      }
    },
    itemId: 'aged-out-item',
    digestId: '',
    authorizedDetailScope: 'actor-a:free',
    pageDisposed: false,
    detailLoadRequestId: 0,
    detailMediaRequestId: 0,
    mediaRecovery: { reset() {} },
    setData(patch) { Object.assign(this.data, patch); }
  };

  try {
    assert.equal(await page.loadItem.call(context, { preserveCurrent: true }), false);
    assert.equal(context.data.item, null);
  } finally {
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('drops a timeline-day response when channel, sort, filters, or request generation changes', async () => {
  let resolveDay;
  let requested;
  const page = loadPage('../pages/inbox/index', [[
    '../features/knowledge-feed/api',
    {
      getKnowledgeFeed: async () => ({ items: [] }),
      getKnowledgeFeedUpdates: async () => ({ newCount: 0 }),
      getKnowledgeFeedDay: (query) => {
        requested = query;
        return new Promise((resolve) => { resolveDay = resolve; });
      }
    }
  ]]);
  let presentCalls = 0;
  const originalItem = { id: 'current', publishedAt: '2026-07-23T02:00:00.000Z' };
  const context = {
    data: {
      activeChannel: 'news',
      sortMode: 'latest',
      filters: { time: '30d', company: 'all', direction: 'all', sourceTag: 'all' }
    },
    feedRequestId: 4,
    timelineDayStates: {},
    timelineDayRequestToken: 0,
    loadedItems: [originalItem],
    present() { presentCalls += 1; }
  };

  const pending = page.loadTimelineDay.call(context, '2026-07-22');
  assert.equal(requested.channel, 'news');
  context.data.activeChannel = 'official';
  context.data.sortMode = 'hot';
  context.data.filters = { ...context.data.filters, company: 'OpenAI' };
  context.feedRequestId = 5;
  context.timelineDayStates = {};
  resolveDay({
    items: [{ id: 'stale', publishedAt: '2026-07-22T01:00:00.000Z' }],
    hasMore: false
  });

  assert.equal(await pending, false);
  assert.deepEqual(context.loadedItems, [originalItem]);
  assert.deepEqual(context.timelineDayStates, {});
  assert.equal(presentCalls, 1);
});

test('a first-page refresh reapplies locally confirmed engagement over an older response', async () => {
  let resolveFeed;
  const page = loadPage('../pages/inbox/index', [[
    '../features/knowledge-feed/api',
    {
      getKnowledgeFeed: () => new Promise((resolve) => { resolveFeed = resolve; }),
      getKnowledgeFeedUpdates: async () => ({ newCount: 0 }),
      getKnowledgeFeedDay: async () => ({ items: [] })
    }
  ]]);
  const { createInitialListState } = require('../features/knowledge-feed/list-model');
  const { rememberEngagement } = require('../features/engagement/session');
  const previousGetApp = global.getApp;
  const app = {
    globalData: {
      membership: membership('member', { cachePartition: 'engagement-actor' }),
      knowledgeFeed: null
    }
  };
  const serverItem = {
    id: 'refresh-race-item',
    title: 'A refresh race',
    summary: 'The server response started before the local write completed.',
    url: 'https://example.com/race',
    publishedAt: '2026-07-23T02:00:00.000Z',
    engagement: {
      liked: false,
      favorited: false,
      likeCount: 2,
      favoriteCount: 0,
      commentCount: 0
    }
  };
  const initialState = createInitialListState();
  const context = {
    data: initialState,
    rawFeed: { ...membership('member'), items: [serverItem], facets: [] },
    loadedItems: [serverItem],
    feedAccessResolved: true,
    feedRequestId: 1,
    timelineDayStates: {},
    collapsedTimelineDays: new Set(),
    feedPollState: {},
    mediaRecovery: null,
    engagementSyncs: new Map(),
    setData(patch) { Object.assign(this.data, patch); },
    pruneEngagementSyncs() {},
    scheduleFeedUpdateCheck() {},
    resolveVisibleFeedMedia() {},
    present(...args) { return page.present.call(this, ...args); }
  };
  global.getApp = () => app;

  try {
    const pendingRefresh = page.loadFeed.call(context, true, { preserveCurrent: true });
    rememberEngagement('refresh-race-item', {
      liked: true,
      favorited: false,
      canComment: true,
      likeCount: 3,
      favoriteCount: 0,
      commentCount: 0
    });
    resolveFeed({
      ...membership('member'),
      items: [serverItem],
      facets: [],
      resultCount: 1,
      totalAvailable: 1,
      hasMore: false,
      headCursor: 'head-2'
    });
    assert.equal(await pendingRefresh, true);
    assert.equal(context.loadedItems[0].engagement.liked, true);
    assert.equal(context.loadedItems[0].engagement.likeCount, 3);
    assert.equal(context.rawFeed.items[0].engagement.liked, true);
    assert.equal(context.data.feed.leadItem.engagement.liked, true);
  } finally {
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('a local entitlement downgrade reloads the feed even when membership refresh is offline', async () => {
  let revision = 0;
  const page = loadPage('../pages/inbox/index', [[
    '../features/membership/session',
    {
      refreshMembershipAccess: () => {
        revision = 1;
        return Promise.reject(Object.assign(new Error('offline'), { code: 'TEMPORARY_FAILURE' }));
      },
      membershipRevision: () => revision
    }
  ]]);
  const previousWarn = console.warn;
  const feedLoads = [];
  let schedules = 0;
  console.warn = () => {};
  const context = {
    seenMembershipRevision: 0,
    feedAccessResolved: true,
    historyBoundarySeen: true,
    loadFeed(force) {
      feedLoads.push(force);
      return Promise.resolve(true);
    },
    scheduleFeedUpdateCheck() { schedules += 1; }
  };

  try {
    await page.refreshMembershipAndFeed.call(context);
    assert.deepEqual(feedLoads, [false]);
    assert.equal(context.seenMembershipRevision, 1);
    assert.equal(context.feedAccessResolved, false);
    assert.equal(context.historyBoundarySeen, false);
    assert.equal(schedules, 1);
  } finally {
    console.warn = previousWarn;
  }
});

test('first-page refresh settles pending day loads and resets their pagination state', async () => {
  let resolveFeed;
  const page = loadPage('../pages/inbox/index', [[
    '../features/knowledge-feed/api',
    {
      getKnowledgeFeed: () => new Promise((resolve) => { resolveFeed = resolve; }),
      getKnowledgeFeedUpdates: async () => ({ newCount: 0 }),
      getKnowledgeFeedDay: async () => ({ items: [] })
    }
  ]]);
  const { createInitialListState } = require('../features/knowledge-feed/list-model');
  const previousGetApp = global.getApp;
  const app = { globalData: { membership: membership('member'), knowledgeFeed: null } };
  const initialState = createInitialListState();
  initialState.feed = {
    ...initialState.feed,
    dayGroups: [{
      dateKey: '2026-07-22',
      dayLabel: '2026-07-22',
      count: 1,
      items: [],
      loading: true,
      hasMore: true
    }]
  };
  const context = {
    data: initialState,
    rawFeed: { ...membership('member'), items: [], facets: [] },
    loadedItems: [],
    feedAccessResolved: true,
    feedRequestId: 7,
    timelineDayStates: {
      '2026-07-22': {
        loading: true,
        pageInitialized: true,
        hasMore: true,
        nextCursor: 'old-cursor',
        requestToken: 8
      }
    },
    collapsedTimelineDays: new Set(),
    feedPollState: {},
    mediaRecovery: null,
    engagementSyncs: new Map(),
    setData(patch) { Object.assign(this.data, patch); },
    pruneEngagementSyncs() {},
    scheduleFeedUpdateCheck() {},
    resolveVisibleFeedMedia() {},
    present(...args) { return page.present.call(this, ...args); }
  };
  global.getApp = () => app;

  try {
    const pendingRefresh = page.loadFeed.call(context, true, { preserveCurrent: true });
    assert.equal(context.timelineDayStates['2026-07-22'].loading, false);
    assert.equal(context.data.feed.dayGroups[0].loading, false);
    resolveFeed({
      ...membership('member'),
      items: [],
      facets: [],
      dayBuckets: [
        { dateKey: '2026-07-23', count: 0 },
        { dateKey: '2026-07-22', count: 1 }
      ],
      resultCount: 0,
      totalAvailable: 0,
      hasMore: false
    });
    assert.equal(await pendingRefresh, true);
    assert.deepEqual(context.timelineDayStates, {});
    assert.deepEqual([...context.collapsedTimelineDays], ['2026-07-22']);
  } finally {
    if (previousGetApp) global.getApp = previousGetApp;
    else delete global.getApp;
  }
});

test('pull-to-refresh keeps the current feed while the authoritative refresh is in flight', async () => {
  const page = loadPage('../pages/inbox/index');
  const previousWx = global.wx;
  const calls = [];
  let stopped = 0;
  global.wx = { stopPullDownRefresh: () => { stopped += 1; } };
  const context = {
    loadFeed(force, options) {
      calls.push({ force, options });
      return Promise.resolve(false);
    }
  };
  try {
    page.onPullDownRefresh.call(context);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(calls, [{ force: true, options: { preserveCurrent: true } }]);
    assert.equal(stopped, 1);
  } finally {
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('feed, profile, and favorites requests cannot write after their pages unload', async () => {
  let resolveFeed;
  const inbox = loadPage('../pages/inbox/index', [[
    '../features/knowledge-feed/api',
    {
      getKnowledgeFeed: () => new Promise((resolve) => { resolveFeed = resolve; }),
      getKnowledgeFeedUpdates: async () => ({ newCount: 0 }),
      getKnowledgeFeedDay: async () => ({ items: [] })
    }
  ]]);
  let inboxPostUnloadWrites = 0;
  const inboxContext = {
    data: {
      activeChannel: 'all',
      sortMode: 'latest',
      filters: { time: '1d', company: 'all', direction: 'all', sourceTag: 'all' }
    },
    pageDisposed: false,
    feedRequestId: 0,
    feedAccessResolved: false,
    loadedItems: [],
    timelineDayStates: {},
    feedPollState: {},
    setData() {
      if (this.pageDisposed) inboxPostUnloadWrites += 1;
    },
    stopFeedUpdateChecks() {},
    disposeEngagementSyncs() {},
    pruneEngagementSyncs() {},
    scheduleFeedUpdateCheck() {},
    present() { inboxPostUnloadWrites += 100; }
  };
  const pendingFeed = inbox.loadFeed.call(inboxContext, false);
  inbox.onUnload.call(inboxContext);
  resolveFeed({ ...membership('free'), items: [], facets: [] });
  assert.equal(await pendingFeed, false);
  assert.equal(inboxPostUnloadWrites, 0);

  let resolveProfileAccess;
  let profileLoads = 0;
  let billingLoads = 0;
  const profile = loadPage('../pages/profile/index', [
    [
      '../features/membership/session',
      {
        refreshMembershipAccess: () => new Promise((resolve) => { resolveProfileAccess = resolve; }),
        changeMembershipRolePreview: async () => membership('member')
      }
    ],
    [
      '../features/user-profile/session',
      { loadUserProfile: async () => { profileLoads += 1; return {}; } }
    ],
    [
      '../features/billing/session',
      { loadBillingPlans: async () => { billingLoads += 1; return {}; } }
    ]
  ]);
  let profilePostUnloadWrites = 0;
  const profileContext = {
    data: {
      billing: { purchasing: false }
    },
    pageDisposed: false,
    setData() {
      if (this.pageDisposed) profilePostUnloadWrites += 1;
    },
    loadMembership: profile.loadMembership,
    loadProfile: profile.loadProfile,
    loadBilling: profile.loadBilling
  };
  const pendingProfile = profile.refreshProfilePage.call(profileContext, { force: true });
  profile.onUnload.call(profileContext);
  resolveProfileAccess(membership('member'));
  assert.equal(await pendingProfile, false);
  assert.equal(profileLoads, 0);
  assert.equal(billingLoads, 0);
  assert.equal(profilePostUnloadWrites, 0);

  let resolveFavoritesAccess;
  let favoriteLoads = 0;
  const cards = loadPage('../pages/cards/index', [
    [
      '../features/membership/session',
      {
        refreshMembershipAccess: () => new Promise((resolve) => { resolveFavoritesAccess = resolve; })
      }
    ],
    [
      '../features/engagement/favorites-session',
      {
        loadFavorites: async () => { favoriteLoads += 1; return { items: [] }; },
        updateFavorite: async () => ({})
      }
    ]
  ]);
  let cardsPostUnloadWrites = 0;
  const cardsContext = {
    data: { favorites: [] },
    pageDisposed: false,
    favoriteLoadRequestId: 0,
    favoriteMediaRequestId: 0,
    mediaRecovery: { dispose() {} },
    setData() {
      if (this.pageDisposed) cardsPostUnloadWrites += 1;
    },
    loadFavorites: cards.loadFavorites
  };
  const pendingFavorites = cards.refreshFavoritesPage.call(cardsContext, { force: true });
  cards.onUnload.call(cardsContext);
  resolveFavoritesAccess(membership('member'));
  assert.equal(await pendingFavorites, false);
  assert.equal(favoriteLoads, 0);
  assert.equal(cardsPostUnloadWrites, 0);
});

test('profile save completes once and cancels its navigation timer on unload', async () => {
  let uploads = 0;
  let saves = 0;
  const page = loadPage('../pages/profile-edit/index', [
    ['../features/user-profile/session', {
      loadUserProfile: async () => ({}),
      updateUserProfile: async () => { saves += 1; }
    }],
    ['../features/user-profile/media', {
      uploadAvatar: async () => {
        uploads += 1;
        return 'cloud://avatar';
      }
    }]
  ]);
  const previousWx = global.wx;
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const timer = { id: 'return' };
  let timerCallback;
  let cleared = null;
  let navigations = 0;
  global.wx = {
    showToast() {},
    navigateBack() { navigations += 1; }
  };
  global.setTimeout = (callback) => {
    timerCallback = callback;
    return timer;
  };
  global.clearTimeout = (value) => { cleared = value; };
  const context = {
    data: {
      canSave: true,
      saving: false,
      nickname: 'Tester',
      avatarUrl: 'temporary://avatar',
      avatarFileId: '',
      avatarChanged: true
    },
    pageDisposed: false,
    saveCompleted: false,
    returnTimer: null,
    setData(patch) { Object.assign(this.data, patch); }
  };

  try {
    const first = page.saveProfile.call(context);
    const duplicate = page.saveProfile.call(context);
    await Promise.all([first, duplicate]);
    await page.saveProfile.call(context);
    assert.equal(uploads, 1);
    assert.equal(saves, 1);
    assert.equal(context.saveCompleted, true);
    assert.equal(context.returnTimer, timer);

    page.onUnload.call(context);
    assert.equal(cleared, timer);
    assert.equal(context.returnTimer, null);
    timerCallback();
    assert.equal(navigations, 0);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
    if (previousWx) global.wx = previousWx;
    else delete global.wx;
  }
});

test('the compatibility reader loads case content and exposes related trends', async () => {
  let caseLoads = 0;
  const page = loadPage('../pages/column-reader/index', [[
    '../features/ai-column/session',
    {
      loadColumnLesson: async () => { throw new Error('wrong lesson loader'); },
      loadColumnPractical: async () => { throw new Error('wrong practical loader'); },
      loadColumnCase: async () => {
        caseLoads += 1;
        return {
          case: {
            id: 'case-1',
            title: 'Case one',
            conclusion: 'A useful conclusion',
            relatedTrends: [{ id: 'trend-1', title: 'Trend one' }]
          }
        };
      },
      clearColumnCache() {}
    }
  ]]);
  const context = {
    data: {},
    articleType: 'case',
    articleId: 'case-1',
    resolveProtectedScope: async () => 'member:open:1',
    setData(patch) { Object.assign(this.data, patch); }
  };

  await page.loadContent.call(context);
  assert.equal(caseLoads, 1);
  assert.equal(context.data.article.kind, 'case');
  assert.equal(context.data.article.relatedTrends[0].id, 'trend-1');
  assert.deepEqual(context.data.article.relatedPracticals, []);
  assert.deepEqual(context.data.article.commands, []);

  const markup = fs.readFileSync(
    path.resolve(__dirname, '../pages/column-reader/index.wxml'),
    'utf8'
  );
  assert.match(markup, /article\.relatedTrends\.length/);
  assert.match(markup, /bindtap="openRelatedTrend"/);
});

test('a denied reader revalidation invalidates an older protected-content response', async () => {
  let resolveLesson;
  const page = loadPage('../pages/column-reader/index', [[
    '../features/ai-column/session',
    {
      loadColumnLesson: () => new Promise((resolve) => { resolveLesson = resolve; }),
      loadColumnPractical: async () => ({}),
      loadColumnCase: async () => ({}),
      clearColumnCache() {}
    }
  ]]);
  const denial = Object.assign(new Error('membership expired'), { code: 'ENTITLEMENT_REQUIRED' });
  let accessAllowed = true;
  const context = {
    data: { article: { id: 'previous-content' } },
    articleType: 'lesson',
    articleId: 'lesson-1',
    pageDisposed: false,
    contentRequestId: 0,
    resolveProtectedScope: async () => {
      if (!accessAllowed) throw denial;
      return 'actor-a:member';
    },
    setData(patch) { Object.assign(this.data, patch); }
  };

  const olderLoad = page.loadContent.call(context);
  await Promise.resolve();
  accessAllowed = false;
  assert.equal(await page.loadContent.call(context, { force: true }), false);
  assert.equal(context.data.article, null);
  resolveLesson({ lesson: { id: 'lesson-1', title: 'Stale protected content' } });
  assert.equal(await olderLoad, false);
  assert.equal(context.data.article, null);
  assert.equal(context.data.membershipPromptVisible, true);
});
