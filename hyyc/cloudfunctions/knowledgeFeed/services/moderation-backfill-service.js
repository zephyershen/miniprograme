const { AppError } = require('../lib/errors');
const { maintenanceAuthorized } = require('../policies/maintenance-auth');
const { moderationMissing, createAttemptId } = require('../repositories/moderation-backfill');

const KINDS = Object.freeze(['comments', 'profiles']);

function emptyStats(kind) {
  return {
    kind,
    scanned: 0,
    claimed: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
    locked: 0,
    skipped: 0,
    nextCursor: '',
    done: true
  };
}

function approvedModeration(result, reviewedAt) {
  return {
    ...(result || {}),
    status: 'approved',
    verdict: 'allow',
    reviewedAt: result && result.reviewedAt || reviewedAt
  };
}

function rejectedModeration(error, reviewedAt) {
  return {
    status: 'rejected',
    verdict: 'reject',
    reasonCode: error && error.code || 'CONTENT_REJECTED',
    reviewedAt
  };
}

function createModerationBackfillService({
  repository,
  commentModerationService,
  profileModerationService,
  maintenanceToken,
  now = () => Date.now(),
  retryDelayMs = 5 * 60 * 1000,
  leaseMs = 4 * 60 * 1000
}) {
  function authorize(token) {
    if (!maintenanceAuthorized(token, maintenanceToken)) {
      throw new AppError('AUTH_REQUIRED', '该操作仅供云端维护');
    }
  }

  async function review(kind, document) {
    if (kind === 'comments') {
      return commentModerationService.review({
        content: document.content || '',
        attachments: Array.isArray(document.attachments) ? document.attachments : []
      });
    }
    return profileModerationService.review({
      nickname: document.nickname || '',
      avatarFileId: document.avatarFileId || ''
    });
  }

  async function processDocument(kind, document, stats) {
    if (!moderationMissing(document)) {
      stats.skipped += 1;
      return;
    }
    const startedAt = new Date(now());
    const attemptId = createAttemptId(kind, document._id, startedAt.getTime());
    const claim = await repository.claim(kind, document._id, {
      attemptId,
      startedAt,
      leaseUntil: new Date(startedAt.getTime() + leaseMs)
    });
    if (claim.state !== 'claimed') {
      if (claim.state === 'locked' || claim.state === 'deferred') stats.locked += 1;
      else stats.skipped += 1;
      return;
    }
    stats.claimed += 1;
    try {
      const moderation = await review(kind, claim.document);
      const completedAt = new Date(now());
      const finalized = await repository.finalize(kind, document._id, attemptId, {
        state: 'approved',
        moderation: approvedModeration(moderation, completedAt),
        completedAt
      });
      if (finalized.state === 'approved') stats.approved += 1;
      else stats.skipped += 1;
    } catch (error) {
      const completedAt = new Date(now());
      if (error && error.code === 'CONTENT_REJECTED') {
        const finalized = await repository.finalize(kind, document._id, attemptId, {
          state: 'rejected',
          moderation: rejectedModeration(error, completedAt),
          completedAt
        });
        if (finalized.state === 'rejected') stats.rejected += 1;
        else stats.skipped += 1;
        return;
      }
      const errorCode = error && /^[A-Z0-9_]{3,80}$/.test(error.code || '')
        ? error.code
        : 'CONTENT_REVIEW_UNAVAILABLE';
      const finalized = await repository.finalize(kind, document._id, attemptId, {
        state: 'pending',
        errorCode,
        completedAt,
        nextAttemptAt: new Date(completedAt.getTime() + retryDelayMs)
      });
      if (finalized.state === 'pending') stats.pending += 1;
      else stats.skipped += 1;
    }
  }

  async function processKind(kind, cursor, limit) {
    const stats = emptyStats(kind);
    const scanLimit = Math.min(200, Math.max(50, limit * 10));
    const documents = await repository.list(kind, cursor, scanLimit);
    let processed = 0;
    let exhaustedPage = true;
    for (const document of documents) {
      if (processed >= limit) {
        exhaustedPage = false;
        break;
      }
      stats.scanned += 1;
      stats.nextCursor = document._id;
      if (moderationMissing(document)) processed += 1;
      await processDocument(kind, document, stats);
    }
    stats.done = exhaustedPage && documents.length < scanLimit;
    if (stats.done) stats.nextCursor = '';
    return stats;
  }

  async function run(event = {}) {
    authorize(event.token);
    const limit = Math.max(1, Math.min(25, Number(event.limit) || 10));
    const requestedKind = KINDS.includes(event.kind) ? event.kind : 'all';
    const cursors = event.cursor && typeof event.cursor === 'object' ? event.cursor : {};
    const result = {};
    for (const kind of KINDS) {
      result[kind] = requestedKind === 'all' || requestedKind === kind
        ? await processKind(kind, typeof cursors[kind] === 'string' ? cursors[kind] : '', limit)
        : emptyStats(kind);
    }
    return {
      ...result,
      totals: KINDS.reduce((totals, kind) => {
        for (const key of ['scanned', 'claimed', 'approved', 'rejected', 'pending', 'locked', 'skipped']) {
          totals[key] += result[kind][key];
        }
        return totals;
      }, { scanned: 0, claimed: 0, approved: 0, rejected: 0, pending: 0, locked: 0, skipped: 0 }),
      nextCursor: {
        comments: result.comments.nextCursor,
        profiles: result.profiles.nextCursor
      },
      done: result.comments.done && result.profiles.done
    };
  }

  return { run };
}

module.exports = {
  emptyStats,
  approvedModeration,
  rejectedModeration,
  createModerationBackfillService
};
