const test = require('node:test');
const assert = require('node:assert/strict');
const { filterFeedItems, filterSummary, filterOptionsWithCounts } = require('../features/knowledge-feed/filters');
const { TIME_FILTERS, COMPANY_FILTERS, DIRECTION_FILTERS } = require('../features/knowledge-feed/config');

const NOW = Date.parse('2026-07-15T06:00:00.000Z');
const items = [
  { id: '1', publishedAt: '2026-07-15T01:00:00.000Z', topicKeys: ['company:openai', 'direction:coding'] },
  { id: '2', publishedAt: '2026-07-13T01:00:00.000Z', topicKeys: ['company:anthropic', 'direction:coding'] },
  { id: '3', publishedAt: '2026-07-09T01:00:00.000Z', topicKeys: ['company:openai', 'direction:safety'] }
];

test('filters by time, company and technical direction together', () => {
  assert.deepEqual(filterFeedItems(items, { time: '1d', company: 'all', direction: 'all' }, NOW).map((item) => item.id), ['1']);
  assert.deepEqual(filterFeedItems(items, { time: '7d', company: 'company:openai', direction: 'direction:safety' }, NOW).map((item) => item.id), ['3']);
  assert.deepEqual(filterFeedItems(items, { time: '3d', company: 'all', direction: 'direction:coding' }, NOW).map((item) => item.id), ['1', '2']);
});

test('keeps every item in the upstream seven-day pool by default', () => {
  const pool = [...items, { id: '4', publishedAt: '', topicKeys: [] }];
  assert.deepEqual(filterFeedItems(pool, { time: '7d', company: 'all', direction: 'all' }, NOW).map((item) => item.id), ['1', '2', '3', '4']);
});

test('builds a compact user-facing filter summary', () => {
  const options = { time: TIME_FILTERS, company: COMPANY_FILTERS, direction: DIRECTION_FILTERS };
  assert.equal(filterSummary({ time: '7d', company: 'all', direction: 'all' }, options), '近 7 天 · 全部主题');
  assert.equal(filterSummary({ time: '1d', company: 'company:openai', direction: 'direction:coding' }, options), '24 小时 · OpenAI / ChatGPT · AI 编码');
});

test('reports option counts and disables choices with no matching content', () => {
  const options = filterOptionsWithCounts({
    time: [{ key: '1d', label: '24 小时' }, { key: '7d', label: '近 7 天' }],
    company: [{ key: 'all', label: '全部' }, { key: 'company:openai', label: 'OpenAI' }],
    direction: [{ key: 'all', label: '全部' }, { key: 'direction:video', label: '视频' }]
  }, items, { time: '7d', company: 'all', direction: 'all' }, NOW);

  assert.equal(options.time.find((entry) => entry.key === '7d').count, 3);
  assert.equal(options.company.find((entry) => entry.key === 'company:openai').count, 2);
  assert.equal(options.direction.find((entry) => entry.key === 'direction:video').disabled, true);
});
