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

module.exports = { SOURCE_CONFIG, CACHE_CONFIG, COVER_CONFIG };
