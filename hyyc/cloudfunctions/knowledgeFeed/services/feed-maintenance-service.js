function createFeedMaintenanceService({
  accessAdminService,
  allFeedSyncService,
  migrationService,
  itemRepository,
  dayIndexRepository,
  syncStateRepository,
  migrationRepository,
  visualJobRepository,
  visualSeedService,
  visualWorkerService,
  now = () => Date.now()
}) {
  function authorize(event) {
    accessAdminService.authorize(event && event.token);
  }

  async function grantAdmin(event = {}) {
    return accessAdminService.grant({ ...event, role: 'admin', status: 'active' });
  }

  async function sync(event = {}) {
    authorize(event);
    return allFeedSyncService.run({ force: event.force === true });
  }

  async function migrate(event = {}) {
    authorize(event);
    return migrationService.run({ restartArchive: event.restartArchive === true });
  }

  async function status(event = {}) {
    authorize(event);
    const [items, days, syncState, migration] = await Promise.all([
      itemRepository.stats(),
      dayIndexRepository.stats(),
      syncStateRepository.get(),
      migrationRepository.get()
    ]);
    return {
      items,
      days,
      sync: syncState || {},
      migration: migration || { status: 'not-started' }
    };
  }

  async function visualStatus(event = {}) {
    authorize(event);
    const cutoff = new Date(now() - (7 * 24 * 60 * 60 * 1000));
    const [allItems, recentItems, queue, syncState] = await Promise.all([
      itemRepository.visualStats(),
      itemRepository.visualStats(cutoff),
      visualJobRepository.status(new Date(now())),
      syncStateRepository.get()
    ]);
    return {
      items: { all: allItems, recent: recentItems },
      queue,
      seed: {
        phase: syncState && syncState.visualSeedPhase || 'not-started',
        recentOffset: Number(syncState && syncState.visualSeedRecentOffset) || 0,
        historyAfterId: syncState && syncState.visualSeedHistoryAfterId || '',
        scanned: Number(syncState && syncState.visualSeedScanned) || 0,
        enqueued: Number(syncState && syncState.visualSeedEnqueued) || 0,
        retained: Number(syncState && syncState.visualSeedRetained) || 0,
        completedAt: syncState && syncState.visualSeedCompletedAt || null,
        lastErrorCode: syncState && syncState.visualSeedLastErrorCode || ''
      },
      worker: {
        lastRunAt: syncState && syncState.visualWorkerLastRunAt || null,
        lastAttempted: Number(syncState && syncState.visualWorkerLastAttempted) || 0,
        lastCompleted: Number(syncState && syncState.visualWorkerLastCompleted) || 0,
        lastResults: syncState && syncState.visualWorkerLastResults || []
      }
    };
  }

  async function seedVisuals(event = {}) {
    authorize(event);
    return visualSeedService.run({
      restart: event.restart === true,
      maxBatches: event.maxBatches
    });
  }

  async function runVisuals(event = {}) {
    authorize(event);
    return visualWorkerService.run({ maxJobs: event.maxJobs });
  }

  return { grantAdmin, sync, migrate, status, visualStatus, seedVisuals, runVisuals };
}

module.exports = { createFeedMaintenanceService };
