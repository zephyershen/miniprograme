const cloud = require('wx-server-sdk');
const { createAihotSource } = require('./adapters/aihot-source');
const { SOURCE_CONFIG, CACHE_CONFIG, COVER_CONFIG, PREVIEW_CONFIG } = require('./config');
const { AppError, ok, fail } = require('./lib/errors');
const { extractCoverUrl } = require('./lib/image-meta');
const { fetchPublicBuffer } = require('./lib/network');
const { createFeedCacheRepository } = require('./repositories/feed-cache');
const { createCoverService } = require('./services/cover-service');
const { createCloudFileDeleter } = require('./services/cloud-file-deleter');
const { createFeedService } = require('./services/feed-service');
const { createPreviewService } = require('./services/preview-service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const repository = createFeedCacheRepository(cloud.database(), CACHE_CONFIG);
const source = createAihotSource(SOURCE_CONFIG);
const feedService = createFeedService({
  repository,
  source,
  cacheConfig: CACHE_CONFIG,
  ownedVisualPrefixes: [COVER_CONFIG.fileIdPrefix, PREVIEW_CONFIG.fileIdPrefix],
  deleteFiles: createCloudFileDeleter(cloud)
});
const coverService = createCoverService({
  cloud,
  repository,
  fetchPublicBuffer,
  extractCoverUrl,
  config: COVER_CONFIG
});
const previewService = createPreviewService({ cloud, repository, config: PREVIEW_CONFIG });

const ACTION_HANDLERS = Object.freeze({
  feed: (event) => feedService.getFeed(event),
  item: (event) => feedService.getItem(event.id),
  registerCovers: (event) => coverService.registerCovers(event.covers),
  hydrateCover: (event) => coverService.hydrateCover(event.id),
  hydrateCovers: (event) => coverService.hydrateCovers(event.limit, event.force),
  hydratePreview: (event) => previewService.hydratePreview(event.id, event.force, event.maintenanceToken),
  hydratePreviews: (event) => previewService.hydratePreviews(event.limit, event.force, event.maintenanceToken),
  previewFailures: (event) => previewService.listPreviewFailures(event.maintenanceToken),
  previewStatus: (event) => previewService.maintenanceStatus(event.maintenanceToken)
});

async function main(event = {}) {
  try {
    const handler = ACTION_HANDLERS[event.action || 'feed'];
    if (!handler) throw new AppError('TEMPORARY_FAILURE', '不支持的操作');
    return ok(await handler(event));
  } catch (error) {
    return fail(error);
  }
}

exports.main = main;
