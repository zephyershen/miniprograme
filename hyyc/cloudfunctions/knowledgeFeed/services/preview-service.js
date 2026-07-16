const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const { toDate } = require('../lib/dates');
const { visualRevisionStem } = require('../lib/visual-version');

function maintenanceAuthorized(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function validRendererUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString().replace(/\/$/, '') : '';
  } catch (error) {
    return '';
  }
}

function decodeJpeg(value, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 8) throw new Error('INVALID_PREVIEW');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > maxBytes || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('INVALID_PREVIEW');
  }
  return buffer;
}

function createPreviewService({ cloud, repository, config, fetchImpl = fetch, now = () => new Date(), logger = console }) {
  function assertMaintenanceContext(maintenanceToken) {
    if (!maintenanceAuthorized(maintenanceToken, config.maintenanceToken)) {
      throw new AppError('TEMPORARY_FAILURE', '该操作仅供云端维护');
    }
  }

  function assertConfigured() {
    const rendererUrl = validRendererUrl(config.rendererUrl);
    if (!rendererUrl || typeof config.rendererToken !== 'string' || config.rendererToken.length < 32) {
      throw new AppError('TEMPORARY_FAILURE', '原文预览服务尚未配置');
    }
    return rendererUrl;
  }

  async function requestPreview(item) {
    const rendererUrl = assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.rendererTimeoutMs);
    try {
      const response = await fetchImpl(`${rendererUrl}/capture`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.rendererToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ url: item.url, maxSegments: config.maxSegments }),
        signal: controller.signal,
        redirect: 'error'
      });
      const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > config.maxResponseBytes) throw new Error('PREVIEW_TOO_LARGE');
      if (!response.ok) throw new Error(`PREVIEW_HTTP_${response.status}`);
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.length > config.maxResponseBytes) throw new Error('PREVIEW_TOO_LARGE');
      const payload = JSON.parse(raw.toString('utf8'));
      const screenshots = payload && payload.ok && payload.data && payload.data.screenshots;
      if (!Array.isArray(screenshots) || !screenshots.length || screenshots.length > config.maxSegments) {
        throw new Error('INVALID_PREVIEW');
      }
      return screenshots.map((entry) => decodeJpeg(entry && entry.data, config.maxImageBytes));
    } finally {
      clearTimeout(timeout);
    }
  }

  async function uploadPreviews(item, images) {
    const fileIds = [];
    const pathStem = visualRevisionStem(item);
    try {
      for (let index = 0; index < images.length; index += 1) {
        const cloudPath = `${config.cloudPathPrefix}${pathStem}-${index + 1}.jpg`;
        const result = await cloud.uploadFile({ cloudPath, fileContent: images[index] });
        if (!result || typeof result.fileID !== 'string' || !result.fileID.startsWith(config.fileIdPrefix)) {
          throw new Error('PREVIEW_UPLOAD_FAILED');
        }
        fileIds.push(result.fileID);
      }
      return fileIds;
    } catch (error) {
      if (fileIds.length) await cloud.deleteFile({ fileList: fileIds }).catch(() => {});
      throw error;
    }
  }

  async function resolveAndUploadPreviews(item) {
    const screenshots = await requestPreview(item);
    return uploadPreviews(item, screenshots);
  }

  function previewCheckIsFresh(item) {
    const checkedAt = toDate(item && item.previewCheckedAt);
    return checkedAt && now().getTime() - checkedAt.getTime() < config.retryMs;
  }

  async function persistResults(resultById, checkedAt, visualDeletes = []) {
    const patches = [...resultById].map(([id, result]) => ({
      id,
      expectedUrl: result.expectedUrl,
      discardFileIds: result.status === 'ready' ? result.fileIds : [],
      fields: {
        previewFileIds: result.fileIds,
        previewCheckedAt: checkedAt,
        previewStatus: result.status
      }
    }));
    return repository.patchItems(patches, checkedAt, visualDeletes);
  }

  async function hydratePreview(id, force = false, maintenanceToken = '') {
    assertMaintenanceContext(maintenanceToken);
    assertConfigured();
    const cache = await repository.get();
    const item = cache && (cache.items || []).find((entry) => entry.id === id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    if (item.coverFileId) return { id, skipped: 'cover-ready', previewFileIds: [] };
    if (!force && Array.isArray(item.previewFileIds) && item.previewFileIds.length) {
      return { id, cached: true, previewFileIds: item.previewFileIds };
    }

    const checkedAt = now();
    const previousFileIds = Array.isArray(item.previewFileIds) ? item.previewFileIds : [];
    let previewFileIds = previousFileIds;
    let status = 'failed';
    try {
      previewFileIds = await resolveAndUploadPreviews(item);
      status = 'ready';
    } catch (error) {
      status = previousFileIds.length ? 'stale' : 'failed';
      logger.warn('Source preview unavailable', { itemId: item.id, message: error && error.message });
    }
    const visualDeletes = status === 'ready'
      ? previousFileIds.filter((fileId) => typeof fileId === 'string'
        && fileId.startsWith(config.fileIdPrefix)
        && !previewFileIds.includes(fileId))
      : [];
    const patchResult = await persistResults(new Map([[
      id,
      { fileIds: previewFileIds, status, expectedUrl: item.url }
    ]]), checkedAt, visualDeletes);
    const applied = patchResult.appliedIds.includes(id);
    return {
      id,
      cached: false,
      previewFileIds: applied ? previewFileIds : [],
      status: applied ? status : 'stale'
    };
  }

  async function hydratePreviews(limit = 1, force = false, maintenanceToken = '') {
    assertMaintenanceContext(maintenanceToken);
    assertConfigured();
    const cache = await repository.get();
    if (!cache || !Array.isArray(cache.items)) throw new AppError('FEED_UNAVAILABLE', '资讯缓存尚未建立');
    const batchSize = Math.max(1, Math.min(2, Number(limit) || 1));
    const candidates = cache.items
      .filter((item) => !item.coverFileId
        && !(Array.isArray(item.previewFileIds) && item.previewFileIds.length)
        && item.coverStatus === 'missing'
        && (force === true || !previewCheckIsFresh(item)))
      .sort((left, right) => Number(Boolean(left.previewCheckedAt)) - Number(Boolean(right.previewCheckedAt)))
      .slice(0, batchSize);
    if (!candidates.length) {
      return previewSummary(cache.items, 0, 0, 0);
    }

    const checkedAt = now();
    const resultById = new Map();
    for (const item of candidates) {
      try {
        resultById.set(item.id, {
          fileIds: await resolveAndUploadPreviews(item),
          status: 'ready',
          expectedUrl: item.url
        });
      } catch (error) {
        logger.warn('Source preview unavailable', { itemId: item.id, message: error && error.message });
        resultById.set(item.id, { fileIds: [], status: 'failed', expectedUrl: item.url });
      }
    }
    const patchResult = await persistResults(resultById, checkedAt);
    const appliedIds = new Set(patchResult.appliedIds);
    const succeeded = [...resultById]
      .filter(([id, entry]) => appliedIds.has(id) && entry.status === 'ready')
      .length;
    const failed = [...resultById]
      .filter(([id, entry]) => appliedIds.has(id) && entry.status === 'failed')
      .length;
    const summary = previewSummary(patchResult.items, candidates.length, succeeded, failed);
    return { ...summary, stale: candidates.length - appliedIds.size };
  }

  function previewSummary(items, attempted, resolved, failed) {
    const missingItems = items.filter((item) => !item.coverFileId && !(Array.isArray(item.previewFileIds) && item.previewFileIds.length));
    return {
      attempted,
      resolved,
      failed,
      pending: missingItems.filter((item) => !item.previewCheckedAt).length,
      totalFailed: missingItems.filter((item) => item.previewStatus === 'failed').length,
      totalWithVisuals: items.filter((item) => item.coverFileId || (Array.isArray(item.previewFileIds) && item.previewFileIds.length)).length
    };
  }

  async function listPreviewFailures(maintenanceToken = '') {
    assertMaintenanceContext(maintenanceToken);
    const cache = await repository.get();
    return ((cache && cache.items) || [])
      .filter((item) => item.previewStatus === 'failed')
      .map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        previewCheckedAt: item.previewCheckedAt
      }));
  }

  async function maintenanceStatus(maintenanceToken = '') {
    assertMaintenanceContext(maintenanceToken);
    const cache = await repository.get();
    const items = ((cache && cache.items) || []);
    const totalWithVisuals = items
      .filter((item) => item.coverFileId || (Array.isArray(item.previewFileIds) && item.previewFileIds.length))
      .length;
    return {
      ...previewSummary(items, 0, 0, 0),
      totalItems: items.length,
      pendingPublication: Math.max(0, items.length - totalWithVisuals),
      totalWithOriginalCovers: items.filter((item) => item.coverFileId).length,
      totalWithSourcePreviews: items.filter((item) => Array.isArray(item.previewFileIds) && item.previewFileIds.length).length,
      pendingVisualDeletes: Array.isArray(cache && cache.pendingVisualDeletes) ? cache.pendingVisualDeletes.length : 0,
      claimedVisualDeletes: Array.isArray(cache && cache.visualDeleteClaims) ? cache.visualDeleteClaims.length : 0
    };
  }

  return { hydratePreview, hydratePreviews, listPreviewFailures, maintenanceStatus };
}

module.exports = { validRendererUrl, decodeJpeg, maintenanceAuthorized, createPreviewService };
