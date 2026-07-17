const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAihotDaily } = require('../cloudfunctions/knowledgeFeed/lib/aihot');
const {
  mergeArchiveItems
} = require('../cloudfunctions/knowledgeFeed/repositories/feed-archive');
const {
  createFeedArchiveService,
  archiveSelectedItem
} = require('../cloudfunctions/knowledgeFeed/services/feed-archive-service');

const NOW = Date.parse('2026-07-17T04:00:00.000Z');

function archiveItem(id, date, source = 'daily') {
  return {
    id,
    title: `${id} title`,
    summary: `${id} summary`,
    url: `https://example.com/${id}`,
    permalink: `https://aihot.virxact.com/items/${id}`,
    source: 'Example',
    publishedAt: `${date}T00:00:00.000Z`,
    category: 'ai-products',
    categoryLabel: 'AI 产品',
    channelKey: 'ai',
    topicKeys: [],
    score: null,
    archiveSource: source,
    archiveDate: date
  };
}

test('normalizes AI HOT daily archive entries into stable historical items', () => {
  const daily = normalizeAihotDaily({
    date: '2026-06-20',
    sections: [{
      label: '论文/研究',
      items: [{
        title: '一篇历史论文',
        summary: '日报中的完整摘要',
        sourceUrl: 'https://example.com/paper',
        sourceName: 'Example Research',
        permalink: 'https://aihot.virxact.com/items/archive01',
        attribution: { canonical: 'https://aihot.virxact.com/items/archive01' }
      }]
    }]
  });
  assert.equal(daily.date, '2026-06-20');
  assert.equal(daily.items.length, 1);
  assert.equal(daily.items[0].id, 'archive01');
  assert.equal(daily.items[0].category, 'paper');
  assert.equal(daily.items[0].archiveSource, 'daily');
});

test('prefers a full selected record over the same item from a daily archive', () => {
  const daily = archiveItem('archive01', '2026-06-20', 'daily');
  const selected = { ...daily, title: '完整精选记录', score: 82, archiveSource: 'selected' };
  assert.deepEqual(mergeArchiveItems([selected], [daily]), [selected]);
  assert.deepEqual(mergeArchiveItems([daily], [selected]), [selected]);
});

test('backfills historical days in bounded batches while archiving current selected items', async () => {
  let cache = {
    items: [{
      id: 'current01',
      title: '当前资讯',
      summary: '当前摘要',
      url: 'https://example.com/current',
      permalink: 'https://aihot.virxact.com/items/current01',
      source: 'Example',
      publishedAt: '2026-07-17T01:00:00.000Z',
      category: 'ai-products',
      categoryLabel: 'AI 产品',
      categoryMarker: 'PRODUCT',
      channelKey: 'ai',
      coverTone: 'cobalt',
      topicKeys: [],
      score: 70
    }]
  };
  const days = new Map();
  const archiveRepository = {
    async upsertDay(date, items) {
      const merged = mergeArchiveItems(days.get(date) || [], items);
      days.set(date, merged);
      return { date, items: merged, itemCount: merged.length };
    },
    async deleteBefore() { return 0; },
    async stats() {
      const dates = [...days.keys()].sort();
      return {
        dayCount: dates.length,
        itemCount: [...days.values()].reduce((sum, items) => sum + items.length, 0),
        newestDate: dates[dates.length - 1] || '',
        oldestDate: dates[0] || ''
      };
    }
  };
  const repository = {
    get: async () => cache,
    patchSourceState: async (fields) => {
      cache = { ...cache, ...fields };
      return cache;
    }
  };
  const historicalDates = ['2026-06-17', '2026-06-18', '2026-06-19'];
  const service = createFeedArchiveService({
    repository,
    archiveRepository,
    source: {
      loadDailyIndex: async () => historicalDates,
      loadDaily: async (date) => ({ date, items: [archiveItem(`day${date.slice(-2)}001`, date)] })
    },
    config: {
      retentionDays: 90,
      historyBatchDays: 2,
      historyIndexTake: 60,
      historyRefreshMs: 6 * 60 * 60 * 1000,
      currentRefreshMs: 6 * 60 * 60 * 1000
    },
    now: () => NOW,
    logger: { info() {}, warn() {} }
  });

  const first = await service.run({ sourceChanged: true });
  assert.equal(first.history.attemptedDays, 2);
  assert.equal(first.history.remaining, 1);
  assert.equal(archiveSelectedItem(cache.items[0]).archiveSource, 'selected');
  assert.equal(days.get('2026-07-17')[0].archiveSource, 'selected');

  const second = await service.run();
  assert.equal(second.history.attemptedDays, 1);
  assert.equal(second.history.remaining, 0);
  assert.equal(second.stats.dayCount, 4);
  assert.equal(cache.archiveDailyDates.length, 3);
  assert.ok(cache.archiveHistoryCheckedAt instanceof Date);
});

test('archives a refreshed source snapshot on the minute after visual work deferred it', async () => {
  let clock = NOW;
  let cache = {
    items: [archiveItem('current01', '2026-07-17', 'selected')],
    updatedAt: new Date(clock),
    archiveCurrentCheckedAt: new Date(clock),
    archiveHistoryCheckedAt: new Date(clock),
    archiveDailyDates: []
  };
  const archivedIds = [];
  const repository = {
    get: async () => cache,
    patchSourceState: async (fields) => {
      cache = { ...cache, ...fields };
      return cache;
    }
  };
  const archiveRepository = {
    upsertDay: async (date, items) => {
      archivedIds.push(...items.map((item) => item.id));
      return { date, items, itemCount: items.length };
    },
    deleteBefore: async () => 0,
    stats: async () => ({ dayCount: 1, itemCount: archivedIds.length })
  };
  const service = createFeedArchiveService({
    repository,
    archiveRepository,
    source: { loadDailyIndex: async () => [], loadDaily: async () => ({ items: [] }) },
    config: {
      retentionDays: 90,
      historyBatchDays: 2,
      historyIndexTake: 60,
      historyRefreshMs: 6 * 60 * 60 * 1000,
      currentRefreshMs: 6 * 60 * 60 * 1000
    },
    now: () => clock,
    logger: { info() {}, warn() {} }
  });

  const unchanged = await service.run();
  assert.equal(unchanged.current.skipped, true);
  clock += 60 * 1000;
  cache = {
    ...cache,
    items: [archiveItem('current02', '2026-07-17', 'selected')],
    updatedAt: new Date(clock)
  };
  const caughtUp = await service.run();
  assert.equal(caughtUp.current.dayCount, 1);
  assert.deepEqual(archivedIds, ['current02']);
});
