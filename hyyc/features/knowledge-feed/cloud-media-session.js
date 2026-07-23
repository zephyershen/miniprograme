const {
  isUsableCloudMediaUrl,
  resolveCloudFileUrls
} = require('../../services/cloud-media.js');

const POSITIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 600;
const RESOLVE_BATCH_SIZE = 50;
const TEMP_URL_SAFETY_MARGIN_MS = 60 * 1000;

function isCloudFileId(value) {
  return typeof value === 'string' && value.startsWith('cloud://');
}

function uniqueCloudFileIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => isCloudFileId(value)))];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function boundedMapSet(map, key, value, maximum) {
  map.delete(key);
  map.set(key, value);
  while (map.size > maximum) map.delete(map.keys().next().value);
}

function resolvedUrlExpiresAt(entry, currentTime, positiveTtl) {
  const providerTtl = Number(entry && entry.maxAgeMs);
  if (!Number.isFinite(providerTtl) || providerTtl <= 0) {
    return currentTime + positiveTtl;
  }
  const safetyMargin = Math.min(
    TEMP_URL_SAFETY_MARGIN_MS,
    Math.max(1000, Math.floor(providerTtl / 4))
  );
  return currentTime + Math.max(1000, Math.min(positiveTtl, providerTtl - safetyMargin));
}

function mediaUrl(value, resolvedUrls, existingUrl = '') {
  if (typeof value !== 'string' || !value) return '';
  if (isCloudFileId(value)) {
    const resolved = resolvedUrls.get(value) || '';
    if (resolved) return resolved;
    return isUsableCloudMediaUrl(existingUrl) ? existingUrl : '';
  }
  return /^(https?:\/\/|wxfile:\/\/|data:image\/|\/)/i.test(value) ? value : '';
}

function avatarFileId(item = {}) {
  return item.sourceAuthor && item.sourceAuthor.avatarFileId
    ? item.sourceAuthor.avatarFileId
    : item.sourceAvatarFileId;
}

function collectItemMediaFileIds(item = {}, { includeRelated = true } = {}) {
  const result = [
    avatarFileId(item),
    item.listVisualFileId,
    item.visualFileId,
    item.coverFileId
  ];
  const slides = Array.isArray(item.previewSlides) ? item.previewSlides : [];
  const previews = Array.isArray(item.previewFileIds) ? item.previewFileIds : [];
  result.push(...slides.map((slide) => slide && slide.fileId), ...previews);
  if (includeRelated && Array.isArray(item.relatedItems)) {
    item.relatedItems.forEach((related) => {
      result.push(...collectItemMediaFileIds(related, { includeRelated: false }));
    });
  }
  return uniqueCloudFileIds(result);
}

function feedItems(feed = {}) {
  const values = [
    feed.leadItem,
    ...((Array.isArray(feed.remainingItems) ? feed.remainingItems : [])),
    ...((Array.isArray(feed.dayGroups) ? feed.dayGroups : [])
      .flatMap((group) => Array.isArray(group.items) ? group.items : []))
  ].filter(Boolean);
  const seen = new Set();
  return values.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function collectFeedMediaFileIds(feed = {}) {
  return uniqueCloudFileIds(feedItems(feed)
    .flatMap((item) => collectItemMediaFileIds(item, { includeRelated: false })));
}

function applyResolvedItemMedia(item = {}, resolvedUrls = new Map(), { includeRelated = true } = {}) {
  const sourceAuthor = item.sourceAuthor && typeof item.sourceAuthor === 'object'
    ? {
      ...item.sourceAuthor,
      avatarUrl: mediaUrl(
        item.sourceAuthor.avatarFileId,
        resolvedUrls,
        item.sourceAuthor.avatarUrl
      )
    }
    : item.sourceAuthor;
  const previewSlides = Array.isArray(item.previewSlides)
    ? item.previewSlides.map((slide) => ({
      ...slide,
      url: mediaUrl(slide && slide.fileId, resolvedUrls, slide && slide.url)
    }))
    : item.previewSlides;
  const relatedItems = includeRelated && Array.isArray(item.relatedItems)
    ? item.relatedItems.map((related) => applyResolvedItemMedia(
      related,
      resolvedUrls,
      { includeRelated: false }
    ))
    : item.relatedItems;
  return {
    ...item,
    ...(sourceAuthor ? { sourceAuthor } : {}),
    listVisualUrl: mediaUrl(
      item.listVisualFileId || item.visualFileId,
      resolvedUrls,
      item.listVisualUrl
    ),
    coverUrl: mediaUrl(item.coverFileId, resolvedUrls, item.coverUrl),
    ...(previewSlides ? { previewSlides } : {}),
    previewFileUrls: (Array.isArray(item.previewFileIds) ? item.previewFileIds : [])
      .map((fileId, index) => mediaUrl(
        fileId,
        resolvedUrls,
        Array.isArray(item.previewFileUrls) ? item.previewFileUrls[index] : ''
      )),
    ...(relatedItems ? { relatedItems } : {})
  };
}

function applyResolvedFeedMedia(feed = {}, resolvedUrls = new Map()) {
  return {
    ...feed,
    leadItem: feed.leadItem
      ? applyResolvedItemMedia(feed.leadItem, resolvedUrls, { includeRelated: false })
      : null,
    remainingItems: (Array.isArray(feed.remainingItems) ? feed.remainingItems : [])
      .map((item) => applyResolvedItemMedia(item, resolvedUrls, { includeRelated: false })),
    dayGroups: (Array.isArray(feed.dayGroups) ? feed.dayGroups : []).map((group) => ({
      ...group,
      items: (Array.isArray(group.items) ? group.items : [])
        .map((item) => applyResolvedItemMedia(item, resolvedUrls, { includeRelated: false }))
    }))
  };
}

function createKnowledgeMediaSession({
  resolveFileUrls = resolveCloudFileUrls,
  now = Date.now,
  positiveTtlMs = POSITIVE_CACHE_TTL_MS,
  negativeTtlMs = NEGATIVE_CACHE_TTL_MS,
  maxEntries = MAX_CACHE_ENTRIES,
  batchSize = RESOLVE_BATCH_SIZE,
  logger = console
} = {}) {
  const positive = new Map();
  const negative = new Map();
  const pending = new Map();
  const positiveTtl = Math.max(1000, Number(positiveTtlMs) || POSITIVE_CACHE_TTL_MS);
  const negativeTtl = Math.max(1000, Number(negativeTtlMs) || NEGATIVE_CACHE_TTL_MS);
  const entryLimit = Math.max(20, Math.floor(Number(maxEntries) || MAX_CACHE_ENTRIES));
  const requestBatchSize = Math.max(1, Math.floor(Number(batchSize) || RESOLVE_BATCH_SIZE));

  function cachedUrl(fileId) {
    const entry = positive.get(fileId);
    if (!entry) return '';
    if (entry.expiresAt <= now()) {
      positive.delete(fileId);
      return '';
    }
    boundedMapSet(positive, fileId, entry, entryLimit);
    return entry.url;
  }

  function negativelyCached(fileId) {
    const expiresAt = negative.get(fileId);
    if (!expiresAt) return false;
    if (expiresAt <= now()) {
      negative.delete(fileId);
      return false;
    }
    return true;
  }

  function startBatch(batch) {
    const request = Promise.resolve()
      .then(() => resolveFileUrls(batch))
      .then((entries) => new Map((Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && batch.includes(entry.fileId)
          && typeof entry.url === 'string' && isUsableCloudMediaUrl(entry.url, {
            currentTime: now(),
            safetyMarginMs: 1000
          }))
        .map((entry) => [entry.fileId, entry])))
      .catch((error) => {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('Knowledge feed cloud media temporarily unavailable', {
            message: error && error.message
          });
        }
        return new Map();
      })
      .then((resolved) => {
        const currentTime = now();
        const resolvedUrls = new Map();
        batch.forEach((fileId) => {
          const entry = resolved.get(fileId);
          const url = entry && entry.url || '';
          if (url) {
            negative.delete(fileId);
            boundedMapSet(positive, fileId, {
              url,
              expiresAt: resolvedUrlExpiresAt(entry, currentTime, positiveTtl)
            }, entryLimit);
            resolvedUrls.set(fileId, url);
          } else {
            const existing = positive.get(fileId);
            if (!existing || existing.expiresAt <= currentTime) {
              positive.delete(fileId);
              boundedMapSet(negative, fileId, currentTime + negativeTtl, entryLimit);
            }
          }
        });
        return resolvedUrls;
      });

    batch.forEach((fileId) => {
      let itemPromise;
      itemPromise = request
        .then((resolved) => resolved.get(fileId) || '')
        .finally(() => {
          if (pending.get(fileId) === itemPromise) pending.delete(fileId);
        });
      pending.set(fileId, itemPromise);
    });
  }

  async function resolveFileIds(values = [], { force = false } = {}) {
    const fileIds = uniqueCloudFileIds(values);
    if (!fileIds.length) return new Map();
    const unresolved = [];
    const waits = [];
    fileIds.forEach((fileId) => {
      if (!force && cachedUrl(fileId)) return;
      if (!force && negativelyCached(fileId)) return;
      const active = pending.get(fileId);
      if (active) waits.push(active);
      else unresolved.push(fileId);
    });
    chunks(unresolved, requestBatchSize).forEach((batch) => {
      startBatch(batch);
      batch.forEach((fileId) => waits.push(pending.get(fileId)));
    });
    await Promise.all(waits);
    return new Map(fileIds
      .map((fileId) => [fileId, cachedUrl(fileId)])
      .filter(([, url]) => url));
  }

  function resolveForFeed(feed, options) {
    return resolveFileIds(collectFeedMediaFileIds(feed), options);
  }

  function resolveForItem(item, options) {
    return resolveFileIds(collectItemMediaFileIds(item), options);
  }

  function invalidate(fileId) {
    if (!fileId) {
      positive.clear();
      negative.clear();
      return;
    }
    positive.delete(fileId);
    negative.delete(fileId);
  }

  function refreshDelayForFileIds(values = [], { minimumMs = 1000 } = {}) {
    const currentTime = now();
    const expirations = uniqueCloudFileIds(values)
      .map((fileId) => positive.get(fileId))
      .filter(Boolean)
      .map((entry) => Number(entry.expiresAt))
      .filter(Number.isFinite);
    const delay = expirations.length
      ? Math.min(...expirations) - currentTime
      : positiveTtl;
    return Math.max(Math.max(1, Number(minimumMs) || 1000), delay);
  }

  return {
    resolveFileIds,
    resolveForFeed,
    resolveForItem,
    invalidate,
    refreshDelayForFileIds,
    cacheSize: () => positive.size + negative.size,
    pendingSize: () => pending.size
  };
}

const knowledgeMediaSession = createKnowledgeMediaSession();

module.exports = {
  POSITIVE_CACHE_TTL_MS,
  NEGATIVE_CACHE_TTL_MS,
  TEMP_URL_SAFETY_MARGIN_MS,
  isCloudFileId,
  uniqueCloudFileIds,
  mediaUrl,
  collectItemMediaFileIds,
  collectFeedMediaFileIds,
  applyResolvedItemMedia,
  applyResolvedFeedMedia,
  resolvedUrlExpiresAt,
  createKnowledgeMediaSession,
  knowledgeMediaSession
};
