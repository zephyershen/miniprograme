const { TIME_WINDOWS } = require('./feed-page');

const DEFAULT_CHANNEL_KEYS = Object.freeze([
  'all',
  'ai',
  'tech',
  'entertainment',
  'society',
  'games',
  'english'
]);

function uniqueKeys(values, prefix = '') {
  return [...new Set((values || [])
    .filter((value) => typeof value === 'string' && (!prefix || value.startsWith(prefix))))];
}

function dimensions(entries, timeKeys) {
  const topicKeys = (entries || []).flatMap((entry) => Array.isArray(entry.topicKeys) ? entry.topicKeys : []);
  return {
    timeKeys: uniqueKeys(timeKeys).filter((key) => Object.prototype.hasOwnProperty.call(TIME_WINDOWS, key)),
    channelKeys: [...DEFAULT_CHANNEL_KEYS],
    companyKeys: ['all', ...uniqueKeys(topicKeys, 'company:').sort()],
    directionKeys: ['all', ...uniqueKeys(topicKeys, 'direction:').sort()]
  };
}

function matrixOffset(shape, timeIndex, channelIndex, companyIndex, directionIndex) {
  return (((timeIndex * shape.channels + channelIndex) * shape.companies + companyIndex)
    * shape.directions) + directionIndex;
}

function entryDimensionKeys(entry, prefix) {
  return ['all', ...uniqueKeys(entry && entry.topicKeys, prefix)];
}

function buildFacetMatrix(entries, { timeKeys, now = Date.now() } = {}) {
  const values = Array.isArray(entries) ? entries : [];
  const keys = dimensions(values, timeKeys || Object.keys(TIME_WINDOWS));
  const shape = {
    times: keys.timeKeys.length,
    channels: keys.channelKeys.length,
    companies: keys.companyKeys.length,
    directions: keys.directionKeys.length
  };
  const counts = new Array(shape.times * shape.channels * shape.companies * shape.directions).fill(0);
  const channelIndexes = new Map(keys.channelKeys.map((key, index) => [key, index]));
  const companyIndexes = new Map(keys.companyKeys.map((key, index) => [key, index]));
  const directionIndexes = new Map(keys.directionKeys.map((key, index) => [key, index]));
  const currentTime = Number(now) || Date.now();

  for (const entry of values) {
    const publishedAt = new Date(entry && entry.publishedAt).getTime();
    if (!Number.isFinite(publishedAt)) continue;
    const channelKeys = ['all'];
    if (channelIndexes.has(entry.channelKey) && entry.channelKey !== 'all') channelKeys.push(entry.channelKey);
    const companyKeys = entryDimensionKeys(entry, 'company:');
    const directionKeys = entryDimensionKeys(entry, 'direction:');
    for (let timeIndex = 0; timeIndex < keys.timeKeys.length; timeIndex += 1) {
      const windowMs = TIME_WINDOWS[keys.timeKeys[timeIndex]];
      if (windowMs !== null && publishedAt < currentTime - windowMs) continue;
      for (const channelKey of channelKeys) {
        const channelIndex = channelIndexes.get(channelKey);
        for (const companyKey of companyKeys) {
          const companyIndex = companyIndexes.get(companyKey);
          if (companyIndex === undefined) continue;
          for (const directionKey of directionKeys) {
            const directionIndex = directionIndexes.get(directionKey);
            if (directionIndex === undefined) continue;
            counts[matrixOffset(shape, timeIndex, channelIndex, companyIndex, directionIndex)] += 1;
          }
        }
      }
    }
  }

  return { version: 1, ...keys, counts };
}

module.exports = {
  DEFAULT_CHANNEL_KEYS,
  dimensions,
  matrixOffset,
  buildFacetMatrix
};
