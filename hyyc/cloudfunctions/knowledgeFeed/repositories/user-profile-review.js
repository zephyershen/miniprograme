const {
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');
const { runBusyTransaction } = require('./transaction-support');

function timestamp(value) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

function createUserProfileReviewRepository(db, config) {
  const collectionName = config.userProfileReviewsCollectionName;
  const profilesCollectionName = config.userProfilesCollectionName;
  const collection = () => db.collection(collectionName);
  const ensureCollection = createCollectionEnsurer(db, collectionName);
  const ensureProfilesCollection = createCollectionEnsurer(db, profilesCollectionName);

  async function transactionDocumentOrNull(reference) {
    try {
      return (await reference.get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function get(ownerKey) {
    await ensureCollection();
    try {
      return (await collection().doc(ownerKey).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function submit(ownerKey, document) {
    await ensureCollection();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(collectionName).doc(ownerKey);
      const current = await transactionDocumentOrNull(reference);
      await reference.set({ data: document });
      return { current, document };
    });
  }

  async function listDue(dueAt, limit = config.userProfileReviewBatchSize) {
    await ensureCollection();
    const size = Math.max(1, Math.min(20, Number(limit) || 6));
    const response = await collection()
      .where({
        status: db.command.in(['pending', 'retry']),
        nextAttemptAt: db.command.lte(dueAt)
      })
      .orderBy('nextAttemptAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function listStaleClaims(dueAt, limit = config.userProfileReviewBatchSize) {
    await ensureCollection();
    const size = Math.max(1, Math.min(20, Number(limit) || 6));
    const response = await collection()
      .where({
        status: 'processing',
        claimExpiresAt: db.command.lte(dueAt)
      })
      .orderBy('claimExpiresAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function claim(ownerKey, revision, claimedAt, claimId, claimExpiresAt) {
    await ensureCollection();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(collectionName).doc(ownerKey);
      const current = await transactionDocumentOrNull(reference);
      if (!current || current.revision !== revision) return null;
      const due = ['pending', 'retry'].includes(current.status)
        && timestamp(current.nextAttemptAt) <= timestamp(claimedAt);
      const stale = current.status === 'processing'
        && timestamp(current.claimExpiresAt) <= timestamp(claimedAt);
      if (!due && !stale) return null;
      const patch = {
        status: 'processing',
        attemptCount: (Number(current.attemptCount) || 0) + 1,
        claimId,
        claimedAt,
        claimExpiresAt,
        updatedAt: claimedAt
      };
      await reference.update({ data: patch });
      return { ...current, ...patch };
    });
  }

  async function transitionClaimed(ownerKey, revision, claimId, patch) {
    await ensureCollection();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(collectionName).doc(ownerKey);
      const current = await transactionDocumentOrNull(reference);
      if (!current
        || current.revision !== revision
        || current.status !== 'processing'
        || current.claimId !== claimId) return null;
      await reference.update({ data: patch });
      return { ...current, ...patch };
    });
  }

  async function approveAndSave(ownerKey, revision, claimId, approved, updatedAt) {
    await Promise.all([ensureCollection(), ensureProfilesCollection()]);
    return runBusyTransaction(db, async (transaction) => {
      const reviewReference = transaction.collection(collectionName).doc(ownerKey);
      const profileReference = transaction.collection(profilesCollectionName).doc(ownerKey);
      const review = await transactionDocumentOrNull(reviewReference);
      const currentProfile = await transactionDocumentOrNull(profileReference);
      if (!review
        || review.revision !== revision
        || review.status !== 'processing'
        || review.claimId !== claimId) {
        return { applied: false, currentProfile, profile: null, review };
      }
      const profile = {
        ownerKey,
        nickname: approved.nickname,
        avatarFileId: approved.avatarFileId,
        moderation: approved.moderation,
        createdAt: currentProfile && currentProfile.createdAt || updatedAt,
        updatedAt
      };
      const finishedReview = {
        ...review,
        status: 'approved',
        claimId: '',
        claimedAt: null,
        claimExpiresAt: null,
        nextAttemptAt: null,
        completedAt: updatedAt,
        updatedAt
      };
      await profileReference.set({ data: profile });
      await reviewReference.set({ data: finishedReview });
      return { applied: true, currentProfile, profile, review: finishedReview };
    });
  }

  return {
    get,
    submit,
    listDue,
    listStaleClaims,
    claim,
    approveAndSave,
    markRetry: (ownerKey, revision, claimId, patch) => (
      transitionClaimed(ownerKey, revision, claimId, patch)
    ),
    markRejected: (ownerKey, revision, claimId, patch) => (
      transitionClaimed(ownerKey, revision, claimId, patch)
    )
  };
}

module.exports = { createUserProfileReviewRepository };
