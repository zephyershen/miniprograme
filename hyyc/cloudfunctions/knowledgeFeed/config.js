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

// Visual generation is forward-only from this release. Existing news keeps
// its current assets and is not backfilled or recaptured by scheduled work.
const NEW_VISUALS_AFTER = '2026-07-18T04:43:08.568Z';

const CACHE_CONFIG = Object.freeze({
  collectionName: 'knowledge_feed_cache',
  documentId: 'aihot_selected'
});

const ARCHIVE_CONFIG = Object.freeze({
  collectionName: 'knowledge_feed_archive',
  retentionDays: 90,
  upstreamWindowDays: 7,
  historyBatchDays: 10,
  historyIndexTake: 60,
  historyRefreshMs: 24 * 60 * 60 * 1000,
  currentRefreshMs: 24 * 60 * 60 * 1000
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
  freeWindowDays: 7,
  memberWindowDays: 30,
  adminWindowDays: 90,
  queryPageSize: 8,
  queryMaxPageSize: 20,
  facetLimit: 12000,
  syncLeaseMs: 4 * 60 * 1000,
  itemsRevalidateMs: 6 * 60 * 60 * 1000,
  fullRefreshMs: 24 * 60 * 60 * 1000,
  migrationDayBatchSize: 10,
  visualNewItemsOnly: true,
  visualPriorityBoost: 2000
});

const MEMBERSHIP_CONFIG = Object.freeze({
  collectionName: 'knowledge_memberships',
  freeWindowDays: ITEM_STORE_CONFIG.freeWindowDays,
  memberWindowDays: ITEM_STORE_CONFIG.memberWindowDays
});

const MEMBERSHIP_FEATURE_FLAGS = Object.freeze({
  membershipUi: true,
  liveCurated: false,
  liveDigests: false,
  memberPurchases: false
});

const INTELLIGENCE_CONFIG = Object.freeze({
  provider: ITEM_STORE_CONFIG.provider,
  providerEnabled: false,
  policyVersion: 1,
  analysisCollectionName: 'knowledge_feed_item_analysis',
  analysisJobsCollectionName: 'knowledge_feed_analysis_jobs',
  digestsCollectionName: 'knowledge_feed_digests',
  itemsCollectionName: ITEM_STORE_CONFIG.itemsCollectionName,
  dayIndexCollectionName: ITEM_STORE_CONFIG.dayIndexCollectionName,
  jobLeaseMs: 4 * 60 * 1000,
  dueBatchSize: 10,
  jobsPerCycle: 2,
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

function localRuntimeConfig() {
  try {
    return require('./config.local');
  } catch (error) {
    return {};
  }
}

const runtime = localRuntimeConfig();
const PREVIEW_CONFIG = Object.freeze({
  rendererUrl: process.env.SOURCE_PREVIEW_RENDERER_URL || runtime.sourcePreviewRendererUrl || '',
  rendererToken: process.env.SOURCE_PREVIEW_RENDERER_TOKEN || runtime.sourcePreviewRendererToken || '',
  maintenanceToken: process.env.KNOWLEDGE_FEED_MAINTENANCE_TOKEN || runtime.knowledgeFeedMaintenanceToken || '',
  rendererTimeoutMs: 55 * 1000,
  retryMs: 5 * 60 * 1000,
  maxResponseBytes: 22 * 1024 * 1024,
  maxImageBytes: 1.25 * 1024 * 1024,
  maxSegments: 12,
  captureVersion: 2,
  captureProfile: 'focus-v1',
  newItemsAfter: NEW_VISUALS_AFTER,
  cloudPathPrefix: 'knowledge-previews/source/',
  fileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-previews/source/'
});

const LIST_THUMBNAIL_CONFIG = Object.freeze({
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
  dueBatchSize: 20,
  jobsPerCycle: 2,
  coverConcurrency: 3,
  workerLeaseMs: 4 * 60 * 1000,
  jobLeaseMs: 4 * 60 * 1000,
  maxAttempts: 8,
  seedBatchSize: 200,
  recentWindowDays: 7,
  newItemsAfter: NEW_VISUALS_AFTER
});

const SYNC_CYCLE_CONFIG = Object.freeze({
  visualIntervalMinutes: 5
});

module.exports = {
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
};
