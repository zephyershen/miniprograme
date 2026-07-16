const { AppError } = require('../lib/errors');
const { toDate } = require('../lib/dates');

function createCoverService({ cloud, repository, fetchPublicBuffer, extractCoverUrl, config, now = () => new Date(), logger = console }) {
  function assertMaintenanceContext() {
    const { OPENID } = cloud.getWXContext();
    if (OPENID) throw new AppError('TEMPORARY_FAILURE', '该操作仅供云端维护');
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
        cloudPath: `${config.cloudPathPrefix}${item.id}.${extension}`,
        fileContent: image.buffer
      });
      return result.fileID || '';
    } catch (error) {
      logger.warn('Feed cover unavailable', { itemId: item.id, message: error && error.message });
      return '';
    }
  }

  async function registerCovers(covers) {
    assertMaintenanceContext();
    if (!Array.isArray(covers) || !covers.length || covers.length > 30) {
      throw new AppError('TEMPORARY_FAILURE', '封面清单无效');
    }
    const cache = await repository.get();
    if (!cache || !Array.isArray(cache.items)) throw new AppError('FEED_UNAVAILABLE', '资讯缓存尚未建立');
    const mapping = new Map();
    for (const entry of covers) {
      const id = entry && entry.id;
      const fileID = entry && entry.fileID;
      if (!/^[a-z0-9_-]{8,80}$/i.test(id || '')) continue;
      const expected = new RegExp(`^${config.fileIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${id}\\.(?:jpg|png|webp)$`);
      if (typeof fileID === 'string' && expected.test(fileID)) mapping.set(id, fileID);
    }
    if (!mapping.size) throw new AppError('TEMPORARY_FAILURE', '没有可登记的封面');
    const updatedAt = now();
    await repository.patchItems([...mapping].map(([id, coverFileId]) => ({
      id,
      fields: { coverFileId }
    })), updatedAt);
    return { registered: [...mapping.keys()] };
  }

  async function hydrateCover(id) {
    assertMaintenanceContext();
    const cache = await repository.get();
    const item = cache && (cache.items || []).find((entry) => entry.id === id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    if (item.coverFileId) return { id, coverFileId: item.coverFileId, cached: true };
    const coverFileId = await resolveAndUploadCover(item);
    const checkedAt = now();
    await repository.patchItems([{
      id,
      fields: { coverFileId, coverCheckedAt: checkedAt, coverStatus: coverFileId ? 'ready' : 'missing' }
    }], checkedAt);
    return { id, coverFileId, cached: false };
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

  async function hydrateCovers(limit, force = false) {
    assertMaintenanceContext();
    const cache = await repository.get();
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

    const checkedAt = now();
    const results = await mapWithConcurrency(candidates, 3, async (item) => ({
      id: item.id,
      coverFileId: await resolveAndUploadCover(item)
    }));
    const items = await repository.patchItems(results.map((result) => ({
      id: result.id,
      fields: {
        coverFileId: result.coverFileId,
        coverCheckedAt: checkedAt,
        coverStatus: result.coverFileId ? 'ready' : 'missing'
      }
    })), checkedAt);
    return {
      attempted: results.length,
      resolved: results.filter((result) => result.coverFileId).length,
      missing: results.filter((result) => !result.coverFileId).length,
      remaining: items.filter((item) => !item.coverFileId && !item.coverCheckedAt).length,
      totalWithCovers: items.filter((item) => item.coverFileId).length
    };
  }

  return { registerCovers, hydrateCover, hydrateCovers };
}

module.exports = { createCoverService };
