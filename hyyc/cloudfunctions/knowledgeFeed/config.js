const SOURCE_CONFIG = Object.freeze({
  provider: 'aihot',
  apiRoot: 'https://aihot.virxact.com/api/public/items',
  pageSize: 100,
  maxItems: 120,
  timeoutMs: 8000
});

const CACHE_CONFIG = Object.freeze({
  collectionName: 'knowledge_feed_cache',
  documentId: 'aihot_selected',
  ttlMs: 15 * 60 * 1000,
  forceMinAgeMs: 60 * 1000
});

const COVER_CONFIG = Object.freeze({
  maxBytes: 2.5 * 1024 * 1024,
  retryMs: 12 * 60 * 60 * 1000,
  cloudPathPrefix: 'knowledge-covers/aihot/',
  fileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-covers/aihot/',
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
  rendererTimeoutMs: 28 * 1000,
  retryMs: 30 * 60 * 1000,
  maxResponseBytes: 6 * 1024 * 1024,
  maxImageBytes: 1.5 * 1024 * 1024,
  maxSegments: 3,
  cloudPathPrefix: 'knowledge-previews/source/',
  fileIdPrefix: 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/knowledge-previews/source/'
});

const VISUAL_MAINTENANCE_CONFIG = Object.freeze({
  triggerName: 'knowledge-feed-visual-sync',
  coverBatchSize: 9,
  previewBatchSize: 2
});

module.exports = {
  SOURCE_CONFIG,
  CACHE_CONFIG,
  COVER_CONFIG,
  PREVIEW_CONFIG,
  VISUAL_MAINTENANCE_CONFIG
};
