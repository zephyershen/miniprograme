const { AppError } = require('../lib/errors');
const { toDate } = require('../lib/dates');
const { presentFeed, presentItem } = require('../presenters/public-feed');

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

function createFeedService({ repository, source, cacheConfig, now = () => Date.now(), logger = console }) {
  let refreshPromise = null;

  function cacheAge(cache, currentTime) {
    const fetchedAt = cache && toDate(cache.fetchedAt);
    return fetchedAt ? currentTime - fetchedAt.getTime() : Number.POSITIVE_INFINITY;
  }

  async function refreshCache(previous) {
    const response = await source.loadSelected(previous && previous.etag);
    const refreshedAt = new Date(now());
    if (response.notModified && previous) {
      await repository.touch(refreshedAt);
      return { ...previous, fetchedAt: refreshedAt, updatedAt: refreshedAt };
    }
    const document = {
      provider: source.provider,
      etag: response.etag,
      fetchedAt: refreshedAt,
      items: mergeCachedCovers(response.items, previous),
      updatedAt: refreshedAt
    };
    await repository.set(document);
    return document;
  }

  async function getFeed(query = {}) {
    const currentTime = now();
    const cached = await repository.get();
    const age = cacheAge(cached, currentTime);
    const shouldRefresh = !cached
      || age >= cacheConfig.ttlMs
      || (query.force === true && age >= cacheConfig.forceMinAgeMs);
    if (!shouldRefresh) return presentFeed(cached, { query, now: currentTime });

    if (!refreshPromise) refreshPromise = refreshCache(cached).finally(() => { refreshPromise = null; });
    try {
      return presentFeed(await refreshPromise, { query, now: currentTime });
    } catch (error) {
      logger.error('Knowledge feed refresh failed', error);
      if (cached && Array.isArray(cached.items) && cached.items.length) {
        return presentFeed(cached, { stale: true, query, now: currentTime });
      }
      throw new AppError('FEED_UNAVAILABLE', '暂时无法读取资讯，请稍后下拉刷新');
    }
  }

  async function getItem(id) {
    if (typeof id !== 'string' || !/^[a-z0-9_-]{8,80}$/i.test(id)) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    }
    const cache = await repository.get();
    const item = cache && (cache.items || []).find((entry) => entry.id === id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '这条资讯已更新，请返回首页刷新');
    return presentItem(cache, item);
  }

  return { getFeed, getItem };
}

module.exports = { createFeedService, mergeCachedCovers };
