function publicSourceResult(result) {
  const value = { ...(result || {}) };
  delete value.cacheDocument;
  delete value.fingerprintObservation;
  delete value.pendingVisualItemIds;
  return value;
}

function createScheduledWorkService({
  sourceSyncService,
  allFeedSyncService,
  aigclinkSyncService,
  archiveService,
  visualMaintenanceService,
  visualWorkerService,
  analysisWorkerService,
  digestGenerationService,
  columnEditorialService,
  userMediaService
}) {
  async function syncSource(event) {
    const mediaCleanupPromise = userMediaService
      && typeof userMediaService.cleanupExpired === 'function'
      ? userMediaService.cleanupExpired().catch(() => ({ status: 'deferred' }))
      : Promise.resolve(null);
    // Keep the lightweight AIGCLINK head poll ahead of the heavier AI HOT
    // refresh chain so upstream delays cannot starve the GitHub library.
    const openSourceLibrary = aigclinkSyncService && typeof aigclinkSyncService.run === 'function'
      ? await aigclinkSyncService.run({
          force: event && event.force === true
        })
      : { status: 'disabled', changed: false };
    const source = await sourceSyncService.run(event);
    const itemStore = await allFeedSyncService.run({
      fingerprintObservation: source.fingerprintObservation || null,
      legacyCache: source.cacheDocument || null,
      force: event && event.force === true
    });
    const mediaCleanup = await mediaCleanupPromise;
    return {
      ...publicSourceResult(source),
      itemStore,
      openSourceLibrary,
      ...(mediaCleanup ? { mediaCleanup } : {})
    };
  }

  async function maintainArchive() {
    return { archive: await archiveService.run() };
  }

  async function maintainLegacyVisuals() {
    return {
      visualMaintenance: await visualMaintenanceService.runMaintenance({ forceCleanup: true })
    };
  }

  async function processVisuals() {
    return { visualBackfill: await visualWorkerService.run() };
  }

  async function processIntelligence() {
    return { intelligence: await analysisWorkerService.run() };
  }

  async function generateDigest(windowKey) {
    return {
      digests: await digestGenerationService.runDue({ windowKeys: [windowKey] })
    };
  }

  async function generateWeeklyColumn() {
    return { column: await columnEditorialService.run() };
  }

  return {
    syncSource,
    maintainArchive,
    maintainLegacyVisuals,
    processVisuals,
    processIntelligence,
    generateDigest,
    generateWeeklyColumn
  };
}

module.exports = { publicSourceResult, createScheduledWorkService };
