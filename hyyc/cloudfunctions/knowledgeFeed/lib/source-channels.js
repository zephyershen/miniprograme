const SOURCE_CHANNEL_KEYS = Object.freeze(['firstParty', 'news', 'x', 'openSource']);
const SOURCE_CHANNEL_SET = new Set(SOURCE_CHANNEL_KEYS);

function normalizeSourceChannelKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key) => SOURCE_CHANNEL_SET.has(key)))];
}

function sourceHost(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function inferSourceChannelKeys(item = {}) {
  const kind = String(item && item.source && item.source.kind || '').toLowerCase();
  const host = sourceHost(item.url);
  if (kind === 'x_search' || host === 'x.com' || host === 'www.x.com') return ['x'];
  return ['news'];
}

function mergeSourceChannelKeys(...values) {
  return normalizeSourceChannelKeys(values.flatMap((value) => (
    Array.isArray(value) ? value : []
  )));
}

function sourceChannelKey(value) {
  const keys = normalizeSourceChannelKeys(value);
  if (keys.includes('firstParty')) return 'firstParty';
  if (keys.includes('openSource')) return 'openSource';
  if (keys.includes('x')) return 'x';
  return 'news';
}

function matchesSourceChannel(item, sourceChannel) {
  return !sourceChannel || sourceChannel === 'all'
    || (item && item.sourceChannelKey) === sourceChannel
    || (!(item && item.sourceChannelKey)
      && sourceChannelKey(item && item.sourceChannelKeys) === sourceChannel);
}

module.exports = {
  SOURCE_CHANNEL_KEYS,
  normalizeSourceChannelKeys,
  inferSourceChannelKeys,
  mergeSourceChannelKeys,
  sourceChannelKey,
  matchesSourceChannel
};
