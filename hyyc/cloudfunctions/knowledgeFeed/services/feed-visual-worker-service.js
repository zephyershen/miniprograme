const { randomUUID } = require('node:crypto');
const {
  hasVisual,
  hasListThumbnail
} = require('../repositories/feed-item');
const { previewRetryDelay, previewFailureCode } = require('./preview-service');

function readyVisualFields(
  kind,
  fileIds,
  checkedAt,
  captureVersion,
  listThumbnailFileId = '',
  thumbnailVersion = 1
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
  async function cleanupClaim(job, owner, fileIds) {
    const requested = [...new Set((fileIds || []).filter(Boolean))];
    if (!requested.length) {
      await jobRepository.discard(job._id, owner);
      return { cleaned: 0, retry: 0 };
    }
    const result = await deleteFiles(requested);
    if (result.retryFileIds.length) {
      const retryAt = new Date(now() + previewRetryDelay(Math.max(1, Number(job.attempts) || 1)));
      await jobRepository.queueCleanup(job._id, owner, result.retryFileIds, retryAt, new Date(now()));
      return { cleaned: result.deletedFileIds.length, retry: result.retryFileIds.length };
    }
    await jobRepository.discard(job._id, owner);
    return { cleaned: result.deletedFileIds.length, retry: 0 };
  }

  async function publishFiles(job, owner, item, kind, fileIds, thumbnailFileId, stagedFileIds) {
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
        config.thumbnailVersion
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
      blocked
    );
    logger.warn('Full feed visual job failed', { itemId: job.itemId, attempts, blocked, errorCode });
    return { status: blocked ? 'blocked' : 'retry', attempts, errorCode };
  }

  async function processClaim(job, owner) {
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
        const sourceFileId = item.coverFileId || item.previewFileIds[0];
        const thumbnailFileId = await thumbnailService.resolveAndUploadFromFile(item, sourceFileId);
        return publishFiles(job, owner, item, 'thumbnail', [], thumbnailFileId, [thumbnailFileId]);
      }
      if (job.stage !== 'preview') {
        const coverFileId = await coverService.resolveAndUploadCover(item);
        if (coverFileId) {
          const staged = await jobRepository.stageFiles(job._id, owner, [coverFileId], new Date(now()));
          if (!staged) {
            await deleteFiles([coverFileId]);
            return { status: 'stale', kind: 'cover' };
          }
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
      const previewFileIds = await previewService.resolveAndUploadPreviews(item);
      const staged = await jobRepository.stageFiles(job._id, owner, previewFileIds, new Date(now()));
      if (!staged) {
        await deleteFiles(previewFileIds);
        return { status: 'stale', kind: 'preview' };
      }
      const thumbnailFileId = await thumbnailService.resolveAndUploadFromFile(item, previewFileIds[0]);
      return publishFiles(
        job,
        owner,
        item,
        'preview',
        previewFileIds,
        thumbnailFileId,
        [...previewFileIds, thumbnailFileId]
      );
    } catch (error) {
      return failClaim(job, owner, error);
    }
  }

  async function run({ maxJobs = config.jobsPerCycle } = {}) {
    const owner = createOwner();
    const startedAt = new Date(now());
    const lease = await syncStateRepository.acquireVisualWorkerLease(
      owner,
      startedAt,
      new Date(startedAt.getTime() + config.workerLeaseMs)
    );
    if (!lease.acquired) return { status: 'busy', attempted: 0, results: [] };
    try {
      const due = await jobRepository.listDue(startedAt, config.dueBatchSize);
      const limit = Math.max(1, Math.min(4, Number(maxJobs) || config.jobsPerCycle));
      const results = [];
      for (const candidate of due) {
        if (results.length >= limit) break;
        const claimed = await jobRepository.claim(
          candidate._id,
          owner,
          new Date(now()),
          new Date(now() + config.jobLeaseMs)
        );
        if (!claimed.acquired) continue;
        results.push({ itemId: claimed.job.itemId, ...(await processClaim(claimed.job, owner)) });
      }
      const completed = results.filter((result) => ['ready', 'already-ready'].includes(result.status)).length;
      await syncStateRepository.patch({
        visualWorkerLastRunAt: new Date(now()),
        visualWorkerLastAttempted: results.length,
        visualWorkerLastCompleted: completed,
        visualWorkerLastResults: results.slice(-4).map((result) => ({
          itemId: result.itemId,
          status: result.status,
          kind: result.kind || '',
          fileCount: Number(result.fileCount) || 0
        }))
      });
      return { status: 'ready', attempted: results.length, completed, results };
    } finally {
      await syncStateRepository.releaseVisualWorkerLease(owner).catch(() => {});
    }
  }

  return { run, processClaim };
}

module.exports = { createFeedVisualWorkerService, readyVisualFields };
