const { randomUUID } = require('node:crypto');
const {
  hasVisual,
  hasListThumbnail
} = require('../repositories/feed-item');
const {
  isObsoleteVisualJob,
  visualJobLane,
  VISUAL_JOB_LANES
} = require('../repositories/feed-visual-job');
const { previewRetryDelay, previewFailureCode } = require('./preview-service');

const { isNewVisualJob } = require('../policies/new-visuals');

function isFreshVisualJob(job) {
  return Boolean(job
    && job.status === 'pending'
    && Math.max(0, Number(job.attempts) || 0) === 0);
}

function visualJobFreshness(job) {
  return isFreshVisualJob(job) ? 'fresh' : 'recovery';
}

// Give newly published items three consecutive opportunities while still
// reserving bounded turns for repair and retry work. Slot identity is persisted
// because lane + freshness alone cannot distinguish the weighted live turns.
const VISUAL_WORK_SLOTS = Object.freeze([
  Object.freeze({ key: 'live-fresh-1', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-2', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-3', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'repair-fresh', lane: VISUAL_JOB_LANES.REPAIR, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-4', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-5', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-6', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-recovery', lane: VISUAL_JOB_LANES.LIVE, freshness: 'recovery' }),
  Object.freeze({ key: 'live-fresh-7', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-8', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'live-fresh-9', lane: VISUAL_JOB_LANES.LIVE, freshness: 'fresh' }),
  Object.freeze({ key: 'repair-recovery', lane: VISUAL_JOB_LANES.REPAIR, freshness: 'recovery' })
]);

function chooseWorkerAssignments(
  candidates,
  limit,
  lastLane = '',
  lastFreshness = '',
  lastSlot = '',
  targetLiveWaiting = Number.POSITIVE_INFINITY
) {
  const values = Array.isArray(candidates) ? candidates : [];
  if (!values.length) return [];
  const maximum = Math.max(1, Math.floor(Number(limit) || 1));
  const explicitLastIndex = VISUAL_WORK_SLOTS.findIndex((slot) => slot.key === lastSlot);
  const legacyLastIndex = VISUAL_WORK_SLOTS.findIndex((slot) => (
    slot.lane === lastLane && slot.freshness === lastFreshness
  ));
  const lastIndex = explicitLastIndex >= 0 ? explicitLastIndex : legacyLastIndex;
  let cursor = lastIndex >= 0 ? (lastIndex + 1) % VISUAL_WORK_SLOTS.length : 0;
  const selected = new Set();
  const assignments = [];

  function append(candidate, slotIndex) {
    selected.add(candidate);
    assignments.push({ candidate, slot: VISUAL_WORK_SLOTS[slotIndex].key });
    cursor = (slotIndex + 1) % VISUAL_WORK_SLOTS.length;
  }

  function nextSlot(predicate = () => true) {
    for (let offset = 0; offset < VISUAL_WORK_SLOTS.length; offset += 1) {
      const slotIndex = (cursor + offset) % VISUAL_WORK_SLOTS.length;
      const slot = VISUAL_WORK_SLOTS[slotIndex];
      if (!predicate(slot)) continue;
      const candidate = values.find((job) => (
        !selected.has(job)
        && visualJobLane(job) === slot.lane
        && visualJobFreshness(job) === slot.freshness
      ));
      if (candidate) return { candidate, slotIndex };
    }
    return null;
  }

  // When fresh live work is building up, drain it first until the configured
  // waiting target is reachable. Weighted repair/retry fairness resumes as
  // soon as the live queue is under control.
  const liveFreshCount = values.filter((job) => (
    visualJobLane(job) === VISUAL_JOB_LANES.LIVE
    && visualJobFreshness(job) === 'fresh'
  )).length;
  const target = Number.isFinite(Number(targetLiveWaiting))
    ? Math.max(0, Math.floor(Number(targetLiveWaiting)))
    : Number.POSITIVE_INFINITY;
  const priorityCount = Math.min(maximum, Math.max(0, liveFreshCount - target));
  while (assignments.length < priorityCount) {
    const match = nextSlot((slot) => (
      slot.lane === VISUAL_JOB_LANES.LIVE && slot.freshness === 'fresh'
    ));
    if (!match) break;
    append(match.candidate, match.slotIndex);
  }

  while (assignments.length < maximum) {
    const match = nextSlot();
    if (!match) break;
    append(match.candidate, match.slotIndex);
  }
  return assignments;
}

function chooseWorkerCandidates(
  candidates,
  limit,
  lastLane = '',
  lastFreshness = '',
  lastSlot = '',
  targetLiveWaiting = Number.POSITIVE_INFINITY
) {
  return chooseWorkerAssignments(
    candidates,
    limit,
    lastLane,
    lastFreshness,
    lastSlot,
    targetLiveWaiting
  ).map((assignment) => assignment.candidate);
}

function deterministicStatusJob(job) {
  try {
    const url = new URL(String(job && job.expectedUrl || ''));
    return /(^|\.)((x)|(twitter))\.com$/i.test(url.hostname)
      && /^\/[^/]+\/status\/\d+/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function previewStartBudgetForJob(job, config) {
  if (job && job.stage === 'thumbnail') {
    return Math.max(0, Number(config.thumbnailStartBudgetMs) || 0);
  }
  if (deterministicStatusJob(job)) {
    return Math.max(
      0,
      Number(config.deterministicPreviewStartBudgetMs)
        || Number(config.previewStartBudgetMs)
        || 0
    );
  }
  return Math.max(0, Number(config.previewStartBudgetMs) || 0);
}

function hasDeadlineBudget(deadlineAt, requiredMs, currentTime) {
  const deadline = deadlineAt instanceof Date ? deadlineAt.getTime() : Number(deadlineAt);
  if (!Number.isFinite(deadline)) return true;
  return deadline - Number(currentTime) >= Math.max(0, Number(requiredMs) || 0);
}

function deadlineError() {
  const error = new Error('PREVIEW_WORKER_DEADLINE');
  error.code = 'PREVIEW_WORKER_DEADLINE';
  return error;
}

function readyVisualFields(
  kind,
  fileIds,
  checkedAt,
  captureVersion,
  listThumbnailFileId = '',
  thumbnailVersion = 1,
  previewQualityAudit = null
) {
  const thumbnailFields = listThumbnailFileId ? {
    listThumbnailFileId,
    listThumbnailVersion: Math.max(1, Number(thumbnailVersion) || 1)
  } : {};
  if (kind === 'thumbnail') return thumbnailFields;
  if (kind === 'cover') {
    return {
      coverFileId: fileIds[0],
      coverCheckedAt: checkedAt,
      coverStatus: 'ready',
      ...thumbnailFields
    };
  }
  return {
    coverCheckedAt: checkedAt,
    coverStatus: 'missing',
    previewFileIds: fileIds,
    previewCheckedAt: checkedAt,
    previewStatus: 'ready',
    previewAttempts: 0,
    previewNextAttemptAt: null,
    previewLastErrorCode: '',
    previewCaptureVersion: captureVersion,
    ...(previewQualityAudit ? { previewQualityAudit } : {}),
    ...thumbnailFields
  };
}

function createFeedVisualWorkerService({
  jobRepository,
  itemRepository,
  syncStateRepository,
  coverService,
  previewService,
  thumbnailService,
  deleteFiles,
  config,
  now = () => Date.now(),
  createOwner = randomUUID,
  logger = console
}) {
  async function finishCleanupClaim(job, owner) {
    if (typeof jobRepository.finishCleanup === 'function') {
      return jobRepository.finishCleanup(job._id, owner, new Date(now()));
    }
    await jobRepository.discard(job._id, owner);
    return { applied: true, action: 'removed' };
  }

  async function cleanupClaim(job, owner, fileIds) {
    const requested = [...new Set((fileIds || []).filter(Boolean))];
    if (!requested.length) {
      await finishCleanupClaim(job, owner);
      return { cleaned: 0, retry: 0 };
    }
    let result;
    try {
      result = await deleteFiles(requested);
    } catch (error) {
      const retryAt = new Date(now() + previewRetryDelay(Math.max(1, Number(job.attempts) || 1)));
      await jobRepository.queueCleanup(job._id, owner, requested, retryAt, new Date(now()));
      logger.warn('Full feed visual cleanup failed', {
        itemId: job.itemId,
        fileCount: requested.length,
        errorCode: previewFailureCode(error)
      });
      return { cleaned: 0, retry: requested.length };
    }
    if (result.retryFileIds.length) {
      const retryAt = new Date(now() + previewRetryDelay(Math.max(1, Number(job.attempts) || 1)));
      await jobRepository.queueCleanup(job._id, owner, result.retryFileIds, retryAt, new Date(now()));
      return { cleaned: result.deletedFileIds.length, retry: result.retryFileIds.length };
    }
    await finishCleanupClaim(job, owner);
    return { cleaned: result.deletedFileIds.length, retry: 0 };
  }

  async function cleanupObsoleteClaim(job, owner) {
    const fileIds = [
      ...(Array.isArray(job.cleanupFileIds) ? job.cleanupFileIds : []),
      ...(Array.isArray(job.stagedFileIds) ? job.stagedFileIds : [])
    ];
    const requested = [...new Set(fileIds.filter(Boolean))];
    if (requested.length) {
      let result;
      try {
        result = await deleteFiles(requested);
      } catch (error) {
        const retryAt = new Date(now() + previewRetryDelay(Math.max(1, Number(job.attempts) || 1)));
        await jobRepository.queueCleanup(job._id, owner, requested, retryAt, new Date(now()));
        logger.warn('Obsolete visual cleanup failed', {
          itemId: job.itemId,
          fileCount: requested.length,
          errorCode: previewFailureCode(error)
        });
        return {
          status: 'obsolete-cleanup-retry',
          captureVersion: Math.max(0, Number(job.captureVersion) || 0),
          cleaned: 0,
          retry: requested.length
        };
      }
      if (result.retryFileIds.length) {
        const retryAt = new Date(now() + previewRetryDelay(Math.max(1, Number(job.attempts) || 1)));
        await jobRepository.queueCleanup(
          job._id,
          owner,
          result.retryFileIds,
          retryAt,
          new Date(now())
        );
        return {
          status: 'obsolete-cleanup-retry',
          captureVersion: Math.max(0, Number(job.captureVersion) || 0),
          cleaned: result.deletedFileIds.length,
          retry: result.retryFileIds.length
        };
      }
    }
    const finished = await jobRepository.finishObsoleteCleanup(
      job._id,
      owner,
      config.captureVersion,
      new Date(now())
    );
    return {
      status: finished && finished.action === 'requeued'
        ? 'obsolete-requeued'
        : 'obsolete-removed',
      captureVersion: Math.max(0, Number(job.captureVersion) || 0),
      cleaned: requested.length,
      retry: 0
    };
  }

  async function publishFiles(
    job,
    owner,
    item,
    kind,
    fileIds,
    thumbnailFileId,
    stagedFileIds,
    previewQualityAudit = null
  ) {
    const checkedAt = new Date(now());
    const generatedFileIds = [...new Set((stagedFileIds || [...fileIds, thumbnailFileId]).filter(Boolean))];
    const staged = await jobRepository.stageFiles(job._id, owner, generatedFileIds, checkedAt);
    if (!staged) {
      await deleteFiles(generatedFileIds);
      await jobRepository.discard(job._id, owner).catch(() => false);
      return { status: 'stale', kind };
    }
    const applied = await jobRepository.completeWithVisual(
      job._id,
      owner,
      readyVisualFields(
        kind,
        fileIds,
        checkedAt,
        config.captureVersion,
        thumbnailFileId,
        config.thumbnailVersion,
        previewQualityAudit
      ),
      checkedAt
    );
    if (applied.applied) return { status: 'ready', kind, fileCount: generatedFileIds.length };
    const cleanup = await cleanupClaim(job, owner, generatedFileIds);
    return { status: 'stale', kind, cleanup };
  }

  async function failClaim(job, owner, error) {
    const attempts = Math.max(0, Number(job.attempts) || 0) + 1;
    const blocked = attempts >= config.maxAttempts;
    const nextAttemptAt = new Date(now() + previewRetryDelay(attempts));
    const errorCode = previewFailureCode(error);
    await jobRepository.retry(
      job._id,
      owner,
      errorCode,
      nextAttemptAt,
      new Date(now()),
      attempts,
      blocked,
      error && error.previewQualityAudit || null
    );
    logger.warn('Full feed visual job failed', { itemId: job.itemId, attempts, blocked, errorCode });
    return { status: blocked ? 'blocked' : 'retry', attempts, errorCode };
  }

  async function processClaim(job, owner, context = {}) {
    if (isObsoleteVisualJob(job, config.captureVersion)) {
      return cleanupObsoleteClaim(job, owner);
    }
    const cleanupFiles = [
      ...(Array.isArray(job.cleanupFileIds) ? job.cleanupFileIds : []),
      ...(Array.isArray(job.stagedFileIds) ? job.stagedFileIds : [])
    ];
    if (job.status === 'cleanup') return { status: 'cleanup', ...(await cleanupClaim(job, owner, cleanupFiles)) };
    if (cleanupFiles.length) {
      const result = await deleteFiles(cleanupFiles);
      if (result.retryFileIds.length) {
        const retryAt = new Date(now() + previewRetryDelay(Math.max(1, Number(job.attempts) || 1)));
        await jobRepository.queueCleanup(
          job._id,
          owner,
          result.retryFileIds,
          retryAt,
          new Date(now())
        );
        return {
          status: 'cleanup',
          cleaned: result.deletedFileIds.length,
          retry: result.retryFileIds.length
        };
      }
      await jobRepository.clearStagedFiles(job._id, owner, new Date(now()));
    }

    const item = await itemRepository.getByItemId(job.itemId);
    if (!item || item.publicState !== 'active'
      || item.url !== job.expectedUrl
      || item.contentHash !== job.expectedContentHash) {
      await jobRepository.discard(job._id, owner);
      return { status: 'stale' };
    }
    if (hasListThumbnail(item)) {
      await jobRepository.discard(job._id, owner);
      return { status: 'already-ready' };
    }

    try {
      if (hasVisual(item)) {
        if (!hasDeadlineBudget(
          context.deadlineAt,
          config.thumbnailStartBudgetMs,
          now()
        )) throw deadlineError();
        const sourceFileId = item.coverFileId || item.previewFileIds[0];
        const thumbnailFileId = await thumbnailService.resolveAndUploadFromFile(item, sourceFileId);
        return publishFiles(job, owner, item, 'thumbnail', [], thumbnailFileId, [thumbnailFileId]);
      }
      if (job.stage !== 'preview') {
        if (!hasDeadlineBudget(
          context.deadlineAt,
          previewStartBudgetForJob(job, config),
          now()
        )) throw deadlineError();
        const coverFileId = await coverService.resolveAndUploadCover(item);
        if (coverFileId) {
          const staged = await jobRepository.stageFiles(job._id, owner, [coverFileId], new Date(now()));
          if (!staged) {
            await deleteFiles([coverFileId]);
            return { status: 'stale', kind: 'cover' };
          }
          if (!hasDeadlineBudget(
            context.deadlineAt,
            config.thumbnailStartBudgetMs,
            now()
          )) throw deadlineError();
          const thumbnailFileId = await thumbnailService.resolveAndUploadFromFile(item, coverFileId);
          return publishFiles(
            job,
            owner,
            item,
            'cover',
            [coverFileId],
            thumbnailFileId,
            [coverFileId, thumbnailFileId]
          );
        }
        const advanced = await jobRepository.advanceToPreview(job._id, owner, new Date(now()));
        if (!advanced) return { status: 'stale' };
        job = advanced;
      }
      if (!hasDeadlineBudget(
        context.deadlineAt,
        previewStartBudgetForJob(job, config),
        now()
      )) throw deadlineError();
      const previewResolution = await previewService.resolveAndUploadPreviews(item);
      const previewFileIds = Array.isArray(previewResolution)
        ? previewResolution
        : (previewResolution && previewResolution.fileIds) || [];
      const previewQualityAudit = Array.isArray(previewResolution)
        ? null
        : previewResolution && previewResolution.qualityAudit || null;
      const staged = await jobRepository.stageFiles(job._id, owner, previewFileIds, new Date(now()));
      if (!staged) {
        await deleteFiles(previewFileIds);
        return { status: 'stale', kind: 'preview' };
      }
      if (!hasDeadlineBudget(
        context.deadlineAt,
        config.thumbnailStartBudgetMs,
        now()
      )) throw deadlineError();
      const thumbnailFileId = await thumbnailService.resolveAndUploadFromFile(item, previewFileIds[0]);
      return publishFiles(
        job,
        owner,
        item,
        'preview',
        previewFileIds,
        thumbnailFileId,
        [...previewFileIds, thumbnailFileId],
        previewQualityAudit
      );
    } catch (error) {
      return failClaim(job, owner, error);
    }
  }

  async function run({ maxJobs = config.jobsPerCycle } = {}) {
    const startedAt = new Date(now());
    const deadlineAt = new Date(
      startedAt.getTime() + Math.max(1000, Number(config.workerSoftDeadlineMs) || 285000)
    );
    if (typeof itemRepository.releaseExpiredVisualPublicationHolds === 'function') {
      const graceMs = Math.max(0, Number(config.visualPublicationGraceMs) || 0);
      await itemRepository.releaseExpiredVisualPublicationHolds(
        new Date(startedAt.getTime() - graceMs),
        startedAt
      );
    }
    const [due, obsoleteDue] = await Promise.all([
      jobRepository.listDue(startedAt, config.dueBatchSize, {
        eligibleAtOrAfter: config.newItemsAfter
      }),
      typeof jobRepository.listObsolete === 'function'
        ? jobRepository.listObsolete(
          startedAt,
          config.captureVersion,
          config.obsoleteCleanupBatchSize
        )
        : []
    ]);
    const eligible = due.filter((candidate) => (
      isNewVisualJob(candidate, config.newItemsAfter)
      && !isObsoleteVisualJob(candidate, config.captureVersion)
    ));
    if (!eligible.length && !obsoleteDue.length) {
      return { status: 'idle', attempted: 0, completed: 0, results: [] };
    }

    const owner = createOwner();
    const lease = await syncStateRepository.acquireVisualWorkerLease(
      owner,
      startedAt,
      new Date(startedAt.getTime() + config.workerLeaseMs)
    );
    if (!lease.acquired) return { status: 'busy', attempted: 0, completed: 0, results: [] };
    try {
      const limit = Math.max(1, Math.min(
        Number(config.maxJobsPerInvocation) || 1,
        Number(maxJobs) || config.jobsPerCycle || 1
      ));
      const results = [];
      const obsoleteLimit = Math.max(0, Math.min(
        4,
        Number(config.obsoleteCleanupBatchSize) || 0
      ));
      for (const candidate of obsoleteDue.slice(0, obsoleteLimit)) {
        const claimed = await jobRepository.claimObsolete(
          candidate._id,
          owner,
          config.captureVersion,
          new Date(now()),
          new Date(now() + config.jobLeaseMs)
        );
        if (!claimed.acquired) continue;
        results.push({
          itemId: claimed.job.itemId,
          ...(await cleanupObsoleteClaim(claimed.job, owner))
        });
      }
      const assignments = chooseWorkerAssignments(
        eligible,
        limit,
        lease.document && lease.document.visualWorkerLastLane,
        lease.document && lease.document.visualWorkerLastFreshness,
        lease.document && lease.document.visualWorkerLastSlot,
        config.targetLiveWaitingJobs
      );
      let lastLane = lease.document && lease.document.visualWorkerLastLane || '';
      let lastFreshness = lease.document && lease.document.visualWorkerLastFreshness || '';
      let lastSlot = lease.document && lease.document.visualWorkerLastSlot || '';
      let visualAttempts = 0;
      const concurrency = Math.max(1, Math.min(
        limit,
        Number(config.maxCaptureConcurrency) || 1
      ));
      for (let offset = 0; offset < assignments.length; offset += concurrency) {
        if (visualAttempts >= limit) break;
        const batch = assignments
          .slice(offset, offset + concurrency)
          .filter((assignment) => (
          hasDeadlineBudget(
            deadlineAt,
            previewStartBudgetForJob(assignment.candidate, config),
            now()
          )
        ));
        if (!batch.length) continue;
        const claimedBatch = (await Promise.all(batch.map(async (assignment) => ({
          assignment,
          claim: await jobRepository.claim(
            assignment.candidate._id,
            owner,
            new Date(now()),
            new Date(now() + config.jobLeaseMs)
          )
        })))).filter((entry) => entry.claim.acquired);
        if (!claimedBatch.length) continue;
        visualAttempts += claimedBatch.length;
        const batchResults = await Promise.all(claimedBatch.map(async ({ assignment, claim }) => ({
          assignment,
          job: claim.job,
          result: await processClaim(claim.job, owner, { deadlineAt })
        })));
        batchResults.forEach(({ assignment, job, result }) => {
          lastLane = visualJobLane(job);
          lastFreshness = visualJobFreshness(assignment.candidate);
          lastSlot = assignment.slot;
          results.push({ itemId: job.itemId, ...result });
        });
      }
      const completed = results.filter((result) => ['ready', 'already-ready'].includes(result.status)).length;
      if (results.length) {
        await syncStateRepository.patch({
          visualWorkerLastRunAt: new Date(now()),
          visualWorkerLastLane: lastLane,
          visualWorkerLastFreshness: lastFreshness,
          visualWorkerLastSlot: lastSlot,
          visualWorkerLastAttempted: results.length,
          visualWorkerLastCompleted: completed,
          visualWorkerLastDue: eligible.length,
          visualWorkerLastConcurrency: concurrency,
          visualWorkerTargetWaiting: Math.max(0, Number(config.targetLiveWaitingJobs) || 0),
          visualWorkerEstimatedRemaining: Math.max(0, eligible.length - visualAttempts),
          visualWorkerLastResults: results.slice(-4).map((result) => ({
            itemId: result.itemId,
            status: result.status,
            kind: result.kind || '',
            fileCount: Number(result.fileCount) || 0
          }))
        });
      }
      return {
        status: 'ready',
        attempted: results.length,
        completed,
        results
      };
    } finally {
      await syncStateRepository.releaseVisualWorkerLease(owner).catch(() => {});
    }
  }

  return { run, processClaim };
}

module.exports = {
  createFeedVisualWorkerService,
  readyVisualFields,
  isFreshVisualJob,
  visualJobFreshness,
  VISUAL_WORK_SLOTS,
  chooseWorkerAssignments,
  chooseWorkerCandidates,
  deterministicStatusJob,
  previewStartBudgetForJob,
  hasDeadlineBudget
};
