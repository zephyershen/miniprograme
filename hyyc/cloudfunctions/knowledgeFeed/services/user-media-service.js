const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  canonicalExtension,
  imageFormat,
  sanitizeImagePayload
} = require('../lib/user-media-image');

const MEDIA_KINDS = Object.freeze({
  avatar: Object.freeze({ directory: 'avatars', maxBytesKey: 'avatarMaxBytes' }),
  comment: Object.freeze({ directory: 'comments', maxBytesKey: 'commentImageMaxBytes' })
});
const PRIVATE_MEDIA_MESSAGE = 'Media is unavailable. Please choose the image again.';
const TEMPORARY_MEDIA_MESSAGE = 'Media is temporarily unavailable. Please try again.';
const DEFAULT_PUBLICATION_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_CLAIM_LEASE_MS = 10 * 60 * 1000;
const CLEANUP_RETRY_DELAY_MS = 5 * 60 * 1000;

function normalizeMediaKind(value) {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!MEDIA_KINDS[kind]) throw new AppError('INVALID_REQUEST', 'Unsupported image type');
  return kind;
}

function normalizeImageExtension(value) {
  return canonicalExtension(value);
}

function uploadIdFromFileId(fileId, config) {
  if (typeof fileId !== 'string') return '';
  if (fileId.startsWith(config.userMediaStagingFileIdPrefix)) {
    const relative = fileId.slice(config.userMediaStagingFileIdPrefix.length);
    const match = relative.match(/^[a-f0-9]{64}\/(?:avatars|comments)\/([a-f0-9]{48})\.[a-z0-9]{2,5}$/);
    return match ? match[1] : '';
  }
  if (fileId.startsWith(config.userMediaPublishedFileIdPrefix)) {
    const relative = fileId.slice(config.userMediaPublishedFileIdPrefix.length);
    const match = relative.match(/^(?:avatars|comments)\/[a-f0-9]{64}\/([a-f0-9]{48})\.[a-z0-9]{2,5}$/);
    return match ? match[1] : '';
  }
  if (fileId.startsWith(config.userMediaReviewFileIdPrefix)) {
    const relative = fileId.slice(config.userMediaReviewFileIdPrefix.length);
    const match = relative.match(/^(?:avatars|comments)\/[a-f0-9]{64}\/([a-f0-9]{48})\.[a-z0-9]{2,5}$/);
    return match ? match[1] : '';
  }
  return '';
}

function fileInfoSucceeded(entry) {
  return Boolean(entry) && (
    entry.code === 'SUCCESS'
    || entry.status === 0
    || entry.status === '0'
  );
}

function copySucceeded(entry) {
  return Boolean(entry) && (
    entry.code === 'SUCCESS'
    || entry.status === 0
    || entry.status === '0'
  );
}

function successfulTempUrl(entry) {
  if (!entry || !/^https:\/\//i.test(entry.tempFileURL || '')) return false;
  if (entry.status !== undefined) return entry.status === 0 || entry.status === '0';
  if (entry.code !== undefined) return entry.code === 'SUCCESS';
  return true;
}

function decodeImagePayload(value, extension, maxBytes) {
  return sanitizeImagePayload(value, extension, maxBytes).buffer;
}

function positiveDuration(value, fallback) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function samePublicationReference(left, right) {
  return Boolean(left && right
    && left.kind === right.kind
    && left.referenceId === right.referenceId
    && (left.kind !== 'comment' || left.itemId === right.itemId));
}

function normalizePublicationReference(reference, intendedAt, { required = false } = {}) {
  const supplied = reference && typeof reference === 'object'
    && Object.keys(reference).length > 0;
  if (!supplied && !required) return null;
  const kind = reference && reference.kind;
  const referenceId = reference && typeof reference.id === 'string' ? reference.id : '';
  if (!['profile', 'comment'].includes(kind) || !/^[a-f0-9]{64}$/.test(referenceId)) {
    throw new Error('USER_MEDIA_BUSINESS_REFERENCE_INVALID');
  }
  const intent = { kind, referenceId, intendedAt };
  if (kind === 'comment') {
    const itemId = typeof reference.itemId === 'string' ? reference.itemId : '';
    if (!/^[a-z0-9_-]{8,80}$/i.test(itemId)) {
      throw new Error('USER_MEDIA_BUSINESS_REFERENCE_INVALID');
    }
    intent.itemId = itemId;
  }
  return intent;
}

function attachedBinding(reference, attachedAt) {
  return {
    state: 'attached',
    kind: reference.kind,
    referenceId: reference.referenceId,
    ...(reference.kind === 'comment' ? { itemId: reference.itemId } : {}),
    attachedAt
  };
}

function assertPublicationOwner(actor, reference) {
  if (reference.kind === 'profile' && reference.referenceId !== (actor && actor.ownerKey)) {
    throw new Error('USER_MEDIA_BUSINESS_REFERENCE_INVALID');
  }
  return reference;
}

function createUserMediaService({
  repository,
  config,
  publicationVerifier,
  getFileInfo,
  uploadFile,
  getTempFileURL,
  copyFile,
  deleteFiles,
  now = () => Date.now(),
  createUploadId = () => crypto.randomBytes(24).toString('hex')
}) {
  const publicationRecoveryTtlMs = positiveDuration(
    config.userMediaPublicationRecoveryTtlMs,
    DEFAULT_PUBLICATION_RECOVERY_TTL_MS
  );
  const cleanupClaimLeaseMs = positiveDuration(
    config.userMediaCleanupClaimLeaseMs,
    DEFAULT_CLEANUP_CLAIM_LEASE_MS
  );

  function fileIdForPath(cloudPath) {
    return `${config.userMediaFileIdRoot}${cloudPath}`;
  }

  async function markDeletedAfterConfirmed(uploadId, ownerKey) {
    const deletedAt = new Date(now());
    await repository.markDeleted(uploadId, ownerKey, {
      status: 'deleted',
      deletedAt,
      updatedAt: deletedAt
    }).catch(() => null);
  }

  async function scheduleCleanup(uploadId, ownerKey) {
    const cleanupAfter = new Date(now());
    await repository.scheduleCleanup(uploadId, ownerKey, {
      cleanupPending: true,
      cleanupAfter,
      cleanupState: 'pending',
      cleanupClaimId: '',
      cleanupClaimedAt: null,
      cleanupClaimExpiresAt: null,
      updatedAt: cleanupAfter
    }).catch(() => null);
  }

  async function reserveUpload(actor, input = {}) {
    const ownerKey = actor && actor.ownerKey;
    if (!/^[a-f0-9]{64}$/.test(ownerKey || '')) {
      throw new AppError('AUTH_REQUIRED', 'Sign in again before uploading media');
    }
    const kind = normalizeMediaKind(input.kind);
    const requestedExtension = normalizeImageExtension(input.extension);
    const maxBytes = Number(config[MEDIA_KINDS[kind].maxBytesKey]);
    const sanitized = sanitizeImagePayload(
      input.contentBase64,
      requestedExtension,
      maxBytes,
      {
        maxDimension: config.userMediaMaxDimension,
        maxPixels: config.userMediaMaxPixels
      }
    );
    const extension = sanitized.extension;
    const fileContent = sanitized.buffer;
    const uploadId = createUploadId();
    if (!/^[a-f0-9]{48}$/.test(uploadId)) throw new Error('USER_MEDIA_UPLOAD_ID_INVALID');
    const filename = `${uploadId}.${extension}`;
    const directory = MEDIA_KINDS[kind].directory;
    const stagingPath = `${config.userMediaStagingPathPrefix}${ownerKey}/${directory}/${filename}`;
    const reviewPath = `${config.userMediaReviewPathPrefix}${directory}/${ownerKey}/${filename}`;
    const publishedPath = `${config.userMediaPublishedPathPrefix}${directory}/${ownerKey}/${filename}`;
    const createdAt = new Date(now());
    const expiresAt = new Date(createdAt.getTime() + config.userMediaReservationTtlMs);
    await repository.reserve({
      uploadId,
      ownerKey,
      kind,
      extension,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
      sanitizedBytes: fileContent.length,
      sanitizedSha256: sanitized.sha256,
      stagingPath,
      stagingFileId: fileIdForPath(stagingPath),
      reviewPath,
      reviewFileId: fileIdForPath(reviewPath),
      publishedPath,
      publishedFileId: fileIdForPath(publishedPath),
      status: 'reserved',
      cleanupPending: true,
      cleanupAfter: expiresAt,
      createdAt,
      expiresAt,
      updatedAt: createdAt
    });

    let upload;
    try {
      upload = await uploadFile({
        cloudPath: stagingPath,
        fileContent,
        contentType: sanitized.mimeType
      });
    } catch (error) {
      await scheduleCleanup(uploadId, ownerKey);
      throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
    const fileId = upload && (upload.fileID || upload.fileId);
    if (fileId !== fileIdForPath(stagingPath)) {
      await scheduleCleanup(uploadId, ownerKey);
      throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
    return {
      cloudPath: stagingPath,
      fileId,
      expiresAt: expiresAt.toISOString()
    };
  }

  async function ownedRecord(actor, kindValue, fileId, { allowPublished = true } = {}) {
    const ownerKey = actor && actor.ownerKey;
    const kind = normalizeMediaKind(kindValue);
    const uploadId = uploadIdFromFileId(fileId, config);
    if (!uploadId) throw new AppError('INVALID_REQUEST', PRIVATE_MEDIA_MESSAGE);
    const record = await repository.get(uploadId);
    const matches = record
      && record.ownerKey === ownerKey
      && record.kind === kind
      && (record.stagingFileId === fileId
        || (allowPublished && record.publishedFileId === fileId));
    if (!matches) throw new AppError('INVALID_REQUEST', PRIVATE_MEDIA_MESSAGE);
    if (record.status === 'published' && allowPublished) return record;
    if (record.status !== 'reserved' && record.status !== 'reviewing') {
      throw new AppError('INVALID_REQUEST', PRIVATE_MEDIA_MESSAGE);
    }
    if (new Date(record.expiresAt).getTime() <= now()) {
      throw new AppError('INVALID_REQUEST', 'The upload reservation expired');
    }
    return record;
  }

  function immutableFileId(record) {
    if (record.status === 'published') return record.publishedFileId;
    if (record.status === 'reviewing') return record.reviewFileId;
    return record.stagingFileId;
  }

  async function validateUploadedFiles(records) {
    if (!records.length) return;
    let response;
    try {
      response = await getFileInfo({ fileList: records.map(immutableFileId) });
    } catch (error) {
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', TEMPORARY_MEDIA_MESSAGE);
    }
    const entries = Array.isArray(response && response.fileList) ? response.fileList : [];
    const byId = new Map(entries.map((entry) => [entry && (entry.fileID || entry.fileId), entry]));
    records.forEach((record) => {
      const fileId = immutableFileId(record);
      const entry = byId.get(fileId);
      const size = Number(entry && entry.size);
      const mime = String(entry && (entry.mime || entry.contentType) || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const maxBytes = Number(config[MEDIA_KINDS[record.kind].maxBytesKey]);
      if (!fileInfoSucceeded(entry) || !IMAGE_MIME_TYPES.has(mime)
        || mime !== record.mimeType
        || !Number.isFinite(size)
        || size <= 0
        || size > maxBytes
        || size !== Number(record.sanitizedBytes)) {
        throw new AppError('INVALID_REQUEST', 'The image format or size is invalid');
      }
    });
  }

  async function ensureReviewCopy(record) {
    if (record.status === 'reviewing' || record.status === 'published') return record;
    let copied = false;
    try {
      const response = await copyFile({
        fileList: [{
          srcPath: record.stagingPath,
          dstPath: record.reviewPath,
          overwrite: false,
          removeOriginal: true
        }]
      });
      copied = copySucceeded(
        Array.isArray(response && response.fileList) ? response.fileList[0] : null
      );
    } catch (error) {
      copied = false;
    }

    const frozen = { ...record, status: 'reviewing' };
    try {
      await validateUploadedFiles([frozen]);
    } catch (error) {
      if (copied && error && error.code === 'INVALID_REQUEST') {
        const deletion = await deleteFiles([record.reviewFileId]);
        if ((deletion && deletion.deletedFileIds || []).includes(record.reviewFileId)) {
          await markDeletedAfterConfirmed(record.uploadId, record.ownerKey);
        } else {
          await scheduleCleanup(record.uploadId, record.ownerKey);
        }
      }
      throw error;
    }

    const updatedAt = new Date(now());
    const reviewing = await repository.markReviewing(record.uploadId, record.ownerKey, {
      status: 'reviewing',
      reviewFrozenAt: record.reviewFrozenAt || updatedAt,
      stagingDeletedAt: record.stagingDeletedAt || (copied ? updatedAt : null),
      updatedAt
    });
    if (!reviewing) throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    return reviewing;
  }

  async function filesForReview(actor, kind, fileIds = []) {
    const records = [];
    for (const fileId of fileIds) {
      const record = await ownedRecord(actor, kind, fileId);
      records.push(await ensureReviewCopy(record));
    }
    return records.map(immutableFileId);
  }

  async function holdForReview(actor, kind, fileIds = [], ttlMs) {
    const duration = positiveDuration(
      ttlMs,
      positiveDuration(config.userProfileReviewMediaTtlMs, 7 * 24 * 60 * 60 * 1000)
    );
    const cleanupAfter = new Date(now() + duration);
    for (const fileId of fileIds) {
      const record = await ownedRecord(actor, kind, fileId);
      if (record.status === 'published'
        && record.businessBinding
        && record.businessBinding.state === 'attached') continue;
      const held = await repository.scheduleCleanup(record.uploadId, actor.ownerKey, {
        cleanupPending: true,
        cleanupAfter,
        expiresAt: cleanupAfter,
        cleanupState: 'pending',
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null,
        updatedAt: new Date(now())
      });
      if (!held) throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
    return { cleanupAfter: cleanupAfter.toISOString() };
  }

  async function ensurePublishedCopy(record) {
    let copied = false;
    try {
      const response = await copyFile({
        fileList: [{
          srcPath: record.reviewPath,
          dstPath: record.publishedPath,
          overwrite: false,
          removeOriginal: false
        }]
      });
      copied = copySucceeded(
        Array.isArray(response && response.fileList) ? response.fileList[0] : null
      );
    } catch (error) {
      copied = false;
    }
    if (copied) return;
    try {
      await validateUploadedFiles([{ ...record, status: 'published' }]);
    } catch (error) {
      throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
  }

  async function cleanupPublishedPrivateCopies(record, actor) {
    if (record.privateCopiesDeletedAt) return record;
    const privateIds = [record.reviewFileId, record.stagingFileId].filter(Boolean);
    const result = await deleteFiles(privateIds);
    const deleted = new Set(result && result.deletedFileIds || []);
    if (privateIds.some((fileId) => !deleted.has(fileId))) {
      throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
    const updatedAt = new Date(now());
    const attached = record.businessBinding
      && record.businessBinding.state === 'attached';
    const updated = await repository.markPublished(record.uploadId, actor.ownerKey, {
      privateCopiesCleanupPending: false,
      privateCopiesDeletedAt: updatedAt,
      stagingDeletedAt: updatedAt,
      reviewDeletedAt: updatedAt,
      cleanupPending: attached ? false : record.cleanupPending,
      cleanupAfter: attached ? null : record.cleanupAfter,
      cleanupState: attached ? 'attached' : record.cleanupState,
      updatedAt
    });
    if (!updated) throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    return updated;
  }

  async function ensurePublicationIntent(record, actor, intent) {
    if (!intent) return record;
    const recoveryAfter = new Date(
      new Date(intent.intendedAt).getTime() + publicationRecoveryTtlMs
    );
    const intended = await repository.recordPublicationIntent(
      record.uploadId,
      actor.ownerKey,
      intent,
      {
        cleanupPending: true,
        cleanupAfter: recoveryAfter,
        cleanupState: 'pending',
        updatedAt: intent.intendedAt
      }
    );
    const effectiveReference = intended
      && (intended.publicationIntent || intended.businessBinding);
    if (!intended || !samePublicationReference(effectiveReference, intent)) {
      throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
    return intended;
  }

  async function publishOwned(actor, kind, fileIds = [], reference = {}, options = {}) {
    const intendedAt = new Date(now());
    const intent = assertPublicationOwner(actor, normalizePublicationReference(
      reference,
      intendedAt,
      { required: true }
    ));
    const results = [];
    for (const fileId of fileIds) {
      const record = await ownedRecord(actor, kind, fileId);
      if (record.status === 'published') {
        const intended = await ensurePublicationIntent(record, actor, intent);
        if (options.keepPrivateCopies === true) {
          results.push(intended.publishedFileId);
        } else {
          const cleaned = await cleanupPublishedPrivateCopies(intended, actor);
          results.push(cleaned.publishedFileId);
        }
        continue;
      }
      if (record.status !== 'reviewing') {
        throw new AppError('INVALID_REQUEST', 'The image has not been reviewed');
      }
      await ensurePublishedCopy(record);
      const updatedAt = new Date(now());
      const published = await repository.markPublished(record.uploadId, actor.ownerKey, {
        status: 'published',
        privateCopiesCleanupPending: true,
        publishedAt: updatedAt,
        updatedAt
      });
      if (!published) throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
      const intended = await ensurePublicationIntent(published, actor, intent);
      if (options.keepPrivateCopies === true) {
        results.push(intended.publishedFileId);
      } else {
        const cleaned = await cleanupPublishedPrivateCopies(intended, actor);
        results.push(cleaned.publishedFileId);
      }
    }
    return results;
  }

  async function cleanupPublishedCopies(actor, kind, fileIds = []) {
    const cleaned = [];
    for (const fileId of fileIds) {
      const record = await ownedRecord(actor, kind, fileId);
      if (record.status !== 'published') {
        throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
      }
      cleaned.push((await cleanupPublishedPrivateCopies(record, actor)).publishedFileId);
    }
    return cleaned;
  }

  async function bindPublished(actor, kind, fileIds = [], reference = {}) {
    const bindingReference = assertPublicationOwner(actor, normalizePublicationReference(
      reference,
      new Date(now()),
      { required: true }
    ));
    const bound = [];
    for (const fileId of fileIds) {
      let record = await ownedRecord(actor, kind, fileId);
      if (record.status !== 'published') {
        throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
      }
      record = await ensurePublicationIntent(record, actor, bindingReference);
      const updatedAt = new Date(now());
      const privateCopiesPending = record.privateCopiesCleanupPending === true;
      const updated = await repository.markBound(record.uploadId, actor.ownerKey, {
        businessBinding: attachedBinding(bindingReference, updatedAt),
        cleanupPending: privateCopiesPending,
        cleanupAfter: privateCopiesPending ? updatedAt : null,
        cleanupState: privateCopiesPending ? 'private-copies' : 'attached',
        updatedAt
      });
      if (!updated) throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
      bound.push(updated.publishedFileId);
    }
    return bound;
  }

  function recordFileIds(record) {
    return [record.publishedFileId, record.reviewFileId, record.stagingFileId];
  }

  async function deleteRecords(actor, kind, fileIds, { includePublished }) {
    const recordsById = new Map();
    for (const fileId of fileIds) {
      const record = await ownedRecord(actor, kind, fileId);
      if (!includePublished && record.status === 'published') continue;
      recordsById.set(record.uploadId, record);
    }
    const records = [...recordsById.values()];
    if (!records.length) return { deletedFileIds: [], retryFileIds: [], uncertain: false };
    const deletionRequestedAt = new Date(now());
    for (const record of records) {
      if (!repository || typeof repository.requestDeletion !== 'function') {
        throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
      }
      const requested = await repository.requestDeletion(record.uploadId, record.ownerKey, {
        status: 'deleting',
        cleanupPending: true,
        cleanupAfter: deletionRequestedAt,
        businessBinding: null,
        publicationIntent: null,
        deletionRequestedAt,
        updatedAt: deletionRequestedAt
      });
      if (!requested) throw new AppError('TEMPORARY_FAILURE', TEMPORARY_MEDIA_MESSAGE);
    }
    const canonicalIds = records.flatMap(recordFileIds).filter(Boolean);
    const result = await deleteFiles(canonicalIds);
    const deleted = new Set(result && result.deletedFileIds || []);
    for (const record of records) {
      const recordIds = recordFileIds(record).filter(Boolean);
      if (recordIds.some((fileId) => !deleted.has(fileId))) continue;
      const updatedAt = new Date(now());
      await repository.markDeleted(record.uploadId, record.ownerKey, {
        status: 'deleted',
        cleanupState: 'completed',
        deletedAt: updatedAt,
        updatedAt
      }).catch(() => null);
    }
    return result;
  }

  function discardUnpublished(actor, kind, fileIds = []) {
    return deleteRecords(actor, kind, fileIds, { includePublished: false });
  }

  function deleteOwned(actor, kind, fileIds = []) {
    return deleteRecords(actor, kind, fileIds, { includePublished: true });
  }

  function cleanupDeadline(record) {
    const value = record && record.cleanupState === 'claimed'
      ? record.cleanupClaimExpiresAt
      : record && record.cleanupAfter;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
  }

  async function releaseCleanupClaim(record, claimId) {
    const retryAt = new Date(now() + CLEANUP_RETRY_DELAY_MS);
    try {
      return await repository.releaseCleanup(
        record.uploadId,
        record.ownerKey,
        claimId,
        retryAt
      );
    } catch (error) {
      return null;
    }
  }

  async function repairClaimedBinding(record, claimId, reference) {
    const updatedAt = new Date(now());
    try {
      return await repository.bindClaimed(record.uploadId, record.ownerKey, claimId, {
        businessBinding: reference.state === 'attached'
          ? reference
          : attachedBinding(reference, updatedAt),
        updatedAt
      });
    } catch (error) {
      return null;
    }
  }

  async function cleanupExpired(limit = config.userMediaCleanupBatchSize) {
    const cleanupStartedAt = new Date(now());
    const size = Math.max(1, Math.min(50, Number(limit) || 10));
    const [expired, staleClaims] = await Promise.all([
      repository.listExpired(cleanupStartedAt, size),
      typeof repository.listStaleCleanupClaims === 'function'
        ? repository.listStaleCleanupClaims(cleanupStartedAt, size)
        : []
    ]);
    const scanned = new Map();
    [...expired, ...staleClaims].forEach((record) => {
      if (record && record.uploadId) scanned.set(record.uploadId, record);
    });
    const candidates = [...scanned.values()]
      .filter((record) => record
        && ['reserved', 'reviewing', 'published', 'deleting'].includes(record.status)
        && (
          (record.cleanupPending === true
            && cleanupDeadline(record) <= cleanupStartedAt.getTime())
          || (record.cleanupState === 'claimed'
            && cleanupDeadline(record) <= cleanupStartedAt.getTime())
        ))
      .sort((left, right) => cleanupDeadline(left) - cleanupDeadline(right))
      .slice(0, size);
    let deleted = 0;
    let retry = 0;
    let repaired = 0;
    let reclaimed = 0;
    for (const record of candidates) {
      const claimId = crypto.randomBytes(16).toString('hex');
      const claimedAt = new Date(now());
      const claimExpiresAt = new Date(claimedAt.getTime() + cleanupClaimLeaseMs);
      const stale = record.cleanupState === 'claimed';
      let claimed;
      try {
        claimed = stale
          ? await repository.reclaimCleanup(
            record.uploadId,
            record.ownerKey,
            claimedAt,
            claimId,
            claimExpiresAt
          )
          : await repository.claimCleanup(
            record.uploadId,
            record.ownerKey,
            claimedAt,
            claimId,
            claimExpiresAt
          );
      } catch (error) {
        retry += 1;
        continue;
      }
      if (!claimed) continue;
      if (stale) reclaimed += 1;

      const existingBinding = claimed.businessBinding;
      if (claimed.status === 'published'
        && existingBinding
        && existingBinding.state === 'attached'
        && claimed.privateCopiesCleanupPending === true) {
        const privateIds = [claimed.reviewFileId, claimed.stagingFileId].filter(Boolean);
        let result;
        try {
          result = await deleteFiles(privateIds);
        } catch (error) {
          await releaseCleanupClaim(claimed, claimId);
          retry += 1;
          continue;
        }
        const removed = new Set(result && result.deletedFileIds || []);
        if (privateIds.some((fileId) => !removed.has(fileId))) {
          await releaseCleanupClaim(claimed, claimId);
          retry += 1;
          continue;
        }
        const cleanedAt = new Date(now());
        const completed = await repository.bindClaimed(
          claimed.uploadId,
          claimed.ownerKey,
          claimId,
          {
            businessBinding: existingBinding,
            privateCopiesCleanupPending: false,
            privateCopiesDeletedAt: cleanedAt,
            stagingDeletedAt: cleanedAt,
            reviewDeletedAt: cleanedAt,
            updatedAt: cleanedAt
          }
        ).catch(() => null);
        if (completed) repaired += 1;
        else {
          await releaseCleanupClaim(claimed, claimId);
          retry += 1;
        }
        continue;
      }
      if (claimed.status === 'published'
        && existingBinding
        && existingBinding.state === 'attached') {
        const restored = await repairClaimedBinding(claimed, claimId, existingBinding);
        if (restored) repaired += 1;
        else {
          await releaseCleanupClaim(claimed, claimId);
          retry += 1;
        }
        continue;
      }

      if (claimed.status === 'published' && claimed.publicationIntent) {
        let attached = false;
        try {
          if (!publicationVerifier
            || typeof publicationVerifier.isAttached !== 'function') {
            throw new Error('USER_MEDIA_PUBLICATION_VERIFIER_REQUIRED');
          }
          attached = await publicationVerifier.isAttached(claimed);
        } catch (error) {
          await releaseCleanupClaim(claimed, claimId);
          retry += 1;
          continue;
        }
        if (attached) {
          const restored = await repairClaimedBinding(
            claimed,
            claimId,
            claimed.publicationIntent
          );
          if (restored) repaired += 1;
          else {
            await releaseCleanupClaim(claimed, claimId);
            retry += 1;
          }
          continue;
        }
      }

      const fileIds = recordFileIds(claimed).filter(Boolean);
      let result;
      try {
        result = await deleteFiles(fileIds);
      } catch (error) {
        await releaseCleanupClaim(claimed, claimId);
        retry += 1;
        continue;
      }
      const removed = new Set(result && result.deletedFileIds || []);
      if (fileIds.some((fileId) => !removed.has(fileId))) {
        await releaseCleanupClaim(claimed, claimId);
        retry += 1;
        continue;
      }
      const deletedAt = new Date(now());
      let updated;
      try {
        updated = await repository.markDeleted(claimed.uploadId, claimed.ownerKey, {
          status: 'deleted',
          cleanupState: 'completed',
          deletedAt,
          updatedAt: deletedAt
        }, claimId);
      } catch (error) {
        updated = null;
      }
      if (updated) deleted += 1;
      else {
        await releaseCleanupClaim(claimed, claimId);
        retry += 1;
      }
    }
    return {
      scanned: scanned.size,
      candidates: candidates.length,
      deleted,
      retry,
      repaired,
      reclaimed
    };
  }

  async function resolveVisible(fileIds = [], access = {}) {
    const allowedPrefixes = [
      config.userMediaPublishedFileIdPrefix,
      config.userMediaReviewFileIdPrefix,
      config.avatarFileIdPrefix,
      config.commentImageFileIdPrefix
    ].filter((prefix) => typeof prefix === 'string' && prefix);
    const requested = [...new Set(
      (Array.isArray(fileIds) ? fileIds : [])
        .filter((fileId) => typeof fileId === 'string'
          && fileId.length <= 700
          && allowedPrefixes.some((prefix) => fileId.startsWith(prefix)))
    )].slice(0, 50);
    const visible = [];
    const privateReview = requested.filter((fileId) => (
      fileId.startsWith(config.userMediaReviewFileIdPrefix)
    ));
    for (const fileId of privateReview) {
      const uploadId = uploadIdFromFileId(fileId, config);
      if (!uploadId || !access.ownerKey) continue;
      const record = await repository.get(uploadId);
      if (!record
        || record.ownerKey !== access.ownerKey
        || record.kind !== 'avatar'
        || !['reviewing', 'published'].includes(record.status)
        || record.reviewFileId !== fileId) continue;
      visible.push(fileId);
    }
    const managed = requested.filter((fileId) => (
      fileId.startsWith(config.userMediaPublishedFileIdPrefix)
    ));
    for (const fileId of managed) {
      const uploadId = uploadIdFromFileId(fileId, config);
      if (!uploadId) continue;
      const record = await repository.get(uploadId);
      if (!record
        || record.status !== 'published'
        || record.publishedFileId !== fileId
        || !record.businessBinding
        || record.businessBinding.state !== 'attached') continue;
      try {
        if (!publicationVerifier
          || typeof publicationVerifier.canRead !== 'function'
          || !await publicationVerifier.canRead(record, access)) continue;
      } catch (error) {
        continue;
      }
      visible.push(fileId);
    }
    const legacy = requested.filter((fileId) => (
      !managed.includes(fileId) && !privateReview.includes(fileId)
    ));
    if (legacy.length
      && publicationVerifier
      && typeof publicationVerifier.authorizedLegacyFileIds === 'function') {
      try {
        const authorized = new Set(
          await publicationVerifier.authorizedLegacyFileIds(legacy, access)
        );
        legacy.forEach((fileId) => {
          if (authorized.has(fileId)) visible.push(fileId);
        });
      } catch (error) {
        // Legacy media is fail-closed. A repository or moderation lookup error
        // must not turn a storage prefix into an authorization boundary.
      }
    }
    if (!visible.length) return [];
    const response = await getTempFileURL({ fileList: visible });
    const visibleSet = new Set(visible);
    return ((response && response.fileList) || [])
      .filter((entry) => successfulTempUrl(entry)
        && visibleSet.has(entry.fileID || entry.fileId))
      .map((entry) => ({
        fileId: entry.fileID || entry.fileId,
        url: entry.tempFileURL,
        maxAge: Number(entry.maxAge) || 0
      }));
  }

  function isOwnedPublishedFileId(fileId) {
    return typeof fileId === 'string'
      && fileId.startsWith(config.userMediaPublishedFileIdPrefix);
  }

  return {
    reserveUpload,
    filesForReview,
    holdForReview,
    publishOwned,
    cleanupPublishedCopies,
    bindPublished,
    discardUnpublished,
    deleteOwned,
    cleanupExpired,
    resolveVisible,
    isOwnedPublishedFileId
  };
}

module.exports = {
  MEDIA_KINDS,
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  normalizeMediaKind,
  normalizeImageExtension,
  uploadIdFromFileId,
  fileInfoSucceeded,
  copySucceeded,
  successfulTempUrl,
  imageFormat,
  decodeImagePayload,
  createUserMediaService
};
