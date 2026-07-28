const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SEARCH_TOKEN_VERSION,
  buildSearchTokens,
  querySearchTokens
} = require('../cloudfunctions/knowledgeFeed/lib/search-terms');
const {
  contentHash,
  toStoredFeedItem
} = require('../cloudfunctions/knowledgeFeed/lib/stored-feed-item');
const {
  normalizeSearchRequest,
  createItemFeedQueryService
} = require('../cloudfunctions/knowledgeFeed/services/item-feed-query-service');
const {
  mergeSearchItems,
  highlightText,
  searchQueryError,
  searchFailureState
} = require('../features/knowledge-feed/search-model');
const {
  normalizedHistory,
  recordSearchHistory,
  clearSearchHistory
} = require('../features/knowledge-feed/search-history');
const {
  createContentSearchService
} = require('../cloudfunctions/knowledgeFeed/services/content-search-service');

const NOW = Date.parse('2026-07-27T08:00:00.000Z');

function rawItem(overrides = {}) {
  return {
    id: 'search_item_0001',
    title: 'Claude Code 正在改变 AI 编程工作流',
    titleEn: 'Claude Code changes agent workflows',
    summary: '从 MCP 工具调用到多智能体协作，开发流程正在重构。',
    url: 'https://example.com/search-item',
    permalink: 'https://example.com/search-item',
    source: 'Example Research',
    publishedAt: '2026-07-26T08:00:00.000Z',
    category: 'tool',
    categoryLabel: '工具产品',
    categoryMarker: 'TOOL',
    channelKey: 'ai',
    coverTone: 'cyan',
    topicKeys: ['company:anthropic', 'direction:agents'],
    score: 88,
    selected: true,
    attribution: null,
    ...overrides
  };
}

function entitlement(days = 30) {
  return {
    viewer: { role: 'member' },
    entitlements: { history: { mode: 'rolling', days } },
    access: {
      defaultTimeKey: '30d',
      allowedTimeKeys: ['1d', '3d', '7d', '30d']
    },
    historyDays: days,
    coverage: { state: 'complete', completeFrom: null }
  };
}

test('builds bounded Chinese bigrams and English prefixes for real keyword lookup', () => {
  const tokens = buildSearchTokens(rawItem());
  assert.ok(tokens.includes('l:clau'));
  assert.ok(tokens.includes('l:claude'));
  assert.ok(tokens.includes('c:编程'));
  assert.ok(tokens.includes('c:工作'));
  assert.ok(tokens.length <= 320);
  assert.ok(tokens.reduce((bytes, token) => bytes + Buffer.byteLength(token) + 1, 0) <= 900);
  assert.deepEqual(querySearchTokens('Claude 编程'), ['c:编程', 'l:claude']);
  assert.ok(querySearchTokens('多智能体协作').every((token) => tokens.includes(token)));
});

test('stores versioned search tokens without changing content or visual identity', () => {
  const item = rawItem();
  const stored = toStoredFeedItem(item, {
    provider: 'aihot',
    generation: 'generation-1',
    observedAt: new Date(NOW)
  });
  assert.equal(stored.searchTokenVersion, 1);
  assert.ok(stored.searchTokens.includes('l:claude'));
  assert.equal(stored.contentHash, contentHash(item));
  assert.notEqual(stored.contentHash, contentHash({ ...item, title: '新的可检索标题' }));
  assert.equal(contentHash(item), contentHash({
    ...item,
    searchTokenVersion: 999,
    searchTokens: ['future:index']
  }));

  const metadataOnly = {
    ...item,
    sourceTags: ['MCP'],
    sourceIdentity: { displayName: 'Another label' }
  };
  assert.equal(contentHash(item), contentHash(metadataOnly));
});

test('validates keyword length and converts input to a bounded server query', () => {
  assert.throws(() => normalizeSearchRequest({ query: 'a' }), /2–50/);
  assert.throws(() => normalizeSearchRequest({ query: '!!' }), /中文或英文/);
  assert.deepEqual(normalizeSearchRequest({
    query: '  Claude Code  ',
    scope: 'openSource',
    limit: 999
  }), {
    query: 'claude code',
    searchTokens: ['l:claude', 'l:code'],
    scope: 'openSource',
    cursor: '',
    limit: 20
  });
});

test('searches only entitled news history while keeping the full GitHub library available', async () => {
  const queries = [];
  const item = {
    ...toStoredFeedItem(rawItem(), {
      provider: 'aihot',
      generation: 'generation-1',
      observedAt: new Date(NOW)
    }),
    visualPublicationHeld: false
  };
  const service = createItemFeedQueryService({
    itemRepository: {
      async queryPage(options) {
        queries.push(options);
        return {
          items: [item],
          resultCount: 1,
          hasMore: false,
          nextCursor: ''
        };
      }
    },
    dayIndexRepository: {},
    syncStateRepository: {
      async get() {
        return {
          allItemsSyncedAt: new Date(NOW),
          aigclinkSyncedAt: new Date(NOW),
          searchTokenBackfillVersion: SEARCH_TOKEN_VERSION,
          searchTokenBackfillCompletedAt: new Date(NOW)
        };
      }
    },
    legacyFeedService: {},
    config: { visualPublicationGraceMs: 0 },
    now: () => NOW
  });

  const news = await service.search({ query: 'Claude', scope: 'news' }, entitlement(30));
  const projects = await service.search({
    query: 'Claude',
    scope: 'openSource'
  }, entitlement(30));

  assert.match(queries[0].since, /^2026-06-27/);
  assert.equal(queries[0].sourceChannel, 'all');
  assert.deepEqual(queries[0].searchTokens, ['l:claude']);
  assert.equal(queries[1].since, null);
  assert.equal(queries[1].sourceChannel, 'openSource');
  assert.equal(news.scopeLabel, '近 30 天资讯');
  assert.equal(projects.scopeLabel, '全部 GitHub 项目');
  assert.equal(news.items[0].title, item.title);
  assert.equal(Object.hasOwn(news.items[0], 'searchTokens'), false);
});

test('fails closed before the stored search-token backfill is complete', async () => {
  let queried = false;
  const service = createItemFeedQueryService({
    itemRepository: {
      async queryPage() {
        queried = true;
        return { items: [], resultCount: 0, hasMore: false, nextCursor: '' };
      }
    },
    dayIndexRepository: {},
    syncStateRepository: {
      async get() {
        return { allItemsSyncedAt: new Date(NOW) };
      }
    },
    legacyFeedService: {},
    config: { visualPublicationGraceMs: 0 },
    now: () => NOW
  });

  await assert.rejects(
    () => service.search({ query: 'Claude', scope: 'news' }, entitlement(30)),
    { code: 'SEARCH_UNAVAILABLE', message: '搜索索引正在准备，请稍后再试' }
  );
  assert.equal(queried, false);
});

test('merges paged search results without duplicates and validates client input', () => {
  const items = mergeSearchItems([
    { id: 'a', title: 'old', source: 'A' }
  ], [
    { id: 'a', title: 'new', source: 'A' },
    { id: 'b', title: 'second', source: 'B' }
  ]);
  assert.deepEqual(items.map((item) => item.title), ['new', 'second']);
  assert.equal(items[0].sourceAuthor.fallbackLabel, 'A');
  assert.equal(searchQueryError('a'), '至少输入 2 个字符');
  assert.equal(searchQueryError('Claude'), '');
  assert.deepEqual(searchFailureState({
    code: 'SEARCH_UNAVAILABLE',
    message: 'server detail'
  }), {
    indexPreparing: true,
    membershipRequired: false,
    message: '搜索索引正在准备，请稍后再试'
  });
  assert.deepEqual(searchFailureState({
    code: 'TEMPORARY_FAILURE',
    message: '网络繁忙'
  }), {
    indexPreparing: false,
    membershipRequired: false,
    message: '网络繁忙'
  });
});

test('highlights matches and keeps a bounded local search history', () => {
  assert.deepEqual(highlightText('Claude Code 与 Claude', 'claude'), [
    { text: 'Claude', highlighted: true },
    { text: ' Code 与 ', highlighted: false },
    { text: 'Claude', highlighted: true }
  ]);
  const writes = [];
  const storage = {
    setStorageSync: (key, value) => writes.push({ key, value }),
    removeStorageSync: (key) => writes.push({ removed: key })
  };
  const history = recordSearchHistory(' Claude ', [
    'MCP',
    'claude',
    'Agent',
    'RAG',
    'DeepSeek',
    'OpenAI',
    'Gemini',
    'Qwen',
    'Kimi'
  ], storage);
  assert.equal(history.length, 8);
  assert.deepEqual(history.slice(0, 3), ['Claude', 'MCP', 'Agent']);
  assert.deepEqual(normalizedHistory(['MCP', 'mcp', '', 'Agent']), ['MCP', 'Agent']);
  assert.deepEqual(clearSearchHistory(storage), []);
  assert.equal(writes.at(-1).removed, 'knowledgeSearchHistory.v1');
});

test('searches published column metadata for everyone and body only for Pro', async () => {
  const entries = [{
    id: 'course_prompt_001',
    kind: 'course',
    publishedAt: '2026-07-27T08:00:00.000Z',
    content: {
      id: 'course_prompt_001',
      title: '提示词基础',
      subtitle: '写清任务、上下文和验收标准',
      categoryLabel: '基础知识',
      tags: ['prompt'],
      sections: { steps: ['仅会员正文里的独特术语'] }
    }
  }];
  const service = createContentSearchService({
    columnCatalogService: { publishedEntries: async () => entries },
    digestRepository: { latest: async () => null },
    liveDigests: true
  });
  const free = {
    entitlements: { aiColumn: false, digests: [] }
  };
  const pro = {
    entitlements: { aiColumn: true, digests: ['24h', '7d', '30d'] }
  };

  assert.equal((await service.search({
    query: '提示词',
    scope: 'column'
  }, free)).items[0].locked, true);
  assert.equal((await service.search({
    query: '独特术语',
    scope: 'column'
  }, free)).resultCount, 0);
  assert.equal((await service.search({
    query: '独特术语',
    scope: 'column'
  }, pro)).resultCount, 1);
});

test('searches protected live digests without exposing them to free users', async () => {
  const service = createContentSearchService({
    columnCatalogService: { publishedEntries: async () => [] },
    digestRepository: {
      latest: async (windowKey) => ({
        _id: `digest_${windowKey.replace(/\W/g, '')}`,
        windowKey,
        executiveSummary: windowKey === '7d' ? 'Agent 工具链本周加速' : '其他内容',
        generatedAt: '2026-07-27T08:00:00.000Z'
      })
    },
    liveDigests: true
  });
  const free = { entitlements: { digests: [] } };
  const pro = { entitlements: { digests: ['24h', '7d', '30d'] } };
  await assert.rejects(
    () => service.search({ query: 'Agent', scope: 'briefing' }, free),
    { code: 'ENTITLEMENT_REQUIRED' }
  );
  const result = await service.search({ query: 'Agent', scope: 'briefing' }, pro);
  assert.equal(result.resultCount, 1);
  assert.equal(result.items[0].kind, 'briefing');
  assert.equal(result.items[0].windowKey, '7d');
});

test('registers the search route, server action, additive indexes, and persistent inbox entry', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  assert.ok(app.pages.includes('pages/search/index'));

  const backend = fs.readFileSync(path.join(
    __dirname,
    '..',
    'cloudfunctions',
    'knowledgeFeed',
    'index.js'
  ), 'utf8');
  const api = fs.readFileSync(path.join(
    __dirname,
    '..',
    'features',
    'knowledge-feed',
    'api.js'
  ), 'utf8');
  const inbox = fs.readFileSync(path.join(__dirname, '..', 'pages', 'inbox', 'index.wxml'), 'utf8');
  const searchPage = fs.readFileSync(path.join(__dirname, '..', 'pages', 'search', 'index.wxml'), 'utf8');
  assert.match(backend, /\bfeedSearch\b/);
  assert.match(backend, /\bsearchTokenBackfill\b/);
  assert.match(api, /action: 'feedSearch'/);
  assert.match(inbox, /class="feed-search-shortcut" bindtap="openSearch"/);
  assert.doesNotMatch(inbox, /wx:if="{{feed\.searchReady}}".*openSearch/);
  assert.match(searchPage, /会员专栏与知识简报/);
  assert.match(searchPage, /item\.titleParts/);
  assert.match(searchPage, /useHistory/);

  const indexes = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'cloud-database-indexes.json'
  ), 'utf8'));
  const identifiers = new Set(indexes.indexes.map((index) => `${index.collection}/${index.name}`));
  assert.ok(identifiers.has('knowledge_feed_items/ps_search_pub_id'));
  assert.ok(identifiers.has('knowledge_feed_items/ps_sc_search_pub_id'));
});
