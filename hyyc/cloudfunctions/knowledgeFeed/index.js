const cloud = require('wx-server-sdk');
const { AppError, ok, fail } = require('./lib/errors');
const { cleanSourceLabel, normalizeAihotResponse } = require('./lib/aihot');
const { extractCoverUrl } = require('./lib/image-meta');
const { fetchPublicBuffer } = require('./lib/network');
const { inferTopicKeys } = require('./lib/topics');
const { buildFeedPage } = require('./lib/feed-page');

const API_ROOT = 'https://aihot.virxact.com/api/public/items';
const API_PAGE_SIZE = 100;
const MAX_FEED_ITEMS = 120;
const CACHE_COLLECTION = 'knowledge_feed_cache';
const CACHE_ID = 'aihot_selected';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FORCE_MIN_AGE_MS = 60 * 1000;
const MAX_COVER_BYTES = 2.5 * 1024 * 1024;
const COVER_RETRY_MS = 12 * 60 * 60 * 1000;
const COVER_FILE_PREFIX = 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-covers/aihot/';
const IMAGE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
let refreshPromise = null;

function isNotFound(error) {
  return error && (error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || ''));
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

async function getCache() {
  try {
    return (await db.collection(CACHE_COLLECTION).doc(CACHE_ID).get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function cacheAge(cache) {
  const fetchedAt = cache && toDate(cache.fetchedAt);
  return fetchedAt ? Date.now() - fetchedAt.getTime() : Number.POSITIVE_INFINITY;
}

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

function publicFeed(cache, stale = false, query = {}) {
  const allItems = cache.items || [];
  const page = buildFeedPage(allItems, query);
  return {
    updatedAt: toIso(cache.fetchedAt),
    stale,
    windowDays: 7,
    totalAvailable: allItems.length,
    resultCount: page.resultCount,
    offset: page.query.offset,
    nextOffset: page.nextOffset,
    limit: page.query.limit,
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

async function fetchAihot(cursor = '', etag = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({ mode: 'selected', take: String(API_PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const headers = {
      accept: 'application/json',
      'user-agent': 'KnowledgePlatform/1.0 (+WeChat Mini Program; AI HOT integration)'
    };
    if (etag) headers['if-none-match'] = etag;
    return await fetch(`${API_ROOT}?${params}`, { headers, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAndUploadCover(item) {
  try {
    const page = await fetchPublicBuffer(item.url, {
      accept: 'text/html,application/xhtml+xml;q=0.9',
      maxBytes: 700 * 1024,
      timeoutMs: 2500,
      maxRedirects: 1
    });
    const contentType = String(page.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return '';
    const imageUrl = extractCoverUrl(page.buffer.toString('utf8'), page.finalUrl);
    if (!imageUrl) return '';

    const image = await fetchPublicBuffer(imageUrl, {
      accept: 'image/jpeg,image/png,image/webp;q=0.9',
      maxBytes: MAX_COVER_BYTES,
      timeoutMs: 2500,
      maxRedirects: 1
    });
    const imageType = String(image.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = IMAGE_TYPES[imageType];
    if (!extension || !image.buffer.length) return '';
    const result = await cloud.uploadFile({
      cloudPath: `knowledge-covers/aihot/${item.id}.${extension}`,
      fileContent: image.buffer
    });
    return result.fileID || '';
  } catch (error) {
    console.warn('AI HOT cover unavailable', { itemId: item.id, message: error && error.message });
    return '';
  }
}

function mergeCachedCovers(items, previous) {
  const previousById = new Map(((previous && previous.items) || []).map((item) => [item.id, item]));
  return items.map((item) => {
    const cached = previousById.get(item.id);
    return {
      ...item,
      coverFileId: (cached && cached.coverFileId) || '',
      coverCheckedAt: (cached && cached.coverCheckedAt) || null,
      coverStatus: (cached && cached.coverStatus) || ''
    };
  });
}

async function refreshCache(previous) {
  const response = await fetchAihot('', previous && previous.etag);
  const now = new Date();
  if (response.status === 304 && previous) {
    await db.collection(CACHE_COLLECTION).doc(CACHE_ID).update({ data: { fetchedAt: now, updatedAt: now } });
    return { ...previous, fetchedAt: now, updatedAt: now };
  }
  if (!response.ok) throw new Error(`AI_HOT_${response.status}`);
  const firstPage = await response.json();
  const rawItems = [...(firstPage.items || [])];
  let nextCursor = firstPage.hasNext ? firstPage.nextCursor : '';
  while (nextCursor && rawItems.length < MAX_FEED_ITEMS) {
    const nextResponse = await fetchAihot(nextCursor);
    if (!nextResponse.ok) throw new Error(`AI_HOT_${nextResponse.status}`);
    const nextPage = await nextResponse.json();
    rawItems.push(...(nextPage.items || []));
    nextCursor = nextPage.hasNext ? nextPage.nextCursor : '';
  }
  const items = normalizeAihotResponse({ items: rawItems }, MAX_FEED_ITEMS);
  if (!items.length) throw new Error('AI_HOT_EMPTY');

  const enriched = mergeCachedCovers(items, previous);

  const document = {
    provider: 'aihot',
    etag: response.headers.get('etag') || '',
    fetchedAt: now,
    items: enriched,
    updatedAt: now
  };
  await db.collection(CACHE_COLLECTION).doc(CACHE_ID).set({ data: document });
  return document;
}

async function getFeed(query = {}) {
  const cached = await getCache();
  const age = cacheAge(cached);
  const shouldRefresh = !cached || age >= CACHE_TTL_MS || (query.force === true && age >= FORCE_MIN_AGE_MS);
  if (!shouldRefresh) return publicFeed(cached, false, query);

  if (!refreshPromise) {
    refreshPromise = refreshCache(cached).finally(() => { refreshPromise = null; });
  }
  try {
    return publicFeed(await refreshPromise, false, query);
  } catch (error) {
    console.error('AI HOT refresh failed', error);
    if (cached && Array.isArray(cached.items) && cached.items.length) return publicFeed(cached, true, query);
    throw new AppError('FEED_UNAVAILABLE', '暂时无法读取资讯，请稍后下拉刷新');
  }
}

async function getItem(id) {
  if (typeof id !== 'string' || !/^[a-z0-9_-]{8,80}$/i.test(id)) {
    throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
  }
  const cache = await getCache();
  const item = cache && (cache.items || []).find((entry) => entry.id === id);
  if (!item) throw new AppError('ITEM_NOT_FOUND', '这条资讯已更新，请返回首页刷新');
  return { ...publicItem(item), relatedItems: relatedItems(cache, item) };
}

function assertMaintenanceContext() {
  const { OPENID } = cloud.getWXContext();
  if (OPENID) throw new AppError('TEMPORARY_FAILURE', '该操作仅供云端维护');
}

async function registerCovers(covers) {
  assertMaintenanceContext();
  if (!Array.isArray(covers) || !covers.length || covers.length > 30) {
    throw new AppError('TEMPORARY_FAILURE', '封面清单无效');
  }
  const cache = await getCache();
  if (!cache || !Array.isArray(cache.items)) throw new AppError('FEED_UNAVAILABLE', '资讯缓存尚未建立');
  const mapping = new Map();
  for (const entry of covers) {
    const id = entry && entry.id;
    const fileID = entry && entry.fileID;
    if (!/^[a-z0-9_-]{8,80}$/i.test(id || '')) continue;
    const expected = new RegExp(`^${COVER_FILE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${id}\\.(?:jpg|png|webp)$`);
    if (typeof fileID === 'string' && expected.test(fileID)) mapping.set(id, fileID);
  }
  if (!mapping.size) throw new AppError('TEMPORARY_FAILURE', '没有可登记的封面');
  const items = cache.items.map((item) => mapping.has(item.id)
    ? { ...item, coverFileId: mapping.get(item.id) }
    : item);
  await db.collection(CACHE_COLLECTION).doc(CACHE_ID).update({ data: { items, updatedAt: new Date() } });
  return { registered: [...mapping.keys()] };
}

async function hydrateCover(id) {
  assertMaintenanceContext();
  const cache = await getCache();
  const item = cache && (cache.items || []).find((entry) => entry.id === id);
  if (!item) throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
  if (item.coverFileId) return { id, coverFileId: item.coverFileId, cached: true };
  const coverFileId = await resolveAndUploadCover(item);
  const checkedAt = new Date();
  const items = cache.items.map((entry) => entry.id === id
    ? { ...entry, coverFileId, coverCheckedAt: checkedAt, coverStatus: coverFileId ? 'ready' : 'missing' }
    : entry);
  await db.collection(CACHE_COLLECTION).doc(CACHE_ID).update({ data: { items, updatedAt: new Date() } });
  return { id, coverFileId, cached: false };
}

function coverCheckIsFresh(item) {
  const checkedAt = toDate(item && item.coverCheckedAt);
  return checkedAt && Date.now() - checkedAt.getTime() < COVER_RETRY_MS;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function hydrateCovers(limit, force = false) {
  assertMaintenanceContext();
  const cache = await getCache();
  if (!cache || !Array.isArray(cache.items)) throw new AppError('FEED_UNAVAILABLE', '资讯缓存尚未建立');
  const batchSize = Math.max(1, Math.min(9, Number(limit) || 6));
  const candidates = cache.items
    .filter((item) => !item.coverFileId && (force === true || !coverCheckIsFresh(item)))
    .slice(0, batchSize);
  if (!candidates.length) {
    return {
      attempted: 0,
      resolved: 0,
      missing: 0,
      remaining: 0,
      totalWithCovers: cache.items.filter((item) => item.coverFileId).length
    };
  }

  const checkedAt = new Date();
  const results = await mapWithConcurrency(candidates, 3, async (item) => ({
    id: item.id,
    coverFileId: await resolveAndUploadCover(item)
  }));
  const resultById = new Map(results.map((result) => [result.id, result.coverFileId]));
  const items = cache.items.map((item) => resultById.has(item.id)
    ? {
      ...item,
      coverFileId: resultById.get(item.id),
      coverCheckedAt: checkedAt,
      coverStatus: resultById.get(item.id) ? 'ready' : 'missing'
    }
    : item);
  await db.collection(CACHE_COLLECTION).doc(CACHE_ID).update({ data: { items, updatedAt: checkedAt } });
  return {
    attempted: results.length,
    resolved: results.filter((result) => result.coverFileId).length,
    missing: results.filter((result) => !result.coverFileId).length,
    remaining: items.filter((item) => !item.coverFileId && !item.coverCheckedAt).length,
    totalWithCovers: items.filter((item) => item.coverFileId).length
  };
}

exports.main = async (event = {}) => {
  try {
    switch (event.action || 'feed') {
      case 'feed':
        return ok(await getFeed(event));
      case 'item':
        return ok(await getItem(event.id));
      case 'registerCovers':
        return ok(await registerCovers(event.covers));
      case 'hydrateCover':
        return ok(await hydrateCover(event.id));
      case 'hydrateCovers':
        return ok(await hydrateCovers(event.limit, event.force));
      default:
        throw new AppError('TEMPORARY_FAILURE', '不支持的操作');
    }
  } catch (error) {
    return fail(error);
  }
};
