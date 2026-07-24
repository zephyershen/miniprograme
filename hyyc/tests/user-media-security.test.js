const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUserMediaService
} = require('../cloudfunctions/knowledgeFeed/services/user-media-service');
const {
  createUserMediaPublicationVerifier
} = require('../cloudfunctions/knowledgeFeed/services/user-media-publication-verifier');
const {
  sameBusinessReference
} = require('../cloudfunctions/knowledgeFeed/repositories/user-media');
const cloudbase = require('../cloudfunctions/knowledgeFeed/node_modules/@cloudbase/node-sdk');
const jpeg = require('../cloudfunctions/knowledgeFeed/node_modules/jpeg-js');
const { PNG } = require('../cloudfunctions/knowledgeFeed/node_modules/pngjs');

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const UPLOAD_ID = 'c'.repeat(48);
const NOW = Date.parse('2026-07-23T03:00:00.000Z');
const PROFILE_REFERENCE = Object.freeze({ kind: 'profile', id: OWNER });
const COMMENT_REFERENCE = Object.freeze({
  kind: 'comment',
  id: 'd'.repeat(64),
  itemId: 'item_test_01'
});
const CONFIG = Object.freeze({
  userMediaFileIdRoot: 'cloud://env/',
  userMediaStagingPathPrefix: 'user-media/staging/',
  userMediaReviewPathPrefix: 'user-media/review/',
  userMediaPublishedPathPrefix: 'user-media/published/',
  userMediaStagingFileIdPrefix: 'cloud://env/user-media/staging/',
  userMediaReviewFileIdPrefix: 'cloud://env/user-media/review/',
  userMediaPublishedFileIdPrefix: 'cloud://env/user-media/published/',
  avatarFileIdPrefix: 'cloud://env/user-media/avatars/',
  commentImageFileIdPrefix: 'cloud://env/user-media/comments/',
  userMediaReservationTtlMs: 30 * 60 * 1000,
  userMediaPublicationRecoveryTtlMs: 24 * 60 * 60 * 1000,
  userMediaCleanupBatchSize: 10,
  userMediaCleanupClaimLeaseMs: 10 * 60 * 1000,
  avatarMaxBytes: 5 * 1024 * 1024,
  commentImageMaxBytes: 10 * 1024 * 1024
});

function imagePayload(extension) {
  const width = 2;
  const height = 2;
  const data = Buffer.from([
    240, 160, 40, 255, 30, 120, 210, 255,
    20, 180, 90, 255, 210, 50, 120, 255
  ]);
  if (extension === 'png') {
    return PNG.sync.write({ width, height, data }).toString('base64');
  }
  return Buffer.from(jpeg.encode({ width, height, data }, 90).data).toString('base64');
}

function mediaInput(kind, extension) {
  return { kind, extension, contentBase64: imagePayload(extension) };
}

function serverUpload({ cloudPath, fileContent }) {
  assert.ok(Buffer.isBuffer(fileContent));
  return { fileID: `cloud://env/${cloudPath}` };
}

function memoryRepository() {
  const records = new Map();
  return {
    records,
    reserve: async (record) => {
      records.set(record.uploadId, { ...record });
      return record;
    },
    listExpired: async (expiresAt, limit) => [...records.values()]
      .filter((record) => record.cleanupAfter
        && new Date(record.cleanupAfter).getTime() <= new Date(expiresAt).getTime())
      .sort((left, right) => (
        new Date(left.cleanupAfter).getTime() - new Date(right.cleanupAfter).getTime()
      ))
      .slice(0, limit),
    listStaleCleanupClaims: async (expiresAt, limit) => [...records.values()]
      .filter((record) => record.cleanupClaimExpiresAt
        && new Date(record.cleanupClaimExpiresAt).getTime() <= new Date(expiresAt).getTime())
      .sort((left, right) => (
        new Date(left.cleanupClaimExpiresAt).getTime()
          - new Date(right.cleanupClaimExpiresAt).getTime()
      ))
      .slice(0, limit),
    get: async (uploadId) => records.get(uploadId) || null,
    markReviewing: async (uploadId, ownerKey, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey
        || !['reserved', 'reviewing'].includes(current.status)) return null;
      const next = { ...current, ...patch };
      records.set(uploadId, next);
      return next;
    },
    markPublished: async (uploadId, ownerKey, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey
        || !['reviewing', 'published'].includes(current.status)) return null;
      const next = { ...current, ...patch };
      records.set(uploadId, next);
      return next;
    },
    markBound: async (uploadId, ownerKey, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey || current.status !== 'published') return null;
      if (current.cleanupPending !== true) {
        const actual = current.businessBinding;
        const expected = patch.businessBinding;
        return actual && expected
          && actual.state === 'attached'
          && sameBusinessReference(actual, expected)
          ? current
          : null;
      }
      const next = { ...current, ...patch };
      records.set(uploadId, next);
      return next;
    },
    recordPublicationIntent: async (uploadId, ownerKey, intent, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey || current.status !== 'published') return null;
      if (current.businessBinding && current.businessBinding.state === 'attached') {
        return sameBusinessReference(current.businessBinding, intent) ? current : null;
      }
      if (current.publicationIntent) {
        return sameBusinessReference(current.publicationIntent, intent) ? current : null;
      }
      if (current.cleanupPending !== true) return null;
      const next = { ...current, ...patch, publicationIntent: intent };
      records.set(uploadId, next);
      return next;
    },
    requestDeletion: async (uploadId, ownerKey, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey
        || !['reserved', 'reviewing', 'published', 'deleting'].includes(current.status)) return null;
      const next = { ...current, ...patch };
      records.set(uploadId, next);
      return next;
    },
    markDeleted: async (uploadId, ownerKey, patch, claimId = '') => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey
        || !['reserved', 'reviewing', 'published', 'deleting'].includes(current.status)
        || (claimId && (current.cleanupState !== 'claimed'
          || current.cleanupClaimId !== claimId))) return null;
      const next = {
        ...current,
        cleanupPending: false,
        cleanupAfter: null,
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null,
        ...patch
      };
      records.set(uploadId, next);
      return next;
    },
    claimCleanup: async (uploadId, ownerKey, claimedAt, claimId, claimExpiresAt) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey || current.cleanupPending !== true
        || new Date(current.cleanupAfter).getTime() > new Date(claimedAt).getTime()) return null;
      const next = {
        ...current,
        cleanupPending: false,
        cleanupAfter: null,
        cleanupState: 'claimed',
        cleanupClaimId: claimId,
        cleanupClaimedAt: claimedAt,
        cleanupClaimExpiresAt: claimExpiresAt,
        updatedAt: claimedAt
      };
      records.set(uploadId, next);
      return next;
    },
    reclaimCleanup: async (uploadId, ownerKey, claimedAt, claimId, claimExpiresAt) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey || current.cleanupState !== 'claimed'
        || new Date(current.cleanupClaimExpiresAt).getTime()
          > new Date(claimedAt).getTime()) return null;
      const next = {
        ...current,
        cleanupPending: false,
        cleanupAfter: null,
        cleanupState: 'claimed',
        cleanupClaimId: claimId,
        cleanupClaimedAt: claimedAt,
        cleanupClaimExpiresAt: claimExpiresAt,
        updatedAt: claimedAt
      };
      records.set(uploadId, next);
      return next;
    },
    bindClaimed: async (uploadId, ownerKey, claimId, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey || current.status !== 'published'
        || current.cleanupState !== 'claimed'
        || current.cleanupClaimId !== claimId) return null;
      const next = {
        ...current,
        ...patch,
        cleanupPending: false,
        cleanupAfter: null,
        cleanupState: 'attached',
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null
      };
      records.set(uploadId, next);
      return next;
    },
    releaseCleanup: async (uploadId, ownerKey, claimId, retryAt) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey || current.cleanupClaimId !== claimId) return null;
      const next = {
        ...current,
        cleanupPending: true,
        cleanupState: 'retry',
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null,
        cleanupAfter: retryAt,
        updatedAt: retryAt
      };
      records.set(uploadId, next);
      return next;
    },
    scheduleCleanup: async (uploadId, ownerKey, patch) => {
      const current = records.get(uploadId);
      if (!current || current.ownerKey !== ownerKey
        || current.cleanupState === 'claimed') return null;
      const next = { ...current, ...patch };
      records.set(uploadId, next);
      return next;
    }
  };
}

function harness(overrides = {}) {
  const repository = memoryRepository();
  const copyCalls = [];
  const deleteCalls = [];
  const service = createUserMediaService({
    repository,
    config: CONFIG,
    publicationVerifier: {
      isAttached: async () => false,
      canRead: async (record, access = {}) => (
        record.businessBinding.kind === 'profile'
          ? access.comments === true || access.ownerKey === record.ownerKey
          : access.comments === true
      )
    },
    uploadFile: serverUpload,
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => ({
        fileID,
        status: 0,
        tempFileURL: `https://media.example.test/${encodeURIComponent(fileID)}`,
        maxAge: 300
      }))
    }),
    getFileInfo: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => {
        const record = repository.records.get(UPLOAD_ID);
        return {
          fileID,
          code: 'SUCCESS',
          mime: record.mimeType,
          size: record.sanitizedBytes
        };
      })
    }),
    copyFile: async (options) => {
      copyCalls.push(options);
      return { fileList: [{ code: 'SUCCESS' }] };
    },
    deleteFiles: async (fileIds) => {
      deleteCalls.push([...fileIds]);
      return { deletedFileIds: fileIds, retryFileIds: [], uncertain: false };
    },
    now: () => NOW,
    createUploadId: () => UPLOAD_ID,
    ...overrides
  });
  return { repository, service, copyCalls, deleteCalls };
}

test('production CloudBase SDK exposes every server-side storage primitive', () => {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  assert.equal(typeof app.uploadFile, 'function');
  assert.equal(typeof app.getFileInfo, 'function');
  assert.equal(typeof app.copyFile, 'function');
});

test('binds every upload reservation to the authenticated owner and a private staging path', async () => {
  const { repository, service } = harness();
  const reservation = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'jpg')
  );
  assert.equal(
    reservation.cloudPath,
    `user-media/staging/${OWNER}/comments/${UPLOAD_ID}.jpg`
  );
  const record = repository.records.get(UPLOAD_ID);
  assert.equal(record.ownerKey, OWNER);
  assert.equal(record.status, 'reserved');
  assert.equal(record.reviewFileId, `cloud://env/user-media/review/comments/${OWNER}/${UPLOAD_ID}.jpg`);
  assert.equal(record.publishedFileId, `cloud://env/user-media/published/comments/${OWNER}/${UPLOAD_ID}.jpg`);
});

test('fails closed for cross-user deletion and unreserved arbitrary paths', async () => {
  const { service, deleteCalls } = harness();
  const reservation = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'png')
  );
  const fileId = `cloud://env/${reservation.cloudPath}`;

  await assert.rejects(
    () => service.deleteOwned({ ownerKey: OTHER }, 'avatar', [fileId]),
    (error) => error.code === 'INVALID_REQUEST'
  );
  await assert.rejects(
    () => service.filesForReview(
      { ownerKey: OWNER },
      'avatar',
      [`cloud://env/user-media/staging/${OWNER}/avatars/${'d'.repeat(48)}.png`]
    ),
    (error) => error.code === 'INVALID_REQUEST'
  );
  assert.deepEqual(deleteCalls, []);
});

test('publishes an approved object, removes private staging, and makes repeats idempotent', async () => {
  const { service, copyCalls, deleteCalls } = harness();
  const reservation = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'png')
  );
  const stagingFileId = `cloud://env/${reservation.cloudPath}`;
  assert.deepEqual(
    await service.filesForReview({ ownerKey: OWNER }, 'comment', [stagingFileId]),
    [`cloud://env/user-media/review/comments/${OWNER}/${UPLOAD_ID}.png`]
  );

  const first = await service.publishOwned(
    { ownerKey: OWNER },
    'comment',
    [stagingFileId],
    COMMENT_REFERENCE
  );
  const repeated = await service.publishOwned(
    { ownerKey: OWNER },
    'comment',
    [stagingFileId],
    COMMENT_REFERENCE
  );
  assert.deepEqual(first, [
    `cloud://env/user-media/published/comments/${OWNER}/${UPLOAD_ID}.png`
  ]);
  assert.deepEqual(repeated, first);
  assert.equal(copyCalls.length, 2);
  assert.deepEqual(copyCalls[0].fileList[0], {
    srcPath: `user-media/staging/${OWNER}/comments/${UPLOAD_ID}.png`,
    dstPath: `user-media/review/comments/${OWNER}/${UPLOAD_ID}.png`,
    overwrite: false,
    removeOriginal: true
  });
  assert.deepEqual(copyCalls[1].fileList[0], {
    srcPath: `user-media/review/comments/${OWNER}/${UPLOAD_ID}.png`,
    dstPath: `user-media/published/comments/${OWNER}/${UPLOAD_ID}.png`,
    overwrite: false,
    removeOriginal: false
  });
  assert.deepEqual(deleteCalls, [[
    `cloud://env/user-media/review/comments/${OWNER}/${UPLOAD_ID}.png`,
    stagingFileId
  ]]);
});

test('recovers when the public copy succeeded before its database publication marker', async () => {
  const repository = memoryRepository();
  let markAttempts = 0;
  const originalMark = repository.markPublished;
  repository.markPublished = async (...args) => {
    markAttempts += 1;
    if (markAttempts === 1) return null;
    return originalMark(...args);
  };
  let copyAttempts = 0;
  const deleted = [];
  const service = createUserMediaService({
    repository,
    config: CONFIG,
    uploadFile: serverUpload,
    getTempFileURL: async () => ({ fileList: [] }),
    getFileInfo: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => {
        const record = repository.records.get(UPLOAD_ID);
        return {
          fileID,
          code: 'SUCCESS',
          mime: record.mimeType,
          size: record.sanitizedBytes
        };
      })
    }),
    copyFile: async () => ({
      fileList: [{ code: ++copyAttempts === 1 ? 'SUCCESS' : 'DESTINATION_EXISTS' }]
    }),
    deleteFiles: async (fileIds) => {
      deleted.push(...fileIds);
      return { deletedFileIds: fileIds, retryFileIds: [], uncertain: false };
    },
    now: () => NOW,
    createUploadId: () => UPLOAD_ID
  });
  const reservation = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const stagingFileId = `cloud://env/${reservation.cloudPath}`;
  assert.deepEqual(
    await service.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]),
    [`cloud://env/user-media/review/avatars/${OWNER}/${UPLOAD_ID}.jpg`]
  );

  await assert.rejects(
    () => service.publishOwned(
      { ownerKey: OWNER },
      'avatar',
      [stagingFileId],
      PROFILE_REFERENCE
    ),
    (error) => error && error.code === 'TEMPORARY_FAILURE'
  );
  assert.deepEqual(await service.publishOwned(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId],
    PROFILE_REFERENCE
  ), [`cloud://env/user-media/published/avatars/${OWNER}/${UPLOAD_ID}.jpg`]);
  assert.equal(copyAttempts, 3);
  assert.deepEqual(deleted, [
    `cloud://env/user-media/review/avatars/${OWNER}/${UPLOAD_ID}.jpg`,
    stagingFileId
  ]);
});

test('recovers a frozen review copy when its database marker failed', async () => {
  const repository = memoryRepository();
  const originalMark = repository.markReviewing;
  let markAttempts = 0;
  repository.markReviewing = async (...args) => {
    markAttempts += 1;
    if (markAttempts === 1) return null;
    return originalMark(...args);
  };
  let copyAttempts = 0;
  const reviewedIds = [];
  const service = createUserMediaService({
    repository,
    config: CONFIG,
    uploadFile: serverUpload,
    getTempFileURL: async () => ({ fileList: [] }),
    getFileInfo: async ({ fileList }) => {
      reviewedIds.push(...fileList);
      return {
        fileList: fileList.map((fileID) => {
          const record = repository.records.get(UPLOAD_ID);
          return {
            fileID,
            code: 'SUCCESS',
            mime: record.mimeType,
            size: record.sanitizedBytes
          };
        })
      };
    },
    copyFile: async () => ({
      fileList: [{ code: ++copyAttempts === 1 ? 'SUCCESS' : 'DESTINATION_EXISTS' }]
    }),
    deleteFiles: async (fileIds) => ({
      deletedFileIds: fileIds,
      retryFileIds: [],
      uncertain: false
    }),
    now: () => NOW,
    createUploadId: () => UPLOAD_ID
  });
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'png')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  const reviewFileId = `cloud://env/user-media/review/avatars/${OWNER}/${UPLOAD_ID}.png`;

  await assert.rejects(
    () => service.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]),
    (error) => error && error.code === 'TEMPORARY_FAILURE'
  );
  assert.deepEqual(
    await service.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]),
    [reviewFileId]
  );
  assert.equal(copyAttempts, 2);
  assert.deepEqual(reviewedIds, [reviewFileId, reviewFileId]);
});

test('moderation and publication use only the immutable review copy', async () => {
  const { service, copyCalls } = harness();
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  const reviewFileId = `cloud://env/user-media/review/comments/${OWNER}/${UPLOAD_ID}.jpg`;

  assert.deepEqual(
    await service.filesForReview({ ownerKey: OWNER }, 'comment', [stagingFileId]),
    [reviewFileId]
  );
  await service.publishOwned(
    { ownerKey: OWNER },
    'comment',
    [stagingFileId],
    COMMENT_REFERENCE
  );

  assert.equal(copyCalls[1].fileList[0].srcPath, `user-media/review/comments/${OWNER}/${UPLOAD_ID}.jpg`);
  assert.notEqual(copyCalls[1].fileList[0].srcPath, cloudPath);
});

test('rejects missing, oversized, or non-image uploads before moderation', async () => {
  const { service } = harness({
    getFileInfo: async ({ fileList }) => ({
      fileList: fileList.map((fileID) => ({
        fileID,
        code: 'SUCCESS',
        mime: 'text/html',
        size: 50 * 1024 * 1024
      }))
    })
  });
  const reservation = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'jpg')
  );
  await assert.rejects(
    () => service.filesForReview(
      { ownerKey: OWNER },
      'comment',
      [`cloud://env/${reservation.cloudPath}`]
    ),
    (error) => error.code === 'INVALID_REQUEST'
  );
});

test('keeps a pending avatar alive and resolves its review copy only for its owner', async () => {
  const { repository, service } = harness();
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  const [reviewFileId] = await service.filesForReview(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId]
  );

  await service.holdForReview(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId],
    7 * 24 * 60 * 60 * 1000
  );

  const record = repository.records.get(UPLOAD_ID);
  assert.ok(new Date(record.expiresAt).getTime() > NOW + (6 * 24 * 60 * 60 * 1000));
  assert.equal((await service.resolveVisible(
    [reviewFileId],
    { ownerKey: OWNER }
  )).length, 1);
  assert.deepEqual(await service.resolveVisible(
    [reviewFileId],
    { ownerKey: OTHER }
  ), []);
  assert.deepEqual(await service.resolveVisible([reviewFileId]), []);
});

test('does not issue a media URL until a successful business write binds the publication', async () => {
  const { service } = harness();
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await service.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]);
  const [publishedFileId] = await service.publishOwned(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId],
    PROFILE_REFERENCE
  );

  assert.deepEqual(await service.resolveVisible([publishedFileId]), []);
  await service.bindPublished({ ownerKey: OWNER }, 'avatar', [publishedFileId], {
    kind: 'profile',
    id: OWNER
  });
  const [visible] = await service.resolveVisible(
    [publishedFileId],
    { ownerKey: OWNER }
  );
  assert.equal(visible.fileId, publishedFileId);
  assert.match(visible.url, /^https:\/\//);
});

test('durably retries private-copy cleanup after an async profile publication is bound', async () => {
  const { repository, service, deleteCalls } = harness();
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await service.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]);
  const [publishedFileId] = await service.publishOwned(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId],
    PROFILE_REFERENCE,
    { keepPrivateCopies: true }
  );
  await service.bindPublished(
    { ownerKey: OWNER },
    'avatar',
    [publishedFileId],
    PROFILE_REFERENCE
  );

  assert.equal(repository.records.get(UPLOAD_ID).cleanupState, 'private-copies');
  assert.equal(repository.records.get(UPLOAD_ID).privateCopiesCleanupPending, true);
  assert.equal((await service.cleanupExpired()).repaired, 1);
  const cleaned = repository.records.get(UPLOAD_ID);
  assert.equal(cleaned.status, 'published');
  assert.equal(cleaned.cleanupPending, false);
  assert.equal(cleaned.privateCopiesCleanupPending, false);
  assert.deepEqual(deleteCalls.at(-1), [
    `cloud://env/user-media/review/avatars/${OWNER}/${UPLOAD_ID}.jpg`,
    stagingFileId
  ]);
});

test('a rejected retry cannot delete a publication already attached to the business record', async () => {
  const { service, deleteCalls } = harness();
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await service.filesForReview({ ownerKey: OWNER }, 'comment', [stagingFileId]);
  const [publishedFileId] = await service.publishOwned(
    { ownerKey: OWNER },
    'comment',
    [stagingFileId],
    COMMENT_REFERENCE
  );
  await service.bindPublished({ ownerKey: OWNER }, 'comment', [publishedFileId], {
    kind: 'comment',
    id: 'd'.repeat(64),
    itemId: 'item_test_01'
  });
  const cleanupCount = deleteCalls.length;

  assert.deepEqual(
    await service.discardUnpublished({ ownerKey: OWNER }, 'comment', [stagingFileId]),
    { deletedFileIds: [], retryFileIds: [], uncertain: false }
  );
  assert.equal(deleteCalls.length, cleanupCount);
  assert.deepEqual(await service.resolveVisible([publishedFileId]), []);
  assert.equal((await service.resolveVisible(
    [publishedFileId],
    { comments: true }
  )).length, 1);
});

test('resolves hidden and appealed managed comment media to its owner after membership expires', async () => {
  let status = 'active';
  const comment = {
    authorKey: OWNER,
    moderation: { status: 'approved' },
    attachments: []
  };
  const verifier = createUserMediaPublicationVerifier({
    profileRepository: { get: async () => null },
    engagementRepository: {
      getComment: async () => ({ comment: { ...comment, status } })
    }
  });
  const { service } = harness({ publicationVerifier: verifier });
  const { cloudPath } = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await service.filesForReview({ ownerKey: OWNER }, 'comment', [stagingFileId]);
  const [publishedFileId] = await service.publishOwned(
    { ownerKey: OWNER },
    'comment',
    [stagingFileId],
    COMMENT_REFERENCE
  );
  comment.attachments = [{ type: 'image', fileId: publishedFileId }];
  await service.bindPublished(
    { ownerKey: OWNER },
    'comment',
    [publishedFileId],
    COMMENT_REFERENCE
  );

  assert.deepEqual(await service.resolveVisible(
    [publishedFileId],
    { ownerKey: OWNER, comments: false }
  ), []);
  for (const privateStatus of ['hidden', 'appealed']) {
    status = privateStatus;
    assert.equal((await service.resolveVisible(
      [publishedFileId],
      { ownerKey: OWNER, comments: false }
    )).length, 1);
    assert.deepEqual(await service.resolveVisible(
      [publishedFileId],
      { ownerKey: OTHER, comments: false }
    ), []);
  }
  status = 'deleted';
  assert.deepEqual(await service.resolveVisible(
    [publishedFileId],
    { ownerKey: OWNER, comments: false }
  ), []);
});

test('keeps a durable cleanup request when deleting attached media is incomplete', async () => {
  let deletionFails = false;
  const runtime = harness({
    deleteFiles: async (fileIds) => deletionFails
      ? { deletedFileIds: [], retryFileIds: fileIds, uncertain: true }
      : { deletedFileIds: fileIds, retryFileIds: [], uncertain: false }
  });
  const { cloudPath } = await runtime.service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('comment', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await runtime.service.filesForReview({ ownerKey: OWNER }, 'comment', [stagingFileId]);
  const [publishedFileId] = await runtime.service.publishOwned(
    { ownerKey: OWNER },
    'comment',
    [stagingFileId],
    COMMENT_REFERENCE
  );
  await runtime.service.bindPublished(
    { ownerKey: OWNER },
    'comment',
    [publishedFileId],
    COMMENT_REFERENCE
  );

  deletionFails = true;
  const result = await runtime.service.deleteOwned(
    { ownerKey: OWNER },
    'comment',
    [publishedFileId]
  );
  assert.equal(result.uncertain, true);
  const pending = runtime.repository.records.get(UPLOAD_ID);
  assert.equal(pending.status, 'deleting');
  assert.equal(pending.cleanupPending, true);
  assert.equal(pending.businessBinding, null);
  assert.equal(pending.publicationIntent, null);

  deletionFails = false;
  assert.deepEqual(await runtime.service.cleanupExpired(), {
    scanned: 1,
    candidates: 1,
    deleted: 1,
    retry: 0,
    repaired: 0,
    reclaimed: 0
  });
  assert.equal(runtime.repository.records.get(UPLOAD_ID).status, 'deleted');
});

test('rejects spoofed image bytes before any server-side upload', async () => {
  let uploaded = false;
  const { service } = harness({
    uploadFile: async () => {
      uploaded = true;
      return {};
    }
  });
  await assert.rejects(
    () => service.reserveUpload({ ownerKey: OWNER }, {
      kind: 'avatar',
      extension: 'jpg',
      contentBase64: Buffer.from('<html>not an image</html>').toString('base64')
    }),
    (error) => error && error.code === 'INVALID_REQUEST'
  );
  assert.equal(uploaded, false);
});

test('scheduled cleanup removes expired unbound uploads but preserves attached publications', async () => {
  const { service, repository } = harness();
  const abandoned = await service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'png')
  );
  const abandonedRecord = repository.records.get(UPLOAD_ID);
  abandonedRecord.cleanupAfter = new Date(NOW - 1);
  for (let index = 0; index < 12; index += 1) {
    const uploadId = index.toString(16).padStart(48, '0');
    repository.records.set(uploadId, {
      ...abandonedRecord,
      uploadId,
      status: index % 2 ? 'published' : 'deleted',
      cleanupPending: false,
      cleanupAfter: null,
      businessBinding: index % 2
        ? { state: 'attached', kind: 'profile', referenceId: OWNER }
        : null
    });
  }

  assert.deepEqual(await service.cleanupExpired(), {
    scanned: 1,
    candidates: 1,
    deleted: 1,
    retry: 0,
    repaired: 0,
    reclaimed: 0
  });
  assert.equal(repository.records.get(UPLOAD_ID).status, 'deleted');
  assert.equal(abandoned.fileId.endsWith(`/${abandoned.cloudPath}`), true);
});

test('an uncertain server upload stays cleanup-pending until every deterministic path is removed', async () => {
  const { service, repository, deleteCalls } = harness({
    uploadFile: async () => {
      const error = new Error('response lost after storage accepted the object');
      throw error;
    }
  });
  await assert.rejects(
    () => service.reserveUpload({ ownerKey: OWNER }, mediaInput('comment', 'jpg')),
    (error) => error && error.code === 'TEMPORARY_FAILURE'
  );
  const pending = repository.records.get(UPLOAD_ID);
  assert.equal(pending.status, 'reserved');
  assert.equal(pending.cleanupPending, true);
  assert.equal(new Date(pending.cleanupAfter).getTime(), NOW);

  assert.equal((await service.cleanupExpired()).deleted, 1);
  assert.deepEqual(deleteCalls[0], [
    `cloud://env/user-media/published/comments/${OWNER}/${UPLOAD_ID}.jpg`,
    `cloud://env/user-media/review/comments/${OWNER}/${UPLOAD_ID}.jpg`,
    `cloud://env/user-media/staging/${OWNER}/comments/${UPLOAD_ID}.jpg`
  ]);
  assert.equal(repository.records.get(UPLOAD_ID).status, 'deleted');
  assert.equal(repository.records.get(UPLOAD_ID).cleanupPending, false);
});

test('cleanup claiming and business binding cannot both win for the same publication', async () => {
  let runtimeService;
  let interceptCleanup = false;
  let bindError = null;
  const runtime = harness({
    deleteFiles: async (fileIds) => {
      if (interceptCleanup) {
        try {
          await runtimeService.bindPublished(
            { ownerKey: OWNER },
            'avatar',
            [`cloud://env/user-media/published/avatars/${OWNER}/${UPLOAD_ID}.jpg`],
            { kind: 'profile', id: OWNER }
          );
        } catch (error) {
          bindError = error;
        }
      }
      return { deletedFileIds: fileIds, retryFileIds: [], uncertain: false };
    }
  });
  runtimeService = runtime.service;
  const { cloudPath } = await runtimeService.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await runtimeService.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]);
  await runtimeService.publishOwned(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId],
    PROFILE_REFERENCE
  );
  runtime.repository.records.get(UPLOAD_ID).cleanupAfter = new Date(NOW - 1);
  interceptCleanup = true;

  assert.equal((await runtimeService.cleanupExpired()).deleted, 1);
  assert.equal(bindError && bindError.code, 'TEMPORARY_FAILURE');
  assert.equal(runtime.repository.records.get(UPLOAD_ID).status, 'deleted');

  const bindingWins = harness();
  const second = await bindingWins.service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const secondStaging = `cloud://env/${second.cloudPath}`;
  await bindingWins.service.filesForReview({ ownerKey: OWNER }, 'avatar', [secondStaging]);
  const [secondPublished] = await bindingWins.service.publishOwned(
    { ownerKey: OWNER },
    'avatar',
    [secondStaging],
    PROFILE_REFERENCE
  );
  bindingWins.repository.records.get(UPLOAD_ID).cleanupAfter = new Date(NOW - 1);
  await bindingWins.service.bindPublished(
    { ownerKey: OWNER },
    'avatar',
    [secondPublished],
    { kind: 'profile', id: OWNER }
  );
  assert.deepEqual(await bindingWins.service.cleanupExpired(), {
    scanned: 0,
    candidates: 0,
    deleted: 0,
    retry: 0,
    repaired: 0,
    reclaimed: 0
  });
  assert.equal(bindingWins.repository.records.get(UPLOAD_ID).status, 'published');
});

test('cleanup repairs a publication when the business write succeeded before binding', async () => {
  const reference = { kind: 'profile', id: OWNER };
  const runtime = harness({
    publicationVerifier: {
      isAttached: async (record) => (
        record.publicationIntent.kind === 'profile'
        && record.publicationIntent.referenceId === OWNER
      )
    }
  });
  const { cloudPath } = await runtime.service.reserveUpload(
    { ownerKey: OWNER },
    mediaInput('avatar', 'jpg')
  );
  const stagingFileId = `cloud://env/${cloudPath}`;
  await runtime.service.filesForReview({ ownerKey: OWNER }, 'avatar', [stagingFileId]);
  const [publishedFileId] = await runtime.service.publishOwned(
    { ownerKey: OWNER },
    'avatar',
    [stagingFileId],
    reference
  );
  const cleanupCalls = runtime.deleteCalls.length;
  const published = runtime.repository.records.get(UPLOAD_ID);
  assert.equal(published.businessBinding, undefined);
  assert.equal(published.publicationIntent.referenceId, OWNER);
  published.cleanupAfter = new Date(NOW - 1);

  assert.deepEqual(await runtime.service.cleanupExpired(), {
    scanned: 1,
    candidates: 1,
    deleted: 0,
    retry: 0,
    repaired: 1,
    reclaimed: 0
  });
  const repaired = runtime.repository.records.get(UPLOAD_ID);
  assert.equal(repaired.status, 'published');
  assert.equal(repaired.businessBinding.state, 'attached');
  assert.equal(repaired.businessBinding.referenceId, OWNER);
  assert.equal(runtime.deleteCalls.length, cleanupCalls);
  assert.equal((await runtime.service.resolveVisible(
    [publishedFileId],
    { ownerKey: OWNER }
  )).length, 1);
});

test('cleanup repairs hidden and appealed comment publications but not deleted ones', async () => {
  const expectedFileId = `cloud://env/user-media/published/comments/${OWNER}/${UPLOAD_ID}.jpg`;
  const comment = {
    authorKey: OWNER,
    moderation: { status: 'approved' },
    attachments: [{ type: 'image', fileId: expectedFileId }]
  };

  for (const status of ['hidden', 'appealed']) {
    const verifier = createUserMediaPublicationVerifier({
      profileRepository: { get: async () => null },
      engagementRepository: {
        getComment: async (commentId, itemId) => {
          assert.equal(commentId, COMMENT_REFERENCE.id);
          assert.equal(itemId, COMMENT_REFERENCE.itemId);
          return { comment: { ...comment, status } };
        }
      }
    });
    const runtime = harness({ publicationVerifier: verifier });
    const { cloudPath } = await runtime.service.reserveUpload(
      { ownerKey: OWNER },
      mediaInput('comment', 'jpg')
    );
    const stagingFileId = `cloud://env/${cloudPath}`;
    await runtime.service.filesForReview(
      { ownerKey: OWNER },
      'comment',
      [stagingFileId]
    );
    const [publishedFileId] = await runtime.service.publishOwned(
      { ownerKey: OWNER },
      'comment',
      [stagingFileId],
      COMMENT_REFERENCE
    );
    assert.equal(publishedFileId, expectedFileId);
    const cleanupCalls = runtime.deleteCalls.length;
    runtime.repository.records.get(UPLOAD_ID).cleanupAfter = new Date(NOW - 1);

    assert.deepEqual(await runtime.service.cleanupExpired(), {
      scanned: 1,
      candidates: 1,
      deleted: 0,
      retry: 0,
      repaired: 1,
      reclaimed: 0
    }, `${status} comment publication should be repaired`);
    const repaired = runtime.repository.records.get(UPLOAD_ID);
    assert.equal(repaired.status, 'published');
    assert.equal(repaired.businessBinding.state, 'attached');
    assert.equal(repaired.businessBinding.referenceId, COMMENT_REFERENCE.id);
    assert.equal(repaired.businessBinding.itemId, COMMENT_REFERENCE.itemId);
    assert.equal(runtime.deleteCalls.length, cleanupCalls);
  }

  const deletedVerifier = createUserMediaPublicationVerifier({
    profileRepository: { get: async () => null },
    engagementRepository: {
      getComment: async () => ({
        comment: { ...comment, status: 'deleted' }
      })
    }
  });
  assert.equal(await deletedVerifier.isAttached({
    status: 'published',
    ownerKey: OWNER,
    publishedFileId: expectedFileId,
    publicationIntent: {
      kind: 'comment',
      referenceId: COMMENT_REFERENCE.id,
      itemId: COMMENT_REFERENCE.itemId
    }
  }), false);
});

test('cleanup reclaims an expired lease left behind by a crashed worker', async () => {
  const { service, repository } = harness();
  await service.reserveUpload({ ownerKey: OWNER }, mediaInput('comment', 'png'));
  const stranded = repository.records.get(UPLOAD_ID);
  stranded.cleanupPending = false;
  stranded.cleanupState = 'claimed';
  stranded.cleanupClaimId = 'abandoned-claim';
  stranded.cleanupClaimedAt = new Date(NOW - (20 * 60 * 1000));
  stranded.cleanupClaimExpiresAt = new Date(NOW - 1);

  assert.deepEqual(await service.cleanupExpired(), {
    scanned: 1,
    candidates: 1,
    deleted: 1,
    retry: 0,
    repaired: 0,
    reclaimed: 1
  });
  assert.equal(repository.records.get(UPLOAD_ID).status, 'deleted');
  assert.equal(repository.records.get(UPLOAD_ID).cleanupClaimId, '');
});

test('cleanup releases its lease and converges after database completion throws', async () => {
  const { service, repository } = harness();
  await service.reserveUpload({ ownerKey: OWNER }, mediaInput('avatar', 'jpg'));
  repository.records.get(UPLOAD_ID).cleanupAfter = new Date(NOW - 1);
  const markDeleted = repository.markDeleted;
  let completions = 0;
  repository.markDeleted = async (...args) => {
    completions += 1;
    if (completions === 1) throw new Error('database response lost');
    return markDeleted(...args);
  };

  const first = await service.cleanupExpired();
  assert.equal(first.deleted, 0);
  assert.equal(first.retry, 1);
  const released = repository.records.get(UPLOAD_ID);
  assert.equal(released.status, 'reserved');
  assert.equal(released.cleanupPending, true);
  assert.equal(released.cleanupState, 'retry');
  assert.equal(released.cleanupClaimId, '');

  released.cleanupAfter = new Date(NOW - 1);
  const second = await service.cleanupExpired();
  assert.equal(second.deleted, 1);
  assert.equal(second.retry, 0);
  assert.equal(repository.records.get(UPLOAD_ID).status, 'deleted');
});

test('legacy media resolves only after exact business-record authorization', async () => {
  const legacyAvatar = 'cloud://env/user-media/avatars/current.webp';
  const unrelated = 'cloud://env/user-media/avatars/unrelated.webp';
  const requested = [];
  const { service } = harness({
    publicationVerifier: {
      isAttached: async () => false,
      authorizedLegacyFileIds: async (fileIds, access) => {
        requested.push({ fileIds, access });
        return fileIds.filter((fileId) => fileId === legacyAvatar);
      }
    }
  });

  const resolved = await service.resolveVisible(
    [legacyAvatar, unrelated],
    { ownerKey: OWNER, comments: false }
  );
  assert.deepEqual(requested, [{
    fileIds: [legacyAvatar, unrelated],
    access: { ownerKey: OWNER, comments: false }
  }]);
  assert.deepEqual(resolved.map((entry) => entry.fileId), [legacyAvatar]);
});
