const { TOPIC_RULES } = require('./topics');

const DEFAULT_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 20;
const TIME_WINDOWS = Object.freeze({
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
});
const CHANNEL_KEYS = new Set(['all', 'ai', 'tech', 'entertainment', 'society', 'games', 'english']);
const COMPANY_KEYS = new Set(['all', ...TOPIC_RULES
  .map((rule) => rule.key)
  .filter((key) => key.startsWith('company:'))]);
const DIRECTION_KEYS = new Set(['all', ...TOPIC_RULES
  .map((rule) => rule.key)
  .filter((key) => key.startsWith('direction:'))]);

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function allowedValue(value, allowed, fallback) {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function normalizeFeedQuery(input = {}) {
  const filters = input.filters || {};
  return {
    offset: boundedInteger(input.offset, 0, 0, 10000),
    limit: boundedInteger(input.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    channel: allowedValue(input.channel, CHANNEL_KEYS, 'all'),
    filters: {
      time: allowedValue(filters.time, new Set(Object.keys(TIME_WINDOWS)), '7d'),
      company: allowedValue(filters.company, COMPANY_KEYS, 'all'),
      direction: allowedValue(filters.direction, DIRECTION_KEYS, 'all')
    }
  };
}

function hasTopic(item, key) {
  return key === 'all' || (Array.isArray(item.topicKeys) && item.topicKeys.includes(key));
}

function matchesFilters(item, filters, now) {
  const publishedAt = new Date(item.publishedAt).getTime();
  const threshold = now - TIME_WINDOWS[filters.time];
  const withinTime = filters.time === '7d'
    || (Number.isFinite(publishedAt) && publishedAt >= threshold);
  return withinTime
    && hasTopic(item, filters.company)
    && hasTopic(item, filters.direction);
}

function buildFeedPage(items, input = {}, now = Date.now()) {
  const query = normalizeFeedQuery(input);
  const filtered = (items || []).filter((item) => matchesFilters(item, query.filters, now));
  const results = query.channel === 'all'
    ? filtered
    : filtered.filter((item) => item.channelKey === query.channel);
  const pageItems = results.slice(query.offset, query.offset + query.limit);
  const nextOffset = query.offset + pageItems.length;
  return {
    query,
    items: pageItems,
    resultCount: results.length,
    hasMore: nextOffset < results.length,
    nextOffset
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizeFeedQuery,
  buildFeedPage
};
