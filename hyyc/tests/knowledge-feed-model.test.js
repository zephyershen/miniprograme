const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialListState,
  createSortState,
  createNewItemsNotice,
  isSortKey,
  usesFlatFeedLayout,
  defaultFiltersForFeed,
  reconcileFeedFilters,
  requestFilters,
  libraryTagOptions,
  normalizeFeedAccess,
  mergeUniqueItems,
  mergeFeedPage,
  createFeedAppendPatch,
  createFilterDraftState,
  applyTimelineCollapse,
  applyTimelineDayStates,
  decorateFeed
} = require('../features/knowledge-feed/list-model');
const { buildFacetMatrix } = require('../cloudfunctions/knowledgeFeed/lib/facet-matrix');
const { decorateKnowledgeItem } = require('../features/knowledge-feed/detail-model');

test('creates one stable initial state for the knowledge feed page', () => {
  const state = createInitialListState();
  assert.equal(state.activeChannel, 'all');
  assert.equal(state.sortMode, 'latest');
  assert.equal(state.libraryMode, false);
  assert.equal(state.flatFeedMode, false);
  assert.equal(state.sortHint, '时间从新到旧');
  assert.equal(state.sortOptions[0].key, 'latest');
  assert.equal(state.sortOptions[0].active, true);
  assert.deepEqual(state.filters, {
    time: '1d', company: 'all', direction: 'all', sourceTag: 'all'
  });
  assert.equal(state.feed.leadItem, null);
});

test('uses a flat library layout without changing the all-channel timeline', () => {
  assert.equal(usesFlatFeedLayout('latest', 'openSource'), true);
  assert.equal(usesFlatFeedLayout('latest', 'all'), false);
  assert.equal(usesFlatFeedLayout('hot', 'all'), true);
});

test('shows the featured lock only when curated feed capability is unavailable', () => {
  const featuredFor = (raw) => decorateFeed(raw).featuredShortcut;
  const free = featuredFor({
    viewer: { role: 'free' },
    entitlements: { curatedFeed: false }
  });
  const member = featuredFor({
    viewer: { role: 'member', membershipStatus: 'active' },
    entitlements: { curatedFeed: true }
  });
  const admin = featuredFor({
    viewer: { role: 'admin', isAdmin: true },
    entitlements: { curatedFeed: true }
  });

  assert.equal(free.locked, true);
  assert.equal(member.locked, false);
  assert.equal(admin.locked, false);
  assert.equal(member.premium, true);
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
      allowedTimeKeys: ['1d'],
      defaultTimeKey: '1d',
      maxHistoryDays: 90,
      label: '普通用户可查看近 7 天'
    }
  });
  assert.deepEqual(free.access.allowedTimeKeys, ['1d']);
  assert.equal(free.access.maxHistoryDays, 1);

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
    access: { allowedTimeKeys: ['1d'], defaultTimeKey: '1d' },
    appliedFilters: { time: '1d' }
  };
  assert.equal(reconcileFeedFilters(downgraded, { time: 'all', company: 'all', direction: 'all' }).time, '1d');
});

test('uses AIGCLINK tags as the only effective library filter', () => {
  const filters = { time: '1d', company: 'company:openai', direction: 'direction:agent', sourceTag: 'MCP' };
  assert.deepEqual(requestFilters(filters, true, 'openSource'), { sourceTag: 'MCP' });
  const raw = {
    totalAvailable: 1727,
    sourceTagFacets: [
      { value: 'AI agent', count: 130 },
      { value: 'MCP', count: 53 }
    ]
  };
  assert.deepEqual(libraryTagOptions(raw, 'MCP').slice(0, 3), [
    { key: 'all', label: '全部标签', count: 1727, active: false, disabled: false },
    { key: 'AI agent', label: 'AI agent', count: 130, active: false, disabled: false },
    { key: 'MCP', label: 'MCP', count: 53, active: true, disabled: false }
  ]);
  assert.equal(libraryTagOptions(raw, 'MCP', 'mcp')[1].key, 'MCP');
  const view = decorateFeed(raw, 'openSource', filters, []);
  assert.equal(view.filterSummary, 'MCP · 不限时间');
  assert.equal(view.accessSummary, '收录 1727 个项目 · 不限时间');
  assert.equal(view.historyBoundary, false);
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
    { id: 'x-new', publishedAt: new Date(now - day).toISOString(), sourceChannelKey: 'x', sourceChannelKeys: ['x'], topicKeys: [] },
    { id: 'first-party-old', publishedAt: new Date(now - (40 * day)).toISOString(), sourceChannelKey: 'firstParty', sourceChannelKeys: ['firstParty', 'news'], topicKeys: [] }
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
  assert.equal(view.channels.find((channel) => channel.key === 'x').count, 1);
  assert.equal(view.channels.find((channel) => channel.key === 'news').count, 0);
  assert.equal(view.channels.find((channel) => channel.key === 'firstParty').count, 1);
  assert.equal(view.accessSummary, '可查看全部已归档资讯 · 收录 2 条');
});

test('uses the compact server facet matrix for channel and filter counts', () => {
  const now = Date.now();
  const entries = [
    {
      id: 'ai-openai',
      publishedAt: new Date(now - 1000).toISOString(),
      sourceChannelKey: 'firstParty',
      sourceChannelKeys: ['firstParty', 'news'],
      topicKeys: ['company:openai', 'direction:agent']
    },
    {
      id: 'tech-google',
      publishedAt: new Date(now - 2000).toISOString(),
      sourceChannelKey: 'x',
      sourceChannelKeys: ['x'],
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
  assert.equal(view.channels.find((channel) => channel.key === 'firstParty').count, 1);
  assert.equal(view.channels.find((channel) => channel.key === 'news').count, 0);
  assert.equal(view.channels.find((channel) => channel.key === 'x').count, 1);
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

test('presents AIHOT source identity and at most three real source tags in list and detail views', () => {
  const publishedAt = '2026-07-21T07:17:00.000Z';
  const item = {
    id: 'source-metadata',
    title: 'AI 护城河转向专有数据',
    source: 'Rohan Paul (@rohanpaul_ai)',
    sourceIdentity: {
      platform: 'X',
      displayName: 'Rohan Paul',
      handle: '@rohanpaul_ai'
    },
    sourceAvatarFileId: 'cloud://example/source-avatars/rohan.jpg',
    sourceTags: [' 开源生态 ', '#政策/监管', 'AI 模型', '#开源生态', '不会显示'],
    publishedAt,
    channelKey: 'ai',
    categoryLabel: '方法实践'
  };
  const list = decorateFeed({ facets: [item], resultCount: 1, totalAvailable: 1 }, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }, [item]).leadItem;
  assert.deepEqual(list.sourceTags, ['#开源生态', '#政策/监管', '#AI 模型']);
  assert.deepEqual(list.sourceAuthor, {
    platform: 'x',
    displayName: 'Rohan Paul',
    handleLabel: '@rohanpaul_ai',
    avatarFileId: 'cloud://example/source-avatars/rohan.jpg',
    avatarUrl: '',
    fallbackAvatarUrl: '/assets/brand/product-avatar.png',
    avatarInitial: 'R',
    fallbackLabel: 'Rohan Paul (@rohanpaul_ai)',
    hasIdentity: true
  });
  assert.equal(list.categoryLabel, '方法实践');

  const detail = decorateKnowledgeItem(item);
  assert.deepEqual(detail.sourceTags, list.sourceTags);
  assert.equal(detail.sourceAuthor.displayName, 'Rohan Paul');
  assert.equal(detail.sourceAuthor.handleLabel, '@rohanpaul_ai');
});

test('falls back to the existing source label and hides unavailable source tags', () => {
  const item = {
    id: 'source-fallback',
    title: '来源兼容',
    source: 'Qwen Blog',
    sourceTags: null,
    sourceIdentity: null,
    publishedAt: '2026-07-21T07:17:00.000Z',
    channelKey: 'ai'
  };
  const list = decorateFeed({ facets: [item], resultCount: 1, totalAvailable: 1 }, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }, [item]).leadItem;
  assert.deepEqual(list.sourceTags, []);
  assert.equal(list.sourceAuthor.hasIdentity, false);
  assert.equal(list.sourceAuthor.fallbackLabel, 'Qwen Blog');
  assert.equal(list.sourceAuthor.avatarFileId, '');
  assert.equal(list.sourceAuthor.avatarUrl, '');
  assert.equal(list.sourceAuthor.fallbackAvatarUrl, '/assets/brand/product-avatar.png');
  assert.equal(list.sourceAuthor.avatarInitial, 'Q');
});

test('keeps timeline day boundaries and counts stable when later pages are appended', () => {
  const firstPage = [
    { id: 'one', title: 'One', publishedAt: '2026-07-21T07:22:00.000Z', channelKey: 'ai' },
    { id: 'two', title: 'Two', publishedAt: '2026-07-21T06:05:00.000Z', channelKey: 'ai' }
  ];
  const nextPage = [
    { id: 'three', title: 'Three', publishedAt: '2026-07-21T05:00:00.000Z', channelKey: 'ai' },
    { id: 'four', title: 'Four', publishedAt: '2026-07-20T15:49:00.000Z', channelKey: 'ai' }
  ];
  const viewFor = (items) => decorateFeed({
    facets: items,
    resultCount: items.length,
    totalAvailable: items.length
  }, 'all', {
    time: '7d', company: 'all', direction: 'all'
  }, items);
  const first = viewFor(firstPage);
  const appended = viewFor(firstPage.concat(nextPage));
  const before = [first.leadItem, ...first.remainingItems];
  const after = [appended.leadItem, ...appended.remainingItems];

  assert.deepEqual(after.slice(0, 2).map((item) => ({
    id: item.id,
    dateKey: item.timelineDateKey,
    dateLabel: item.timelineDateLabel,
    timeLabel: item.timelineTimeLabel,
    startsDay: item.timelineStartsDay
  })), before.map((item) => ({
    id: item.id,
    dateKey: item.timelineDateKey,
    dateLabel: item.timelineDateLabel,
    timeLabel: item.timelineTimeLabel,
    startsDay: item.timelineStartsDay
  })));
  assert.equal(after[0].timelineStartsDay, true);
  assert.equal(after[1].timelineStartsDay, false);
  assert.equal(after[2].timelineStartsDay, false);
  assert.equal(after[3].timelineStartsDay, true);
  assert.equal(after[2].timelineDateCount, 3);
  assert.equal(after[2].timeline.timeLabel, after[2].timelineTimeLabel);
  assert.match(after[2].timelineDateMetaLabel, /3 条$/);

  const patch = createFeedAppendPatch(first, appended, firstPage.length);
  assert.equal(patch['feed.remainingItems[0].timeline'].endsDay, false);
  assert.equal(patch['feed.remainingItems[0].timeline'].dayCount, 3);
  assert.equal(patch['feed.remainingItems[1]'].id, 'three');
});

test('collapses an entire timeline day without hiding adjacent dates', () => {
  const items = [
    { id: 'one', title: 'One', publishedAt: '2026-07-21T07:22:00.000Z', channelKey: 'ai' },
    { id: 'two', title: 'Two', publishedAt: '2026-07-21T06:05:00.000Z', channelKey: 'ai' },
    { id: 'three', title: 'Three', publishedAt: '2026-07-20T15:49:00.000Z', channelKey: 'ai' }
  ];
  const feed = decorateFeed({
    facets: items,
    resultCount: items.length,
    totalAvailable: items.length
  }, 'all', { time: '7d', company: 'all', direction: 'all' }, items);
  const dateKey = feed.leadItem.timeline.dateKey;
  const collapsed = applyTimelineCollapse(feed, new Set([dateKey]));

  assert.equal(collapsed.leadItem.timeline.collapsed, true);
  assert.equal(collapsed.remainingItems[0].timeline.collapsed, true);
  assert.equal(collapsed.remainingItems[1].timeline.collapsed, false);
  assert.equal(feed.leadItem.timeline.collapsed, undefined);
});

test('keeps every selected date header while loading each day independently', () => {
  const items = [{
    id: 'today-item',
    title: 'Today',
    publishedAt: '2026-07-21T07:22:00.000Z',
    channelKey: 'ai'
  }];
  const dayBuckets = Array.from({ length: 7 }, (_, index) => ({
    dateKey: `2026-07-${String(21 - index).padStart(2, '0')}`,
    dayLabel: `7月${21 - index}日`,
    weekdayLabel: '星期二',
    count: index === 0 ? 1 : index
  }));
  const feed = decorateFeed({
    facets: items,
    resultCount: 1,
    totalAvailable: 28,
    dayBuckets
  }, 'all', { time: '7d', company: 'all', direction: 'all' }, items);
  assert.equal(feed.dayGroups.length, 7);
  assert.equal(feed.dayGroups[0].items.length, 1);
  assert.equal(feed.dayGroups[1].items.length, 0);
  assert.equal(feed.dayGroups[1].hasMore, true);

  const collapsed = applyTimelineCollapse(feed, new Set(dayBuckets.slice(1).map((day) => day.dateKey)));
  assert.equal(collapsed.dayGroups[0].collapsed, false);
  assert.equal(collapsed.dayGroups[1].collapsed, true);
  const loading = applyTimelineDayStates(collapsed, {
    '2026-07-20': { loading: true, pageInitialized: false }
  });
  assert.equal(loading.dayGroups[1].loading, true);
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
