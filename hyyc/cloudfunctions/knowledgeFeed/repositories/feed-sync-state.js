const { createCollectionEnsurer, isNotFound } = require('./collection-support');

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function createFeedSyncStateRepository(db, config) {
  const collection = () => db.collection(config.syncStateCollectionName);
  const document = () => collection().doc(config.syncStateDocumentId);
  const ensureCollection = createCollectionEnsurer(db, config.syncStateCollectionName);

  async function get() {
    await ensureCollection();
    try {
      return (await document().get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function patch(fields, lease = null) {
    await ensureCollection();
    if (lease) {
      return db.runTransaction(async (transaction) => {
        const reference = transaction.collection(config.syncStateCollectionName).doc(config.syncStateDocumentId);
        const current = (await reference.get()).data;
        if (current.leaseOwner !== lease.owner || toMillis(current.leaseUntil) <= toMillis(lease.now)) {
          const error = new Error('ALL_SYNC_LEASE_LOST');
          error.code = 'ALL_SYNC_LEASE_LOST';
          throw error;
        }
        await reference.update({ data: fields });
        return { ...current, ...fields };
      });
    }
    const current = await get();
    if (current) await document().update({ data: fields });
    else await document().set({ data: fields });
    return { ...(current || {}), ...fields };
  }

  async function acquireLease(owner, acquiredAt, expiresAt) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName).doc(config.syncStateDocumentId);
      let current = null;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (current && current.leaseOwner && toMillis(current.leaseUntil) > toMillis(acquiredAt)) {
        return { acquired: false, document: current };
      }
      const fields = { leaseOwner: owner, leaseAcquiredAt: acquiredAt, leaseUntil: expiresAt };
      if (current) await reference.update({ data: fields });
      else await reference.set({ data: fields });
      return { acquired: true, document: { ...(current || {}), ...fields } };
    });
  }

  async function renewLease(owner, renewedAt, expiresAt) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName).doc(config.syncStateDocumentId);
      const current = (await reference.get()).data;
      if (current.leaseOwner !== owner || toMillis(current.leaseUntil) <= toMillis(renewedAt)) {
        return { renewed: false, document: current };
      }
      const fields = { leaseHeartbeatAt: renewedAt, leaseUntil: expiresAt };
      await reference.update({ data: fields });
      return { renewed: true, document: { ...current, ...fields } };
    });
  }

  async function releaseLease(owner) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName).doc(config.syncStateDocumentId);
      const current = (await reference.get()).data;
      if (current.leaseOwner !== owner) return false;
      await reference.update({ data: { leaseOwner: '', leaseAcquiredAt: null, leaseUntil: null } });
      return true;
    });
  }

  async function acquireVisualWorkerLease(owner, acquiredAt, expiresAt) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName).doc(config.syncStateDocumentId);
      let current = null;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (current && current.visualWorkerOwner
        && toMillis(current.visualWorkerUntil) > toMillis(acquiredAt)) {
        return { acquired: false, document: current };
      }
      const fields = {
        visualWorkerOwner: owner,
        visualWorkerAcquiredAt: acquiredAt,
        visualWorkerUntil: expiresAt
      };
      if (current) await reference.update({ data: fields });
      else await reference.set({ data: fields });
      return { acquired: true, document: { ...(current || {}), ...fields } };
    });
  }

  async function releaseVisualWorkerLease(owner) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName).doc(config.syncStateDocumentId);
      const current = (await reference.get()).data;
      if (current.visualWorkerOwner !== owner) return false;
      await reference.update({
        data: { visualWorkerOwner: '', visualWorkerAcquiredAt: null, visualWorkerUntil: null }
      });
      return true;
    });
  }

  async function beginSearchTokenBackfill(targetVersion, startedAt) {
    await ensureCollection();
    const version = Math.max(1, Math.floor(Number(targetVersion) || 0));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName)
        .doc(config.syncStateDocumentId);
      let current = null;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const state = current || {};
      const failures = Array.isArray(state.searchTokenBackfillFailures)
        ? state.searchTokenBackfillFailures
        : [];
      if (Number(state.searchTokenBackfillVersion) === version
        && state.searchTokenBackfillCompletedAt
        && failures.length === 0) {
        return { done: true, state };
      }
      if (Number(state.searchTokenBackfillTargetVersion) === version) {
        return { done: false, state };
      }
      const fields = {
        searchTokenBackfillTargetVersion: version,
        searchTokenBackfillCursor: '',
        searchTokenBackfillScanned: 0,
        searchTokenBackfillUpdated: 0,
        searchTokenBackfillSkipped: 0,
        searchTokenBackfillFailureCount: 0,
        searchTokenBackfillFailures: [],
        searchTokenBackfillLastErrorCode: '',
        searchTokenBackfillLastFailedAt: null,
        searchTokenBackfillLastBatchDurationMs: 0,
        searchTokenBackfillStartedAt: startedAt,
        searchTokenBackfillUpdatedAt: startedAt,
        searchTokenBackfillScanCompletedAt: null,
        searchTokenBackfillCompletedAt: null
      };
      if (current) await reference.update({ data: fields });
      else await reference.set({ data: fields });
      return { done: false, state: { ...state, ...fields } };
    });
  }

  async function advanceSearchTokenBackfill({
    targetVersion,
    expectedCursor,
    nextCursor,
    scanned,
    updated,
    skipped,
    failureCount = 0,
    failures = [],
    lastErrorCode = '',
    lastFailedAt = null,
    batchDurationMs = 0,
    scanDone = false,
    done,
    advancedAt
  }) {
    await ensureCollection();
    const version = Math.max(1, Math.floor(Number(targetVersion) || 0));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName)
        .doc(config.syncStateDocumentId);
      const current = (await reference.get()).data;
      if (Number(current.searchTokenBackfillVersion) === version
        && current.searchTokenBackfillCompletedAt) {
        return { advanced: false, done: true, state: current };
      }
      if (Number(current.searchTokenBackfillTargetVersion) !== version
        || (current.searchTokenBackfillCursor || '') !== expectedCursor) {
        return { advanced: false, done: false, state: current };
      }
      const fields = {
        searchTokenBackfillCursor: scanDone ? '' : nextCursor,
        searchTokenBackfillScanned: Math.max(0, Number(current.searchTokenBackfillScanned) || 0)
          + Math.max(0, Number(scanned) || 0),
        searchTokenBackfillUpdated: Math.max(0, Number(current.searchTokenBackfillUpdated) || 0)
          + Math.max(0, Number(updated) || 0),
        searchTokenBackfillSkipped: Math.max(0, Number(current.searchTokenBackfillSkipped) || 0)
          + Math.max(0, Number(skipped) || 0),
        searchTokenBackfillFailureCount:
          Math.max(0, Number(current.searchTokenBackfillFailureCount) || 0)
          + Math.max(0, Number(failureCount) || 0),
        searchTokenBackfillFailures: Array.isArray(failures) ? failures : [],
        searchTokenBackfillLastBatchDurationMs:
          Math.max(0, Math.floor(Number(batchDurationMs) || 0)),
        searchTokenBackfillUpdatedAt: advancedAt,
        ...(lastErrorCode ? {
          searchTokenBackfillLastErrorCode: lastErrorCode,
          searchTokenBackfillLastFailedAt: lastFailedAt || advancedAt
        } : {}),
        ...(scanDone ? { searchTokenBackfillScanCompletedAt: advancedAt } : {}),
        ...(scanDone ? {
          searchTokenBackfillVersion: version,
          searchTokenBackfillCompletedAt: advancedAt
        } : {})
      };
      await reference.update({ data: fields });
      return { advanced: true, done, state: { ...current, ...fields } };
    });
  }

  async function recordSearchTokenBackfillAttempt({
    targetVersion,
    expectedCursor,
    failures = [],
    failureCount = 0,
    lastErrorCode = '',
    lastFailedAt = null,
    batchDurationMs = 0,
    attemptedAt
  }) {
    await ensureCollection();
    const version = Math.max(1, Math.floor(Number(targetVersion) || 0));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName)
        .doc(config.syncStateDocumentId);
      const current = (await reference.get()).data;
      if (Number(current.searchTokenBackfillTargetVersion) !== version
        || (current.searchTokenBackfillCursor || '') !== expectedCursor) {
        return { recorded: false, state: current };
      }
      const fields = {
        searchTokenBackfillFailures: Array.isArray(failures) ? failures : [],
        searchTokenBackfillFailureCount:
          Math.max(0, Number(current.searchTokenBackfillFailureCount) || 0)
          + Math.max(0, Number(failureCount) || 0),
        searchTokenBackfillLastBatchDurationMs:
          Math.max(0, Math.floor(Number(batchDurationMs) || 0)),
        searchTokenBackfillUpdatedAt: attemptedAt,
        ...(lastErrorCode ? {
          searchTokenBackfillLastErrorCode: lastErrorCode,
          searchTokenBackfillLastFailedAt: lastFailedAt || attemptedAt
        } : {})
      };
      await reference.update({ data: fields });
      return { recorded: true, state: { ...current, ...fields } };
    });
  }

  async function completeSearchTokenBackfill(targetVersion, completedAt, batchDurationMs = 0) {
    await ensureCollection();
    const version = Math.max(1, Math.floor(Number(targetVersion) || 0));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.syncStateCollectionName)
        .doc(config.syncStateDocumentId);
      const current = (await reference.get()).data;
      const failures = Array.isArray(current.searchTokenBackfillFailures)
        ? current.searchTokenBackfillFailures
        : [];
      if (Number(current.searchTokenBackfillVersion) === version
        && current.searchTokenBackfillCompletedAt
        && failures.length === 0) {
        return { completed: true, state: current };
      }
      if (Number(current.searchTokenBackfillTargetVersion) !== version
        || !current.searchTokenBackfillScanCompletedAt
        || failures.length) {
        return { completed: false, state: current };
      }
      const fields = {
        searchTokenBackfillVersion: version,
        searchTokenBackfillCompletedAt: completedAt,
        searchTokenBackfillUpdatedAt: completedAt,
        searchTokenBackfillLastBatchDurationMs:
          Math.max(0, Math.floor(Number(batchDurationMs) || 0))
      };
      await reference.update({ data: fields });
      return { completed: true, state: { ...current, ...fields } };
    });
  }

  return {
    ensureCollection,
    get,
    patch,
    acquireLease,
    renewLease,
    releaseLease,
    acquireVisualWorkerLease,
    releaseVisualWorkerLease,
    beginSearchTokenBackfill,
    advanceSearchTokenBackfill,
    recordSearchTokenBackfillAttempt,
    completeSearchTokenBackfill
  };
}

module.exports = { createFeedSyncStateRepository };
