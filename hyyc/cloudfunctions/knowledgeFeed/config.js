const SOURCE_CONFIG = Object.freeze({
  provider: 'aihot',
  apiRoot: 'https://aihot.virxact.com/api/public/items',
  fingerprintRoot: 'https://aihot.virxact.com/api/public/fingerprint',
  dailyIndexRoot: 'https://aihot.virxact.com/api/public/dailies',
  dailyRoot: 'https://aihot.virxact.com/api/public/daily',
  pageSize: 100,
  maxItems: 500,
  allMaxItems: 6000,
  timeoutMs: 8000
});

const SOURCE_METADATA_CONFIG = Object.freeze({
  feedRoot: 'https://aihot.virxact.com/api/public/feed',
  timeoutMs: 5000,
  avatarTimeoutMs: 5000,
  mediaTimeoutMs: 8000,
  maxPages: 3,
  // AI HOT does not expose first-party membership on /items. Scan its own
  // firstParty feed deeply enough to classify the complete 30-day member view.
  firstPartyMaxPages: 25,
  maxItemsPerPage: 100,
  maxResponseBytes: 512 * 1024,
  maxAvatarBytes: 256 * 1024,
  maxMediaBytes: 2.5 * 1024 * 1024,
  collectionName: 'knowledge_feed_source_profiles',
  cloudPathPrefix: 'knowledge-source-avatars/x/',
  mediaCloudPathPrefix: 'knowledge-previews/source/aihot-media/'
});

const AIGCLINK_SOURCE_CONFIG = Object.freeze({
  siteRoot: 'https://d.aigclink.ai',
  queryRoot: 'https://d.aigclink.ai/api/v3/queryCollection?src=initial_load',
  collectionId: 'bf0ecb26-74f9-4cb9-8d02-95b0ea44beab',
  viewId: '8f252a54-730e-49f4-b8ca-f897b7ae49f6',
  spaceId: '4ce4d650-ed04-405e-a492-bd790ae10569',
  excludedTags: Object.freeze([]),
  headItems: 30,
  maxItems: 5000,
  maxSegments: 10,
  timeoutMs: 15 * 1000,
  // Keep this below the one-minute timer cadence so scheduler jitter cannot
  // accidentally defer a head check to the following minute.
  pollMs: 45 * 1000,
  fullRefreshMs: 24 * 60 * 60 * 1000,
  // Keep ownership beyond the 300-second CloudBase function timeout. This
  // prevents a replacement worker from taking over while a timed-out worker's
  // final database request is still settling.
  leaseMs: 6 * 60 * 1000,
  visualPriorityBoost: 1500,
  visualRecentWindowMs: 7 * 24 * 60 * 60 * 1000,
  writeDayIndex: false,
  provider: 'aihot',
  syncVersion: 3,
  sourceAvatarFileId: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-source-avatars/github-invertocat-black-clearspace-v1.png'
});

// Visual generation is forward-only from this release. Existing news keeps
// its current assets and is not backfilled or recaptured by scheduled work.
const NEW_VISUALS_AFTER = '2026-07-18T04:43:08.568Z';

const CACHE_CONFIG = Object.freeze({
  collectionName: 'knowledge_feed_cache',
  documentId: 'aihot_selected'
});

const ARCHIVE_CONFIG = Object.freeze({
  collectionName: 'knowledge_feed_archive',
  triggerName: 'knowledge-feed-archive-maintenance',
  retentionDays: 90,
  upstreamWindowDays: 7,
  historyBatchDays: 10,
  historyIndexTake: 60,
  historyRefreshMs: 24 * 60 * 60 * 1000,
  currentRefreshMs: 24 * 60 * 60 * 1000,
  retentionCheckMs: 24 * 60 * 60 * 1000,
  statsRefreshMs: 24 * 60 * 60 * 1000
});

const ITEM_STORE_CONFIG = Object.freeze({
  provider: 'aihot',
  itemsCollectionName: 'knowledge_feed_items',
  dayIndexCollectionName: 'knowledge_feed_day_index',
  syncStateCollectionName: 'knowledge_feed_sync_state',
  accessCollectionName: 'knowledge_feed_access_grants',
  migrationCollectionName: 'knowledge_feed_migrations',
  syncStateDocumentId: 'aihot_all',
  migrationDocumentId: 'item_store_v1',
  freeWindowDays: 1,
  memberWindowDays: 30,
  adminWindowDays: 90,
  queryPageSize: 8,
  queryMaxPageSize: 20,
  facetLimit: 12000,
  // The all-items sync shares the 300-second CloudBase invocation. Keep its
  // ownership beyond that hard timeout so an older invocation cannot overlap
  // a replacement worker's writes.
  syncLeaseMs: 6 * 60 * 1000,
  itemsRevalidateMs: 6 * 60 * 60 * 1000,
  fullRefreshMs: 24 * 60 * 60 * 1000,
  migrationDayBatchSize: 10,
  visualNewItemsOnly: true,
  visualPriorityBoost: 2000,
  // The dedicated visual worker probes four times per minute. Preserve the
  // four-minute publication ceiling even when individual captures are delayed.
  visualPublicationGraceMs: 4 * 60 * 1000
});

const MEMBERSHIP_CONFIG = Object.freeze({
  collectionName: 'knowledge_memberships',
  freeWindowDays: ITEM_STORE_CONFIG.freeWindowDays,
  memberWindowDays: ITEM_STORE_CONFIG.memberWindowDays
});

const ENGAGEMENT_CONFIG = Object.freeze({
  provider: ITEM_STORE_CONFIG.provider,
  itemsCollectionName: ITEM_STORE_CONFIG.itemsCollectionName,
  userEngagementsCollectionName: 'knowledge_feed_user_engagements',
  commentsCollectionName: 'knowledge_feed_comments',
  userProfilesCollectionName: 'knowledge_user_profiles',
  userProfileReviewsCollectionName: 'knowledge_user_profile_reviews',
  userMediaCollectionName: 'knowledge_user_media',
  messageEventsCollectionName: 'knowledge_message_events',
  userMessagesCollectionName: 'knowledge_user_messages',
  commentMaxLength: 280,
  commentPageSize: 30,
  commentImageLimit: 3,
  commentReportThreshold: 3,
  commentReportLimitPerItem: 100,
  commentGovernanceScanLimit: 500,
  commentImageMaxBytes: 3 * 1024 * 1024,
  avatarMaxBytes: 1 * 1024 * 1024,
  userMediaMaxDimension: 4096,
  userMediaMaxPixels: 12 * 1024 * 1024,
  favoriteListLimit: 100,
  userMediaReservationTtlMs: 30 * 60 * 1000,
  userMediaPublicationRecoveryTtlMs: 24 * 60 * 60 * 1000,
  userMediaCleanupBatchSize: 10,
  userMediaCleanupClaimLeaseMs: 10 * 60 * 1000,
  userProfileReviewBatchSize: 6,
  userProfileReviewConcurrency: 3,
  userProfileReviewLeaseMs: 2 * 60 * 1000,
  userProfileReviewMaxAttempts: 8,
  userProfileReviewMediaTtlMs: 7 * 24 * 60 * 60 * 1000,
  commentReviewBatchSize: 8,
  commentReviewConcurrency: 3,
  commentReviewLeaseMs: 2 * 60 * 1000,
  commentReviewMaxAttempts: 8,
  commentReviewMediaTtlMs: 7 * 24 * 60 * 60 * 1000,
  commentSubmissionCooldownMs: 30 * 1000,
  commentSubmissionWindowMs: 24 * 60 * 60 * 1000,
  commentSubmissionWindowLimit: 30,
  messageEventBatchSize: 12,
  messageEventConcurrency: 3,
  messageEventLeaseMs: 2 * 60 * 1000,
  messageEventMaxAttempts: 8,
    messageParticipantLimit: 200,
    messageParticipantScanLimit: 1000,
    userMessagePageSize: 50,
    userMessageMarkAllBudgetMs: 15 * 1000,
  userMediaFileIdRoot: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/',
  userMediaStagingPathPrefix: 'user-media/staging/',
  userMediaReviewPathPrefix: 'user-media/review/',
  userMediaPublishedPathPrefix: 'user-media/published/',
  userMediaStagingFileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/user-media/staging/',
  userMediaReviewFileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/user-media/review/',
  userMediaPublishedFileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/user-media/published/',
  avatarFileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/user-media/avatars/',
  commentImageFileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/user-media/comments/'
});

const COLUMN_CONFIG = Object.freeze({
  casesCollectionName: 'knowledge_column_cases',
  dossiersCollectionName: 'knowledge_trend_dossiers',
  eventsCollectionName: 'knowledge_trend_events',
  casePageSize: 8,
  caseMaxPageSize: 20,
  sourceLimit: 24,
  sourceScanPages: 3,
  minimumCandidates: 3,
  minimumCurationScore: 75,
  singleSourceMinimumScore: 85,
  dossierEventLimit: 100,
  generationLeaseMs: 10 * 60 * 1000
});

function localRuntimeConfig() {
  try {
    return require('./config.local');
  } catch (error) {
    return {};
  }
}

function enabledFlag(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function enabledDefault(value, fallback) {
  return value === undefined || value === null || value === ''
    ? fallback
    : enabledFlag(value);
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

const runtime = localRuntimeConfig();

const PACKY_BACKGROUND_TIMEOUT_MS = positiveInteger(
  process.env.PACKY_TIMEOUT_MS || runtime.packyTimeoutMs,
  90 * 1000,
  180 * 1000
);

const PACKY_MODERATION_TIMEOUT_MS = positiveInteger(
  process.env.PACKY_MODERATION_TIMEOUT_MS || runtime.packyModerationTimeoutMs,
  20 * 1000,
  60 * 1000
);

const MEMBERSHIP_FEATURE_FLAGS = Object.freeze({
  membershipUi: true,
  liveCurated: enabledDefault(
    process.env.KNOWLEDGE_LIVE_CURATED ?? runtime.knowledgeLiveCurated,
    true
  ),
  liveDigests: enabledDefault(
    process.env.KNOWLEDGE_LIVE_DIGESTS ?? runtime.knowledgeLiveDigests,
    true
  ),
  memberPurchases: enabledDefault(
    process.env.KNOWLEDGE_MEMBER_PURCHASES_ENABLED
      ?? runtime.knowledgeMemberPurchasesEnabled,
    false
  )
});

const INTELLIGENCE_CONFIG = Object.freeze({
  provider: ITEM_STORE_CONFIG.provider,
  providerEnabled: enabledDefault(
    process.env.KNOWLEDGE_INTELLIGENCE_ENABLED ?? runtime.knowledgeIntelligenceEnabled,
    true
  ),
  digestGenerationEnabled: enabledDefault(
    process.env.KNOWLEDGE_DIGEST_GENERATION_ENABLED
      ?? runtime.knowledgeDigestGenerationEnabled,
    true
  ),
  apiBaseUrl: process.env.PACKY_API_BASE_URL
    || runtime.packyApiBaseUrl
    || 'https://www.packyapi.com/v1',
  apiKey: process.env.PACKY_API_KEY || runtime.packyApiKey || '',
  model: process.env.PACKY_MODEL || runtime.packyModel || 'grok-4.5',
  // Grok 4.5 does not support disabling reasoning. Keep its fallback at the
  // minimum supported effort while every Qwen request explicitly disables it.
  reasoningEffort: 'low',
  cloudbaseEnabled: enabledDefault(
    process.env.KNOWLEDGE_CLOUDBASE_AI_ENABLED ?? runtime.knowledgeCloudbaseAiEnabled,
    true
  ),
  cloudbaseModelGroup: process.env.KNOWLEDGE_CLOUDBASE_MODEL_GROUP
    || runtime.knowledgeCloudbaseModelGroup
    || 'cloudbase',
  cloudbaseAnalysisModel: process.env.KNOWLEDGE_CLOUDBASE_ANALYSIS_MODEL
    || runtime.knowledgeCloudbaseAnalysisModel
    || 'qwen3.5-flash',
  cloudbaseDigestModel: process.env.KNOWLEDGE_CLOUDBASE_DIGEST_MODEL
    || runtime.knowledgeCloudbaseDigestModel
    || 'qwen3.5-plus',
  cloudbaseModerationTextModel: process.env.KNOWLEDGE_CLOUDBASE_MODERATION_TEXT_MODEL
    || runtime.knowledgeCloudbaseModerationTextModel
    || 'qwen3.5-flash',
  cloudbaseModerationImageModel: process.env.KNOWLEDGE_CLOUDBASE_MODERATION_IMAGE_MODEL
    || runtime.knowledgeCloudbaseModerationImageModel
    || 'qwen3.5-plus',
  cloudbaseTimeoutMs: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_TIMEOUT_MS || runtime.knowledgeCloudbaseTimeoutMs,
    180 * 1000,
    180 * 1000
  ),
  cloudbaseAnalysisTimeoutMs: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_ANALYSIS_TIMEOUT_MS
      || runtime.knowledgeCloudbaseAnalysisTimeoutMs,
    90 * 1000,
    120 * 1000
  ),
  cloudbaseDigestTimeoutMs: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_DIGEST_TIMEOUT_MS
      || runtime.knowledgeCloudbaseDigestTimeoutMs,
    180 * 1000,
    180 * 1000
  ),
  cloudbaseModerationTimeoutMs: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_MODERATION_TIMEOUT_MS
      || runtime.knowledgeCloudbaseModerationTimeoutMs,
    30 * 1000,
    30 * 1000
  ),
  cloudbaseSourcePreviewReviewTimeoutMs: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_SOURCE_PREVIEW_REVIEW_TIMEOUT_MS
      || runtime.knowledgeCloudbaseSourcePreviewReviewTimeoutMs,
    180 * 1000,
    240 * 1000
  ),
  cloudbaseFailureThreshold: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_FAILURE_THRESHOLD
      || runtime.knowledgeCloudbaseFailureThreshold,
    3,
    10
  ),
  cloudbaseCooldownMs: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_COOLDOWN_MS || runtime.knowledgeCloudbaseCooldownMs,
    5 * 60 * 1000,
    60 * 60 * 1000
  ),
  cloudbaseMonthlyPackagePoints: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_MONTHLY_PACKAGE_POINTS
      || runtime.knowledgeCloudbaseMonthlyPackagePoints,
    330000,
    10000000
  ),
  cloudbaseCoreReservePoints: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_CORE_RESERVE_POINTS
      || runtime.knowledgeCloudbaseCoreReservePoints,
    100000,
    10000000
  ),
  cloudbaseMonthlyAiPointLimit: positiveInteger(
    process.env.KNOWLEDGE_CLOUDBASE_AI_MONTHLY_POINT_LIMIT
      || runtime.knowledgeCloudbaseAiMonthlyPointLimit,
    60000,
    1000000
  ),
  cloudbaseOutputTokenReserveMultiplier: 2,
  cloudbaseBudgetCollectionName: 'knowledge_ai_budget',
  cloudbaseModelPointRates: Object.freeze({
    'qwen3.5-flash': Object.freeze({ inputPerMillion: 200, outputPerMillion: 2000 }),
    'qwen3.5-plus': Object.freeze({ inputPerMillion: 800, outputPerMillion: 4800 })
  }),
  packyTimeoutMs: PACKY_BACKGROUND_TIMEOUT_MS,
  packyModerationTimeoutMs: PACKY_MODERATION_TIMEOUT_MS,
  packySourcePreviewReviewTimeoutMs: positiveInteger(
    process.env.KNOWLEDGE_PACKY_SOURCE_PREVIEW_REVIEW_TIMEOUT_MS
      || runtime.knowledgePackySourcePreviewReviewTimeoutMs,
    90 * 1000,
    180 * 1000
  ),
  // Keep the legacy name for callers that still consume this config directly.
  timeoutMs: PACKY_BACKGROUND_TIMEOUT_MS,
  analysisMaxOutputTokens: 1800,
  analysisBatchMaxOutputTokens: 3600,
  digestMaxOutputTokens: 3600,
  columnCaseMaxOutputTokens: 2800,
  sourcePreviewReviewMaxOutputTokens: 300,
  policyVersion: 1,
  analysisCollectionName: 'knowledge_feed_item_analysis',
  analysisJobsCollectionName: 'knowledge_feed_analysis_jobs',
  digestsCollectionName: 'knowledge_feed_digests',
  itemsCollectionName: ITEM_STORE_CONFIG.itemsCollectionName,
  dayIndexCollectionName: ITEM_STORE_CONFIG.dayIndexCollectionName,
  jobLeaseMs: 4 * 60 * 1000,
  dueBatchSize: 10,
  jobsPerCycle: positiveInteger(
    process.env.KNOWLEDGE_INTELLIGENCE_JOBS_PER_CYCLE
      || runtime.knowledgeIntelligenceJobsPerCycle,
    10,
    25
  ),
  workerIntervalMinutes: positiveInteger(
    process.env.KNOWLEDGE_INTELLIGENCE_INTERVAL_MINUTES
      || runtime.knowledgeIntelligenceIntervalMinutes,
    10,
    60
  ),
  maxAnalysisJobsPerDay: positiveInteger(
    process.env.KNOWLEDGE_MAX_ANALYSIS_JOBS_PER_DAY || runtime.knowledgeMaxAnalysisJobsPerDay,
    10000,
    10000
  ),
  digestSourceLimit: 40,
  maxAttempts: 8
});

const SOURCE_SYNC_CONFIG = Object.freeze({
  triggerName: 'knowledge-feed-source-sync',
  leaseMs: 2 * 60 * 1000,
  itemsRevalidateMs: 6 * 60 * 60 * 1000,
  fullRefreshMs: 24 * 60 * 60 * 1000,
  rateLimitBackoffMs: 60 * 1000,
  serverErrorBaseBackoffMs: 60 * 1000,
  defaultBackoffMs: 5 * 60 * 1000,
  maxBackoffMs: 15 * 60 * 1000,
  visualNewItemsAfter: NEW_VISUALS_AFTER
});

const COVER_CONFIG = Object.freeze({
  maxBytes: 2.5 * 1024 * 1024,
  retryMs: 12 * 60 * 60 * 1000,
  cloudPathPrefix: 'knowledge-covers/aihot/',
  fileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-covers/aihot/',
  newItemsAfter: NEW_VISUALS_AFTER,
  imageTypes: Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  })
});

const PREVIEW_CONFIG = Object.freeze({
  rendererFunctionName: process.env.SOURCE_PREVIEW_FUNCTION_NAME
    || runtime.sourcePreviewFunctionName
    || 'sourcePreviewWorker',
  rendererFunctionEnabled: enabledDefault(
    process.env.SOURCE_PREVIEW_FUNCTION_ENABLED ?? runtime.sourcePreviewFunctionEnabled,
    true
  ),
  rendererFunctionTimeoutMs: 88 * 1000,
  rendererHttpFallbackEnabled: enabledDefault(
    process.env.SOURCE_PREVIEW_HTTP_FALLBACK_ENABLED
      ?? runtime.sourcePreviewHttpFallbackEnabled,
    false
  ),
  rendererUrl: process.env.SOURCE_PREVIEW_RENDERER_URL || runtime.sourcePreviewRendererUrl || '',
  rendererToken: process.env.SOURCE_PREVIEW_RENDERER_TOKEN || runtime.sourcePreviewRendererToken || '',
  maintenanceToken: process.env.KNOWLEDGE_FEED_MAINTENANCE_TOKEN || runtime.knowledgeFeedMaintenanceToken || '',
  rendererTimeoutMs: 55 * 1000,
  retryMs: 5 * 60 * 1000,
  maxResponseBytes: 22 * 1024 * 1024,
  maxImageBytes: 1.25 * 1024 * 1024,
  maxSegments: 12,
  captureVersion: 3,
  captureProfile: 'focus-v1',
  reviewMinConfidence: 0.9,
  reviewMaxImages: 1,
  reviewDeadlineMs: 210 * 1000,
  reviewImageMaxWidth: 720,
  reviewImageMaxHeight: 900,
  reviewImageMaxBytes: 320 * 1024,
  reviewImageQuality: 60,
  newItemsAfter: NEW_VISUALS_AFTER,
  cloudPathPrefix: 'knowledge-previews/source/',
  fileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-previews/source/'
});

const LIST_THUMBNAIL_CONFIG = Object.freeze({
  rendererFunctionName: PREVIEW_CONFIG.rendererFunctionName,
  rendererFunctionEnabled: PREVIEW_CONFIG.rendererFunctionEnabled,
  rendererFunctionTimeoutMs: PREVIEW_CONFIG.rendererFunctionTimeoutMs,
  rendererHttpFallbackEnabled: PREVIEW_CONFIG.rendererHttpFallbackEnabled,
  rendererUrl: PREVIEW_CONFIG.rendererUrl,
  rendererToken: PREVIEW_CONFIG.rendererToken,
  rendererTimeoutMs: 12 * 1000,
  maxResponseBytes: 256 * 1024,
  maxImageBytes: 180 * 1024,
  version: 1,
  width: 360,
  height: 253,
  cloudPathPrefix: 'knowledge-thumbnails/list/',
  fileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-thumbnails/list/'
});

const VISUAL_MAINTENANCE_CONFIG = Object.freeze({
  coverBatchSize: 9,
  previewBatchSize: 1,
  immediateCoverBatchSize: 3,
  immediatePreviewBatchSize: 1,
  leaseMs: 4 * 60 * 1000
});

const VISUAL_JOB_CONFIG = Object.freeze({
  collectionName: 'knowledge_feed_visual_jobs',
  seedDocumentId: 'visual_jobs_v1',
  dueBatchSize: 40,
  laneCandidateSize: 40,
  legacyLaneCandidateSize: 100,
  repairReason: 'PREVIEW_CONTENT_INVALID',
  obsoleteCleanupBatchSize: 1,
  // Each screenshot request still owns one isolated 2GB CloudBase instance.
  // The orchestrator starts up to six requests together, then drains another
  // bounded batch while its lease is active. Six stays below the relay's
  // measured 4096-connection envelope while leaving headroom for personal use.
  jobsPerCycle: 38,
  maxJobsPerInvocation: 38,
  maxCaptureConcurrency: 6,
  targetLiveWaitingJobs: 0,
  workerSoftDeadlineMs: 290 * 1000,
  // Exact X status pages pass deterministic target matching and normally need
  // about 13 seconds. Keep enough room for the worker's 90-second hard timeout
  // while allowing more than one four-item batch per orchestration cycle.
  deterministicPreviewStartBudgetMs: 110 * 1000,
  previewStartBudgetMs: 282 * 1000,
  thumbnailStartBudgetMs: 17 * 1000,
  coverConcurrency: 3,
  // A reviewed preview can use the renderer (55s), the bounded primary and
  // fallback vision window (210s), and thumbnail generation (12s). Keep both
  // leases beyond the 300-second function window so a second timer cannot
  // claim the same job while the first invocation is still finishing.
  workerLeaseMs: 6 * 60 * 1000,
  jobLeaseMs: 6 * 60 * 1000,
  maxAttempts: 8,
  seedBatchSize: 200,
  recentWindowDays: 7,
  newItemsAfter: NEW_VISUALS_AFTER
});

const TIMER_CONFIG = Object.freeze({
  source: SOURCE_SYNC_CONFIG.triggerName,
  archive: ARCHIVE_CONFIG.triggerName,
  legacyVisual: 'knowledge-feed-legacy-visual-maintenance',
  visualWorker: 'knowledge-feed-visual-worker',
  intelligenceWorker: 'knowledge-feed-intelligence-worker',
  profileReviewWorker: 'knowledge-feed-profile-review-worker',
  dailyDigest: 'knowledge-feed-daily-digest',
  weeklyDigest: 'knowledge-feed-weekly-digest',
  monthlyDigest: 'knowledge-feed-monthly-digest',
  weeklyColumn: 'knowledge-feed-weekly-column'
});

module.exports = {
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
};
