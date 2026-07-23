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
const { isNewVisualJob } = require('../policies/new-visuals');

const DAY_MS = 24 * 60 * 60 * 1000;
const RECOVERY_STATUSES = Object.freeze(['retry', 'cleanup', 'leased']);
const CLAIMABLE_STATUSES = Object.freeze(['pending', ...RECOVERY_STATUSES]);
const VISUAL_JOB_LANES = Object.freeze({
  LIVE: 'live',
  REPAIR: 'repair'
});
const DEFAULT_REPAIR_REASON = 'PREVIEW_CONTENT_INVALID';

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function atomicPreviewAudit(db, fields = {}) {
  if (!Object.prototype.hasOwnProperty.call(fields, 'previewQualityAudit')
    || !fields.previewQualityAudit
    || !db
    || !db.command
    || typeof db.command.set !== 'function') return fields;
  return {
    ...fields,
    // CloudBase flattens plain nested objects into dot-path updates. A repaired
    // item deliberately has previewQualityAudit=null, so explicitly replace
    // the whole field before writing the first v3 audit object.
    previewQualityAudit: db.command.set(fields.previewQualityAudit)
  };
}

function compareDueJobs(left, right) {
  const priority = (Number(right && right.priority) || 0)
    - (Number(left && left.priority) || 0);
  if (priority) return priority;
  const published = toMillis(right && right.publishedAt) - toMillis(left && left.publishedAt);
  if (Number.isFinite(published) && published) return published;
  const due = toMillis(left && left.nextAttemptAt) - toMillis(right && right.nextAttemptAt);
  if (Number.isFinite(due) && due) return due;
  return String((left && left._id) || '').localeCompare(String((right && right._id) || ''));
}

function isUnattemptedPending(job) {
  return Boolean(job
    && job.status === 'pending'
    && Math.max(0, Number(job.attempts) || 0) === 0);
}

function isRepairVisualJob(job, repairReason = DEFAULT_REPAIR_REASON) {
  return Boolean(job && (
    job.lane === VISUAL_JOB_LANES.REPAIR
    || job.repairReason === repairReason
  ));
}

function visualJobLane(job, repairReason = DEFAULT_REPAIR_REASON) {
  return isRepairVisualJob(job, repairReason)
    ? VISUAL_JOB_LANES.REPAIR
    : VISUAL_JOB_LANES.LIVE;
}

function isObsoleteVisualJob(job, currentCaptureVersion) {
  const current = Math.max(1, Number(currentCaptureVersion) || 1);
  return Boolean(job && Math.max(0, Number(job.captureVersion) || 0) < current);
}

function prioritizeDueJobs(
  pendingCandidates,
  recoveryCandidates,
  currentTime,
  limit,
  eligibleAtOrAfter = ''
) {
  const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
  const size = Math.max(1, Math.min(100, Number(limit) || 1));
  const unique = new Map();
  for (const candidate of [
    ...(Array.isArray(pendingCandidates) ? pendingCandidates : []),
    ...(Array.isArray(recoveryCandidates) ? recoveryCandidates : [])
  ]) {
    if (!candidate || !candidate._id || unique.has(candidate._id)) continue;
    const dueAt = toMillis(candidate.nextAttemptAt);
    if (!Number.isFinite(dueAt) || dueAt > now.getTime()) continue;
    if (!isNewVisualJob(candidate, eligibleAtOrAfter)) continue;
    unique.set(candidate._id, candidate);
  }

  const fresh = [];
  const recovery = [];
  for (const candidate of unique.values()) {
    (isUnattemptedPending(candidate) ? fresh : recovery).push(candidate);
  }
  fresh.sort(compareDueJobs);
  recovery.sort(compareDueJobs);

  // Alternate lanes with fresh work first. With the production capacity of
  // two or more, a retry storm cannot delay a never-tried item and recovery
  // work still advances on every cycle.
  const prioritized = [];
  while (prioritized.length < size && (fresh.length || recovery.length)) {
    if (fresh.length) prioritized.push(fresh.shift());
    if (prioritized.length < size && recovery.length) prioritized.push(recovery.shift());
  }
  return prioritized;
}

function prioritizeVisualJobLanes(liveCandidates, repairCandidates, limit) {
  const size = Math.max(1, Math.min(100, Number(limit) || 1));
  const live = Array.isArray(liveCandidates) ? [...liveCandidates] : [];
  const repair = Array.isArray(repairCandidates) ? [...repairCandidates] : [];
  const prioritized = [];

  // A live item always gets the first slot. Repair work receives the next slot
  // so a large manual quarantine batch cannot hide newly-ingested news, while
  // the repair backlog still moves forward on every multi-job cycle.
  while (prioritized.length < size && (live.length || repair.length)) {
    if (live.length) prioritized.push(live.shift());
    if (prioritized.length < size && repair.length) prioritized.push(repair.shift());
  }
  return prioritized;
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
    lane: VISUAL_JOB_LANES.LIVE,
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
    const resetResults = await mapWithConcurrency(resets, 8, async (job) => {
      const now = observedAt instanceof Date ? observedAt : new Date(observedAt);
      return db.runTransaction(async (transaction) => {
        const reference = transaction.collection(config.collectionName).doc(job._id);
        let current;
        try {
          current = (await reference.get()).data;
        } catch (error) {
          if (isNotFound(error)) return { reset: false, reason: 'missing' };
          throw error;
        }
        const sameSource = current.expectedUrl === job.expectedUrl
          && current.expectedContentHash === job.expectedContentHash;
        if (current.status === 'blocked' && sameSource) {
          return { reset: false, reason: 'blocked' };
        }
        if (current.leaseOwner && toMillis(current.leaseUntil) > now.getTime()) {
          return { reset: false, reason: 'leased' };
        }
        const cleanupFileIds = [...new Set([
          ...(Array.isArray(current.cleanupFileIds) ? current.cleanupFileIds : []),
          ...(Array.isArray(current.stagedFileIds) ? current.stagedFileIds : [])
        ].filter(Boolean))];
        if (cleanupFileIds.length) {
          await reference.update({
            data: {
              status: 'cleanup',
              lane: visualJobLane(current, config.repairReason),
              cleanupFileIds,
              stagedFileIds: [],
              leaseOwner: '',
              leaseUntil: null,
              nextAttemptAt: now,
              updatedAt: now
            }
          });
          return { reset: false, reason: 'cleanup-first' };
        }
        const data = { ...job };
        delete data._id;
        await reference.update({ data });
        return { reset: true };
      });
    });
    const appliedResets = resets.filter((job, index) => resetResults[index] && resetResults[index].reset);
    const deferredResets = resets.length - appliedResets.length;
    return {
      requested: candidates.size,
      inserted: inserts.length,
      reset: appliedResets.length,
      retained: retained.length + deferredResets,
      queuedItems: [...new Set([...inserts, ...appliedResets].map((job) => job._id))]
        .map((documentId) => candidates.get(documentId))
        .filter(Boolean)
    };
  }

  async function listDue(currentTime, limit = config.dueBatchSize, options = {}) {
    await ensureCollection();
    const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
    const size = Math.max(1, Math.min(100, Number(limit) || config.dueBatchSize));
    const eligibleAtOrAfter = options.eligibleAtOrAfter || config.newItemsAfter || '';
    const cutoffMillis = toMillis(eligibleAtOrAfter);
    const due = {
      nextAttemptAt: db.command.lte(now),
      ...(Number.isFinite(cutoffMillis)
        ? { eligibleAt: db.command.gte(new Date(cutoffMillis)) }
        : {})
    };
    const candidateSize = Math.max(size, Math.min(
      100,
      Number(config.laneCandidateSize) || size
    ));
    const legacyCandidateSize = Math.max(candidateSize, Math.min(
      100,
      Number(config.legacyLaneCandidateSize) || candidateSize
    ));
    const repairReason = config.repairReason || DEFAULT_REPAIR_REASON;
    const ordered = (query, queryLimit = candidateSize) => query
      .orderBy('priority', 'desc')
      .orderBy('nextAttemptAt', 'asc')
      .limit(queryLimit)
      .get();
    const [
      pendingResponse,
      recoveryResponse,
      livePendingResponse,
      liveRecoveryResponse,
      repairPendingResponse,
      repairRecoveryResponse
    ] = await Promise.all([
      // Legacy live jobs have neither lane nor repair marker. Keeping their
      // query separate prevents old million-priority repairs from occupying
      // its result window while the explicit lane handles every new job.
      ordered(collection().where({
        status: 'pending',
        lane: db.command.exists(false),
        repairReason: db.command.exists(false),
        ...due
      }), legacyCandidateSize),
      ordered(collection().where({
        status: db.command.in(RECOVERY_STATUSES),
        lane: db.command.exists(false),
        repairReason: db.command.exists(false),
        ...due
      }), legacyCandidateSize),
      ordered(collection().where({
        status: 'pending',
        lane: VISUAL_JOB_LANES.LIVE,
        ...due
      })),
      ordered(collection().where({
        status: db.command.in(RECOVERY_STATUSES),
        lane: VISUAL_JOB_LANES.LIVE,
        ...due
      })),
      ordered(collection().where({
        status: 'pending',
        repairReason,
        ...due
      })),
      ordered(collection().where({
        status: db.command.in(RECOVERY_STATUSES),
        repairReason,
        ...due
      }))
    ]);
    const pending = [
      ...((pendingResponse && pendingResponse.data) || []),
      ...((livePendingResponse && livePendingResponse.data) || []),
      ...((repairPendingResponse && repairPendingResponse.data) || [])
    ];
    const recovery = [
      ...((recoveryResponse && recoveryResponse.data) || []),
      ...((liveRecoveryResponse && liveRecoveryResponse.data) || []),
      ...((repairRecoveryResponse && repairRecoveryResponse.data) || [])
    ];
    const live = prioritizeDueJobs(
      pending.filter((job) => !isRepairVisualJob(job, repairReason)),
      recovery.filter((job) => !isRepairVisualJob(job, repairReason)),
      now,
      size,
      eligibleAtOrAfter
    );
    const repair = prioritizeDueJobs(
      pending.filter((job) => isRepairVisualJob(job, repairReason)),
      recovery.filter((job) => isRepairVisualJob(job, repairReason)),
      now,
      size,
      eligibleAtOrAfter
    );
    return prioritizeVisualJobLanes(live, repair, size);
  }

  async function listObsolete(currentTime, currentCaptureVersion, limit = 1) {
    await ensureCollection();
    const now = currentTime instanceof Date ? currentTime : new Date(currentTime);
    const size = Math.max(1, Math.min(20, Number(limit) || 1));
    const response = await collection()
      .where({
        captureVersion: db.command.lt(Math.max(1, Number(currentCaptureVersion) || 1)),
        status: db.command.in(CLAIMABLE_STATUSES),
        nextAttemptAt: db.command.lte(now)
      })
      .orderBy('nextAttemptAt', 'asc')
      .limit(size)
      .get();
    return ((response && response.data) || [])
      .filter((job) => isObsoleteVisualJob(job, currentCaptureVersion))
      .slice(0, size);
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
        lane: visualJobLane(current, config.repairReason),
        leaseOwner: owner,
        leaseUntil: until,
        nextAttemptAt: until,
        updatedAt: now
      };
      await reference.update({ data: fields });
      return { acquired: true, job: { ...current, ...fields } };
    });
  }

  async function claimObsolete(
    documentId,
    owner,
    currentCaptureVersion,
    currentTime = new Date(),
    leaseUntil
  ) {
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
      if (!isObsoleteVisualJob(current, currentCaptureVersion)) {
        return { acquired: false, reason: 'current-version', job: current };
      }
      const due = toMillis(current.nextAttemptAt) <= now.getTime();
      const claimable = ['pending', 'retry', 'cleanup'].includes(current.status)
        || (current.status === 'leased' && toMillis(current.leaseUntil) <= now.getTime());
      if (!due || !claimable) return { acquired: false, reason: 'not-due', job: current };
      const fields = {
        status: 'cleanup',
        lane: visualJobLane(current, config.repairReason),
        leaseOwner: owner,
        leaseUntil: until,
        nextAttemptAt: until,
        updatedAt: now
      };
      await reference.update({ data: fields });
      return { acquired: true, job: { ...current, ...fields } };
    });
  }

  async function finishObsoleteCleanup(
    documentId,
    owner,
    currentCaptureVersion,
    updatedAt = new Date()
  ) {
    await ensureCollection();
    const now = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    return db.runTransaction(async (transaction) => {
      const jobReference = transaction.collection(config.collectionName).doc(documentId);
      const itemReference = transaction.collection(config.itemsCollectionName).doc(documentId);
      let job;
      let item = null;
      try {
        job = (await jobReference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return { applied: false, reason: 'missing' };
        throw error;
      }
      if (job.leaseOwner !== owner) return { applied: false, reason: 'lease-lost' };
      if (!isObsoleteVisualJob(job, currentCaptureVersion)) {
        return { applied: false, reason: 'current-version' };
      }
      try {
        item = (await itemReference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const currentItem = item
        && item.publicState === 'active'
        && item.url === job.expectedUrl
        && item.contentHash === job.expectedContentHash;
      if (!currentItem || !needsVisualWork(item)) {
        await jobReference.remove();
        return {
          applied: true,
          action: 'discarded',
          reason: currentItem ? 'already-ready' : 'stale-item'
        };
      }
      const fields = {
        status: 'pending',
        stage: hasVisual(item) ? 'thumbnail' : 'cover',
        attempts: 0,
        nextAttemptAt: now,
        leaseOwner: '',
        leaseUntil: null,
        lastErrorCode: '',
        stagedFileIds: [],
        cleanupFileIds: [],
        captureVersion: Math.max(1, Number(currentCaptureVersion) || 1),
        captureProfile: config.captureProfile || job.captureProfile || 'focus-v1',
        thumbnailVersion: Math.max(1, Number(config.thumbnailVersion) || 1),
        lane: visualJobLane(job, config.repairReason),
        // A v2 job may predate the forward-only cutoff. Requeueing is an
        // explicit current repair decision, so it must be eligible now.
        eligibleAt: now,
        updatedAt: now
      };
      await jobReference.update({ data: fields });
      return { applied: true, action: 'requeued', job: { ...job, ...fields } };
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
        data: atomicPreviewAudit(db, {
          ...visualFields,
          visualState: 'ready',
          visualLastErrorCode: '',
          visualLastAttemptAt: updatedAt,
          visualUpdatedAt: updatedAt,
          visualPublicationHeld: false,
          visualPublicationReleasedAt: updatedAt,
          visualPublicationReleaseReason: 'visual-ready',
          updatedAt
        })
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

  async function finishCleanup(documentId, owner, updatedAt) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(documentId);
      let current;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return { applied: false, reason: 'missing' };
        throw error;
      }
      if (current.leaseOwner !== owner) return { applied: false, reason: 'lease-lost' };
      if (current.cleanupTerminalStatus === 'blocked') {
        const fields = {
          status: 'blocked',
          cleanupTerminalStatus: '',
          cleanupFileIds: [],
          stagedFileIds: [],
          nextAttemptAt: null,
          leaseOwner: '',
          leaseUntil: null,
          updatedAt
        };
        await reference.update({ data: fields });
        return { applied: true, action: 'blocked', job: { ...current, ...fields } };
      }
      await reference.remove();
      return { applied: true, action: 'removed' };
    });
  }

  async function retry(
    documentId,
    owner,
    errorCode,
    nextAttemptAt,
    updatedAt,
    attempts,
    blocked,
    previewQualityAudit = null
  ) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const jobReference = transaction.collection(config.collectionName).doc(documentId);
      const itemReference = transaction.collection(config.itemsCollectionName).doc(documentId);
      let current;
      let item = null;
      try {
        current = (await jobReference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      if (current.leaseOwner !== owner) return null;
      try {
        item = (await itemReference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const cleanupFileIds = blocked
        ? [...new Set([
            ...(Array.isArray(current.cleanupFileIds) ? current.cleanupFileIds : []),
            ...(Array.isArray(current.stagedFileIds) ? current.stagedFileIds : [])
          ].filter(Boolean))]
        : [];
      const cleanupRequired = blocked && cleanupFileIds.length > 0;
      const status = cleanupRequired ? 'cleanup' : (blocked ? 'blocked' : 'retry');
      const jobFields = {
        status,
        attempts,
        nextAttemptAt: blocked && !cleanupRequired ? null : nextAttemptAt,
        leaseOwner: '',
        leaseUntil: null,
        lastErrorCode: errorCode,
        ...(cleanupRequired ? {
          cleanupTerminalStatus: 'blocked',
          cleanupFileIds,
          stagedFileIds: []
        } : {}),
        updatedAt
      };
      await jobReference.update({ data: jobFields });

      if (item && item.publicState === 'active'
        && item.url === current.expectedUrl
        && item.contentHash === current.expectedContentHash) {
        await itemReference.update({
          data: atomicPreviewAudit(db, {
            visualState: blocked ? 'blocked' : status,
            visualLastErrorCode: errorCode,
            visualLastAttemptAt: updatedAt,
            ...(previewQualityAudit ? { previewQualityAudit } : {}),
            visualPublicationHeld: false,
            visualPublicationReleasedAt: updatedAt,
            visualPublicationReleaseReason: 'visual-failed',
            updatedAt
          })
        });
      }
      return { ...current, ...jobFields };
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
    listObsolete,
    claim,
    claimObsolete,
    finishObsoleteCleanup,
    advanceToPreview,
    stageFiles,
    clearStagedFiles,
    completeWithVisual,
    discard,
    queueCleanup,
    finishCleanup,
    retry,
    status
  };
}

module.exports = {
  createFeedVisualJobRepository,
  visualJob,
  jobPriority,
  toMillis,
  compareDueJobs,
  isUnattemptedPending,
  prioritizeDueJobs,
  prioritizeVisualJobLanes,
  isRepairVisualJob,
  visualJobLane,
  isObsoleteVisualJob,
  atomicPreviewAudit,
  RECOVERY_STATUSES,
  CLAIMABLE_STATUSES,
  VISUAL_JOB_LANES,
  DEFAULT_REPAIR_REASON
};
