const test = require('node:test');
const assert = require('node:assert/strict');
const { inferChannel, decorateChannels } = require('../features/knowledge-feed/channels');

test('infers the requested editorial channels from real article metadata', () => {
  assert.equal(inferChannel({ sourceTitle: 'OpenAI releases a new GPT model' }).key, 'ai');
  assert.equal(inferChannel({ summaryZh: '一款新的主机游戏发布' }).key, 'games');
  assert.equal(inferChannel({ sourceTitle: 'English vocabulary practice' }).key, 'english');
  assert.equal(inferChannel({ summaryZh: '城市教育政策更新' }).key, 'society');
});

test('keeps unmatched content in the selected stream without inventing a category', () => {
  assert.equal(inferChannel({ sourceTitle: 'A useful article' }).key, 'all');
});

test('decorates channel navigation with active state and counts', () => {
  const entries = [
    { channelKey: 'ai' },
    { channelKey: 'ai' },
    { channelKey: 'english' }
  ];
  const channels = decorateChannels(entries, 'ai');
  assert.equal(channels[0].label, '全部');
  assert.equal(channels.find((channel) => channel.key === 'all').count, 3);
  assert.equal(channels.find((channel) => channel.key === 'ai').count, 2);
  assert.equal(channels.find((channel) => channel.key === 'ai').active, true);
});
