function scheduledTime(event, now = () => Date.now()) {
  const parsed = Date.parse(event && event.Time);
  return Number.isNaN(parsed) ? now() : parsed;
}

function isVisualMaintenanceDue(event, intervalMinutes, now = () => Date.now()) {
  const interval = Math.max(1, Number(intervalMinutes) || 1);
  const minute = Math.floor(scheduledTime(event, now) / (60 * 1000));
  return minute % interval === 0;
}

function isVisualCleanupTick(event, now = () => Date.now()) {
  return isVisualMaintenanceDue(event, 60, now);
}

function createSyncCycleService({
  sourceSyncService,
  archiveService,
  visualMaintenanceService,
  visualIntervalMinutes,
  now = () => Date.now()
}) {
  function visualWorkAttempted(result) {
    return Boolean(result && (
      Number(result.covers && result.covers.attempted) > 0
      || Number(result.previews && result.previews.attempted) > 0
    ));
  }

  function archiveBackfillAttempted(result) {
    return Number(result && result.history && result.history.attemptedDays) > 0;
  }

  async function run(event) {
    const source = await sourceSyncService.run(event);
    const visualDue = isVisualMaintenanceDue(event, visualIntervalMinutes, now);
    const visualCleanupTick = isVisualCleanupTick(event, now);
    const sourceOwnsCycle = !['busy', 'superseded'].includes(source.status);
    const pendingVisualItemIds = Array.isArray(source.pendingVisualItemIds)
      ? source.pendingVisualItemIds
      : [];
    const immediateVisuals = sourceOwnsCycle
      ? await visualMaintenanceService.preparePendingPublication(pendingVisualItemIds)
      : null;
    const immediateWork = visualWorkAttempted(immediateVisuals);
    const archive = sourceOwnsCycle && archiveService && !immediateWork
      ? await archiveService.run({ sourceChanged: source.changed })
      : (immediateWork ? { status: 'deferred', reason: 'immediate-visuals' } : null);
    const archiveBackfillWork = archiveBackfillAttempted(archive);
    const visualMaintenance = visualDue && sourceOwnsCycle && !immediateWork && !archiveBackfillWork
      ? await visualMaintenanceService.runMaintenance({ forceCleanup: visualCleanupTick })
      : null;
    const sourceResult = { ...source };
    delete sourceResult.pendingVisualItemIds;
    return {
      ...sourceResult,
      pendingVisualCount: pendingVisualItemIds.length,
      archive,
      immediateVisuals,
      visualMaintenanceDue: visualDue,
      visualCleanupTick,
      visualMaintenanceDeferred: visualDue && !visualMaintenance
        ? (immediateWork ? 'immediate-visuals' : (archiveBackfillWork ? 'archive-backfill' : 'source-busy'))
        : '',
      visualMaintenance
    };
  }

  return { run };
}

module.exports = { createSyncCycleService, isVisualMaintenanceDue, isVisualCleanupTick };
