const crypto = require('node:crypto');
const { storedDocumentId } = require('../lib/stored-feed-item');
const {
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');

function moderationMissing(document) {
  return Boolean(document) && (document.moderation === undefined || document.moderation === null);
}

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

async function documentOrNull(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createModerationBackfillRepository(db, config) {
  const ensureComments = createCollectionEnsurer(db, config.commentsCollectionName);
  const ensureProfiles = createCollectionEnsurer(db, config.userProfilesCollectionName);
  const ensureItems = createCollectionEnsurer(db, config.itemsCollectionName);

  function collectionName(kind) {
    if (kind === 'comments') return config.commentsCollectionName;
    if (kind === 'profiles') return config.userProfilesCollectionName;
    throw new Error('MODERATION_BACKFILL_KIND_INVALID');
  }

  async function ensureKind(kind) {
    return kind === 'comments' ? ensureComments() : ensureProfiles();
  }

  async function list(kind, cursor = '', limit = 100) {
    await ensureKind(kind);
    const size = Math.max(1, Math.min(200, Number(limit) || 100));
    let query = db.collection(collectionName(kind));
    if (cursor) query = query.where({ _id: db.command.gt(cursor) });
    const response = await query.orderBy('_id', 'asc').limit(size).get();
    return (response && response.data) || [];
  }

  async function claim(kind, id, options) {
    await Promise.all([ensureKind(kind), kind === 'comments' ? ensureItems() : null]);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(collectionName(kind)).doc(id);
      const document = await documentOrNull(reference);
      if (!moderationMissing(document)) return { state: 'skipped', reason: 'already-reviewed' };
      if (kind === 'comments' && document.status === 'deleted') {
        return { state: 'skipped', reason: 'not-public' };
      }
      const previous = document.moderationBackfill || {};
      const leaseUntil = previous.leaseUntil ? new Date(previous.leaseUntil).getTime() : 0;
      if (previous.state === 'reviewing' && leaseUntil > options.startedAt.getTime()) {
        return { state: 'locked' };
      }
      const nextAttemptAt = previous.nextAttemptAt ? new Date(previous.nextAttemptAt).getTime() : 0;
      if (previous.state === 'retry' && nextAttemptAt > options.startedAt.getTime()) {
        return { state: 'deferred' };
      }

      let countAdjusted = previous.countAdjusted === true;
      if (kind === 'comments' && !countAdjusted
        && (document.status === 'active' || document.status === undefined)) {
        const itemReference = transaction.collection(config.itemsCollectionName)
          .doc(storedDocumentId(config.provider, document.itemId));
        const item = await documentOrNull(itemReference);
        if (item) {
          await itemReference.update({
            data: {
              commentCount: Math.max(0, count(item.commentCount) - 1),
              engagementUpdatedAt: options.startedAt
            }
          });
          countAdjusted = true;
        }
      }

      await reference.update({
        data: {
          ...(kind === 'comments' ? { status: 'moderation_pending' } : {}),
          moderationBackfill: {
            state: 'reviewing',
            attemptId: options.attemptId,
            startedAt: options.startedAt,
            leaseUntil: options.leaseUntil,
            nextAttemptAt: null,
            lastErrorCode: '',
            countAdjusted
          },
          moderationUpdatedAt: options.startedAt
        }
      });
      return { state: 'claimed', document, countAdjusted };
    });
  }

  async function finalize(kind, id, attemptId, outcome) {
    await Promise.all([ensureKind(kind), kind === 'comments' ? ensureItems() : null]);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(collectionName(kind)).doc(id);
      const document = await documentOrNull(reference);
      const backfill = document && document.moderationBackfill || {};
      if (!document || !moderationMissing(document) || backfill.attemptId !== attemptId) {
        return { state: 'superseded' };
      }
      if (kind === 'comments' && document.status === 'deleted') {
        return { state: 'superseded' };
      }

      if (outcome.state === 'approved' && kind === 'comments' && backfill.countAdjusted === true) {
        const itemReference = transaction.collection(config.itemsCollectionName)
          .doc(storedDocumentId(config.provider, document.itemId));
        const item = await documentOrNull(itemReference);
        if (item) {
          await itemReference.update({
            data: {
              commentCount: count(item.commentCount) + 1,
              engagementUpdatedAt: outcome.completedAt
            }
          });
        }
      }

      const data = {
        moderationUpdatedAt: outcome.completedAt,
        moderationBackfill: outcome.state === 'pending'
          ? {
              state: 'retry',
              attemptId: '',
              startedAt: backfill.startedAt || null,
              leaseUntil: null,
              nextAttemptAt: outcome.nextAttemptAt,
              lastErrorCode: outcome.errorCode,
              countAdjusted: backfill.countAdjusted === true
            }
          : null
      };
      if (outcome.state === 'approved') {
        data.moderation = outcome.moderation;
        if (kind === 'comments') data.status = 'active';
      } else if (outcome.state === 'rejected') {
        data.moderation = outcome.moderation;
        if (kind === 'comments') data.status = 'moderation_rejected';
      } else if (kind === 'comments') {
        data.status = 'moderation_pending';
      }
      await reference.update({ data });
      return { state: outcome.state };
    });
  }

  return { list, claim, finalize };
}

function createAttemptId(kind, id, now = Date.now()) {
  return crypto.createHash('sha256').update(`${kind}:${id}:${now}:${crypto.randomBytes(12)}`).digest('hex');
}

module.exports = {
  moderationMissing,
  createAttemptId,
  createModerationBackfillRepository
};
