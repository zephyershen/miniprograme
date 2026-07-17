const { randomUUID } = require('node:crypto');

const DEFAULT_VISUAL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function visualCleanupIsDue(lastCleanupAt, currentTime, intervalMs = DEFAULT_VISUAL_CLEANUP_INTERVAL_MS) {
  const current = new Date(currentTime);
  if (Number.isNaN(current.getTime())) return true;
  const last = new Date(lastCleanupAt);
  if (Number.isNaN(last.getTime())) return true;
  const interval = Math.max(5 * 60 * 1000, Number(intervalMs) || DEFAULT_VISUAL_CLEANUP_INTERVAL_MS);
  return current.getTime() - last.getTime() >= interval;
}

function createVisualMaintenanceService({
  repository,
  sourceSyncService,
  coverService,
  previewService,
  cleanupService,
  previewMaintenanceToken,
  config,
  now = () => Date.now(),
  createLeaseOwner = randomUUID,
  logger = console
}) {
  const cleanupIntervalMs = Math.max(
    5 * 60 * 1000,
    Number(config.cleanupIntervalMs) || DEFAULT_VISUAL_CLEANUP_INTERVAL_MS
  );

  async function withVisualLease(reason, operation) {
    const owner = createLeaseOwner();
    if (repository && typeof repository.acquireVisualLease === 'function') {
      const acquired = await repository.acquireVisualLease(
        owner,
        new Date(now()),
        new Date(now() + config.leaseMs)
      );
      if (!acquired.acquired) return { status: 'busy', reason };
    }
    try {
      return await operation();
    } finally {
      if (repository && typeof repository.releaseVisualLease === 'function') {
        await repository.releaseVisualLease(owner).catch((error) => {
          logger.warn('Knowledge feed visual lease could not be released', {
            message: error && error.message
          });
        });
      }
    }
  }

  async function preparePendingPublication(itemIds = []) {
    return withVisualLease('pending-publication', async () => {
      const cache = await sourceSyncService.ensureCache();
      const options = {
        itemIds: Array.isArray(itemIds) ? itemIds : [],
        untriedOnly: true
      };
      const covers = await coverService.hydrateCovers(
        config.immediateCoverBatchSize || 3,
        false,
        true,
        options
      );
      const previews = await previewService.hydratePreviews(
        config.immediatePreviewBatchSize || 1,
        false,
        previewMaintenanceToken,
        options
      );
      const status = await previewService.maintenanceStatus(previewMaintenanceToken);
      const result = {
        status: 'ready',
        reason: 'pending-publication',
        updatedAt: cache.fetchedAt,
        covers,
        previews,
        publication: status
      };
      logger.info('Knowledge feed pending visuals prepared', result);
      return result;
    });
  }

  async function runCleanupIfDue(cache, options = {}) {
    const cleanupAvailable = cleanupService && typeof cleanupService.run === 'function';
    if (!cleanupAvailable || options.runCleanup === false) {
      return { attempted: 0, deleted: 0, retry: 0, skipped: true };
    }
    const checkedAt = new Date(now());
    const force = options.forceCleanup === true || options.runCleanup === true;
    if (!force && !visualCleanupIsDue(cache.visualCleanupCheckedAt, checkedAt, cleanupIntervalMs)) {
      return {
        attempted: 0,
        deleted: 0,
        retry: 0,
        skipped: true,
        nextDueAt: new Date(new Date(cache.visualCleanupCheckedAt).getTime() + cleanupIntervalMs)
      };
    }

    const cleanup = await cleanupService.run();
    if (repository && typeof repository.patchSourceState === 'function') {
      await repository.patchSourceState({ visualCleanupCheckedAt: checkedAt });
    }
    return { ...cleanup, skipped: false, checkedAt };
  }

  async function runMaintenance(options = {}) {
    return withVisualLease('scheduled-maintenance', async () => {
      const cache = await sourceSyncService.ensureCache();
      const covers = {
        attempted: 0,
        resolved: 0,
        missing: 0,
        skipped: true,
        reason: 'retry-only'
      };
      const previews = await previewService.hydratePreviews(
        config.previewBatchSize,
        false,
        previewMaintenanceToken,
        { retryOnly: true }
      );
      const cleanup = await runCleanupIfDue(cache, options);
      const status = await previewService.maintenanceStatus(previewMaintenanceToken);
      const result = {
        status: 'ready',
        reason: 'scheduled-maintenance',
        updatedAt: cache.fetchedAt,
        stale: Boolean(cache.sourceLastErrorCode),
        covers,
        previews,
        cleanup,
        publication: status
      };
      logger.info('Knowledge feed visual maintenance completed', result);
      return result;
    });
  }

  return {
    preparePendingPublication,
    runMaintenance,
    run: runMaintenance
  };
}

module.exports = {
  DEFAULT_VISUAL_CLEANUP_INTERVAL_MS,
  visualCleanupIsDue,
  createVisualMaintenanceService
};
