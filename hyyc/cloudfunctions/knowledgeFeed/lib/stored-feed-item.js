const crypto = require('node:crypto');
const { analysisInputHash } = require('../policies/feed-curation');

function storedDocumentId(provider, itemId) {
  if (!/^[a-z0-9_-]{2,24}$/i.test(provider || '')
    || !/^[a-z0-9_-]{8,80}$/i.test(itemId || '')) {
    throw new Error('FEED_ITEM_ID_INVALID');
  }
  return `${provider}_${itemId}`;
}

function publishedDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function stableContent(item) {
  return {
    title: item.title,
    titleEn: item.titleEn || '',
    summary: item.summary || '',
    url: item.url,
    permalink: item.permalink || '',
    source: item.source,
    publishedAt: item.publishedAt,
    category: item.category,
    categoryLabel: item.categoryLabel,
    categoryMarker: item.categoryMarker,
    channelKey: item.channelKey,
    coverTone: item.coverTone,
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : [],
    score: item.score === undefined ? null : item.score,
    selected: item.selected === true,
    attribution: item.attribution || null
  };
}

function contentHash(item) {
  return crypto.createHash('sha256').update(JSON.stringify(stableContent(item))).digest('hex');
}

function visualFields(item) {
  const result = {};
  if (typeof item.coverFileId === 'string' && item.coverFileId) {
    result.coverFileId = item.coverFileId;
    result.coverCheckedAt = item.coverCheckedAt || null;
    result.coverStatus = item.coverStatus || 'ready';
  }
  const previews = Array.isArray(item.previewFileIds)
    ? item.previewFileIds.filter((fileId) => typeof fileId === 'string' && fileId)
    : [];
  if (previews.length) {
    result.previewFileIds = previews;
    result.previewCheckedAt = item.previewCheckedAt || null;
    result.previewStatus = item.previewStatus || 'ready';
    result.previewCaptureVersion = item.previewCaptureVersion || 1;
  }
  if (typeof item.listThumbnailFileId === 'string' && item.listThumbnailFileId) {
    result.listThumbnailFileId = item.listThumbnailFileId;
    result.listThumbnailVersion = Math.max(1, Number(item.listThumbnailVersion) || 1);
  }
  return result;
}

function hasStoredVisual(item) {
  return Boolean(item && (
    (typeof item.coverFileId === 'string' && item.coverFileId)
    || (Array.isArray(item.previewFileIds) && item.previewFileIds.length)
  ));
}

function toStoredFeedItem(item, {
  provider,
  generation,
  observedAt = new Date(),
  coverage = 'all',
  archiveSource = ''
}) {
  const day = publishedDay(item && item.publishedAt);
  if (!item || !day) throw new Error('FEED_ITEM_PUBLISHED_AT_INVALID');
  const normalized = stableContent(item);
  const source = archiveSource || item.archiveSource || (item.selected ? 'selected' : 'all');
  return {
    _id: storedDocumentId(provider, item.id),
    id: item.id,
    provider,
    ...normalized,
    publishedDay: day,
    contentHash: contentHash(item),
    analysisInputHash: analysisInputHash(item),
    publicState: 'active',
    historyCoverage: coverage,
    archiveSource: source,
    visualState: hasStoredVisual(item) ? 'ready' : 'pending',
    firstStoredAt: observedAt,
    lastSeenAt: observedAt,
    lastSeenAllGeneration: coverage === 'all' ? generation : '',
    updatedAt: observedAt,
    ...visualFields(item)
  };
}

function groupItemIdsByDay(items) {
  const groups = new Map();
  for (const item of (Array.isArray(items) ? items : [])) {
    const day = item && (item.publishedDay || publishedDay(item.publishedAt));
    if (!day || !item.id) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item.id);
  }
  return groups;
}

module.exports = {
  storedDocumentId,
  publishedDay,
  contentHash,
  visualFields,
  hasStoredVisual,
  toStoredFeedItem,
  groupItemIdsByDay
};
