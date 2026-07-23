const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');
const { createCaptureService } = require('./src/capture.js');
const { createWebSocketProxyBridge } = require('./src/ws-proxy-bridge.js');
const { probeRelayTunnel } = require('./src/relay-probe.js');
const {
  officialXEmbedUrl,
  shouldRetryThroughForeignProxy,
  captureEgressPlan,
  captureRouteOptions
} = require('./src/egress-policy.js');
const { CAPTURE_VERSION, HARD_MAX_SEGMENTS } = require('./src/capture-plan.js');
const {
  LIST_THUMBNAIL_VERSION,
  LIST_THUMBNAIL_WIDTH,
  LIST_THUMBNAIL_HEIGHT
} = require('./src/list-thumbnail.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const PREVIEW_PREFIX = 'knowledge-previews/source/';
const THUMBNAIL_PREFIX = 'knowledge-thumbnails/list/';
const MAX_CAPTURE_TIMEOUT_MS = 85 * 1000;
const directCaptureService = createCaptureService({ allowDirectEgress: true });
let proxyCaptureService = null;
let proxyBridge = null;

async function foreignProxyCaptureService() {
  if (!proxyCaptureService) {
    if (!proxyBridge) {
      proxyBridge = createWebSocketProxyBridge({
        relayUrl: process.env.SOURCE_PREVIEW_RELAY_URL || '',
        relayAddress: process.env.SOURCE_PREVIEW_RELAY_ADDRESS || '',
        token: process.env.SOURCE_PREVIEW_RENDERER_TOKEN || ''
      });
    }
    proxyCaptureService = createCaptureService({
      trustedProxyUrl: await proxyBridge.listen(),
      allowDirectEgress: false
    });
  }
  return proxyCaptureService;
}

async function captureWithEgressFallback(url, maxSegments, signal, profile) {
  const foreignProxyConfigured = Boolean(process.env.SOURCE_PREVIEW_RELAY_URL);
  const plan = captureEgressPlan(url, foreignProxyConfigured);
  let lastError = null;
  for (const route of plan) {
    try {
      const service = route.proxied
        ? await foreignProxyCaptureService()
        : directCaptureService;
      const result = route.captureKind === 'open-graph'
        ? await service.captureOpenGraph(route.url, signal)
        : await service.capture(
          route.url,
          maxSegments,
          signal,
          profile,
          captureRouteOptions(route, foreignProxyConfigured)
        );
      return { ...result, egressMode: route.mode };
    } catch (error) {
      lastError = error;
      if ((signal && signal.aborted) || !shouldRetryThroughForeignProxy(error)) throw error;
    }
  }
  throw lastError || new Error('SOURCE_PREVIEW_CAPTURE_FAILED');
}

function safeEqual(actualValue, expectedValue) {
  if (typeof actualValue !== 'string' || typeof expectedValue !== 'string') return false;
  const actual = Buffer.from(actualValue);
  const expected = Buffer.from(expectedValue);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function assertAuthorized(event = {}) {
  const expected = process.env.SOURCE_PREVIEW_RENDERER_TOKEN || '';
  if (expected.length < 32 || !safeEqual(event.token, expected)) {
    const error = new Error('SOURCE_PREVIEW_WORKER_UNAVAILABLE');
    error.code = error.message;
    throw error;
  }
}

function assertCloudStem(value, prefix) {
  if (typeof value !== 'string'
    || !value.startsWith(prefix)
    || value.length > 240
    || !/^[a-zA-Z0-9/_-]+$/.test(value)) {
    const error = new Error('SOURCE_PREVIEW_PATH_INVALID');
    error.code = error.message;
    throw error;
  }
  return value;
}

function jpegBuffer(entry, maximumBytes) {
  if (!entry || entry.mimeType !== 'image/jpeg' || typeof entry.data !== 'string') {
    throw new Error('SOURCE_PREVIEW_IMAGE_INVALID');
  }
  const buffer = Buffer.from(entry.data, 'base64');
  if (!buffer.length || buffer.length > maximumBytes
    || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('SOURCE_PREVIEW_IMAGE_INVALID');
  }
  return buffer;
}

async function deleteFiles(fileIds) {
  if (!fileIds.length) return;
  await cloud.deleteFile({ fileList: fileIds }).catch(() => {});
}

async function uploadCapture(event, signal) {
  if (Number(event.captureVersion) !== CAPTURE_VERSION) {
    throw new Error('SOURCE_PREVIEW_VERSION_UNSUPPORTED');
  }
  const cloudPathStem = assertCloudStem(event.cloudPathStem, PREVIEW_PREFIX);
  const result = await captureWithEgressFallback(
    event.url,
    Math.min(HARD_MAX_SEGMENTS, Math.max(1, Number(event.maxSegments) || 1)),
    signal,
    event.profile
  );
  const screenshots = Array.isArray(result.screenshots) ? result.screenshots : [];
  if (!screenshots.length || Number(result.segmentCount) !== screenshots.length) {
    throw new Error('SOURCE_PREVIEW_CAPTURE_EMPTY');
  }

  const fileIds = [];
  try {
    for (let index = 0; index < screenshots.length; index += 1) {
      const uploaded = await cloud.uploadFile({
        cloudPath: `${cloudPathStem}-${index + 1}.jpg`,
        fileContent: jpegBuffer(screenshots[index], 1.25 * 1024 * 1024)
      });
      if (!uploaded || typeof uploaded.fileID !== 'string' || !uploaded.fileID.startsWith('cloud://')) {
        throw new Error('SOURCE_PREVIEW_UPLOAD_FAILED');
      }
      fileIds.push(uploaded.fileID);
    }
    return {
      captureVersion: result.captureVersion,
      finalUrl: result.finalUrl,
      title: result.title,
      pageHeight: result.pageHeight,
      segmentCount: result.segmentCount,
      truncated: result.truncated,
      profile: result.profile,
      focus: result.focus,
      media: result.media,
      quality: result.quality,
      egressMode: result.egressMode,
      fileIds
    };
  } catch (error) {
    await deleteFiles(fileIds);
    throw error;
  }
}

async function uploadThumbnail(event, signal) {
  if (Number(event.version) !== LIST_THUMBNAIL_VERSION) {
    throw new Error('THUMBNAIL_VERSION_UNSUPPORTED');
  }
  const cloudPath = `${assertCloudStem(event.cloudPathStem, THUMBNAIL_PREFIX)}.jpg`;
  const result = await directCaptureService.thumbnail(event, signal);
  const uploaded = await cloud.uploadFile({
    cloudPath,
    fileContent: jpegBuffer(result, 180 * 1024)
  });
  if (!uploaded || typeof uploaded.fileID !== 'string' || !uploaded.fileID.startsWith('cloud://')) {
    throw new Error('THUMBNAIL_UPLOAD_FAILED');
  }
  return {
    version: result.version,
    mimeType: result.mimeType,
    width: LIST_THUMBNAIL_WIDTH,
    height: LIST_THUMBNAIL_HEIGHT,
    fileId: uploaded.fileID
  };
}

async function main(event = {}) {
  assertAuthorized(event);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_CAPTURE_TIMEOUT_MS);
  try {
    if (event.action === 'health') {
      return {
        ok: true,
        data: {
          execution: 'cloudbase-function',
          directEgress: false,
          fixedIpEgress: true,
          foreignProxyConfigured: Boolean(process.env.SOURCE_PREVIEW_RELAY_URL),
          captureVersion: CAPTURE_VERSION,
          thumbnailVersion: LIST_THUMBNAIL_VERSION
        }
      };
    }
    if (event.action === 'probeRelay') {
      const probe = await probeRelayTunnel({
        relayUrl: process.env.SOURCE_PREVIEW_RELAY_URL || '',
        relayAddress: process.env.SOURCE_PREVIEW_RELAY_ADDRESS || '',
        token: process.env.SOURCE_PREVIEW_RENDERER_TOKEN || ''
      });
      return {
        ok: true,
        data: {
          ...probe,
          addressPinned: Boolean(process.env.SOURCE_PREVIEW_RELAY_ADDRESS)
        }
      };
    }
    const data = event.action === 'thumbnail'
      ? await uploadThumbnail(event, controller.signal)
      : await uploadCapture(event, controller.signal);
    return { ok: true, data };
  } catch (error) {
    console.warn('CloudBase source preview failed', {
      action: event.action || 'capture',
      message: error && error.message
    });
    const failure = new Error(error && error.message || 'SOURCE_PREVIEW_CAPTURE_FAILED');
    failure.code = failure.message;
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
}

exports.main = main;
exports._private = {
  safeEqual,
  assertCloudStem,
  officialXEmbedUrl,
  shouldRetryThroughForeignProxy,
  captureEgressPlan,
  foreignProxyCaptureService,
  captureWithEgressFallback,
  jpegBuffer,
  uploadCapture,
  uploadThumbnail,
  probeRelayTunnel
};
