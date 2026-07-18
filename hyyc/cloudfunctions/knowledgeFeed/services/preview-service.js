const { AppError } = require('../lib/errors');
const { toDate } = require('../lib/dates');
const { visualRevisionStem } = require('../lib/visual-version');
const { maintenanceAuthorized } = require('../policies/maintenance-auth');
const { isNewVisualItem } = require('../policies/new-visuals');

const DEFAULT_PREVIEW_RETRY_MS = 5 * 60 * 1000;
const MAX_PREVIEW_RETRY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_RETRY_MULTIPLIER = 3;

function previewRetryDelay(attempts, baseMs = DEFAULT_PREVIEW_RETRY_MS, maxMs = MAX_PREVIEW_RETRY_MS) {
  const normalizedAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  const normalizedBase = Math.max(1000, Number(baseMs) || DEFAULT_PREVIEW_RETRY_MS);
  const normalizedMax = Math.max(normalizedBase, Number(maxMs) || MAX_PREVIEW_RETRY_MS);
  const exponent = Math.min(12, normalizedAttempts - 1);
  return Math.min(normalizedMax, normalizedBase * (PREVIEW_RETRY_MULTIPLIER ** exponent));
}

function previewFailureCode(error) {
  if (error && error.name === 'AbortError') return 'PREVIEW_TIMEOUT';
  const message = String(error && error.message || '');
  return /^PREVIEW_[A-Z0-9_]+$/.test(message) ? message : 'PREVIEW_CAPTURE_FAILED';
}

function previewAttemptIsDue(item, currentTime, baseRetryMs = DEFAULT_PREVIEW_RETRY_MS, captureVersion = 1) {
  const current = toDate(currentTime) || new Date();
  const nextAttemptAt = toDate(item && item.previewNextAttemptAt);
  if (nextAttemptAt) return nextAttemptAt.getTime() <= current.getTime();

  const checkedAt = toDate(item && item.previewCheckedAt);
  if (!checkedAt) return true;
  const hasLegacyPreview = Array.isArray(item && item.previewFileIds)
    && item.previewFileIds.length
    && Number(item.previewCaptureVersion || 1) !== Number(captureVersion || 1);
  if (hasLegacyPreview && !Number(item.previewAttempts)) return true;
  return checkedAt.getTime() + Math.max(1000, Number(baseRetryMs) || DEFAULT_PREVIEW_RETRY_MS)
    <= current.getTime();
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
  const captureVersion = Math.max(1, Number(config.captureVersion) || 1);
  const retryBaseMs = Math.max(1000, Number(config.retryMs) || DEFAULT_PREVIEW_RETRY_MS);
  const retryMaxMs = Math.max(retryBaseMs, Number(config.maxRetryMs) || MAX_PREVIEW_RETRY_MS);
  async function deleteUploadedFiles(fileIds) {
    if (!fileIds.length || !cloud || typeof cloud.deleteFile !== 'function') return;
    await cloud.deleteFile({ fileList: fileIds }).catch(() => {});
  }
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
        body: JSON.stringify({
          url: item.url,
          maxSegments: config.maxSegments,
          captureVersion,
          profile: config.captureProfile || 'page'
        }),
        signal: controller.signal,
        redirect: 'error'
      });
      const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > config.maxResponseBytes) throw new Error('PREVIEW_TOO_LARGE');
      if (!response.ok) throw new Error(`PREVIEW_HTTP_${response.status}`);
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.length > config.maxResponseBytes) throw new Error('PREVIEW_TOO_LARGE');
      const payload = JSON.parse(raw.toString('utf8'));
      const data = payload && payload.ok && payload.data;
      const screenshots = data && data.screenshots;
      if (!Array.isArray(screenshots) || !screenshots.length || screenshots.length > config.maxSegments) {
        throw new Error('INVALID_PREVIEW');
      }
      if (Number(data.captureVersion) !== captureVersion
        || Number(data.segmentCount) !== screenshots.length) {
        throw new Error('PREVIEW_CONTRACT_MISMATCH');
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
      await deleteUploadedFiles(fileIds);
      throw error;
    }
  }

  async function resolveAndUploadPreviews(item) {
    const screenshots = await requestPreview(item);
    return uploadPreviews(item, screenshots);
  }

  function retryOutcome(item, error, checkedAt) {
    const previousFileIds = Array.isArray(item && item.previewFileIds) ? item.previewFileIds : [];
    const attempts = Math.max(0, Number(item && item.previewAttempts) || 0) + 1;
    return {
      fileIds: previousFileIds,
      status: previousFileIds.length ? 'stale' : 'failed',
      expectedUrl: item.url,
      previousFileIds,
      attempts,
      nextAttemptAt: new Date(checkedAt.getTime() + previewRetryDelay(attempts, retryBaseMs, retryMaxMs)),
      errorCode: previewFailureCode(error)
    };
  }

  function readyOutcome(item, fileIds) {
    return {
      fileIds,
      status: 'ready',
      expectedUrl: item.url,
      previousFileIds: Array.isArray(item.previewFileIds) ? item.previewFileIds : [],
      attempts: 0,
      nextAttemptAt: null,
      errorCode: ''
    };
  }

  async function persistResults(resultById, checkedAt, visualDeletes = []) {
    const patches = [...resultById].map(([id, result]) => {
      const fields = {
        previewFileIds: result.fileIds,
        previewCheckedAt: checkedAt,
        previewStatus: result.status,
        previewAttempts: result.status === 'ready' ? 0 : Math.max(1, Number(result.attempts) || 1),
        previewNextAttemptAt: result.status === 'ready' ? null : result.nextAttemptAt,
        previewLastErrorCode: result.status === 'ready' ? '' : result.errorCode
      };
      if (result.status === 'ready') fields.previewCaptureVersion = captureVersion;
      return {
        id,
        expectedUrl: result.expectedUrl,
        discardFileIds: result.status === 'ready' ? result.fileIds : [],
        fields
      };
    });
    const stagedFileIds = [...resultById.values()]
      .filter((result) => result.status === 'ready')
      .flatMap((result) => result.fileIds);
    let journaled = false;
    if (stagedFileIds.length && typeof repository.queueVisualDeletes === 'function') {
      try {
        await repository.queueVisualDeletes(stagedFileIds, checkedAt);
        journaled = true;
      } catch (error) {
        await deleteUploadedFiles(stagedFileIds);
        throw error;
      }
    }
    try {
      return await repository.patchItems(patches, checkedAt, visualDeletes);
    } catch (error) {
      if (stagedFileIds.length && !journaled) {
        await deleteUploadedFiles(stagedFileIds);
      }
      throw error;
    }
  }

  async function hydratePreview(id, force = false, maintenanceToken = '') {
    assertMaintenanceContext(maintenanceToken);
    assertConfigured();
    const cache = await repository.get();
    const item = cache && (cache.items || []).find((entry) => entry.id === id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
    if (!force && !isNewVisualItem(item, config.newItemsAfter)) {
      return { id, skipped: 'existing-item', previewFileIds: item.previewFileIds || [] };
    }
    if (item.coverFileId) return { id, skipped: 'cover-ready', previewFileIds: [] };
    if (!force
      && Array.isArray(item.previewFileIds)
      && item.previewFileIds.length
      && Number(item.previewCaptureVersion || 1) === captureVersion) {
      return { id, cached: true, previewFileIds: item.previewFileIds };
    }

    const checkedAt = toDate(now()) || new Date();
    if (!force && !previewAttemptIsDue(item, checkedAt, retryBaseMs, captureVersion)) {
      return {
        id,
        cached: true,
        deferred: true,
        previewFileIds: Array.isArray(item.previewFileIds) ? item.previewFileIds : [],
        status: item.previewStatus || '',
        attempts: Math.max(0, Number(item.previewAttempts) || 0),
        nextAttemptAt: item.previewNextAttemptAt || null
      };
    }

    const previousFileIds = Array.isArray(item.previewFileIds) ? item.previewFileIds : [];
    let outcome;
    try {
      outcome = readyOutcome(item, await resolveAndUploadPreviews(item));
    } catch (error) {
      outcome = retryOutcome(item, error, checkedAt);
      logger.warn('Source preview unavailable', { itemId: item.id, message: error && error.message });
    }
    const visualDeletes = outcome.status === 'ready'
      ? previousFileIds.filter((fileId) => typeof fileId === 'string'
        && fileId.startsWith(config.fileIdPrefix)
        && !outcome.fileIds.includes(fileId))
      : [];
    const patchResult = await persistResults(new Map([[id, outcome]]), checkedAt, visualDeletes);
    const applied = patchResult.appliedIds.includes(id);
    return {
      id,
      cached: false,
      previewFileIds: applied ? outcome.fileIds : [],
      status: applied ? outcome.status : 'stale',
      attempts: applied ? outcome.attempts : Math.max(0, Number(item.previewAttempts) || 0),
      nextAttemptAt: applied ? outcome.nextAttemptAt : item.previewNextAttemptAt || null
    };
  }

  async function hydratePreviews(limit = 1, force = false, maintenanceToken = '', options = {}) {
    assertMaintenanceContext(maintenanceToken);
    assertConfigured();
    const cache = await repository.get();
    if (!cache || !Array.isArray(cache.items)) throw new AppError('FEED_UNAVAILABLE', '资讯缓存尚未建立');
    const batchSize = Math.max(1, Math.min(2, Number(limit) || 1));
    const candidateIds = Array.isArray(options.itemIds) && options.itemIds.length
      ? new Set(options.itemIds)
      : null;
    const selectionTime = toDate(now()) || new Date();
    const candidates = cache.items
      .filter((item) => (!candidateIds || candidateIds.has(item.id))
        && (force === true || isNewVisualItem(item, config.newItemsAfter))
        && !item.coverFileId
        && (!(Array.isArray(item.previewFileIds) && item.previewFileIds.length)
          || Number(item.previewCaptureVersion || 1) !== captureVersion)
        && item.coverStatus === 'missing'
        && (!options.retryOnly || (Boolean(item.previewCheckedAt)
          && ['failed', 'stale'].includes(item.previewStatus)))
        && (!options.untriedOnly || !item.previewCheckedAt)
        && (force === true || previewAttemptIsDue(item, selectionTime, retryBaseMs, captureVersion)))
      .sort((left, right) => {
        const untried = Number(Boolean(left.previewCheckedAt)) - Number(Boolean(right.previewCheckedAt));
        if (untried) return untried;
        const leftNext = toDate(left.previewNextAttemptAt || left.previewCheckedAt);
        const rightNext = toDate(right.previewNextAttemptAt || right.previewCheckedAt);
        return (leftNext ? leftNext.getTime() : 0) - (rightNext ? rightNext.getTime() : 0);
      })
      .slice(0, batchSize);
    if (!candidates.length) {
      return previewSummary(cache.items, 0, 0, 0);
    }

    const checkedAt = selectionTime;
    const resultById = new Map();
    for (const item of candidates) {
      try {
        resultById.set(item.id, readyOutcome(item, await resolveAndUploadPreviews(item)));
      } catch (error) {
        logger.warn('Source preview unavailable', { itemId: item.id, message: error && error.message });
        resultById.set(item.id, retryOutcome(item, error, checkedAt));
      }
    }
    const visualDeletes = [...resultById.values()]
      .filter((result) => result.status === 'ready')
      .flatMap((result) => result.previousFileIds.filter((fileId) => typeof fileId === 'string'
        && fileId.startsWith(config.fileIdPrefix)
        && !result.fileIds.includes(fileId)));
    const patchResult = await persistResults(resultById, checkedAt, visualDeletes);
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
        previewCheckedAt: item.previewCheckedAt,
        previewAttempts: Math.max(0, Number(item.previewAttempts) || 0),
        previewNextAttemptAt: item.previewNextAttemptAt || null,
        previewLastErrorCode: item.previewLastErrorCode || ''
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

  return {
    resolveAndUploadPreviews,
    hydratePreview,
    hydratePreviews,
    listPreviewFailures,
    maintenanceStatus
  };
}

module.exports = {
  validRendererUrl,
  decodeJpeg,
  maintenanceAuthorized,
  previewRetryDelay,
  previewFailureCode,
  previewAttemptIsDue,
  createPreviewService
};
