const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const { mapWithConcurrency } = require('../repositories/collection-support');
const { moderationApproved } = require('../policies/moderation-policy');

const ACTIVE_REVIEW_STATUSES = new Set(['pending', 'processing', 'retry']);
const DEFAULT_REVIEW_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_REVIEW_BATCH_SIZE = 6;
const DEFAULT_REVIEW_CONCURRENCY = 3;
const REVIEW_RETRY_DELAYS_MS = Object.freeze([
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000
]);

function normalizeNickname(value, maxLength = 24) {
  const nickname = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!nickname) throw new AppError('INVALID_REQUEST', '请填写昵称');
  if (nickname.length > maxLength) {
    throw new AppError('INVALID_REQUEST', `昵称最多 ${maxLength} 个字`);
  }
  return nickname;
}

function profileView(profile) {
  const approved = moderationApproved(profile && profile.moderation);
  const nickname = approved && typeof profile.nickname === 'string' ? profile.nickname : '';
  const avatarFileId = approved && typeof profile.avatarFileId === 'string'
    ? profile.avatarFileId
    : '';
  return {
    nickname,
    avatarFileId,
    initial: nickname ? [...nickname][0] : '读',
    isComplete: Boolean(nickname && avatarFileId)
  };
}

function reviewView(review) {
  if (!review || typeof review !== 'object') return { status: 'none' };
  if (ACTIVE_REVIEW_STATUSES.has(review.status)) {
    return {
      status: 'pending',
      nickname: typeof review.nickname === 'string' ? review.nickname : '',
      avatarFileId: typeof review.reviewAvatarFileId === 'string'
        ? review.reviewAvatarFileId
        : '',
      submittedAt: review.submittedAt || null
    };
  }
  if (review.status === 'rejected') {
    return {
      status: 'rejected',
      message: review.failureCode === 'MEDIA_EXPIRED'
        ? '待审核头像已失效，请重新选择头像后提交'
        : '头像或昵称未通过审核，请调整后重新提交',
      completedAt: review.completedAt || null
    };
  }
  if (review.status === 'failed') {
    return {
      status: 'rejected',
      message: '审核服务暂时不可用，请重新提交资料',
      completedAt: review.completedAt || null
    };
  }
  return { status: 'none' };
}

function ownerProfileView(profile, review) {
  return { ...profileView(profile), review: reviewView(review) };
}

function assertAvatarFileId(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 700) {
    throw new AppError('INVALID_REQUEST', '请选择有效的微信头像');
  }
  return value;
}

function retryDelay(attemptCount) {
  const index = Math.max(0, Math.min(
    REVIEW_RETRY_DELAYS_MS.length - 1,
    (Number(attemptCount) || 1) - 1
  ));
  return REVIEW_RETRY_DELAYS_MS[index];
}

function createUserProfileService({
  repository,
  reviewRepository,
  config,
  profileModerationService,
  userMediaService,
  logger = { warn: () => {} },
  now = () => Date.now(),
  createId = () => crypto.randomBytes(16).toString('hex')
}) {
  const reviewLeaseMs = Number(config.userProfileReviewLeaseMs)
    || DEFAULT_REVIEW_LEASE_MS;
  const reviewBatchSize = Number(config.userProfileReviewBatchSize)
    || DEFAULT_REVIEW_BATCH_SIZE;
  const reviewConcurrency = Number(config.userProfileReviewConcurrency)
    || DEFAULT_REVIEW_CONCURRENCY;
  const reviewMaxAttempts = Number(config.userProfileReviewMaxAttempts) || 8;
  const reviewMediaTtlMs = Number(config.userProfileReviewMediaTtlMs)
    || (7 * 24 * 60 * 60 * 1000);

  async function get(actor) {
    const [profile, review] = await Promise.all([
      repository.get(actor.ownerKey),
      reviewRepository.get(actor.ownerKey)
    ]);
    return { profile: ownerProfileView(profile, review) };
  }

  async function getStored(actor) {
    return repository.get(actor.ownerKey);
  }

  function reusablePendingAvatar(review, requestedAvatarFileId) {
    return review
      && ACTIVE_REVIEW_STATUSES.has(review.status)
      && review.avatarChanged === true
      && [review.requestedAvatarFileId, review.reviewAvatarFileId]
        .includes(requestedAvatarFileId);
  }

  async function save(payload, actor) {
    if (!reviewRepository) throw new Error('USER_PROFILE_REVIEW_REPOSITORY_REQUIRED');
    if (!userMediaService) throw new Error('USER_MEDIA_SERVICE_REQUIRED');
    const [current, currentReview] = await Promise.all([
      repository.get(actor.ownerKey),
      reviewRepository.get(actor.ownerKey)
    ]);
    const nickname = normalizeNickname(payload && payload.nickname);
    let requestedAvatarFileId = payload && payload.avatarFileId
      || current && current.avatarFileId;
    if (typeof requestedAvatarFileId !== 'string' || !requestedAvatarFileId
      || requestedAvatarFileId.length > 700) {
      throw new AppError('INVALID_REQUEST', '请选择有效的微信头像');
    }

    const reusingPendingAvatar = reusablePendingAvatar(
      currentReview,
      requestedAvatarFileId
    );
    let avatarChanged = reusingPendingAvatar
      || !current
      || current.avatarFileId !== requestedAvatarFileId;
    let reviewAvatarFileId = requestedAvatarFileId;
    let newCandidate = false;
    if (reusingPendingAvatar) {
      requestedAvatarFileId = currentReview.requestedAvatarFileId;
      reviewAvatarFileId = currentReview.reviewAvatarFileId;
    } else if (avatarChanged) {
      [reviewAvatarFileId] = await userMediaService.filesForReview(
        actor,
        'avatar',
        [requestedAvatarFileId]
      );
      newCandidate = true;
    }
    if (avatarChanged) {
      await userMediaService.holdForReview(
        actor,
        'avatar',
        [requestedAvatarFileId],
        reviewMediaTtlMs
      );
    }

    const submittedAt = new Date(now());
    const document = {
      ownerKey: actor.ownerKey,
      revision: createId(),
      status: 'pending',
      nickname,
      requestedAvatarFileId,
      reviewAvatarFileId,
      avatarChanged,
      attemptCount: 0,
      nextAttemptAt: submittedAt,
      claimId: '',
      claimedAt: null,
      claimExpiresAt: null,
      submittedAt,
      updatedAt: submittedAt
    };
    let submitted;
    try {
      submitted = await reviewRepository.submit(actor.ownerKey, document);
    } catch (error) {
      if (newCandidate) {
        await userMediaService.discardUnpublished(
          actor,
          'avatar',
          [requestedAvatarFileId]
        ).catch(() => null);
      }
      throw error;
    }

    const previous = submitted && submitted.current;
    if (previous
      && ACTIVE_REVIEW_STATUSES.has(previous.status)
      && previous.avatarChanged === true
      && previous.requestedAvatarFileId
      && previous.requestedAvatarFileId !== requestedAvatarFileId) {
      await userMediaService.discardUnpublished(
        actor,
        'avatar',
        [previous.requestedAvatarFileId]
      ).catch(() => null);
    }
    return { profile: ownerProfileView(current, document) };
  }

  async function rejectClaimed(review, claimId, failureCode) {
    const completedAt = new Date(now());
    const rejected = await reviewRepository.markRejected(
      review.ownerKey,
      review.revision,
      claimId,
      {
        status: 'rejected',
        failureCode,
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: null,
        completedAt,
        updatedAt: completedAt
      }
    );
    if (rejected && review.avatarChanged) {
      await userMediaService.discardUnpublished(
        { ownerKey: review.ownerKey },
        'avatar',
        [review.requestedAvatarFileId]
      ).catch(() => null);
    }
    return rejected;
  }

  async function retryClaimed(review, claimId, error) {
    if ((Number(review.attemptCount) || 0) >= reviewMaxAttempts) {
      const completedAt = new Date(now());
      const failed = await reviewRepository.markRejected(
        review.ownerKey,
        review.revision,
        claimId,
        {
          status: 'failed',
          failureCode: 'REVIEW_UNAVAILABLE',
          claimId: '',
          claimedAt: null,
          claimExpiresAt: null,
          nextAttemptAt: null,
          completedAt,
          updatedAt: completedAt
        }
      );
      if (failed && review.avatarChanged) {
        await userMediaService.discardUnpublished(
          { ownerKey: review.ownerKey },
          'avatar',
          [review.requestedAvatarFileId]
        ).catch(() => null);
      }
      return { status: 'failed' };
    }
    const retryAt = new Date(now() + retryDelay(review.attemptCount));
    const retried = await reviewRepository.markRetry(
      review.ownerKey,
      review.revision,
      claimId,
      {
        status: 'retry',
        failureCode: 'REVIEW_UNAVAILABLE',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: retryAt,
        updatedAt: new Date(now())
      }
    );
    if (retried && review.avatarChanged) {
      await userMediaService.holdForReview(
        { ownerKey: review.ownerKey },
        'avatar',
        [review.requestedAvatarFileId],
        reviewMediaTtlMs
      ).catch(() => null);
    }
    logger.warn('Profile review deferred', {
      code: error && error.code || 'UNKNOWN'
    });
    return { status: retried ? 'retry' : 'stale' };
  }

  async function processCandidate(candidate) {
    const claimedAt = new Date(now());
    const claimId = createId();
    const claimed = await reviewRepository.claim(
      candidate.ownerKey,
      candidate.revision,
      claimedAt,
      claimId,
      new Date(claimedAt.getTime() + reviewLeaseMs)
    );
    if (!claimed) return { status: 'skipped' };
    try {
      const moderation = await profileModerationService.review({
        nickname: claimed.nickname,
        avatarFileId: claimed.reviewAvatarFileId
      });
      const actor = { ownerKey: claimed.ownerKey };
      const avatarFileId = claimed.avatarChanged
        ? (await userMediaService.publishOwned(
          actor,
          'avatar',
          [claimed.requestedAvatarFileId],
          { kind: 'profile', id: claimed.ownerKey },
          { keepPrivateCopies: true }
        ))[0]
        : claimed.requestedAvatarFileId;
      const completedAt = new Date(now());
      const approved = await reviewRepository.approveAndSave(
        claimed.ownerKey,
        claimed.revision,
        claimId,
        {
          nickname: claimed.nickname,
          avatarFileId,
          moderation
        },
        completedAt
      );
      if (!approved || approved.applied !== true) return { status: 'stale' };

      const managedAvatar = userMediaService.isOwnedPublishedFileId(avatarFileId);
      let avatarReady = !managedAvatar;
      if (managedAvatar) {
        try {
          await userMediaService.bindPublished(actor, 'avatar', [avatarFileId], {
            kind: 'profile',
            id: claimed.ownerKey
          });
          avatarReady = true;
        } catch (error) {
          logger.warn('Approved profile avatar binding deferred', {
            code: error && error.code || 'UNKNOWN'
          });
        }
        if (avatarReady && typeof userMediaService.cleanupPublishedCopies === 'function') {
          await userMediaService.cleanupPublishedCopies(
            actor,
            'avatar',
            [avatarFileId]
          ).catch((error) => {
            logger.warn('Approved profile private media cleanup deferred', {
              code: error && error.code || 'UNKNOWN'
            });
          });
        }
      }
      const oldAvatar = approved.currentProfile && approved.currentProfile.avatarFileId;
      if (oldAvatar
        && oldAvatar !== avatarFileId
        && userMediaService.isOwnedPublishedFileId(oldAvatar)) {
        await userMediaService.deleteOwned(actor, 'avatar', [oldAvatar]).catch(() => null);
      }
      return { status: 'approved' };
    } catch (error) {
      if (error && error.code === 'CONTENT_REJECTED') {
        await rejectClaimed(claimed, claimId, 'CONTENT_REJECTED');
        return { status: 'rejected' };
      }
      if (error && error.code === 'INVALID_REQUEST') {
        await rejectClaimed(claimed, claimId, 'MEDIA_EXPIRED');
        return { status: 'rejected' };
      }
      return retryClaimed(claimed, claimId, error);
    }
  }

  async function processDue() {
    const dueAt = new Date(now());
    const [due, stale] = await Promise.all([
      reviewRepository.listDue(dueAt, reviewBatchSize),
      reviewRepository.listStaleClaims(dueAt, reviewBatchSize)
    ]);
    const candidatesByOwner = new Map();
    [...stale, ...due].forEach((review) => {
      if (review && review.ownerKey && !candidatesByOwner.has(review.ownerKey)) {
        candidatesByOwner.set(review.ownerKey, review);
      }
    });
    const candidates = [...candidatesByOwner.values()].slice(0, reviewBatchSize);
    const results = await mapWithConcurrency(
      candidates,
      reviewConcurrency,
      processCandidate
    );
    return results.reduce((summary, result) => {
      const status = result && result.status || 'skipped';
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, { scanned: candidates.length });
  }

  return { get, getStored, save, processDue };
}

module.exports = {
  ACTIVE_REVIEW_STATUSES,
  normalizeNickname,
  profileView,
  reviewView,
  ownerProfileView,
  retryDelay,
  assertAvatarFileId,
  createUserProfileService
};
