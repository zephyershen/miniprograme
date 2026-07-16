const { AppError } = require('../lib/errors');
const { toDate } = require('../lib/dates');
const { hasReadyVisual } = require('../policies/visual-publication');
const { presentFeed, presentItem } = require('../presenters/public-feed');

function mergeCachedVisuals(items, previous) {
  const previousById = new Map(((previous && previous.items) || []).map((item) => [item.id, item]));
  return items.map((item) => {
    const cached = previousById.get(item.id);
    const reusable = cached && cached.url === item.url ? cached : null;
    return {
      ...item,
      coverFileId: (reusable && reusable.coverFileId) || '',
      coverCheckedAt: (reusable && reusable.coverCheckedAt) || null,
      coverStatus: (reusable && reusable.coverStatus) || '',
      previewFileIds: (reusable && Array.isArray(reusable.previewFileIds) && reusable.previewFileIds) || [],
      previewCheckedAt: (reusable && reusable.previewCheckedAt) || null,
      previewStatus: (reusable && reusable.previewStatus) || ''
    };
  });
}

function visualFileIds(document, ownedPrefixes) {
  const fileIds = new Set();
  const owned = (Array.isArray(ownedPrefixes) ? ownedPrefixes : [])
    .filter((prefix) => typeof prefix === 'string' && prefix.startsWith('cloud://'));
  const addOwned = (fileId) => {
    if (typeof fileId === 'string' && owned.some((prefix) => fileId.startsWith(prefix))) fileIds.add(fileId);
  };
  for (const item of ((document && document.items) || [])) {
    addOwned(item.coverFileId);
    for (const fileId of (Array.isArray(item.previewFileIds) ? item.previewFileIds : [])) addOwned(fileId);
  }
  return fileIds;
}

function orphanedVisualFileIds(previous, current, ownedPrefixes) {
  const active = visualFileIds(current, ownedPrefixes);
  return [...visualFileIds(previous, ownedPrefixes)].filter((fileId) => !active.has(fileId));
}

function prepareRefreshedDocument(next, previous, ownedPrefixes) {
  const current = {
    ...next,
    items: mergeCachedVisuals(next.items || [], previous)
  };
  const active = visualFileIds(current, ownedPrefixes);
  const owned = (Array.isArray(ownedPrefixes) ? ownedPrefixes : [])
    .filter((prefix) => typeof prefix === 'string' && prefix.startsWith('cloud://'));
  const pending = new Set(
    ((previous && previous.pendingVisualDeletes) || [])
      .filter((fileId) => typeof fileId === 'string' && owned.some((prefix) => fileId.startsWith(prefix)))
  );
  const claims = new Set(
    ((previous && previous.visualDeleteClaims) || [])
      .filter((fileId) => typeof fileId === 'string' && owned.some((prefix) => fileId.startsWith(prefix)))
  );
  for (const fileId of orphanedVisualFileIds(previous, current, ownedPrefixes)) pending.add(fileId);
  for (const fileId of active) pending.delete(fileId);
  for (const fileId of claims) pending.delete(fileId);
  return { ...current, pendingVisualDeletes: [...pending], visualDeleteClaims: [...claims] };
}

function createFeedService({
  repository,
  source,
  cacheConfig,
  ownedVisualPrefixes = [],
  deleteFiles = null,
  now = () => Date.now(),
  logger = console
}) {
  let refreshPromise = null;

  function cacheAge(cache, currentTime) {
    const fetchedAt = cache && toDate(cache.fetchedAt);
    return fetchedAt ? currentTime - fetchedAt.getTime() : Number.POSITIVE_INFINITY;
  }

  async function drainPendingVisualDeletes(current) {
    const owned = (Array.isArray(ownedVisualPrefixes) ? ownedVisualPrefixes : [])
      .filter((prefix) => typeof prefix === 'string' && prefix.startsWith('cloud://'));
    const cleanupCandidates = [...new Set([
      ...(Array.isArray(current.pendingVisualDeletes) ? current.pendingVisualDeletes : []),
      ...(Array.isArray(current.visualDeleteClaims) ? current.visualDeleteClaims : [])
    ])].filter((fileId) => typeof fileId === 'string'
      && owned.some((prefix) => fileId.startsWith(prefix)));
    if (typeof deleteFiles !== 'function') return current;
    for (let offset = 0; offset < cleanupCandidates.length; offset += 50) {
      const batch = cleanupCandidates.slice(offset, offset + 50);
      try {
        const claimed = await repository.claimVisualDeletes(batch, new Date(now()));
        if (!claimed.length) continue;
        const outcome = await deleteFiles(claimed);
        const deletedFileIds = Array.isArray(outcome && outcome.deletedFileIds)
          ? outcome.deletedFileIds.filter((fileId) => claimed.includes(fileId))
          : [];
        if (deletedFileIds.length) {
          await repository.acknowledgeVisualDeletes(deletedFileIds, new Date(now()));
        }
        const retryCount = claimed.length - deletedFileIds.length;
        if (retryCount > 0) {
          logger.warn('Some unused feed visuals remain claimed for retry', { retryCount });
        }
      } catch (error) {
        logger.warn('Unused feed visuals could not be deleted', { message: error && error.message });
        break;
      }
    }
    return current;
  }

  async function refreshCache(previous) {
    const response = await source.loadSelected(previous && previous.etag);
    const refreshedAt = new Date(now());
    if (response.notModified && previous) {
      await repository.touch(refreshedAt);
      return drainPendingVisualDeletes({ ...previous, fetchedAt: refreshedAt, updatedAt: refreshedAt });
    }
    const document = {
      provider: source.provider,
      etag: response.etag,
      fetchedAt: refreshedAt,
      items: response.items,
      updatedAt: refreshedAt
    };
    const persisted = await repository.replace(
      document,
      (next, latest) => prepareRefreshedDocument(next, latest, ownedVisualPrefixes)
    );
    const current = persisted.document || persisted;
    return drainPendingVisualDeletes(current);
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
    if (!item || !hasReadyVisual(item)) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯已更新，请返回首页刷新');
    }
    return presentItem(cache, item);
  }

  return { getFeed, getItem };
}

module.exports = {
  createFeedService,
  mergeCachedVisuals,
  orphanedVisualFileIds,
  prepareRefreshedDocument
};
