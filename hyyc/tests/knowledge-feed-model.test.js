const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialListState,
  createSortState,
  isSortKey,
  mergeUniqueItems,
  decorateFeed
} = require('../features/knowledge-feed/list-model');

test('creates one stable initial state for the knowledge feed page', () => {
  const state = createInitialListState();
  assert.equal(state.activeChannel, 'all');
  assert.equal(state.sortMode, 'hot');
  assert.equal(state.sortHint, '热度从高到低');
  assert.equal(state.sortOptions[0].key, 'hot');
  assert.equal(state.sortOptions[0].active, true);
  assert.deepEqual(state.filters, { time: '7d', company: 'all', direction: 'all' });
  assert.equal(state.feed.visibleItems.length, 0);
});

test('keeps sort state validation and labels inside the feature model', () => {
  assert.equal(isSortKey('hot'), true);
  assert.equal(isSortKey('unknown'), false);
  const state = createSortState('hot');
  assert.equal(state.sortMode, 'hot');
  assert.equal(state.sortHint, '热度从高到低');
  assert.equal(state.sortOptions.find((option) => option.key === 'hot').active, true);
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
