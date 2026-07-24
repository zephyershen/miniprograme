const crypto = require('node:crypto');
const { mapWithConcurrency } = require('../repositories/collection-support');

const RETRY_DELAYS_MS = Object.freeze([
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  3 * 60 * 60 * 1000
]);

function retryDelay(attemptCount) {
  const index = Math.max(0, Math.min(
    RETRY_DELAYS_MS.length - 1,
    (Number(attemptCount) || 1) - 1
  ));
  return RETRY_DELAYS_MS[index];
}

function createCommentReviewService({
  repository,
  moderationService,
  userMediaService,
  config,
  logger = { warn: () => {} },
  now = () => Date.now(),
  createId = () => crypto.randomBytes(16).toString('hex')
}) {
  const batchSize = Number(config.commentReviewBatchSize) || 8;
  const concurrency = Number(config.commentReviewConcurrency) || 3;
  const leaseMs = Number(config.commentReviewLeaseMs) || (2 * 60 * 1000);
  const maxAttempts = Number(config.commentReviewMaxAttempts) || 8;
  const mediaTtlMs = Number(config.commentReviewMediaTtlMs)
    || (7 * 24 * 60 * 60 * 1000);

  async function discard(comment) {
    const fileIds = (comment.attachments || [])
      .map((attachment) => attachment && attachment.fileId)
      .filter(Boolean);
    if (fileIds.length) {
      await userMediaService.discardUnpublished(
        { ownerKey: comment.authorKey },
        'comment',
        fileIds
      ).catch(() => null);
    }
  }

  async function reject(comment, claimId, failureCode, reviewState = 'rejected') {
    const completedAt = new Date(now());
    const rejected = await repository.reject(
      comment._id,
      comment.reviewRevision,
      claimId,
      { failureCode, reviewState },
      completedAt
    );
    if (rejected) await discard(comment);
    return rejected;
  }

  async function retry(comment, claimId, error) {
    if ((Number(comment.attemptCount) || 0) >= maxAttempts) {
      await reject(comment, claimId, 'REVIEW_UNAVAILABLE', 'failed');
      return { status: 'failed' };
    }
    const retryAt = new Date(now() + retryDelay(comment.attemptCount));
    const retried = await repository.markRetry(
      comment._id,
      comment.reviewRevision,
      claimId,
      {
        reviewState: 'retry',
        failureCode: 'REVIEW_UNAVAILABLE',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: retryAt,
        updatedAt: new Date(now())
      }
    );
    if (retried) {
      const fileIds = (comment.attachments || [])
        .map((attachment) => attachment && attachment.fileId)
        .filter(Boolean);
      if (fileIds.length) {
        await userMediaService.holdForReview(
          { ownerKey: comment.authorKey },
          'comment',
          fileIds,
          mediaTtlMs
        ).catch(() => null);
      }
    }
    logger.warn('Comment review deferred', {
      code: error && error.code || 'UNKNOWN'
    });
    return { status: retried ? 'retry' : 'stale' };
  }

  async function processCandidate(candidate) {
    const claimedAt = new Date(now());
    const claimId = createId();
    const claimed = await repository.claim(
      candidate._id,
      candidate.reviewRevision,
      claimedAt,
      claimId,
      new Date(claimedAt.getTime() + leaseMs)
    );
    if (!claimed) return { status: 'skipped' };
    try {
      const moderation = await moderationService.review({
        content: claimed.content,
        attachments: claimed.reviewAttachments || []
      });
      const actor = { ownerKey: claimed.authorKey };
      const requestedFileIds = (claimed.attachments || [])
        .map((attachment) => attachment && attachment.fileId)
        .filter(Boolean);
      const publishedFileIds = requestedFileIds.length
        ? await userMediaService.publishOwned(
          actor,
          'comment',
          requestedFileIds,
          { kind: 'comment', id: claimed._id, itemId: claimed.itemId },
          { keepPrivateCopies: true }
        )
        : [];
      let publishedIndex = 0;
      const attachments = (claimed.attachments || []).map((attachment) => {
        if (!attachment || !attachment.fileId) return attachment;
        const value = { ...attachment, fileId: publishedFileIds[publishedIndex] };
        publishedIndex += 1;
        return value;
      });
      const approved = await repository.approve(
        claimed._id,
        claimed.reviewRevision,
        claimId,
        { attachments, moderation },
        new Date(now())
      );
      if (!approved) {
        // A newer worker may have published and bound the same deterministic object.
        // Leave an unbound stale copy to the existing media cleanup journal instead
        // of risking deletion of the winning worker's approved attachment.
        return { status: 'stale' };
      }
      if (publishedFileIds.length) {
        let bound = false;
        try {
          await userMediaService.bindPublished(actor, 'comment', publishedFileIds, {
            kind: 'comment',
            id: claimed._id,
            itemId: claimed.itemId
          });
          bound = true;
        } catch (error) {
          logger.warn('Approved comment media binding deferred', {
            code: error && error.code || 'UNKNOWN'
          });
        }
        if (bound && typeof userMediaService.cleanupPublishedCopies === 'function') {
          await userMediaService.cleanupPublishedCopies(
            actor,
            'comment',
            publishedFileIds
          ).catch((error) => {
            logger.warn('Approved comment private media cleanup deferred', {
              code: error && error.code || 'UNKNOWN'
            });
          });
        }
      }
      return { status: 'approved' };
    } catch (error) {
      if (error && error.code === 'CONTENT_REJECTED') {
        await reject(claimed, claimId, 'CONTENT_REJECTED');
        return { status: 'rejected' };
      }
      if (error && ['INVALID_REQUEST', 'ITEM_NOT_FOUND'].includes(error.code)) {
        await reject(claimed, claimId, error.code);
        return { status: 'rejected' };
      }
      return retry(claimed, claimId, error);
    }
  }

  async function processDue() {
    const dueAt = new Date(now());
    const [due, stale] = await Promise.all([
      repository.listDue(dueAt, batchSize),
      repository.listStaleClaims(dueAt, batchSize)
    ]);
    const candidates = [...new Map([...stale, ...due]
      .filter((comment) => comment && comment._id)
      .map((comment) => [comment._id, comment])).values()]
      .slice(0, batchSize);
    const results = await mapWithConcurrency(candidates, concurrency, processCandidate);
    return results.reduce((summary, result) => {
      const status = result && result.status || 'skipped';
      summary[status] = (summary[status] || 0) + 1;
      return summary;
    }, { scanned: candidates.length });
  }

  return { processDue };
}

module.exports = { retryDelay, createCommentReviewService };
