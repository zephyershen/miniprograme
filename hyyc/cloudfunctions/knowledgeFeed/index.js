const cloud = require('wx-server-sdk');
const { createAihotSource } = require('./adapters/aihot-source');
const { createDisabledIntelligenceProvider } = require('./adapters/intelligence-provider');
const {
  SOURCE_CONFIG,
  CACHE_CONFIG,
  ARCHIVE_CONFIG,
  ITEM_STORE_CONFIG,
  MEMBERSHIP_CONFIG,
  MEMBERSHIP_FEATURE_FLAGS,
  INTELLIGENCE_CONFIG,
  SOURCE_SYNC_CONFIG,
  COVER_CONFIG,
  PREVIEW_CONFIG,
  LIST_THUMBNAIL_CONFIG,
  VISUAL_MAINTENANCE_CONFIG,
  VISUAL_JOB_CONFIG,
  SYNC_CYCLE_CONFIG
} = require('./config');
const { AppError, ok, fail } = require('./lib/errors');
const { extractCoverUrl } = require('./lib/image-meta');
const { fetchPublicBuffer } = require('./lib/network');
const { resolveScheduledTrigger } = require('./policies/timer-trigger');
const { createFeedCacheRepository } = require('./repositories/feed-cache');
const { createFeedArchiveRepository } = require('./repositories/feed-archive');
const { createFeedItemRepository } = require('./repositories/feed-item');
const { createFeedDayIndexRepository } = require('./repositories/feed-day-index');
const { createFeedSyncStateRepository } = require('./repositories/feed-sync-state');
const { createFeedAccessRepository } = require('./repositories/feed-access');
const { createMembershipRepository } = require('./repositories/membership');
const { createFeedVisualJobRepository } = require('./repositories/feed-visual-job');
const { createFeedAnalysisRepository } = require('./repositories/feed-analysis');
const { createFeedAnalysisJobRepository } = require('./repositories/feed-analysis-job');
const { createFeedDigestRepository } = require('./repositories/feed-digest');
const { createCoverService } = require('./services/cover-service');
const { createCloudFileDeleter } = require('./services/cloud-file-deleter');
const { createFeedService } = require('./services/feed-service');
const { createPreviewService } = require('./services/preview-service');
const { createListThumbnailService } = require('./services/list-thumbnail-service');
const { createSourceSyncService } = require('./services/source-sync-service');
const { createSyncCycleService } = require('./services/sync-cycle-service');
const { createVisualMaintenanceService } = require('./services/visual-maintenance-service');
const { createVisualCleanupService } = require('./services/visual-cleanup-service');
const { createFeedArchiveService } = require('./services/feed-archive-service');
const { createActorService } = require('./services/actor-service');
const { createFeedEntitlementService } = require('./services/feed-entitlement-service');
const { createItemFeedQueryService } = require('./services/item-feed-query-service');
const { createCuratedFeedQueryService } = require('./services/curated-feed-query-service');
const { createDigestQueryService } = require('./services/digest-query-service');
const { createDigestGenerationService } = require('./services/digest-generation-service');
const { createFeedAnalysisWorkerService } = require('./services/feed-analysis-worker-service');
const { createAllFeedSyncService } = require('./services/all-feed-sync-service');
const { createFeedVisualWorkerService } = require('./services/feed-visual-worker-service');
const { createRolePreviewService } = require('./services/role-preview-service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const database = cloud.database();
const cacheRepository = createFeedCacheRepository(database, CACHE_CONFIG);
const archiveRepository = createFeedArchiveRepository(database, ARCHIVE_CONFIG);
const itemRepository = createFeedItemRepository(database, ITEM_STORE_CONFIG);
const dayIndexRepository = createFeedDayIndexRepository(database, ITEM_STORE_CONFIG);
const syncStateRepository = createFeedSyncStateRepository(database, ITEM_STORE_CONFIG);
const accessRepository = createFeedAccessRepository(database, ITEM_STORE_CONFIG);
const membershipRepository = createMembershipRepository(database, MEMBERSHIP_CONFIG);
const analysisRepository = createFeedAnalysisRepository(database, INTELLIGENCE_CONFIG);
const analysisJobRepository = createFeedAnalysisJobRepository(database, INTELLIGENCE_CONFIG);
const digestRepository = createFeedDigestRepository(database, INTELLIGENCE_CONFIG);
const intelligenceProvider = createDisabledIntelligenceProvider();
const visualJobConfig = Object.freeze({
  ...VISUAL_JOB_CONFIG,
  provider: ITEM_STORE_CONFIG.provider,
  itemsCollectionName: ITEM_STORE_CONFIG.itemsCollectionName,
  captureVersion: PREVIEW_CONFIG.captureVersion,
  thumbnailVersion: LIST_THUMBNAIL_CONFIG.version
});
const visualJobRepository = createFeedVisualJobRepository(database, visualJobConfig);
const source = createAihotSource(SOURCE_CONFIG);
const sourceSyncService = createSourceSyncService({
  repository: cacheRepository,
  source,
  config: SOURCE_SYNC_CONFIG,
  ownedVisualPrefixes: [
    COVER_CONFIG.fileIdPrefix,
    PREVIEW_CONFIG.fileIdPrefix,
    LIST_THUMBNAIL_CONFIG.fileIdPrefix
  ]
});
const legacyFeedService = createFeedService({
  repository: cacheRepository,
  ensureCache: () => sourceSyncService.ensureCache()
});
const coverService = createCoverService({
  cloud,
  repository: cacheRepository,
  fetchPublicBuffer,
  extractCoverUrl,
  config: COVER_CONFIG
});
const previewService = createPreviewService({ cloud, repository: cacheRepository, config: PREVIEW_CONFIG });
const thumbnailService = createListThumbnailService({ cloud, config: LIST_THUMBNAIL_CONFIG });
const deleteFiles = createCloudFileDeleter(cloud);
const cleanupService = createVisualCleanupService({
  repository: cacheRepository,
  deleteFiles,
  ownedVisualPrefixes: [
    COVER_CONFIG.fileIdPrefix,
    PREVIEW_CONFIG.fileIdPrefix,
    LIST_THUMBNAIL_CONFIG.fileIdPrefix
  ]
});
const visualMaintenanceService = createVisualMaintenanceService({
  repository: cacheRepository,
  sourceSyncService,
  coverService,
  previewService,
  cleanupService,
  previewMaintenanceToken: PREVIEW_CONFIG.maintenanceToken,
  config: VISUAL_MAINTENANCE_CONFIG
});
const archiveService = createFeedArchiveService({
  repository: cacheRepository,
  archiveRepository,
  source,
  config: ARCHIVE_CONFIG
});
const syncCycleService = createSyncCycleService({
  sourceSyncService,
  archiveService,
  visualMaintenanceService,
  visualIntervalMinutes: SYNC_CYCLE_CONFIG.visualIntervalMinutes
});
const actorService = createActorService({ getWXContext: () => cloud.getWXContext() });
const entitlementService = createFeedEntitlementService({
  accessRepository,
  membershipRepository,
  config: ITEM_STORE_CONFIG,
  featureFlags: MEMBERSHIP_FEATURE_FLAGS
});
const rolePreviewService = createRolePreviewService({ accessRepository });
const itemFeedQueryService = createItemFeedQueryService({
  itemRepository,
  dayIndexRepository,
  syncStateRepository,
  legacyFeedService,
  config: ITEM_STORE_CONFIG
});
const curatedFeedQueryService = createCuratedFeedQueryService({
  itemFeedQueryService,
  liveEnabled: MEMBERSHIP_FEATURE_FLAGS.liveCurated
});
const digestQueryService = createDigestQueryService({
  digestRepository,
  itemFeedQueryService,
  liveEnabled: MEMBERSHIP_FEATURE_FLAGS.liveDigests
});
const allFeedSyncService = createAllFeedSyncService({
  source,
  cacheRepository,
  itemRepository,
  visualJobRepository,
  analysisJobRepository,
  dayIndexRepository,
  syncStateRepository,
  config: ITEM_STORE_CONFIG
});
const visualWorkerService = createFeedVisualWorkerService({
  jobRepository: visualJobRepository,
  itemRepository,
  syncStateRepository,
  coverService,
  previewService,
  thumbnailService,
  deleteFiles,
  config: visualJobConfig
});
const analysisWorkerService = createFeedAnalysisWorkerService({
  provider: intelligenceProvider,
  jobRepository: analysisJobRepository,
  itemRepository,
  analysisRepository,
  config: INTELLIGENCE_CONFIG
});
const digestGenerationService = createDigestGenerationService({ provider: intelligenceProvider });

let coverageCache = null;

async function readCoverageStats() {
  const currentTime = Date.now();
  if (coverageCache && coverageCache.expiresAt > currentTime) return coverageCache.value;
  const value = await dayIndexRepository.stats();
  coverageCache = { value, expiresAt: currentTime + (5 * 60 * 1000) };
  return value;
}

async function coverageFor(entitlement) {
  try {
    const stats = await readCoverageStats();
    const completeFrom = stats.completeFrom ? `${stats.completeFrom}T00:00:00.000Z` : null;
    const history = entitlement.entitlements.history;
    let complete = false;
    if (history.mode === 'all') {
      complete = Boolean(stats.oldestDate) && Number(stats.partialDayCount) === 0;
    } else if (completeFrom) {
      const cutoff = new Date(Date.now() - (Number(history.days) * 24 * 60 * 60 * 1000))
        .toISOString().slice(0, 10);
      complete = stats.completeFrom <= cutoff;
    }
    return { state: complete ? 'complete' : 'partial', completeFrom };
  } catch (error) {
    console.warn('Knowledge feed coverage could not be resolved', { message: error && error.message });
    return { state: 'partial', completeFrom: null };
  }
}

async function resolveEntitlement(actor = null) {
  const entitlement = await entitlementService.resolve(actor || actorService.resolve());
  const coverage = await coverageFor(entitlement);
  return { ...entitlement, coverage };
}

const ACTION_HANDLERS = Object.freeze({
  entitlements: async () => resolveEntitlement(),
  setRolePreview: async (event) => {
    const actor = actorService.resolve();
    await rolePreviewService.set(actor, event.role);
    return resolveEntitlement(actor);
  },
  feed: async (event) => {
    const entitlement = await resolveEntitlement();
    return event.mode === 'curated'
      ? curatedFeedQueryService.getFeed(event, entitlement)
      : itemFeedQueryService.getFeed(event, entitlement);
  },
  item: async (event) => itemFeedQueryService.getItem(event.id, await resolveEntitlement()),
  digest: async (event) => digestQueryService.getDigest(event.windowKey, await resolveEntitlement()),
  digestReference: async (event) => digestQueryService.getReference(
    event.digestId,
    event.itemId,
    await resolveEntitlement()
  )
});

async function main(event = {}) {
  try {
    const scheduled = resolveScheduledTrigger(event, { source: SOURCE_SYNC_CONFIG.triggerName });
    if (scheduled === 'source') {
      const legacy = await syncCycleService.run(event);
      const itemStore = await allFeedSyncService.run();
      const visualBackfill = await visualWorkerService.run();
      const intelligence = await analysisWorkerService.run();
      const digests = await digestGenerationService.runDue();
      return ok({ ...legacy, itemStore, visualBackfill, intelligence, digests });
    }
    const handler = ACTION_HANDLERS[event.action || 'feed'];
    if (!handler) throw new AppError('INVALID_REQUEST', '不支持的操作');
    return ok(await handler(event));
  } catch (error) {
    return fail(error);
  }
}

exports.main = main;
