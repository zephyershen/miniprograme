const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const { createCollectionEnsurer, chunks, isNotFound } = require('./collection-support');
const { analysisInputHash } = require('../policies/feed-curation');

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function analysisJobId(provider, itemId, inputHash, policyVersion) {
  return crypto.createHash('sha256')
    .update(`${provider}\n${itemId}\n${inputHash}\n${policyVersion}`)
    .digest('hex');
}

function analysisPriority(item, basePriority = 100) {
  const publishedAt = new Date(item && item.publishedAt).getTime();
  const recencyDay = Number.isFinite(publishedAt)
    ? Math.max(0, Math.floor(publishedAt / (24 * 60 * 60 * 1000)))
    : 0;
  return Math.max(0, Number(basePriority) || 0) + recencyDay;
}

function analysisJob(item, config, observedAt = new Date(), priority = 100) {
  const inputHash = analysisInputHash(item);
  const policyVersion = Math.max(1, Number(config.policyVersion) || 1);
  return {
    _id: analysisJobId(config.provider, item.id, inputHash, policyVersion),
    provider: config.provider,
    itemId: item.id,
    expectedInputHash: inputHash,
    policyVersion,
    priority: analysisPriority(item, priority),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: observedAt,
    leaseOwner: '',
    leaseUntil: null,
    lastErrorCode: '',
    createdAt: observedAt,
    updatedAt: observedAt
  };
}

function createFeedAnalysisJobRepository(db, config) {
  const collection = () => db.collection(config.analysisJobsCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.analysisJobsCollectionName);

  async function existingIds(ids) {
    const found = new Set();
    for (const batch of chunks(ids, 50)) {
      if (!batch.length) continue;
      const response = await collection().where({ _id: db.command.in(batch) })
        .field({ _id: true }).limit(batch.length).get();
      ((response && response.data) || []).forEach((document) => found.add(document._id));
    }
    return found;
  }

  async function enqueueMany(items, observedAt = new Date(), { priority = 100 } = {}) {
    await ensureCollection();
    const jobs = [...new Map((items || [])
      .filter((item) => item && item.id && item.publicState !== 'withdrawn')
      .map((item) => {
        const job = analysisJob(item, config, observedAt, priority);
        return [job._id, job];
      })).values()];
    const existing = await existingIds(jobs.map((job) => job._id));
    const inserts = jobs.filter((job) => !existing.has(job._id));
    for (const batch of chunks(inserts, 50)) {
      if (batch.length) await collection().add({ data: batch });
    }
    return { requested: jobs.length, inserted: inserts.length, retained: jobs.length - inserts.length };
  }

  async function listDue(currentTime = new Date(), limit = config.dueBatchSize) {
    await ensureCollection();
    const response = await collection().where({
      status: db.command.in(['pending', 'retry', 'leased']),
      nextAttemptAt: db.command.lte(currentTime)
    }).orderBy('priority', 'desc').orderBy('nextAttemptAt', 'asc')
      .limit(Math.max(1, Math.min(100, Number(limit) || config.dueBatchSize))).get();
    return (response && response.data) || [];
  }

  async function claim(documentId, owner = randomUUID(), currentTime = new Date()) {
    await ensureCollection();
    const until = new Date(currentTime.getTime() + config.jobLeaseMs);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.analysisJobsCollectionName).doc(documentId);
      let current;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return { acquired: false, reason: 'missing' };
        throw error;
      }
      const claimable = ['pending', 'retry'].includes(current.status)
        || (current.status === 'leased' && toMillis(current.leaseUntil) <= currentTime.getTime());
      if (!claimable || toMillis(current.nextAttemptAt) > currentTime.getTime()) {
        return { acquired: false, reason: 'not-due', job: current };
      }
      const fields = {
        status: 'leased', leaseOwner: owner, leaseUntil: until,
        nextAttemptAt: until, updatedAt: currentTime
      };
      await reference.update({ data: fields });
      return { acquired: true, job: { ...current, ...fields } };
    });
  }

  async function updateClaim(documentId, owner, fields) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.analysisJobsCollectionName).doc(documentId);
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

  function complete(documentId, owner, updatedAt = new Date()) {
    return updateClaim(documentId, owner, {
      status: 'completed', leaseOwner: '', leaseUntil: null, nextAttemptAt: null,
      lastErrorCode: '', completedAt: updatedAt, updatedAt
    });
  }

  function retry(documentId, owner, errorCode, nextAttemptAt, attempts, blocked = false) {
    const updatedAt = new Date();
    return updateClaim(documentId, owner, {
      status: blocked ? 'blocked' : 'retry',
      attempts: Math.max(1, Number(attempts) || 1),
      leaseOwner: '', leaseUntil: null,
      nextAttemptAt: blocked ? null : nextAttemptAt,
      lastErrorCode: errorCode || 'INTELLIGENCE_FAILURE', updatedAt
    });
  }

  async function status() {
    await ensureCollection();
    const count = async (where) => Number((await collection().where(where).count()).total) || 0;
    const [total, pending, retryCount, blocked, completed] = await Promise.all([
      collection().count().then((result) => Number(result.total) || 0),
      count({ status: 'pending' }), count({ status: 'retry' }),
      count({ status: 'blocked' }), count({ status: 'completed' })
    ]);
    return { total, pending, retry: retryCount, blocked, completed };
  }

  return { ensureCollection, enqueueMany, listDue, claim, complete, retry, status };
}

module.exports = {
  analysisJobId,
  analysisPriority,
  analysisJob,
  createFeedAnalysisJobRepository
};
