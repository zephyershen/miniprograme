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

  return {
    ensureCollection,
    get,
    patch,
    acquireLease,
    renewLease,
    releaseLease,
    acquireVisualWorkerLease,
    releaseVisualWorkerLease
  };
}

module.exports = { createFeedSyncStateRepository };
