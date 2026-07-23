const CHANNELS = Object.freeze([
  { key: 'all', label: '全部', marker: 'ALL', tone: 'ink' },
  { key: 'firstParty', label: '官方动态', marker: 'SOURCE', tone: 'cobalt' },
  { key: 'news', label: '资讯', marker: 'NEWS', tone: 'cobalt' },
  { key: 'x', label: '推文', marker: 'X', tone: 'cobalt' },
  { key: 'openSource', label: 'GitHub', marker: 'GITHUB', tone: 'teal' }
]);

const NAVIGATION_CHANNELS = CHANNELS;

const FEATURED_SHORTCUT = Object.freeze({
  key: 'featured',
  label: '精选',
  tone: 'cobalt',
  premium: true,
  locked: true,
  navigation: true,
  active: false,
  count: 0
});

function channelByKey(key) {
  return CHANNELS.find((channel) => channel.key === key) || CHANNELS[0];
}

function sourceChannelKeys(entry = {}) {
  return Array.isArray(entry.sourceChannelKeys) ? entry.sourceChannelKeys : [];
}

function matchesChannel(entry, key) {
  return key === 'all' || entry.sourceChannelKey === key
    || (!entry.sourceChannelKey && inferChannel(entry).key === key);
}

function inferChannel(entry = {}) {
  const keys = sourceChannelKeys(entry);
  return channelByKey(keys.includes('firstParty')
    ? 'firstParty'
    : (keys.includes('openSource')
      ? 'openSource'
      : (keys.includes('x') ? 'x' : (keys.includes('news') ? 'news' : 'all'))));
}

function decorateChannels(entries, activeKey = 'all') {
  return NAVIGATION_CHANNELS.map((channel) => ({
    ...channel,
    active: channel.key === activeKey,
    count: entries.filter((entry) => matchesChannel(entry, channel.key)).length
  }));
}

function decorateChannelCounts(countByKey = {}, activeKey = 'all') {
  return NAVIGATION_CHANNELS.map((channel) => ({
    ...channel,
    active: channel.key === activeKey,
    count: Math.max(0, Number(countByKey[channel.key]) || 0)
  }));
}

function addFeaturedShortcut(channels = [], { locked = true } = {}) {
  return [...channels, { ...FEATURED_SHORTCUT, locked: locked === true }];
}

module.exports = {
  CHANNELS,
  NAVIGATION_CHANNELS,
  FEATURED_SHORTCUT,
  channelByKey,
  matchesChannel,
  inferChannel,
  decorateChannels,
  decorateChannelCounts,
  addFeaturedShortcut
};
