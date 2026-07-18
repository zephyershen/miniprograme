const { AppError } = require('../lib/errors');
const { toDate } = require('../lib/dates');
const { visualRevisionStem } = require('../lib/visual-version');
const { hasReadyVisual } = require('../policies/visual-publication');
const { isNewVisualItem } = require('../policies/new-visuals');

function createCoverService({ cloud, repository, fetchPublicBuffer, extractCoverUrl, config, now = () => new Date(), logger = console }) {
  function assertScheduledMaintenance(scheduled) {
    if (scheduled !== true) throw new AppError('TEMPORARY_FAILURE', '该操作仅供云端维护');
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
        maxBytes: config.maxBytes,
        timeoutMs: 2500,
        maxRedirects: 1
      });
      const imageType = String(image.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const extension = config.imageTypes[imageType];
      if (!extension || !image.buffer.length) return '';
      const result = await cloud.uploadFile({
        cloudPath: `${config.cloudPathPrefix}${visualRevisionStem(item)}.${extension}`,
        fileContent: image.buffer
      });
      return result.fileID || '';
    } catch (error) {
      logger.warn('Feed cover unavailable', { itemId: item.id, message: error && error.message });
      return '';
    }
  }

  function coverCheckIsFresh(item) {
    const checkedAt = toDate(item && item.coverCheckedAt);
    return checkedAt && now().getTime() - checkedAt.getTime() < config.retryMs;
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

  async function hydrateCovers(limit, force = false, scheduled = false, options = {}) {
    assertScheduledMaintenance(scheduled);
    const cache = await repository.get();
    if (!cache || !Array.isArray(cache.items)) throw new AppError('FEED_UNAVAILABLE', '资讯缓存尚未建立');
    const batchSize = Math.max(1, Math.min(9, Number(limit) || 6));
    const candidateIds = Array.isArray(options.itemIds) && options.itemIds.length
      ? new Set(options.itemIds)
      : null;
    const candidates = cache.items
      .filter((item) => (!candidateIds || candidateIds.has(item.id))
        && (force === true || isNewVisualItem(item, config.newItemsAfter))
        && !hasReadyVisual(item)
        && (!options.untriedOnly || !item.coverCheckedAt)
        && (force === true || !coverCheckIsFresh(item)))
      .slice(0, batchSize);
    if (!candidates.length) {
      return {
        attempted: 0,
        resolved: 0,
        missing: 0,
        remaining: cache.items.filter((item) => !hasReadyVisual(item) && !coverCheckIsFresh(item)).length,
        totalWithCovers: cache.items.filter((item) => item.coverFileId).length
      };
    }

    const checkedAt = now();
    const results = await mapWithConcurrency(candidates, 3, async (item) => ({
      id: item.id,
      url: item.url,
      coverFileId: await resolveAndUploadCover(item)
    }));
    const patchResult = await repository.patchItems(results.map((result) => ({
      id: result.id,
      expectedUrl: result.url,
      discardFileIds: result.coverFileId ? [result.coverFileId] : [],
      fields: {
        coverFileId: result.coverFileId,
        coverCheckedAt: checkedAt,
        coverStatus: result.coverFileId ? 'ready' : 'missing'
      }
    })), checkedAt);
    const items = patchResult.items;
    const appliedIds = new Set(patchResult.appliedIds);
    return {
      attempted: results.length,
      resolved: results.filter((result) => result.coverFileId && appliedIds.has(result.id)).length,
      missing: results.filter((result) => !result.coverFileId && appliedIds.has(result.id)).length,
      stale: results.filter((result) => !appliedIds.has(result.id)).length,
      remaining: items.filter((item) => !hasReadyVisual(item) && !coverCheckIsFresh(item)).length,
      totalWithCovers: items.filter((item) => item.coverFileId).length
    };
  }

  return { resolveAndUploadCover, hydrateCovers };
}

module.exports = { createCoverService };
