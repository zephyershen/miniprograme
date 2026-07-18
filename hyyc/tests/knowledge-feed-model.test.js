const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialListState,
  createSortState,
  createNewItemsNotice,
  isSortKey,
  defaultFiltersForFeed,
  reconcileFeedFilters,
  requestFilters,
  normalizeFeedAccess,
  mergeUniqueItems,
  mergeFeedPage,
  createFeedAppendPatch,
  createFilterDraftState,
  decorateFeed
} = require('../features/knowledge-feed/list-model');
const { buildFacetMatrix } = require('../cloudfunctions/knowledgeFeed/lib/facet-matrix');

test('creates one stable initial state for the knowledge feed page', () => {
  const state = createInitialListState();
  assert.equal(state.activeChannel, 'all');
  assert.equal(state.sortMode, 'latest');
  assert.equal(state.sortHint, '时间从新到旧');
  assert.equal(state.sortOptions[0].key, 'latest');
  assert.equal(state.sortOptions[0].active, true);
  assert.deepEqual(state.filters, { time: '7d', company: 'all', direction: 'all' });
  assert.equal(state.feed.leadItem, null);
});

test('keeps sort state validation and labels inside the feature model', () => {
  assert.equal(isSortKey('hot'), true);
  assert.equal(isSortKey('unknown'), false);
  const state = createSortState('hot');
  assert.equal(state.sortMode, 'hot');
  assert.equal(state.sortHint, '热度从高到低');
  assert.equal(state.sortOptions.find((option) => option.key === 'hot').active, true);
});

test('formats the passive new-items notice without mutating the visible feed', () => {
  assert.deepEqual(createNewItemsNotice(3), {
    newItemCount: 3,
    newItemsVisible: true,
    newItemsLabel: '3 条新资讯'
  });
  assert.equal(createNewItemsNotice(120).newItemsLabel, '99+ 条新资讯');
  assert.equal(createNewItemsNotice(-1).newItemsVisible, false);
});

test('merges paginated items without duplicates and builds the page view model', () => {
  const loaded = mergeUniqueItems(
    [{ id: 'first', title: 'A', publishedAt: '2026-07-16T00:00:00.000Z', channelKey: 'ai', topicKeys: [] }],
    [
      { id: 'first', title: 'A duplicate' },
      { id: 'second', title: 'B', publishedAt: '2026-07-15T00:00:00.000Z', channelKey: 'tech', topicKeys: [] }
    ]
  );
  const view = decorateFeed({ facets: loaded, resultCount: 2, totalAvailable: 2 }, 'all', {
    time: '7d',
    company: 'all',
    direction: 'all'
  }, loaded);
  assert.deepEqual(loaded.map((item) => item.id), ['first', 'second']);
  assert.equal(view.leadItem.sequenceLabel, '01');
  assert.equal(view.remainingItems[0].sequenceLabel, '02');
  assert.equal(view.resultCount, 2);
});

test('uses capability access metadata for free, member and administrator time choices', () => {
  const free = normalizeFeedAccess({
    viewer: { role: 'free', isAdmin: false },
    access: {
      allowedTimeKeys: ['1d', '3d', '7d', 'all'],
      defaultTimeKey: '7d',
      maxHistoryDays: 90,
      label: '普通用户可查看近 7 天'
    }
  });
  assert.deepEqual(free.access.allowedTimeKeys, ['1d', '3d', '7d']);
  assert.equal(free.access.maxHistoryDays, 7);

  const memberRaw = {
    viewer: { role: 'member', membershipStatus: 'active' },
    entitlements: {
      history: { mode: 'rolling', days: 30 },
      allowedTimeRanges: ['1d', '3d', '7d', '30d'],
      curatedFeed: true,
      digests: ['24h', '7d', '30d']
    }
  };
  const member = normalizeFeedAccess(memberRaw);
  assert.equal(member.viewer.role, 'member');
  assert.equal(member.access.defaultTimeKey, '30d');
  assert.deepEqual(member.timeFilters.map((option) => option.key), ['1d', '3d', '7d', '30d']);

  const adminRaw = {
    viewer: { role: 'admin', isAdmin: true },
    entitlements: {
      history: { mode: 'all' },
      allowedTimeRanges: ['1d', '3d', '7d', '30d', 'all'],
      curatedFeed: true,
      digests: ['24h', '7d', '30d']
    }
  };
  const admin = normalizeFeedAccess(adminRaw);
  assert.equal(admin.access.defaultTimeKey, 'all');
  assert.deepEqual(admin.timeFilters.map((option) => option.key), ['1d', '3d', '7d', '30d', 'all']);
  assert.equal(defaultFiltersForFeed(adminRaw).time, 'all');
  assert.deepEqual(
    createFilterDraftState({ ...adminRaw, facets: [] }, 'all', defaultFiltersForFeed(adminRaw))
      .filterOptions.time.map((option) => option.key),
    ['1d', '3d', '7d', '30d', 'all']
  );
});

test('lets the server choose the first time range and reconciles later downgrades', () => {
  assert.deepEqual(requestFilters({ time: '7d', company: 'all', direction: 'all' }, false), {
    company: 'all',
    direction: 'all'
  });
  const admin = {
    viewer: { role: 'admin', isAdmin: true },
    entitlements: { history: { mode: 'all' }, allowedTimeRanges: ['1d', '3d', '7d', '30d', 'all'] },
    appliedFilters: { time: 'all' }
  };
  assert.equal(reconcileFeedFilters(admin, { time: '7d', company: 'all', direction: 'all' }, true).time, 'all');

  const downgraded = {
    viewer: { role: 'free', isAdmin: false },
    access: { allowedTimeKeys: ['1d', '3d', '7d'], defaultTimeKey: '7d' },
    appliedFilters: { time: '7d' }
  };
  assert.equal(reconcileFeedFilters(downgraded, { time: 'all', company: 'all', direction: 'all' }).time, '7d');
});

test('preserves first-page access metadata while merging later pages', () => {
  const first = {
    facets: [{ id: 'facet-1' }],
    viewer: { role: 'admin', isAdmin: true },
    entitlements: { history: { mode: 'all' }, allowedTimeRanges: ['7d', 'all'] },
    access: { allowedTimeKeys: ['7d', 'all'], defaultTimeKey: 'all' },
    appliedFilters: { time: 'all' },
    nextOffset: 8
  };
  const merged = mergeFeedPage(first, { facets: undefined, nextOffset: 16 }, [{ id: 'item-1' }]);
  assert.deepEqual(merged.facets, first.facets);
  assert.deepEqual(merged.viewer, first.viewer);
  assert.deepEqual(merged.access, first.access);
  assert.deepEqual(merged.appliedFilters, first.appliedFilters);
  assert.equal(merged.nextOffset, 16);
});

test('decorates administrator counts and access copy from the accessible facet pool', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const facets = [
    { id: 'ai-new', publishedAt: new Date(now - day).toISOString(), channelKey: 'ai', topicKeys: [] },
    { id: 'tech-old', publishedAt: new Date(now - (40 * day)).toISOString(), channelKey: 'tech', topicKeys: [] }
  ];
  const raw = {
    facets,
    resultCount: 2,
    totalAvailable: 2,
    viewer: { role: 'admin', isAdmin: true },
    entitlements: {
      history: { mode: 'all' },
      allowedTimeRanges: ['1d', '3d', '7d', '30d', 'all']
    }
  };
  const view = decorateFeed(raw, 'all', { time: 'all', company: 'all', direction: 'all' }, facets);
  assert.equal(view.channels[0].label, '全部');
  assert.equal(view.channels[0].count, 2);
  assert.equal(view.channels.find((channel) => channel.key === 'ai').count, 1);
  assert.equal(view.channels.find((channel) => channel.key === 'tech').count, 1);
  assert.equal(view.accessSummary, '可查看全部已归档资讯 · 收录 2 条');
});

test('uses the compact server facet matrix for channel and filter counts', () => {
  const now = Date.now();
  const entries = [
    {
      id: 'ai-openai',
      publishedAt: new Date(now - 1000).toISOString(),
      channelKey: 'ai',
      topicKeys: ['company:openai', 'direction:agent']
    },
    {
      id: 'tech-google',
      publishedAt: new Date(now - 2000).toISOString(),
      channelKey: 'tech',
      topicKeys: ['company:google', 'direction:coding']
    }
  ];
  const raw = {
    facetMatrix: buildFacetMatrix(entries, { timeKeys: ['1d', '7d'], now }),
    resultCount: 2,
    totalAvailable: 2
  };
  const view = decorateFeed(raw, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }, entries);
  assert.equal(view.channels.find((channel) => channel.key === 'all').count, 2);
  assert.equal(view.channels.find((channel) => channel.key === 'ai').count, 1);
  assert.equal(view.channels.find((channel) => channel.key === 'tech').count, 1);
  const draft = createFilterDraftState(raw, 'all', {
    time: '7d', company: 'company:openai', direction: 'all'
  });
  assert.equal(draft.draftCount, 1);
  assert.equal(draft.filterOptions.direction
    .find((option) => option.key === 'direction:agent').count, 1);
});

test('labels only an explicit curated quality tier as editorially selected', () => {
  const publishedAt = new Date().toISOString();
  const items = [
    { id: 'standard', title: 'Standard', publishedAt, channelKey: 'ai', qualityTier: 'standard' },
    { id: 'curated', title: 'Curated', publishedAt, channelKey: 'ai', qualityTier: 'curated' }
  ];
  const view = decorateFeed({ facets: items, resultCount: 2, totalAvailable: 2 }, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }, items);
  assert.equal(view.leadItem.scoreLabel, '热度待评估');
  assert.equal(view.remainingItems[0].scoreLabel, '编辑精选');
});

test('appends only new rows when lazy loading keeps the same lead item', () => {
  const current = {
    leadItem: { id: 'lead' },
    remainingItems: [{ id: 'row-1' }]
  };
  const next = {
    leadItem: { id: 'lead' },
    remainingItems: [{ id: 'row-1' }, { id: 'row-2' }, { id: 'row-3' }],
    remainingCount: 3,
    resultCount: 4,
    loadedCount: 4,
    totalAvailable: 4,
    hasMore: false,
    accessSummary: '4 items'
  };
  const patch = createFeedAppendPatch(current, next, 2);
  assert.equal(patch['feed.remainingItems[1]'].id, 'row-2');
  assert.equal(patch['feed.remainingItems[2]'].id, 'row-3');
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'feed.remainingItems[0]'), false);
  assert.equal(patch['feed.hasMore'], false);
  assert.equal(createFeedAppendPatch({ leadItem: { id: 'old' } }, next, 2), null);
});
