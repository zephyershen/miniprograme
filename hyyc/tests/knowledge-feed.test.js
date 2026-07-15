const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAihotItem, normalizeAihotResponse } = require('../cloudfunctions/knowledgeFeed/lib/aihot');
const { extractCoverUrl } = require('../cloudfunctions/knowledgeFeed/lib/image-meta');
const { isPrivateIp } = require('../cloudfunctions/knowledgeFeed/lib/network');

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
