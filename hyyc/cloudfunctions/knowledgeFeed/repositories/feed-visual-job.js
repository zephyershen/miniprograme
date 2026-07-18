const { randomUUID } = require('node:crypto');
const {
  createCollectionEnsurer,
  chunks,
  isNotFound,
  mapWithConcurrency
} = require('./collection-support');
const {
  itemDocumentId,
  hasVisual,
  needsVisualWork
} = require('./feed-item');

const DAY_MS = 24 * 60 * 60 * 1000;

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function jobPriority(item, currentTime, recentWindowDays) {
  const publishedAt = new Date(item && item.publishedAt).getTime();
  if (Number.isFinite(publishedAt)
    && publishedAt >= currentTime - (recentWindowDays * DAY_MS)) return 300;
  return item && item.selected === true ? 200 : 100;
}

function visualJob(item, config, observedAt, priorityBoost = 0) {
  const timestamp = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const eligibleAt = item.firstStoredAt || item.firstObservedAt || timestamp;
  return {
    _id: itemDocumentId(config.provider, item.id),
    itemId: item.id,
    provider: config.provider,
    expectedUrl: item.url,
    expectedContentHash: item.contentHash,
    publishedAt: item.publishedAt,
    selected: item.selected === true,
    priority: jobPriority(item, timestamp.getTime(), config.recentWindowDays)
      + Math.max(0, Number(priorityBoost) || 0),
    status: 'pending',
    stage: hasVisual(item) ? 'thumbnail' : 'cover',
    attempts: 0,
    nextAttemptAt: timestamp,
    leaseOwner: '',
    leaseUntil: null,
    lastErrorCode: '',
    stagedFileIds: [],
    captureVersion: config.captureVersion,
    captureProfile: config.captureProfile || 'focus-v1',
    eligibleAt,
    thumbnailVersion: Math.max(1, Number(config.thumbnailVersion) || 1),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createFeedVisualJobRepository(db, config) {
  const collection = () => db.collection(config.collectionName);
  const ensureCollection = createCollectionEnsurer(db, config.collectionName);

  async function metadataByIds(ids) {
    const records = [];
    for (const batch of chunks(ids, 50)) {
      if (!batch.length) continue;
      const response = await collection()
        .where({ _id: db.command.in(batch) })
        .field({
          _id: true,
          expectedUrl: true,
          expectedContentHash: true,
          captureVersion: true,
          thumbnailVersion: true,
          status: true
        })
        .limit(batch.length)
        .get();
      records.push(...((response && response.data) || []));
    }
    return new Map(records.map((record) => [record._id, record]));
  }

  async function enqueueMany(items, observedAt = new Date(), options = {}) {
    await ensureCollection();
    const candidates = new Map();
    for (const item of (Array.isArray(items) ? items : [])) {
      if (!item || !item.id || !needsVisualWork(item) || item.publicState === 'withdrawn') continue;
      candidates.set(itemDocumentId(config.provider, item.id), item);
    }
    const existing = await metadataByIds([...candidates.keys()]);
    const inserts = [];
    const resets = [];
    const retained = [];
    for (const [documentId, item] of candidates) {
      const current = existing.get(documentId);
      const next = visualJob(item, config, observedAt, options.priorityBoost);
      if (!current) inserts.push(next);
      else if (current.expectedUrl !== next.expectedUrl
        || current.expectedContentHash !== next.expectedContentHash
        || Number(current.captureVersion || 0) !== Number(config.captureVersion)
        || Number(current.thumbnailVersion || 0) !== Number(next.thumbnailVersion)) {
        resets.push(next);
      } else {
        retained.push(item);
      }
    }
    for (const batch of chunks(inserts, 50)) {
      if (batch.length) await collection().add({ data: batch });
    }
    await mapWithConcurrency(resets, 8, async (job) => {
      const data = { ...job };
      delete data._id;
      await collection().doc(job._id).update({ data });
    });
    return {
      requested: candidates.size,
      inserted: inserts.length,
      reset: resets.length,
      retained: retained.length,
      queuedItems: [...new Set([...inserts, ...resets].map((job) => job._id))]
        .map((documentId) => candidates.get(documentId))
        .filter(Boolean)
    };
  }

  async function listDue(currentTime, limit = config.dueBatchSize) {
    await ensureCollection();
    const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
    const size = Math.max(1, Math.min(100, Number(limit) || config.dueBatchSize));
    const response = await collection()
      .where({ nextAttemptAt: db.command.lte(now) })
      .orderBy('priority', 'desc')
      .orderBy('nextAttemptAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function claim(documentId, owner = randomUUID(), currentTime = new Date(), leaseUntil) {
    await ensureCollection();
    const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
    const until = leaseUntil instanceof Date
      ? leaseUntil
      : new Date(now.getTime() + config.jobLeaseMs);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(documentId);
      let current;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return { acquired: false, reason: 'missing' };
        throw error;
      }
      const due = toMillis(current.nextAttemptAt) <= now.getTime();
      const claimable = ['pending', 'retry', 'cleanup'].includes(current.status)
        || (current.status === 'leased' && toMillis(current.leaseUntil) <= now.getTime());
      if (!due || !claimable) return { acquired: false, reason: 'not-due', job: current };
      const fields = {
        status: current.status === 'cleanup' ? 'cleanup' : 'leased',
        leaseOwner: owner,
        leaseUntil: until,
        nextAttemptAt: until,
        updatedAt: now
      };
      await reference.update({ data: fields });
      return { acquired: true, job: { ...current, ...fields } };
    });
  }

  async function updateClaim(documentId, owner, fields) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(documentId);
      let current;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      if (current.leaseOwner !== owner) return null;
      await reference.update({ data: fields });
      return { ...current, ...fields };
    });
  }

  function advanceToPreview(documentId, owner, updatedAt) {
    return updateClaim(documentId, owner, { stage: 'preview', updatedAt });
  }

  function stageFiles(documentId, owner, fileIds, updatedAt) {
    return updateClaim(documentId, owner, {
      stagedFileIds: [...new Set((fileIds || []).filter(Boolean))],
      updatedAt
    });
  }

  function clearStagedFiles(documentId, owner, updatedAt) {
    return updateClaim(documentId, owner, { stagedFileIds: [], updatedAt });
  }

  async function completeWithVisual(documentId, owner, visualFields, updatedAt) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const jobReference = transaction.collection(config.collectionName).doc(documentId);
      const itemReference = transaction.collection(config.itemsCollectionName).doc(documentId);
      let job;
      let item;
      try {
        job = (await jobReference.get()).data;
        item = (await itemReference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return { applied: false, reason: 'missing' };
        throw error;
      }
      if (job.leaseOwner !== owner) return { applied: false, reason: 'lease-lost' };
      if (item.url !== job.expectedUrl
        || item.contentHash !== job.expectedContentHash
        || item.publicState !== 'active') {
        return { applied: false, reason: 'stale-item' };
      }
      await itemReference.update({
        data: {
          ...visualFields,
          visualState: 'ready',
          visualUpdatedAt: updatedAt,
          updatedAt
        }
      });
      await jobReference.remove();
      return { applied: true, itemId: item.id };
    });
  }

  async function discard(documentId, owner) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(documentId);
      let current;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
      if (owner && current.leaseOwner !== owner) return false;
      await reference.remove();
      return true;
    });
  }

  function queueCleanup(documentId, owner, fileIds, nextAttemptAt, updatedAt) {
    return updateClaim(documentId, owner, {
      status: 'cleanup',
      cleanupFileIds: [...new Set((fileIds || []).filter(Boolean))],
      stagedFileIds: [],
      leaseOwner: '',
      leaseUntil: null,
      nextAttemptAt,
      updatedAt
    });
  }

  function retry(documentId, owner, errorCode, nextAttemptAt, updatedAt, attempts, blocked) {
    return updateClaim(documentId, owner, {
      status: blocked ? 'blocked' : 'retry',
      attempts,
      nextAttemptAt: blocked ? null : nextAttemptAt,
      leaseOwner: '',
      leaseUntil: null,
      lastErrorCode: errorCode,
      updatedAt
    });
  }

  async function countWhere(where = {}) {
    const result = await collection().where(where).count();
    return Number(result && result.total) || 0;
  }

  async function status(currentTime = new Date()) {
    await ensureCollection();
    const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
    const [total, pending, leased, retryCount, blocked, cleanup, due] = await Promise.all([
      collection().count().then((result) => Number(result && result.total) || 0),
      countWhere({ status: 'pending' }),
      countWhere({ status: 'leased' }),
      countWhere({ status: 'retry' }),
      countWhere({ status: 'blocked' }),
      countWhere({ status: 'cleanup' }),
      countWhere({ nextAttemptAt: db.command.lte(now) })
    ]);
    return { total, pending, leased, retry: retryCount, blocked, cleanup, due };
  }

  return {
    ensureCollection,
    enqueueMany,
    listDue,
    claim,
    advanceToPreview,
    stageFiles,
    clearStagedFiles,
    completeWithVisual,
    discard,
    queueCleanup,
    retry,
    status
  };
}

module.exports = {
  createFeedVisualJobRepository,
  visualJob,
  jobPriority,
  toMillis
};
