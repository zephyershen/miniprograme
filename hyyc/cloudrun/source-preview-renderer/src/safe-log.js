const SAFE_ERROR_CODES = new Set([
  'ABORT_ERR',
  'BODY_TOO_LARGE',
  'BROWSER_NETWORK_GUARD_REQUIRED',
  'BROWSER_RESTART_FAILED',
  'BROWSER_SMOKE_CAPTURE_INVALID',
  'CHROMIUM_VERSION_MISMATCH',
  'DNS_TIMEOUT',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'EXTERNAL_BROWSER_PROXY_UNSUPPORTED',
  'INVALID_JSON',
  'INVALID_PROXY_URL',
  'INVALID_URL',
  'LOOPBACK_PROXY_REQUIRED',
  'NO_DOCUMENT_RESPONSE',
  'OPEN_GRAPH_IMAGE_UNAVAILABLE',
  'PAGE_QUALITY_REJECTED',
  'PLAYWRIGHT_DOCKER_IMAGE_MISMATCH',
  'PLAYWRIGHT_DOCKER_IMAGE_NOT_PINNED',
  'PRIVATE_HOST',
  'PROXY_BRIDGE_CONFIG_INVALID',
  'PROXY_RELAY_ADDRESS_INVALID',
  'PROXY_RELAY_PROBE_INVALID',
  'PROXY_RELAY_PROBE_REJECTED',
  'PROXY_RELAY_PROBE_TIMEOUT',
  'PROXY_RELAY_UNAVAILABLE',
  'PROXY_RESOLVER_REQUIRED',
  'PROXY_TARGET_INVALID',
  'PROXY_TARGET_UNAVAILABLE',
  'RELAY_CONNECT_TIMEOUT',
  'RELAY_EGRESS_MODE_INVALID',
  'RELAY_RESOLVER_REQUIRED',
  'RELAY_TARGET_ADDRESS_INVALID',
  'RELAY_TARGET_UNAVAILABLE',
  'REQUEST_TIMEOUT',
  'SCREENSHOT_TOO_LARGE',
  'SOURCE_PREVIEW_CAPTURE_EMPTY',
  'SOURCE_PREVIEW_CAPTURE_FAILED',
  'SOURCE_PREVIEW_IMAGE_INVALID',
  'SOURCE_PREVIEW_PATH_INVALID',
  'SOURCE_PREVIEW_UPLOAD_FAILED',
  'SOURCE_PREVIEW_VERSION_UNSUPPORTED',
  'SOURCE_PREVIEW_WORKER_UNAVAILABLE',
  'TARGET_INVALID',
  'THUMBNAIL_ABORTED',
  'THUMBNAIL_OUTPUT_INVALID',
  'THUMBNAIL_UPLOAD_FAILED',
  'THUMBNAIL_VERSION_UNSUPPORTED',
  'UNEXPECTED_ERROR',
  'UPSTREAM_PROXY_REJECTED',
  'UPSTREAM_PROXY_RESPONSE_INVALID',
  'UPSTREAM_PROXY_TIMEOUT'
]);
const SAFE_DYNAMIC_ERROR_CODE = /^(?:PROXY_RELAY_(?:CLOSED|HTTP)_\d{1,5}|UPSTREAM_HTTP_(?:\d{3}|INVALID))$/;
const SAFE_RENDERER_ACTIONS = new Set([
  'capture',
  'health',
  'probeRelay',
  'thumbnail'
]);
const DEFAULT_ERROR_CODE = 'UNEXPECTED_ERROR';

function normalizeErrorCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  if (SAFE_ERROR_CODES.has(code) || SAFE_DYNAMIC_ERROR_CODE.test(code)) return code;
  if (/^CHROMIUM_VERSION_MISMATCH:/.test(code)) return 'CHROMIUM_VERSION_MISMATCH';
  return '';
}

function safeErrorCode(error, fallbackCode = DEFAULT_ERROR_CODE) {
  const code = normalizeErrorCode(error && error.code);
  if (code) return code;

  // Renderer-owned errors use an explicit allowlist of machine codes. Never
  // retain arbitrary messages because they can contain request URLs, query
  // parameters, headers, tokens, or serialized config.
  const messageCode = normalizeErrorCode(error && error.message);
  if (messageCode) return messageCode;

  return normalizeErrorCode(fallbackCode) || DEFAULT_ERROR_CODE;
}

function safeErrorSummary(error, fallbackCode) {
  return Object.freeze({
    code: safeErrorCode(error, fallbackCode)
  });
}

function safeRendererAction(value) {
  return SAFE_RENDERER_ACTIONS.has(value) ? value : 'unknown';
}

module.exports = {
  DEFAULT_ERROR_CODE,
  normalizeErrorCode,
  safeErrorCode,
  safeErrorSummary,
  safeRendererAction
};
