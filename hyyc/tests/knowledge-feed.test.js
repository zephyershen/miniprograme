const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSourceLabel, normalizeAihotItem, normalizeAihotResponse } = require('../cloudfunctions/knowledgeFeed/lib/aihot');
const { extractCoverUrl } = require('../cloudfunctions/knowledgeFeed/lib/image-meta');
const { isPrivateIp } = require('../cloudfunctions/knowledgeFeed/lib/network');
const { buildFeedPage, normalizeFeedQuery } = require('../cloudfunctions/knowledgeFeed/lib/feed-page');

const baseItem = {
  id: 'cmrl9plh50014bi2b56tar61d',
  title: 'Codex 周活超 700 万',
  title_en: 'Codex reaches 7M weekly users',
  url: 'https://x.com/OpenAIDevs/status/123',
  permalink: 'https://aihot.virxact.com/items/cmrl9plh50014bi2b56tar61d',
  source: 'X：OpenAI Developers',
  publishedAt: '2026-07-14T23:01:05.000Z',
  summary: '两月更新 150+ 项。',
  category: 'ai-products',
  score: 74,
  attribution: {
    source: 'AI HOT',
    canonical: 'https://aihot.virxact.com/items/cmrl9plh50014bi2b56tar61d'
  }
};

test('normalizes AI HOT items into the platform channel model', () => {
  const item = normalizeAihotItem(baseItem);
  assert.equal(item.channelKey, 'ai');
  assert.equal(item.categoryLabel, 'AI 产品');
  assert.equal(item.categoryMarker, 'PRODUCT');
  assert.equal(item.score, 74);
  assert.equal(item.attribution.source, 'AI HOT');
});

test('maps industry updates to the technology channel', () => {
  const item = normalizeAihotItem({ ...baseItem, category: 'industry' });
  assert.equal(item.channelKey, 'tech');
  assert.equal(item.categoryLabel, '产业动态');
});

test('removes feed transport details from public source labels', () => {
  assert.equal(cleanSourceLabel('TechCrunch：AI（RSS）'), 'TechCrunch');
  assert.equal(cleanSourceLabel('Hacker News 热门（buzzing.cc 中文翻译）'), 'Hacker News');
  assert.equal(cleanSourceLabel('X：OpenAI Developers'), 'OpenAI Developers');
  assert.equal(cleanSourceLabel('公众号：通义实验室（千问）'), '通义实验室（千问）');
  assert.equal(cleanSourceLabel('Anthropic：Research（发表成果 · 网页）'), 'Anthropic');
});

test('drops malformed entries and de-duplicates IDs', () => {
  const items = normalizeAihotResponse({
    items: [baseItem, { ...baseItem }, { ...baseItem, id: 'bad', url: 'http://insecure.test' }]
  });
  assert.equal(items.length, 1);
});

test('extracts absolute and relative Open Graph cover URLs', () => {
  assert.equal(
    extractCoverUrl('<meta property="og:image" content="https://cdn.test/hero.jpg?x=1&amp;y=2">', 'https://example.test/post'),
    'https://cdn.test/hero.jpg?x=1&y=2'
  );
  assert.equal(
    extractCoverUrl("<meta content='/images/hero.webp' name='twitter:image'>", 'https://example.test/post'),
    'https://example.test/images/hero.webp'
  );
});

test('rejects non-HTTPS image metadata', () => {
  assert.equal(extractCoverUrl('<meta property="og:image" content="http://cdn.test/hero.jpg">', 'https://example.test'), '');
});

test('recognizes private and public addresses for cover SSRF protection', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('169.254.1.1'), true);
  assert.equal(isPrivateIp('10.1.2.3'), true);
  assert.equal(isPrivateIp('192.0.66.4'), false);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
});

test('returns a bounded first page and a stable next offset', () => {
  const items = Array.from({ length: 18 }, (_, index) => ({
    id: String(index),
    publishedAt: '2026-07-15T01:00:00.000Z',
    channelKey: index % 2 === 0 ? 'ai' : 'tech',
    topicKeys: index % 3 === 0 ? ['company:openai'] : []
  }));
  const testNow = Date.parse('2026-07-16T02:00:00.000Z');
  const page = buildFeedPage(items, { offset: 0, limit: 8, channel: 'all', filters: { time: '7d' } }, testNow);
  assert.equal(page.items.length, 8);
  assert.equal(page.resultCount, 18);
  assert.equal(page.nextOffset, 8);
  assert.equal(page.hasMore, true);

  const lastPage = buildFeedPage(items, { offset: 16, limit: 8, channel: 'all', filters: { time: '7d' } }, testNow);
  assert.equal(lastPage.items.length, 2);
  assert.equal(lastPage.nextOffset, 18);
  assert.equal(lastPage.hasMore, false);
});

test('paginates after applying channel and topic filters', () => {
  const items = [
    { id: '1', publishedAt: '2026-07-15T01:00:00.000Z', sourceChannelKeys: ['firstParty', 'news'], topicKeys: ['company:openai'] },
    { id: '2', publishedAt: '2026-07-15T01:00:00.000Z', sourceChannelKeys: ['x'], topicKeys: ['company:openai'] },
    { id: '3', publishedAt: '2026-07-15T01:00:00.000Z', sourceChannelKeys: ['firstParty'], topicKeys: ['company:anthropic'] }
  ];
  const page = buildFeedPage(items, {
    channel: 'firstParty',
    filters: { time: '7d', company: 'company:openai', direction: 'all' }
  }, Date.parse('2026-07-16T02:00:00.000Z'));
  assert.deepEqual(page.items.map((item) => item.id), ['1']);
  assert.equal(page.resultCount, 1);
});

test('keeps the open-source library channel instead of falling back to all news', () => {
  const query = normalizeFeedQuery({ channel: 'openSource', filters: { time: '30d' } });
  assert.equal(query.channel, 'openSource');

  const page = buildFeedPage([
    { id: 'aigclink', publishedAt: '2026-07-20T04:00:00.000Z', sourceChannelKey: 'openSource', topicKeys: [] },
    { id: 'aihot', publishedAt: '2026-07-20T05:00:00.000Z', sourceChannelKey: 'news', topicKeys: [] }
  ], query, Date.parse('2026-07-23T00:00:00.000Z'));

  assert.deepEqual(page.items.map((item) => item.id), ['aigclink']);
  assert.equal(page.resultCount, 1);
});

test('sorts the default feed by publish time instead of trusting upstream order', () => {
  const items = [
    { id: 'older', publishedAt: '2026-07-14T01:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 99 },
    { id: 'newest', publishedAt: '2026-07-16T01:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 60 },
    { id: 'middle', publishedAt: '2026-07-15T01:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 80 }
  ];
  const page = buildFeedPage(
    items,
    { filters: { time: '7d' } },
    Date.parse('2026-07-16T02:00:00.000Z')
  );
  assert.equal(page.query.sort, 'latest');
  assert.deepEqual(page.items.map((item) => item.id), ['newest', 'middle', 'older']);
});

test('sorts the full heat feed by score and uses time as the tie-breaker', () => {
  const items = [
    { id: 'newest-warm', publishedAt: '2026-07-16T01:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 70 },
    { id: 'hot-older', publishedAt: '2026-07-15T01:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 90 },
    { id: 'hot-newer', publishedAt: '2026-07-15T02:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 90 }
  ];
  const page = buildFeedPage(
    items,
    { sort: 'hot', filters: { time: '7d' } },
    Date.parse('2026-07-16T02:00:00.000Z')
  );
  assert.equal(page.query.sort, 'hot');
  assert.deepEqual(page.items.map((item) => item.id), ['hot-newer', 'hot-older', 'newest-warm']);
});

test('applies the time filter before sorting by heat', () => {
  const items = [
    { id: 'expired-hot', publishedAt: '2026-07-14T01:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 100 },
    { id: 'recent-warm', publishedAt: '2026-07-15T23:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 70 },
    { id: 'recent-hot-old', publishedAt: '2026-07-15T21:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 90 },
    { id: 'recent-hot-new', publishedAt: '2026-07-15T22:00:00.000Z', channelKey: 'ai', topicKeys: [], score: 90 }
  ];
  const page = buildFeedPage(items, {
    sort: 'hot',
    filters: { time: '1d', company: 'all', direction: 'all' }
  }, Date.parse('2026-07-16T01:00:00.000Z'));
  assert.deepEqual(page.items.map((item) => item.id), ['recent-hot-new', 'recent-hot-old', 'recent-warm']);
  assert.equal(page.resultCount, 3);
});

test('normalizes malformed pagination input to safe defaults', () => {
  const query = normalizeFeedQuery({
    offset: -10,
    limit: 999,
    channel: 'unknown',
    sort: 'unknown',
    filters: { time: 'forever', company: 'company:unknown', direction: 'direction:unknown' }
  });
  assert.deepEqual(query, {
    offset: 0,
    limit: 20,
    channel: 'all',
    sort: 'latest',
    filters: { time: '7d', company: 'all', direction: 'all', sourceTag: 'all' }
  });
});
