const cloud = require('wx-server-sdk');
const cloudbase = require('@cloudbase/node-sdk');
const { createAihotSource } = require('./adapters/aihot-source');
const { createAigclinkSource } = require('./adapters/aigclink-source');
const {
  createAihotFeedEnrichmentAdapter
} = require('./adapters/aihot-feed-enrichment');
const { createIntelligenceProvider } = require('./adapters/intelligence-provider');
const {
  createSourcePreviewRendererClient
} = require('./adapters/source-preview-renderer-client');
const {
  SOURCE_CONFIG,
  SOURCE_METADATA_CONFIG,
  AIGCLINK_SOURCE_CONFIG,
  CACHE_CONFIG,
  ARCHIVE_CONFIG,
  ITEM_STORE_CONFIG,
  MEMBERSHIP_CONFIG,
  ENGAGEMENT_CONFIG,
  COLUMN_CONFIG,
  MEMBERSHIP_FEATURE_FLAGS,
  INTELLIGENCE_CONFIG,
  SOURCE_SYNC_CONFIG,
  COVER_CONFIG,
  PREVIEW_CONFIG,
  LIST_THUMBNAIL_CONFIG,
  VISUAL_MAINTENANCE_CONFIG,
  VISUAL_JOB_CONFIG,
  TIMER_CONFIG
} = require('./config');
const { AppError, ok, fail } = require('./lib/errors');
const { createSafeLogger } = require('./lib/safe-log');
const { extractCoverUrl } = require('./lib/image-meta');
const { fetchPublicBuffer } = require('./lib/network');
const { resolveScheduledTrigger } = require('./policies/timer-trigger');
const { createFeedCacheRepository } = require('./repositories/feed-cache');
const { createSourceProfileRepository } = require('./repositories/source-profile');
const { createFeedArchiveRepository } = require('./repositories/feed-archive');
const { createFeedItemRepository } = require('./repositories/feed-item');
const { createFeedDayIndexRepository } = require('./repositories/feed-day-index');
const { createFeedSyncStateRepository } = require('./repositories/feed-sync-state');
const { createFeedAccessRepository } = require('./repositories/feed-access');
const { createMembershipRepository } = require('./repositories/membership');
const { createFeedEngagementRepository } = require('./repositories/feed-engagement');
const { createUserProfileRepository } = require('./repositories/user-profile');
const { createUserMediaRepository } = require('./repositories/user-media');
const { createFeedVisualJobRepository } = require('./repositories/feed-visual-job');
const { createFeedAnalysisRepository } = require('./repositories/feed-analysis');
const { createFeedAnalysisJobRepository } = require('./repositories/feed-analysis-job');
const { createFeedDigestRepository } = require('./repositories/feed-digest');
const { createColumnEditorialRepository } = require('./repositories/column-editorial');
const {
  createModerationBackfillRepository
} = require('./repositories/moderation-backfill');
const { createCoverService } = require('./services/cover-service');
const { createCloudFileDeleter } = require('./services/cloud-file-deleter');
const { createFeedService } = require('./services/feed-service');
const { createPreviewService } = require('./services/preview-service');
const {
  createSourcePreviewReviewService
} = require('./services/source-preview-review-service');
const { createListThumbnailService } = require('./services/list-thumbnail-service');
const { createSourceSyncService } = require('./services/source-sync-service');
const {
  createSourceMetadataEnrichmentService
} = require('./services/source-metadata-enrichment-service');
const { createVisualMaintenanceService } = require('./services/visual-maintenance-service');
const { createVisualCleanupService } = require('./services/visual-cleanup-service');
const { createFeedArchiveService } = require('./services/feed-archive-service');
const { createActorService } = require('./services/actor-service');
const { createFeedEntitlementService } = require('./services/feed-entitlement-service');
const { createItemFeedQueryService } = require('./services/item-feed-query-service');
const { createCuratedFeedQueryService } = require('./services/curated-feed-query-service');
const { createDigestQueryService } = require('./services/digest-query-service');
const { createDigestGenerationService } = require('./services/digest-generation-service');
const { createDigestMaintenanceService } = require('./services/digest-maintenance-service');
const { createFeedAnalysisWorkerService } = require('./services/feed-analysis-worker-service');
const { createAllFeedSyncService } = require('./services/all-feed-sync-service');
const { createAigclinkSyncService } = require('./services/aigclink-sync-service');
const {
  createFeedSyncMaintenanceService
} = require('./services/feed-sync-maintenance-service');
const { createFeedVisualWorkerService } = require('./services/feed-visual-worker-service');
const { createRolePreviewService } = require('./services/role-preview-service');
const { createFeedEngagementService } = require('./services/feed-engagement-service');
const { createUserProfileService } = require('./services/user-profile-service');
const { createUserMediaService } = require('./services/user-media-service');
const {
  createUserMediaPublicationVerifier
} = require('./services/user-media-publication-verifier');
const { createCloudbaseMediaUploader } = require('./services/cloudbase-media-uploader');
const { createCommentModerationService } = require('./services/comment-moderation-service');
const { createProfileModerationService } = require('./services/profile-moderation-service');
const { createColumnContentService } = require('./services/column-content-service');
const { createColumnEditorialService } = require('./services/column-editorial-service');
const { createScheduledWorkService } = require('./services/scheduled-work-service');
const {
  createModerationBackfillService
} = require('./services/moderation-backfill-service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const cloudbaseApp = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

const database = cloud.database();
const logger = createSafeLogger(console);
const cacheRepository = createFeedCacheRepository(database, CACHE_CONFIG);
const sourceProfileRepository = createSourceProfileRepository(database, SOURCE_METADATA_CONFIG);
const archiveRepository = createFeedArchiveRepository(database, ARCHIVE_CONFIG);
const itemRepository = createFeedItemRepository(database, ITEM_STORE_CONFIG);
const engagementRepository = createFeedEngagementRepository(database, {
  ...ENGAGEMENT_CONFIG,
  ensureItems: itemRepository.ensureCollection
});
const userProfileRepository = createUserProfileRepository(database, ENGAGEMENT_CONFIG);
const userMediaRepository = createUserMediaRepository(database, ENGAGEMENT_CONFIG);
const dayIndexRepository = createFeedDayIndexRepository(database, ITEM_STORE_CONFIG);
const syncStateRepository = createFeedSyncStateRepository(database, ITEM_STORE_CONFIG);
const accessRepository = createFeedAccessRepository(database, ITEM_STORE_CONFIG);
const membershipRepository = createMembershipRepository(database, MEMBERSHIP_CONFIG);
const analysisRepository = createFeedAnalysisRepository(database, INTELLIGENCE_CONFIG);
const analysisJobRepository = createFeedAnalysisJobRepository(database, INTELLIGENCE_CONFIG);
const digestRepository = createFeedDigestRepository(database, INTELLIGENCE_CONFIG);
const columnEditorialRepository = createColumnEditorialRepository(database, COLUMN_CONFIG);
const moderationBackfillRepository = createModerationBackfillRepository(database, ENGAGEMENT_CONFIG);
const intelligenceProvider = createIntelligenceProvider(INTELLIGENCE_CONFIG, {
  cloud,
  database,
  logger
});
const visualJobConfig = Object.freeze({
  ...VISUAL_JOB_CONFIG,
  provider: ITEM_STORE_CONFIG.provider,
  itemsCollectionName: ITEM_STORE_CONFIG.itemsCollectionName,
  captureVersion: PREVIEW_CONFIG.captureVersion,
  captureProfile: PREVIEW_CONFIG.captureProfile,
  thumbnailVersion: LIST_THUMBNAIL_CONFIG.version,
  visualPublicationGraceMs: ITEM_STORE_CONFIG.visualPublicationGraceMs
});
const visualJobRepository = createFeedVisualJobRepository(database, visualJobConfig);
const sourceMetadataAdapter = createAihotFeedEnrichmentAdapter(SOURCE_METADATA_CONFIG);
const sourceMetadataEnrichmentService = createSourceMetadataEnrichmentService({
  adapter: sourceMetadataAdapter,
  profileRepository: sourceProfileRepository,
  itemRepository,
  cloud,
  cloudPathPrefix: SOURCE_METADATA_CONFIG.cloudPathPrefix,
  mediaCloudPathPrefix: SOURCE_METADATA_CONFIG.mediaCloudPathPrefix,
  previewCaptureVersion: PREVIEW_CONFIG.captureVersion,
  logger
});
const source = createAihotSource(
  SOURCE_CONFIG,
  fetch,
  sourceMetadataEnrichmentService,
  logger
);
const sourceSyncService = createSourceSyncService({
  repository: cacheRepository,
  source,
  config: SOURCE_SYNC_CONFIG,
  ownedVisualPrefixes: [
    COVER_CONFIG.fileIdPrefix,
    PREVIEW_CONFIG.fileIdPrefix,
    LIST_THUMBNAIL_CONFIG.fileIdPrefix
  ],
  logger
});
const legacyFeedService = createFeedService({
  repository: cacheRepository,
  ensureCache: () => sourceSyncService.ensureCache(),
  visualPublicationGraceMs: ITEM_STORE_CONFIG.visualPublicationGraceMs,
  logger
});
const coverService = createCoverService({
  cloud,
  repository: cacheRepository,
  fetchPublicBuffer,
  extractCoverUrl,
  config: COVER_CONFIG,
  logger
});
const sourcePreviewReviewService = createSourcePreviewReviewService({
  provider: intelligenceProvider,
  minConfidence: PREVIEW_CONFIG.reviewMinConfidence,
  maxImages: PREVIEW_CONFIG.reviewMaxImages,
  reviewDeadlineMs: PREVIEW_CONFIG.reviewDeadlineMs,
  imageMaxWidth: PREVIEW_CONFIG.reviewImageMaxWidth,
  imageMaxHeight: PREVIEW_CONFIG.reviewImageMaxHeight,
  imageMaxBytes: PREVIEW_CONFIG.reviewImageMaxBytes,
  imageQuality: PREVIEW_CONFIG.reviewImageQuality
});
const sourcePreviewRendererClient = createSourcePreviewRendererClient({
  cloud,
  config: PREVIEW_CONFIG,
  logger
});
const previewService = createPreviewService({
  cloud,
  repository: cacheRepository,
  config: PREVIEW_CONFIG,
  sourcePreviewReviewService,
  rendererClient: sourcePreviewRendererClient,
  logger
});
const thumbnailService = createListThumbnailService({
  cloud,
  config: LIST_THUMBNAIL_CONFIG,
  rendererClient: sourcePreviewRendererClient
});
const deleteFiles = createCloudFileDeleter(cloud);
const uploadUserMedia = createCloudbaseMediaUploader({
  getUploadMetadata: (options) => cloudbaseApp.getUploadMetadata(options)
});
const userMediaPublicationVerifier = createUserMediaPublicationVerifier({
  profileRepository: userProfileRepository,
  engagementRepository
});
const userMediaService = createUserMediaService({
  repository: userMediaRepository,
  config: ENGAGEMENT_CONFIG,
  publicationVerifier: userMediaPublicationVerifier,
  getFileInfo: (options) => cloudbaseApp.getFileInfo(options),
  uploadFile: uploadUserMedia,
  getTempFileURL: (options) => cloudbaseApp.getTempFileURL(options),
  copyFile: (options) => cloudbaseApp.copyFile(options),
  deleteFiles
});
const commentModerationService = createCommentModerationService({
  provider: intelligenceProvider,
  getTempFileURL: (options) => cloud.getTempFileURL(options),
  logger
});
const profileModerationService = createProfileModerationService({
  provider: intelligenceProvider,
  getTempFileURL: (options) => cloud.getTempFileURL(options),
  logger
});
// Legacy moderation must never delete user media. Rejected records remain stored
// and are only removed from public views by their moderation state.
const backfillCommentModerationService = createCommentModerationService({
  provider: intelligenceProvider,
  getTempFileURL: (options) => cloud.getTempFileURL(options),
  deleteFiles: async () => null
});
const moderationBackfillService = createModerationBackfillService({
  repository: moderationBackfillRepository,
  commentModerationService: backfillCommentModerationService,
  profileModerationService,
  maintenanceToken: PREVIEW_CONFIG.maintenanceToken
});
const userProfileService = createUserProfileService({
  repository: userProfileRepository,
  config: ENGAGEMENT_CONFIG,
  profileModerationService,
  userMediaService
});
const columnContentService = createColumnContentService({
  repository: columnEditorialRepository,
  getTempFileURL: (options) => cloud.getTempFileURL(options)
});
const cleanupService = createVisualCleanupService({
  repository: cacheRepository,
  deleteFiles,
  ownedVisualPrefixes: [
    COVER_CONFIG.fileIdPrefix,
    PREVIEW_CONFIG.fileIdPrefix,
    LIST_THUMBNAIL_CONFIG.fileIdPrefix
  ],
  logger
});
const visualMaintenanceService = createVisualMaintenanceService({
  repository: cacheRepository,
  sourceSyncService,
  coverService,
  previewService,
  cleanupService,
  previewMaintenanceToken: PREVIEW_CONFIG.maintenanceToken,
  config: VISUAL_MAINTENANCE_CONFIG,
  logger
});
const archiveService = createFeedArchiveService({
  repository: cacheRepository,
  archiveRepository,
  source,
  config: ARCHIVE_CONFIG,
  logger
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
const engagementService = createFeedEngagementService({
  repository: engagementRepository,
  profileRepository: userProfileRepository,
  itemLoader: (itemId, entitlement) => itemFeedQueryService.getItem(itemId, entitlement),
  commentModerationService,
  userMediaService,
  config: ENGAGEMENT_CONFIG
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
  config: ITEM_STORE_CONFIG,
  logger
});
const aigclinkSource = createAigclinkSource(AIGCLINK_SOURCE_CONFIG, fetch);
const aigclinkSyncService = createAigclinkSyncService({
  source: aigclinkSource,
  itemRepository,
  dayIndexRepository,
  syncStateRepository,
  visualJobRepository,
  config: AIGCLINK_SOURCE_CONFIG,
  logger
});
const feedSyncMaintenanceService = createFeedSyncMaintenanceService({
  allFeedSyncService,
  maintenanceToken: PREVIEW_CONFIG.maintenanceToken
});
const visualWorkerService = createFeedVisualWorkerService({
  jobRepository: visualJobRepository,
  itemRepository,
  syncStateRepository,
  coverService,
  previewService,
  thumbnailService,
  deleteFiles,
  config: visualJobConfig,
  logger
});
const analysisWorkerService = createFeedAnalysisWorkerService({
  provider: intelligenceProvider,
  jobRepository: analysisJobRepository,
  itemRepository,
  analysisRepository,
  config: INTELLIGENCE_CONFIG,
  logger
});
const digestGenerationService = createDigestGenerationService({
  provider: intelligenceProvider,
  digestRepository,
  itemRepository,
  config: INTELLIGENCE_CONFIG
});
const digestMaintenanceService = createDigestMaintenanceService({
  digestGenerationService,
  maintenanceToken: PREVIEW_CONFIG.maintenanceToken
});
const columnEditorialService = createColumnEditorialService({
  provider: intelligenceProvider,
  repository: columnEditorialRepository,
  itemRepository,
  config: COLUMN_CONFIG
});
const scheduledWorkService = createScheduledWorkService({
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
});

const SCHEDULED_HANDLERS = Object.freeze({
  source: (event) => scheduledWorkService.syncSource(event),
  archive: () => scheduledWorkService.maintainArchive(),
  legacyVisual: () => scheduledWorkService.maintainLegacyVisuals(),
  visualWorker: () => scheduledWorkService.processVisuals(),
  intelligenceWorker: () => scheduledWorkService.processIntelligence(),
  dailyDigest: () => scheduledWorkService.generateDigest('24h'),
  weeklyDigest: () => scheduledWorkService.generateDigest('7d'),
  monthlyDigest: () => scheduledWorkService.generateDigest('30d'),
  weeklyColumn: () => scheduledWorkService.generateWeeklyColumn()
});

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
    logger.warn('Knowledge feed coverage could not be resolved', {
      code: error && error.code || 'UNKNOWN'
    });
    return { state: 'partial', completeFrom: null };
  }
}

async function resolveEntitlement(actor = null) {
  const entitlement = await entitlementService.resolve(actor || actorService.resolve());
  const coverage = await coverageFor(entitlement);
  return { ...entitlement, coverage };
}

const ACTION_HANDLERS = Object.freeze({
  uploadMedia: async (event) => {
    const actor = actorService.resolve();
    return userMediaService.reserveUpload(actor, {
      kind: event.kind,
      extension: event.extension,
      contentBase64: event.contentBase64
    });
  },
  resolveUserMedia: async (event) => {
    const actor = actorService.resolve();
    const entitlement = await resolveEntitlement(actor);
    return {
      files: await userMediaService.resolveVisible(event.fileIds, {
        ownerKey: actor.ownerKey,
        comments: entitlement.entitlements.comments === true,
        isAdmin: entitlement.viewer && entitlement.viewer.isActualAdmin === true
      })
    };
  },
  entitlements: async () => resolveEntitlement(),
  setRolePreview: async (event) => {
    const actor = actorService.resolve();
    await rolePreviewService.set(actor, event.role);
    return resolveEntitlement(actor);
  },
  feed: async (event) => {
    const actor = actorService.resolve();
    const entitlement = await resolveEntitlement(actor);
    const feed = event.mode === 'curated'
      ? curatedFeedQueryService.getFeed(event, entitlement)
      : itemFeedQueryService.getFeed(event, entitlement);
    return engagementService.decorateFeed(await feed, actor, entitlement);
  },
  feedDay: async (event) => {
    const actor = actorService.resolve();
    const entitlement = await resolveEntitlement(actor);
    return engagementService.decorateFeed(
      await itemFeedQueryService.getDay(event, entitlement),
      actor,
      entitlement
    );
  },
  feedUpdates: async (event) => itemFeedQueryService.getUpdates(event, await resolveEntitlement()),
  item: async (event) => {
    const actor = actorService.resolve();
    const entitlement = await resolveEntitlement(actor);
    const item = await itemFeedQueryService.getItem(event.id, entitlement);
    return engagementService.decorateItem(item, actor, entitlement);
  },
  toggleLike: async (event) => {
    const actor = actorService.resolve();
    return engagementService.toggleLike(
      event.id,
      typeof event.liked === 'boolean' ? event.liked : undefined,
      actor,
      await resolveEntitlement(actor)
    );
  },
  toggleFavorite: async (event) => {
    const actor = actorService.resolve();
    return engagementService.toggleFavorite(
      event.id,
      typeof event.favorited === 'boolean' ? event.favorited : undefined,
      actor,
      await resolveEntitlement(actor)
    );
  },
  comments: async (event) => {
    const actor = actorService.resolve();
    return engagementService.listComments(event.id, actor, await resolveEntitlement(actor));
  },
  addComment: async (event) => {
    const actor = actorService.resolve();
    return engagementService.addComment(
      event.id,
      {
        content: event.content,
        attachments: event.attachments,
        clientMutationId: event.clientMutationId
      },
      actor,
      await resolveEntitlement(actor)
    );
  },
  deleteComment: async (event) => {
    const actor = actorService.resolve();
    return engagementService.deleteComment(
      event.id,
      event.commentId,
      actor,
      await resolveEntitlement(actor)
    );
  },
  reportComment: async (event) => {
    const actor = actorService.resolve();
    return engagementService.reportComment(
      event.id,
      event.commentId,
      actor,
      await resolveEntitlement(actor)
    );
  },
  appealComment: async (event) => {
    const actor = actorService.resolve();
    return engagementService.appealComment(
      event.id,
      event.commentId,
      actor,
      await resolveEntitlement(actor)
    );
  },
  restoreComment: async (event) => {
    const actor = actorService.resolve();
    return engagementService.restoreComment(
      event.id,
      event.commentId,
      actor,
      await resolveEntitlement(actor)
    );
  },
  profile: async () => {
    const actor = actorService.resolve();
    return userProfileService.get(actor);
  },
  saveProfile: async (event) => {
    const actor = actorService.resolve();
    return userProfileService.save(event.profile, actor);
  },
  columnContent: async () => {
    const actor = actorService.resolve();
    return columnContentService.get(await resolveEntitlement(actor));
  },
  columnHome: async () => {
    const actor = actorService.resolve();
    return columnContentService.home(await resolveEntitlement(actor));
  },
  columnLesson: async (event) => {
    const actor = actorService.resolve();
    return columnContentService.lesson(event.lessonId, await resolveEntitlement(actor));
  },
  columnPractical: async (event) => {
    const actor = actorService.resolve();
    return columnContentService.practical(event.practicalId, await resolveEntitlement(actor));
  },
  columnCases: async (event) => {
    const actor = actorService.resolve();
    return columnContentService.listCases(event, await resolveEntitlement(actor));
  },
  columnCase: async (event) => {
    const actor = actorService.resolve();
    return columnContentService.getCase(event.caseId, await resolveEntitlement(actor));
  },
  trendDossier: async (event) => {
    const actor = actorService.resolve();
    return columnContentService.trendDossier(event.key, await resolveEntitlement(actor));
  },
  favorites: async () => {
    const actor = actorService.resolve();
    return engagementService.listFavorites(actor, await resolveEntitlement(actor));
  },
  digest: async (event) => digestQueryService.getDigest(event.windowKey, await resolveEntitlement()),
  digestReference: async (event) => digestQueryService.getReference(
    event.digestId,
    event.itemId,
    await resolveEntitlement()
  ),
  digestRegenerate: async (event) => digestMaintenanceService.regenerate(event),
  feedRefresh: async (event) => feedSyncMaintenanceService.refresh(event),
  moderationBackfill: async (event) => moderationBackfillService.run(event)
});

async function main(event = {}) {
  try {
    const scheduled = resolveScheduledTrigger(event, TIMER_CONFIG);
    if (scheduled) return ok(await SCHEDULED_HANDLERS[scheduled](event));
    const handler = ACTION_HANDLERS[event.action || 'feed'];
    if (!handler) throw new AppError('INVALID_REQUEST', '不支持的操作');
    return ok(await handler(event));
  } catch (error) {
    if (event && event.Type === 'Timer') throw error;
    return fail(error);
  }
}

exports.main = main;
