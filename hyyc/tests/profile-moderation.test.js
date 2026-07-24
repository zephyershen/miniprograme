const test = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../cloudfunctions/knowledgeFeed/lib/errors');
const {
  createProfileModerationService
} = require('../cloudfunctions/knowledgeFeed/services/profile-moderation-service');
const {
  createUserProfileService
} = require('../cloudfunctions/knowledgeFeed/services/user-profile-service');

const OWNER = 'a'.repeat(64);
const OLD_AVATAR = `cloud://env/user-media/published/avatars/${OWNER}/old.jpg`;
const STAGING_AVATAR = `cloud://env/user-media/staging/${OWNER}/avatars/new.jpg`;
const REVIEW_AVATAR = `cloud://env/user-media/review/avatars/${OWNER}/new.jpg`;
const PUBLISHED_AVATAR = `cloud://env/user-media/published/avatars/${OWNER}/new.jpg`;

function approvedProfile() {
  return {
    ownerKey: OWNER,
    nickname: '旧昵称',
    avatarFileId: OLD_AVATAR,
    moderation: { status: 'approved' },
    createdAt: new Date(0),
    updatedAt: new Date(0)
  };
}

function pendingReview(overrides = {}) {
  return {
    ownerKey: OWNER,
    revision: 'review-revision',
    status: 'pending',
    nickname: '新昵称',
    requestedAvatarFileId: STAGING_AVATAR,
    reviewAvatarFileId: REVIEW_AVATAR,
    avatarChanged: true,
    attemptCount: 0,
    nextAttemptAt: new Date(1000),
    submittedAt: new Date(1000),
    updatedAt: new Date(1000),
    ...overrides
  };
}

function serviceFor(overrides = {}) {
  return createUserProfileService({
    repository: {
      get: async () => approvedProfile(),
      ...(overrides.repository || {})
    },
    reviewRepository: {
      get: async () => null,
      submit: async (ownerKey, document) => ({ current: null, document }),
      listDue: async () => [],
      listStaleClaims: async () => [],
      ...(overrides.reviewRepository || {})
    },
    config: {
      userProfileReviewBatchSize: 3,
      userProfileReviewConcurrency: 1,
      userProfileReviewLeaseMs: 120000,
      userProfileReviewMediaTtlMs: 86400000
    },
    profileModerationService: overrides.profileModerationService || {
      review: async () => ({ status: 'approved' })
    },
    userMediaService: {
      filesForReview: async () => [REVIEW_AVATAR],
      holdForReview: async () => null,
      publishOwned: async () => [PUBLISHED_AVATAR],
      bindPublished: async () => null,
      discardUnpublished: async () => null,
      deleteOwned: async () => null,
      isOwnedPublishedFileId: () => true,
      ...(overrides.userMediaService || {})
    },
    now: overrides.now || (() => 1000),
    createId: overrides.createId || (() => 'generated-id')
  });
}

test('freezes and queues a profile review without calling the moderation model', async () => {
  let modelCalls = 0;
  let submitted;
  const held = [];
  const service = serviceFor({
    profileModerationService: {
      review: async () => {
        modelCalls += 1;
        return { status: 'approved' };
      }
    },
    reviewRepository: {
      get: async () => null,
      submit: async (ownerKey, document) => {
        submitted = document;
        return { current: null, document };
      }
    },
    userMediaService: {
      holdForReview: async (actor, kind, fileIds) => held.push(...fileIds)
    }
  });

  const result = await service.save({
    nickname: '  新 昵称  ',
    avatarFileId: STAGING_AVATAR
  }, { ownerKey: OWNER });

  assert.equal(modelCalls, 0);
  assert.equal(submitted.status, 'pending');
  assert.equal(submitted.nickname, '新 昵称');
  assert.equal(submitted.reviewAvatarFileId, REVIEW_AVATAR);
  assert.deepEqual(held, [STAGING_AVATAR]);
  assert.equal(result.profile.nickname, '旧昵称');
  assert.equal(result.profile.review.status, 'pending');
  assert.equal(result.profile.review.nickname, '新 昵称');
});

test('publishes and atomically swaps an approved claimed profile review', async () => {
  const calls = [];
  const review = pendingReview();
  const service = serviceFor({
    reviewRepository: {
      listDue: async () => [review],
      listStaleClaims: async () => [],
      claim: async () => ({ ...review, status: 'processing', attemptCount: 1 }),
      approveAndSave: async (ownerKey, revision, claimId, approved) => {
        calls.push(['approve', approved]);
        return { applied: true, currentProfile: approvedProfile(), profile: approved };
      }
    },
    profileModerationService: {
      review: async (input) => {
        calls.push(['review', input]);
        return { status: 'approved', provider: 'test' };
      }
    },
    userMediaService: {
      publishOwned: async (actor, kind, fileIds) => {
        calls.push(['publish', fileIds]);
        return [PUBLISHED_AVATAR];
      },
      bindPublished: async () => calls.push(['bind']),
      deleteOwned: async (actor, kind, fileIds) => calls.push(['delete', fileIds])
    }
  });

  const result = await service.processDue();

  assert.equal(result.approved, 1);
  assert.deepEqual(calls[0], ['review', {
    nickname: '新昵称',
    avatarFileId: REVIEW_AVATAR
  }]);
  assert.deepEqual(calls[1], ['publish', [STAGING_AVATAR]]);
  assert.equal(calls[2][0], 'approve');
  assert.deepEqual(calls.at(-1), ['delete', [OLD_AVATAR]]);
});

test('rejects unsafe profile candidates without replacing the approved profile', async () => {
  const review = pendingReview();
  const deleted = [];
  let approved = false;
  const service = serviceFor({
    reviewRepository: {
      listDue: async () => [review],
      listStaleClaims: async () => [],
      claim: async () => ({ ...review, status: 'processing', attemptCount: 1 }),
      markRejected: async () => ({ ...review, status: 'rejected' }),
      approveAndSave: async () => {
        approved = true;
      }
    },
    profileModerationService: {
      review: async () => {
        throw new AppError('CONTENT_REJECTED', 'unsafe');
      }
    },
    userMediaService: {
      discardUnpublished: async (actor, kind, fileIds) => deleted.push(...fileIds)
    }
  });

  const result = await service.processDue();

  assert.equal(result.rejected, 1);
  assert.equal(approved, false);
  assert.deepEqual(deleted, [STAGING_AVATAR]);
});

test('retries an unavailable review and keeps its immutable media on hold', async () => {
  const review = pendingReview();
  let retryPatch;
  const held = [];
  const service = serviceFor({
    reviewRepository: {
      listDue: async () => [review],
      listStaleClaims: async () => [],
      claim: async () => ({ ...review, status: 'processing', attemptCount: 1 }),
      markRetry: async (ownerKey, revision, claimId, patch) => {
        retryPatch = patch;
        return { ...review, ...patch };
      }
    },
    profileModerationService: {
      review: async () => {
        throw new AppError('CONTENT_REVIEW_UNAVAILABLE', 'temporary');
      }
    },
    userMediaService: {
      holdForReview: async (actor, kind, fileIds) => held.push(...fileIds)
    }
  });

  const result = await service.processDue();

  assert.equal(result.retry, 1);
  assert.equal(retryPatch.status, 'retry');
  assert.equal(new Date(retryPatch.nextAttemptAt).getTime(), 61000);
  assert.deepEqual(held, [STAGING_AVATAR]);
});

test('stops retrying an unavailable review after the bounded attempt limit', async () => {
  const review = pendingReview({ attemptCount: 7 });
  let failedPatch;
  const service = serviceFor({
    reviewRepository: {
      listDue: async () => [review],
      listStaleClaims: async () => [],
      claim: async () => ({ ...review, status: 'processing', attemptCount: 8 }),
      markRejected: async (ownerKey, revision, claimId, patch) => {
        failedPatch = patch;
        return { ...review, ...patch };
      }
    },
    profileModerationService: {
      review: async () => {
        throw new AppError('CONTENT_REVIEW_UNAVAILABLE', 'temporary');
      }
    }
  });

  const result = await service.processDue();

  assert.equal(result.failed, 1);
  assert.equal(failedPatch.status, 'failed');
  assert.equal(failedPatch.nextAttemptAt, null);
});

test('does not publish a profile when an allow verdict is uncertain', async () => {
  const moderation = createProfileModerationService({
    provider: {
      enabled: true,
      moderateProfile: async () => ({
        verdict: 'allow', confidence: 0.4, categories: ['other']
      })
    },
    getTempFileURL: async () => ({
      fileList: [{ status: 0, tempFileURL: 'https://temporary.example/avatar.jpg' }]
    })
  });
  await assert.rejects(
    () => moderation.review({
      nickname: '昵称', avatarFileId: REVIEW_AVATAR
    }),
    (error) => error.code === 'CONTENT_REVIEW_UNAVAILABLE'
  );
});
