const { cleanSourceLabel } = require('../lib/aihot');
const { toIso } = require('../lib/dates');
const { buildFeedPage } = require('../lib/feed-page');
const { inferTopicKeys } = require('../lib/topics');

function publicItem(item) {
  return {
    id: item.id,
    title: item.title,
    titleEn: item.titleEn || '',
    summary: item.summary || '',
    url: item.url,
    source: cleanSourceLabel(item.source),
    publishedAt: item.publishedAt,
    category: item.category,
    categoryLabel: item.categoryLabel,
    categoryMarker: item.categoryMarker,
    channelKey: item.channelKey,
    coverTone: item.coverTone,
    coverFileId: item.coverFileId || '',
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : inferTopicKeys(item),
    score: item.score
  };
}

function publicFacet(item) {
  return {
    id: item.id,
    publishedAt: item.publishedAt,
    channelKey: item.channelKey,
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : inferTopicKeys(item)
  };
}

function presentFeed(cache, { stale = false, query = {}, now = Date.now() } = {}) {
  const allItems = cache.items || [];
  const page = buildFeedPage(allItems, query, now);
  return {
    updatedAt: toIso(cache.fetchedAt),
    stale,
    windowDays: 7,
    totalAvailable: allItems.length,
    resultCount: page.resultCount,
    offset: page.query.offset,
    nextOffset: page.nextOffset,
    limit: page.query.limit,
    sort: page.query.sort,
    hasMore: page.hasMore,
    items: page.items.map(publicItem),
    facets: page.query.offset === 0 ? allItems.map(publicFacet) : undefined
  };
}

function publicRelatedItem(item) {
  return {
    id: item.id,
    title: item.title,
    source: cleanSourceLabel(item.source),
    publishedAt: item.publishedAt,
    category: item.category,
    categoryLabel: item.categoryLabel,
    channelKey: item.channelKey,
    coverTone: item.coverTone,
    coverFileId: item.coverFileId || ''
  };
}

function relatedItems(cache, current, limit = 3) {
  return (cache.items || [])
    .filter((item) => item.id !== current.id)
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      relationRank: item.category === current.category ? 0 : item.channelKey === current.channelKey ? 1 : 2
    }))
    .sort((left, right) => left.relationRank - right.relationRank || left.originalIndex - right.originalIndex)
    .slice(0, limit)
    .map(({ item }) => publicRelatedItem(item));
}

function presentItem(cache, item) {
  return { ...publicItem(item), relatedItems: relatedItems(cache, item) };
}

module.exports = { publicItem, presentFeed, presentItem };
