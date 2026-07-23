const test = require('node:test');
const assert = require('node:assert/strict');
const { inferChannel, decorateChannels, addFeaturedShortcut } = require('../features/knowledge-feed/channels');

test('uses AI HOT source membership instead of guessing a topic from copy', () => {
  assert.equal(inferChannel({ sourceChannelKeys: ['firstParty', 'news'] }).key, 'firstParty');
  assert.equal(inferChannel({ sourceChannelKeys: ['x'] }).key, 'x');
  assert.equal(inferChannel({ sourceChannelKeys: ['news'] }).key, 'news');
  assert.equal(inferChannel({ sourceChannelKeys: ['openSource'] }).key, 'openSource');
});

test('keeps unmatched content in the selected stream without inventing a category', () => {
  assert.equal(inferChannel({ sourceTitle: 'A useful article' }).key, 'all');
});

test('decorates channel navigation with active state and counts', () => {
  const entries = [
    { sourceChannelKeys: ['firstParty', 'news'] },
    { sourceChannelKeys: ['news'] },
    { sourceChannelKeys: ['x'] }
  ];
  const channels = decorateChannels(entries, 'news');
  assert.equal(channels[0].label, '全部');
  assert.equal(channels.find((channel) => channel.key === 'all').count, 3);
  assert.equal(channels.find((channel) => channel.key === 'news').count, 1);
  assert.equal(channels.find((channel) => channel.key === 'news').active, true);
  assert.deepEqual(channels.map((channel) => channel.key), ['all', 'firstParty', 'news', 'x', 'openSource']);
  assert.equal(channels.find((channel) => channel.key === 'firstParty').label, '官方动态');
  assert.equal(channels.find((channel) => channel.key === 'openSource').label, 'GitHub');
});

test('adds a member-only featured shortcut without turning it into a feed filter', () => {
  const channels = addFeaturedShortcut(decorateChannels([], 'all'), { locked: true });
  assert.deepEqual(channels.map((item) => item.key), ['all', 'firstParty', 'news', 'x', 'openSource', 'featured']);
  assert.equal(channels[5].premium, true);
  assert.equal(channels[5].locked, true);
  assert.equal(channels[5].navigation, true);
  assert.equal(channels[5].active, false);

  const unlocked = addFeaturedShortcut(decorateChannels([], 'all'), { locked: false });
  assert.equal(unlocked[5].premium, true);
  assert.equal(unlocked[5].locked, false);
});
