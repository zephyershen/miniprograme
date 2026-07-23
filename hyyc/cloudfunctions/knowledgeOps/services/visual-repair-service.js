const DEFAULT_ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: '视觉修复请求无效',
  VISUAL_REPAIR_NOT_FOUND: '目标资讯不存在',
  VISUAL_REPAIR_NOT_ACTIVE: '目标资讯当前未公开',
  VISUAL_REPAIR_STALE: '资讯或图片已发生变化，请重新核对后再操作',
  VISUAL_REPAIR_BUSY: '该资讯的视觉任务正在执行，请稍后重试',
  VISUAL_REPAIR_CACHE_CONFLICT: '旧缓存中的资讯身份不一致，未执行修复',
  VISUAL_CLEANUP_UNAVAILABLE: '视觉清理队列不可用，未执行修复'
});

const MAX_BATCH_SIZE = 50;

function defaultError(code, message) {
  const error = new Error(message || DEFAULT_ERROR_MESSAGES[code] || code);
  error.code = code;
  return error;
}

function isNotFound(error) {
  return Boolean(error && (
    error.errCode === -1
    || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(
      `${error.errCode || ''} ${error.code || ''} ${error.message || ''}`
    )
  ));
}

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function normalizedFileIds(value, maximum = 12) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const fileIds = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry || entry.length > 1024) return null;
    fileIds.push(entry);
  }
  return fileIds;
}

function currentPreviewFileIds(item) {
  return Array.isArray(item && item.previewFileIds)
    ? item.previewFileIds.filter((fileId) => typeof fileId === 'string' && fileId)
    : [];
}

function sameFileIds(left, right) {
  return left.length === right.length
    && left.every((fileId, index) => fileId === right[index]);
}

function visualFileIds(items) {
  const fileIds = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    for (const field of ['coverFileId', 'listThumbnailFileId']) {
      if (typeof item[field] === 'string' && item[field]) fileIds.add(item[field]);
    }
    for (const fileId of currentPreviewFileIds(item)) fileIds.add(fileId);
  }
  return fileIds;
}

function writableDocument(document) {
  const { _id, ...data } = document || {};
  return data;
}

function createVisualRepairService({
  db,
  authorize,
  config,
  now = () => Date.now(),
  wallNow = () => Date.now(),
  createError = defaultError
}) {
  const provider = config.provider || 'aihot';
  const itemIdPattern = /^[a-z0-9_-]{8,80}$/i;
  const contentHashPattern = /^[a-f0-9]{64}$/i;
  const previewFileIdPrefix = typeof config.previewFileIdPrefix === 'string'
    && config.previewFileIdPrefix.startsWith('cloud://')
    && config.previewFileIdPrefix.includes('/knowledge-previews/source/')
    ? config.previewFileIdPrefix
    : '';
  const listThumbnailFileIdPrefix = typeof config.listThumbnailFileIdPrefix === 'string'
    && config.listThumbnailFileIdPrefix.startsWith('cloud://')
    && config.listThumbnailFileIdPrefix.includes('/knowledge-thumbnails/list/')
    ? config.listThumbnailFileIdPrefix
    : '';
  const batchDeadlineMs = Math.max(5000, Math.min(50000, Number(config.batchDeadlineMs) || 45000));

  function fail(code, message) {
    throw createError(code, message || DEFAULT_ERROR_MESSAGES[code]);
  }

  function validHttpsUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch (error) {
      return false;
    }
  }

  function escapedPattern(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function ownedPreviewByItem(fileId, itemId) {
    if (!previewFileIdPrefix || typeof fileId !== 'string'
      || fileId.length > 1024 || !fileId.startsWith(previewFileIdPrefix)) return false;
    const name = fileId.slice(previewFileIdPrefix.length);
    return new RegExp(
      `^${escapedPattern(itemId)}-[a-f0-9]{12}-[a-f0-9]{12}-[1-9][0-9]{0,2}\\.jpg$`,
      'i'
    ).test(name);
  }

  function ownedThumbnailByItem(fileId, itemId) {
    if (!listThumbnailFileIdPrefix || typeof fileId !== 'string'
      || fileId.length > 1024 || !fileId.startsWith(listThumbnailFileIdPrefix)) return false;
    const name = fileId.slice(listThumbnailFileIdPrefix.length);
    return new RegExp(
      `^${escapedPattern(itemId)}-[a-f0-9]{12}-[a-f0-9]{12}-v[1-9][0-9]{0,2}\\.jpg$`,
      'i'
    ).test(name);
  }

  function ownedByItem(fileId, itemId) {
    return ownedPreviewByItem(fileId, itemId) || ownedThumbnailByItem(fileId, itemId);
  }

  function validateStrictRequest(event) {
    const itemId = typeof event.itemId === 'string' ? event.itemId.trim() : '';
    const expectedUrl = typeof event.expectedUrl === 'string' ? event.expectedUrl.trim() : '';
    const expectedContentHash = typeof event.expectedContentHash === 'string'
      ? event.expectedContentHash.trim().toLowerCase()
      : '';
    const expectedPreviewFileIds = normalizedFileIds(event.expectedPreviewFileIds);
    const expectedListThumbnailFileId = typeof event.expectedListThumbnailFileId === 'string'
      ? event.expectedListThumbnailFileId
      : '';
    if (!itemIdPattern.test(itemId)
      || !contentHashPattern.test(expectedContentHash)
      || !validHttpsUrl(expectedUrl)
      || expectedPreviewFileIds === null
      || expectedListThumbnailFileId.length > 1024) {
      fail('INVALID_REQUEST');
    }
    return {
      mode: 'strict',
      itemId,
      expectedUrl,
      expectedContentHash,
      expectedPreviewFileIds,
      expectedListThumbnailFileId
    };
  }

  function validateTargetedRequest(event) {
    const itemId = typeof event.itemId === 'string' ? event.itemId.trim() : '';
    const expectedPreviewFileId = typeof event.expectedPreviewFileId === 'string'
      ? event.expectedPreviewFileId
      : '';
    if (!itemIdPattern.test(itemId) || !ownedPreviewByItem(expectedPreviewFileId, itemId)) {
      fail('INVALID_REQUEST');
    }
    return { mode: 'targeted', itemId, expectedPreviewFileId };
  }

  function matchingJob(job, request) {
    return Boolean(job
      && job.itemId === request.itemId
      && (job.provider || provider) === provider
      && job.expectedUrl === request.expectedUrl
      && String(job.expectedContentHash || '').toLowerCase() === request.expectedContentHash);
  }

  function expectedRepairPreview(request) {
    if (request.mode === 'targeted') return request.expectedPreviewFileId;
    return Array.isArray(request.expectedPreviewFileIds) ? request.expectedPreviewFileIds[0] || '' : '';
  }

  function activeJobLease(job, currentTime) {
    if (!job || (!job.leaseOwner && job.status !== 'leased')) return false;
    const leaseUntil = toMillis(job.leaseUntil);
    return !Number.isFinite(leaseUntil) || leaseUntil > currentTime.getTime();
  }

  function activeLegacyVisualLease(cache, currentTime) {
    if (!cache || !cache.visualLeaseOwner) return false;
    const leaseUntil = toMillis(cache.visualLeaseUntil);
    return !Number.isFinite(leaseUntil) || leaseUntil > currentTime.getTime();
  }

  async function getOptional(reference) {
    try {
      return (await reference.get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  function quarantinedFields(currentTime) {
    return {
      previewFileIds: [],
      listThumbnailFileId: '',
      previewStatus: 'stale',
      previewAttempts: 0,
      previewNextAttemptAt: currentTime,
      previewLastErrorCode: 'PREVIEW_CONTENT_INVALID',
      previewCaptureVersion: 0,
      listThumbnailVersion: 0,
      previewQualityAudit: null,
      visualState: 'queued',
      visualLastErrorCode: 'PREVIEW_CONTENT_INVALID',
      visualQueuedAt: currentTime,
      visualUpdatedAt: currentTime,
      visualPublicationHeld: false,
      visualPublicationReleasedAt: currentTime,
      visualPublicationReleaseReason: 'visual-repair-quarantine',
      updatedAt: currentTime
    };
  }

  function buildVisualJob(item, request, currentTime) {
    const coverFileId = typeof item.coverFileId === 'string' ? item.coverFileId : '';
    return {
      itemId: request.itemId,
      provider,
      expectedUrl: request.expectedUrl,
      expectedContentHash: request.expectedContentHash,
      publishedAt: item.publishedAt || '',
      selected: item.selected === true,
      priority: Math.max(1000000, Number(config.priority) || 0),
      status: 'pending',
      stage: coverFileId ? 'thumbnail' : 'cover',
      attempts: 0,
      nextAttemptAt: currentTime,
      leaseOwner: '',
      leaseUntil: null,
      lastErrorCode: '',
      stagedFileIds: [],
      cleanupFileIds: [],
      captureVersion: Math.max(1, Number(config.captureVersion) || 1),
      captureProfile: config.captureProfile || 'focus-v1',
      eligibleAt: currentTime,
      thumbnailVersion: Math.max(1, Number(config.thumbnailVersion) || 1),
      repairReason: 'PREVIEW_CONTENT_INVALID',
      repairExpectedPreviewFileId: expectedRepairPreview(request),
      repairRequestedAt: currentTime,
      createdAt: currentTime,
      updatedAt: currentTime
    };
  }

  async function repairOne(initialRequest) {
    const currentTime = new Date(now());
    const documentId = `${provider}_${initialRequest.itemId}`;
    return db.runTransaction(async (transaction) => {
      const itemReference = transaction.collection(config.itemsCollectionName).doc(documentId);
      const jobReference = transaction.collection(config.jobsCollectionName).doc(documentId);
      const cacheReference = transaction.collection(config.cacheCollectionName).doc(config.cacheDocumentId);
      // CloudBase binds transaction reads to one session; keep them ordered for
      // compatibility with every supported wx-server-sdk runtime.
      const item = await getOptional(itemReference);
      const job = await getOptional(jobReference);
      const cache = await getOptional(cacheReference);

      if (!item) fail('VISUAL_REPAIR_NOT_FOUND');
      if (!cache) fail('VISUAL_CLEANUP_UNAVAILABLE');
      if (item.id !== initialRequest.itemId || (item.provider && item.provider !== provider)) {
        fail('VISUAL_REPAIR_STALE');
      }
      if (item.publicState !== 'active') fail('VISUAL_REPAIR_NOT_ACTIVE');
      const currentHash = String(item.contentHash || '').toLowerCase();
      if (!validHttpsUrl(item.url) || !contentHashPattern.test(currentHash)) {
        fail('VISUAL_REPAIR_STALE');
      }
      const request = initialRequest.mode === 'strict'
        ? initialRequest
        : { ...initialRequest, expectedUrl: item.url, expectedContentHash: currentHash };
      if (initialRequest.mode === 'strict'
        && (item.url !== request.expectedUrl || currentHash !== request.expectedContentHash)) {
        fail('VISUAL_REPAIR_STALE');
      }
      if (activeJobLease(job, currentTime) || activeLegacyVisualLease(cache, currentTime)) {
        fail('VISUAL_REPAIR_BUSY');
      }

      const previewFileIds = currentPreviewFileIds(item);
      const listThumbnailFileId = typeof item.listThumbnailFileId === 'string'
        ? item.listThumbnailFileId
        : '';
      const noCurrentRefs = previewFileIds.length === 0 && !listThumbnailFileId;
      const sameRepairJob = matchingJob(job, request)
        && job.repairReason === 'PREVIEW_CONTENT_INVALID'
        && job.repairExpectedPreviewFileId === expectedRepairPreview(request);
      if (noCurrentRefs && sameRepairJob
        && ['pending', 'retry', 'leased'].includes(job.status)) {
        return {
          itemId: request.itemId,
          status: 'alreadyQueued',
          textVisible: item.visualPublicationHeld !== true,
          cleanupQueued: 0,
          cleanupSkipped: 0
        };
      }
      const resettingInterruptedRepair = noCurrentRefs
        && sameRepairJob
        && ['blocked', 'cleanup'].includes(job.status);
      if (!resettingInterruptedRepair) {
        if (request.mode === 'strict'
          && (!sameFileIds(previewFileIds, request.expectedPreviewFileIds)
            || listThumbnailFileId !== request.expectedListThumbnailFileId)) {
          fail('VISUAL_REPAIR_STALE');
        }
        if (request.mode === 'targeted' && previewFileIds[0] !== request.expectedPreviewFileId) {
          fail('VISUAL_REPAIR_STALE');
        }
      }

      const cacheItems = Array.isArray(cache.items) ? cache.items : [];
      const matchingCacheItems = cacheItems.filter((entry) => entry && entry.id === request.itemId);
      if (matchingCacheItems.some((entry) => entry.url !== request.expectedUrl
        || (entry.contentHash
          && String(entry.contentHash).toLowerCase() !== request.expectedContentHash))) {
        fail('VISUAL_REPAIR_CACHE_CONFLICT');
      }
      const cacheVisualsToClear = [];
      let cachePatched = false;
      const cacheFields = quarantinedFields(currentTime);
      const nextCacheItems = cacheItems.map((entry) => {
        if (!entry || entry.id !== request.itemId) return entry;
        cachePatched = true;
        cacheVisualsToClear.push(
          ...currentPreviewFileIds(entry),
          typeof entry.listThumbnailFileId === 'string' ? entry.listThumbnailFileId : ''
        );
        return { ...entry, ...cacheFields };
      });
      const claims = new Set(Array.isArray(cache.visualDeleteClaims)
        ? cache.visualDeleteClaims.filter((fileId) => typeof fileId === 'string' && fileId)
        : []);
      const oldJobFiles = [
        ...(Array.isArray(job && job.stagedFileIds) ? job.stagedFileIds : []),
        ...(Array.isArray(job && job.cleanupFileIds) ? job.cleanupFileIds : [])
      ];
      const requestedDeletes = [...new Set([
        ...previewFileIds,
        listThumbnailFileId,
        ...cacheVisualsToClear,
        ...oldJobFiles
      ].filter(Boolean))];
      const safeDeletes = requestedDeletes.filter((fileId) => ownedByItem(fileId, request.itemId));
      const skippedDeletes = requestedDeletes.filter((fileId) => !ownedByItem(fileId, request.itemId));
      const activeVisuals = visualFileIds(nextCacheItems);
      const pendingVisualDeletes = [...new Set([
        ...(Array.isArray(cache.pendingVisualDeletes) ? cache.pendingVisualDeletes : []),
        ...safeDeletes
      ])].filter((fileId) => typeof fileId === 'string'
        && fileId
        && !activeVisuals.has(fileId)
        && !claims.has(fileId));

      const itemFields = quarantinedFields(currentTime);
      const visualJob = buildVisualJob(item, request, currentTime);
      await itemReference.update({ data: itemFields });
      await cacheReference.update({
        data: {
          items: nextCacheItems,
          pendingVisualDeletes,
          visualDeleteClaims: [...claims],
          updatedAt: currentTime
        }
      });
      await jobReference.set({ data: writableDocument(visualJob) });

      return {
        itemId: request.itemId,
        status: 'queued',
        textVisible: true,
        cachePatched,
        stage: visualJob.stage,
        cleanupQueued: safeDeletes.filter((fileId) => pendingVisualDeletes.includes(fileId)).length,
        cleanupSkipped: skippedDeletes.length,
        ...(resettingInterruptedRepair ? { resetFromStatus: job.status } : {})
      };
    });
  }

  function skippedResult(itemId, error) {
    const code = /^[A-Z0-9_]{3,80}$/.test(error && error.code || '')
      ? error.code
      : 'TEMPORARY_FAILURE';
    return { itemId, status: 'skipped', code };
  }

  async function runBatch(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > MAX_BATCH_SIZE) {
      fail('INVALID_REQUEST');
    }
    const results = [];
    const seen = new Set();
    const startedAt = wallNow();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (index > 0 && wallNow() - startedAt >= batchDeadlineMs) {
        for (const remaining of entries.slice(index)) {
          const itemId = typeof (remaining && remaining.itemId) === 'string'
            ? remaining.itemId.trim().slice(0, 80)
            : '';
          results.push({ itemId, status: 'skipped', code: 'BATCH_DEADLINE' });
        }
        break;
      }
      const candidateId = typeof (entry && entry.itemId) === 'string'
        ? entry.itemId.trim().slice(0, 80)
        : '';
      let request;
      try {
        request = validateTargetedRequest(entry || {});
      } catch (error) {
        results.push(skippedResult(candidateId, error));
        continue;
      }
      if (seen.has(request.itemId)) {
        results.push({ itemId: request.itemId, status: 'skipped', code: 'DUPLICATE_ITEM' });
        continue;
      }
      seen.add(request.itemId);
      try {
        const outcome = await repairOne(request);
        results.push(outcome.status === 'queued'
          ? { ...outcome, status: 'applied' }
          : { ...outcome, status: 'skipped', code: 'ALREADY_QUEUED' });
      } catch (error) {
        results.push(skippedResult(request.itemId, error));
      }
    }
    return {
      status: 'completed',
      requested: entries.length,
      applied: results.filter((entry) => entry.status === 'applied').length,
      skipped: results.filter((entry) => entry.status === 'skipped').length,
      results
    };
  }

  async function run(event = {}) {
    authorize(event.token);
    if (Array.isArray(event.repairs)) return runBatch(event.repairs);
    if (Object.prototype.hasOwnProperty.call(event, 'expectedPreviewFileId')) {
      return repairOne(validateTargetedRequest(event));
    }
    return repairOne(validateStrictRequest(event));
  }

  return { run };
}

module.exports = {
  createVisualRepairService,
  isNotFound,
  toMillis,
  visualFileIds
};
