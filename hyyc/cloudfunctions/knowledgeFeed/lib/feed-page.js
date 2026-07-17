const { TOPIC_RULES } = require('./topics');

const DEFAULT_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 20;
const TIME_WINDOWS = Object.freeze({
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  all: null
});
const CHANNEL_KEYS = new Set(['all', 'ai', 'tech', 'entertainment', 'society', 'games', 'english']);
const SORT_KEYS = new Set(['latest', 'hot', 'importance']);
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
  const cursor = typeof input.cursor === 'string' && input.cursor.length <= 1000 ? input.cursor : '';
  return {
    offset: boundedInteger(input.offset, 0, 0, 100000),
    limit: boundedInteger(input.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    ...(cursor ? { cursor } : {}),
    channel: allowedValue(input.channel, CHANNEL_KEYS, 'all'),
    sort: allowedValue(input.sort, SORT_KEYS, 'latest'),
    filters: {
      time: allowedValue(filters.time, new Set(Object.keys(TIME_WINDOWS)), '7d'),
      company: allowedValue(filters.company, COMPANY_KEYS, 'all'),
      direction: allowedValue(filters.direction, DIRECTION_KEYS, 'all')
    }
  };
}

function timestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function score(value) {
  if (value === null || value === undefined || value === '') return Number.NEGATIVE_INFINITY;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sortFeedItems(items, sort) {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      if (sort === 'hot') {
        const scoreDifference = score(right.item.score) - score(left.item.score);
        if (scoreDifference) return scoreDifference;
      }
      const timeDifference = timestamp(right.item.publishedAt) - timestamp(left.item.publishedAt);
      return timeDifference || left.originalIndex - right.originalIndex;
    })
    .map(({ item }) => item);
}

function hasTopic(item, key) {
  return key === 'all' || (Array.isArray(item.topicKeys) && item.topicKeys.includes(key));
}

function matchesFilters(item, filters, now) {
  const publishedAt = new Date(item.publishedAt).getTime();
  const windowMs = TIME_WINDOWS[filters.time];
  const withinTime = Number.isFinite(publishedAt)
    && (windowMs === null || publishedAt >= now - windowMs);
  return withinTime
    && hasTopic(item, filters.company)
    && hasTopic(item, filters.direction);
}

function buildFeedPage(items, input = {}, now = Date.now()) {
  const query = normalizeFeedQuery(input);
  const filtered = (items || []).filter((item) => matchesFilters(item, query.filters, now));
  const channelItems = query.channel === 'all'
    ? filtered
    : filtered.filter((item) => item.channelKey === query.channel);
  const results = sortFeedItems(channelItems, query.sort);
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
  TIME_WINDOWS,
  normalizeFeedQuery,
  sortFeedItems,
  buildFeedPage
};
