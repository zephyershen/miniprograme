const { cleanSourceLabel } = require('../lib/aihot');
const { toIso } = require('../lib/dates');
const { buildFeedPage } = require('../lib/feed-page');
const { inferTopicKeys } = require('../lib/topics');
const { publishableItems } = require('../policies/visual-publication');
const { FREE_WINDOW_DAYS, freeItemVisible } = require('../policies/feed-access');
const { qualityTier } = require('../policies/feed-quality');
const { buildFacetMatrix } = require('../lib/facet-matrix');

function publicItem(item, { includeAllPreviews = false } = {}) {
  const allPreviewFileIds = Array.isArray(item.previewFileIds)
    ? item.previewFileIds.filter((fileId) => typeof fileId === 'string' && fileId)
    : [];
  const previewFileIds = includeAllPreviews ? allPreviewFileIds : allPreviewFileIds.slice(0, 1);
  const visualFileId = item.coverFileId || previewFileIds[0] || '';
  const listThumbnailFileId = item.listThumbnailFileId || '';
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
    previewFileIds,
    previewCount: allPreviewFileIds.length,
    visualFileId,
    listThumbnailFileId,
    listVisualFileId: listThumbnailFileId || visualFileId,
    visualKind: item.coverFileId ? 'cover' : previewFileIds.length ? 'source-preview' : '',
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : inferTopicKeys(item),
    score: item.score,
    qualityTier: qualityTier(item),
    curationReason: qualityTier(item) === 'curated' && typeof item.curationReason === 'string'
      ? item.curationReason
      : ''
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
  const allItems = publishableItems(cache.items).filter((item) => freeItemVisible(item, now));
  const page = buildFeedPage(allItems, query, now);
  return {
    updatedAt: toIso(cache.fetchedAt),
    stale,
    windowDays: FREE_WINDOW_DAYS,
    totalAvailable: allItems.length,
    resultCount: page.resultCount,
    offset: page.query.offset,
    nextOffset: page.nextOffset,
    limit: page.query.limit,
    sort: page.query.sort,
    hasMore: page.hasMore,
    items: page.items.map(publicItem),
    facetMatrix: page.query.offset === 0
      ? buildFacetMatrix(allItems, { timeKeys: ['1d', '3d', '7d'], now })
      : undefined
  };
}

function publicRelatedItem(item) {
  const previewFileIds = Array.isArray(item.previewFileIds) ? item.previewFileIds.slice(0, 1) : [];
  const visualFileId = item.coverFileId || previewFileIds[0] || '';
  const listThumbnailFileId = item.listThumbnailFileId || '';
  return {
    id: item.id,
    title: item.title,
    source: cleanSourceLabel(item.source),
    publishedAt: item.publishedAt,
    category: item.category,
    categoryLabel: item.categoryLabel,
    channelKey: item.channelKey,
    coverTone: item.coverTone,
    coverFileId: item.coverFileId || '',
    previewFileIds,
    visualFileId,
    listThumbnailFileId,
    listVisualFileId: listThumbnailFileId || visualFileId,
    visualKind: item.coverFileId ? 'cover' : previewFileIds.length ? 'source-preview' : ''
  };
}

function relatedItems(cache, current, limit = 3, now = Date.now()) {
  return publishableItems(cache.items)
    .filter((item) => item.id !== current.id && freeItemVisible(item, now))
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      relationRank: item.category === current.category ? 0 : item.channelKey === current.channelKey ? 1 : 2
    }))
    .sort((left, right) => left.relationRank - right.relationRank || left.originalIndex - right.originalIndex)
    .slice(0, limit)
    .map(({ item }) => publicRelatedItem(item));
}

function presentItem(cache, item, { now = Date.now() } = {}) {
  return {
    ...publicItem(item, { includeAllPreviews: true }),
    relatedItems: relatedItems(cache, item, 3, now)
  };
}

module.exports = { publicItem, presentFeed, presentItem };
