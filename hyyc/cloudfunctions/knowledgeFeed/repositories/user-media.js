const {
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');
const { runBusyTransaction } = require('./transaction-support');

function sameBusinessReference(left, right) {
  return Boolean(left && right
    && left.kind === right.kind
    && left.referenceId === right.referenceId
    && (left.kind !== 'comment' || left.itemId === right.itemId));
}

function createUserMediaRepository(db, config) {
  const collection = () => db.collection(config.userMediaCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.userMediaCollectionName);

  async function get(uploadId) {
    await ensureCollection();
    try {
      return (await collection().doc(uploadId).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function transactionDocumentOrNull(reference) {
    try {
      return (await reference.get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function reserve(document) {
    await ensureCollection();
    await runBusyTransaction(db, async (transaction) => {
      const uploadReference = transaction.collection(config.userMediaCollectionName)
        .doc(document.uploadId);
      if (await transactionDocumentOrNull(uploadReference)) {
        throw new Error('USER_MEDIA_UPLOAD_ID_COLLISION');
      }
      await uploadReference.set({ data: document });
    });
    return document;
  }

  async function listExpired(expiresAt, limit = config.userMediaCleanupBatchSize) {
    await ensureCollection();
    const size = Math.max(1, Math.min(50, Number(limit) || 10));
    const response = await collection()
      .where({ cleanupAfter: db.command.lte(expiresAt) })
      .orderBy('cleanupAfter', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function listStaleCleanupClaims(expiresAt, limit = config.userMediaCleanupBatchSize) {
    await ensureCollection();
    const size = Math.max(1, Math.min(50, Number(limit) || 10));
    const response = await collection()
      .where({ cleanupClaimExpiresAt: db.command.lte(expiresAt) })
      .orderBy('cleanupClaimExpiresAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function transitionOwned(uploadId, ownerKey, allowedStatuses, patch, extraFilter = {}) {
    await ensureCollection();
    const response = await collection().where({
      _id: uploadId,
      ownerKey,
      status: db.command.in(allowedStatuses),
      ...extraFilter
    }).update({ data: patch });
    const updated = Number(response && response.stats && response.stats.updated) || 0;
    if (updated !== 1) return null;
    return get(uploadId);
  }

  async function markBound(uploadId, ownerKey, patch) {
    const updated = await transitionOwned(
      uploadId,
      ownerKey,
      ['published'],
      patch,
      { cleanupPending: true }
    );
    if (updated) return updated;
    const current = await get(uploadId);
    const expected = patch && patch.businessBinding;
    const actual = current && current.businessBinding;
    return current
      && current.ownerKey === ownerKey
      && current.status === 'published'
      && actual
      && expected
      && actual.state === 'attached'
      && sameBusinessReference(actual, expected)
      ? current
      : null;
  }

  async function recordPublicationIntent(uploadId, ownerKey, publicationIntent, patch) {
    await ensureCollection();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(config.userMediaCollectionName).doc(uploadId);
      const current = await transactionDocumentOrNull(reference);
      if (!current || current.ownerKey !== ownerKey || current.status !== 'published') return null;
      if (current.businessBinding && current.businessBinding.state === 'attached') {
        return sameBusinessReference(current.businessBinding, publicationIntent) ? current : null;
      }
      if (current.publicationIntent) {
        return sameBusinessReference(current.publicationIntent, publicationIntent)
          ? current
          : null;
      }
      if (current.cleanupPending !== true) return null;
      await reference.update({ data: { ...patch, publicationIntent } });
      return { ...current, ...patch, publicationIntent };
    });
  }

  async function requestDeletion(uploadId, ownerKey, patch) {
    return transitionOwned(
      uploadId,
      ownerKey,
      ['reserved', 'reviewing', 'published', 'deleting'],
      patch
    );
  }

  async function claimCleanup(uploadId, ownerKey, claimedAt, claimId, claimExpiresAt) {
    return transitionOwned(
      uploadId,
      ownerKey,
      ['reserved', 'reviewing', 'published', 'deleting'],
      {
        cleanupPending: false,
        cleanupAfter: null,
        cleanupState: 'claimed',
        cleanupClaimId: claimId,
        cleanupClaimedAt: claimedAt,
        cleanupClaimExpiresAt: claimExpiresAt,
        updatedAt: claimedAt
      },
      {
        cleanupPending: true,
        cleanupAfter: db.command.lte(claimedAt)
      }
    );
  }

  async function reclaimCleanup(uploadId, ownerKey, claimedAt, claimId, claimExpiresAt) {
    return transitionOwned(
      uploadId,
      ownerKey,
      ['reserved', 'reviewing', 'published', 'deleting'],
      {
        cleanupPending: false,
        cleanupAfter: null,
        cleanupState: 'claimed',
        cleanupClaimId: claimId,
        cleanupClaimedAt: claimedAt,
        cleanupClaimExpiresAt: claimExpiresAt,
        updatedAt: claimedAt
      },
      {
        cleanupState: 'claimed',
        cleanupClaimExpiresAt: db.command.lte(claimedAt)
      }
    );
  }

  async function bindClaimed(uploadId, ownerKey, claimId, patch) {
    await ensureCollection();
    const response = await collection().where({
      _id: uploadId,
      ownerKey,
      status: 'published',
      cleanupState: 'claimed',
      cleanupClaimId: claimId
    }).update({
      data: {
        ...patch,
        cleanupPending: false,
        cleanupAfter: null,
        cleanupState: 'attached',
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null
      }
    });
    const updated = Number(response && response.stats && response.stats.updated) || 0;
    return updated === 1 ? get(uploadId) : null;
  }

  async function releaseCleanup(uploadId, ownerKey, claimId, retryAt) {
    await ensureCollection();
    const response = await collection().where({
      _id: uploadId,
      ownerKey,
      cleanupState: 'claimed',
      cleanupClaimId: claimId
    }).update({
      data: {
        cleanupPending: true,
        cleanupState: 'retry',
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null,
        cleanupAfter: retryAt,
        updatedAt: retryAt
      }
    });
    const updated = Number(response && response.stats && response.stats.updated) || 0;
    return updated === 1 ? get(uploadId) : null;
  }

  return {
    get,
    reserve,
    listExpired,
    listStaleCleanupClaims,
    claimCleanup,
    reclaimCleanup,
    bindClaimed,
    releaseCleanup,
    markReviewing: (uploadId, ownerKey, patch) => (
      transitionOwned(uploadId, ownerKey, ['reserved', 'reviewing'], patch)
    ),
    markPublished: (uploadId, ownerKey, patch) => (
      transitionOwned(uploadId, ownerKey, ['reviewing', 'published'], patch)
    ),
    markBound,
    recordPublicationIntent,
    requestDeletion,
    scheduleCleanup: (uploadId, ownerKey, patch) => (
      transitionOwned(
        uploadId,
        ownerKey,
        ['reserved', 'reviewing', 'published'],
        patch,
        { cleanupState: db.command.neq('claimed') }
      )
    ),
    markDeleted: (uploadId, ownerKey, patch, claimId = '') => (
      transitionOwned(uploadId, ownerKey, ['reserved', 'reviewing', 'published', 'deleting'], {
        cleanupPending: false,
        cleanupAfter: null,
        cleanupClaimId: '',
        cleanupClaimedAt: null,
        cleanupClaimExpiresAt: null,
        ...patch
      }, claimId ? {
        cleanupState: 'claimed',
        cleanupClaimId: claimId
      } : {})
    )
  };
}

module.exports = {
  sameBusinessReference,
  createUserMediaRepository
};
