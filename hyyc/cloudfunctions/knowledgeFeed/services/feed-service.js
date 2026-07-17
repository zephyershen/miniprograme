const { AppError } = require('../lib/errors');
const { hasReadyVisual } = require('../policies/visual-publication');
const { presentFeed, presentItem } = require('../presenters/public-feed');
const { freeItemVisible } = require('../policies/feed-access');

function createFeedService({
  repository,
  ensureCache = null,
  now = () => Date.now(),
  logger = console
}) {
  async function readCache() {
    let cache = await repository.get();
    if (!cache && typeof ensureCache === 'function') {
      try {
        cache = await ensureCache();
      } catch (error) {
        logger.error('Knowledge feed bootstrap failed', error);
      }
    }
    return cache;
  }

  async function getFeed(query = {}) {
    const cache = await readCache();
    if (!cache || !Array.isArray(cache.items)) {
      throw new AppError('FEED_UNAVAILABLE', '暂时无法读取资讯，请稍后下拉刷新');
    }
    return presentFeed(cache, {
      stale: Boolean(cache.sourceLastErrorCode),
      query,
      now: now()
    });
  }

  async function getItem(id) {
    if (typeof id !== 'string' || !/^[a-z0-9_-]{8,80}$/i.test(id)) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    }
    const cache = await readCache();
    const item = cache && (cache.items || []).find((entry) => entry.id === id);
    const currentTime = now();
    if (!item || !hasReadyVisual(item) || !freeItemVisible(item, currentTime)) {
      throw new AppError('ITEM_NOT_FOUND', '这条资讯已更新，请返回首页刷新');
    }
    return presentItem(cache, item, { now: currentTime });
  }

  return { getFeed, getItem };
}

module.exports = { createFeedService };
