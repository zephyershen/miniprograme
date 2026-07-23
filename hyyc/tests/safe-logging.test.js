const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createSafeLogger,
  sanitizeLogValue
} = require('../cloudfunctions/knowledgeFeed/lib/safe-log');
const {
  safeString: safeBillingString
} = require('../cloudfunctions/membershipBilling/lib/safe-log');
const {
  normalizeErrorCode,
  safeErrorCode,
  safeErrorSummary,
  safeRendererAction
} = require('../cloudrun/source-preview-renderer/src/safe-log');

test('recursively removes credentials, request payloads, and URLs from production logs', () => {
  const calls = [];
  const logger = createSafeLogger({
    warn: (...args) => calls.push(args),
    log: (...args) => calls.push(args)
  });

  logger.warn('request to https://example.com/private?token=secret failed', {
    code: 'UPSTREAM_FAILURE',
    request: {
      authorization: 'Bearer secret',
      url: 'https://example.com/private'
    },
    message: 'Bearer abc.def https://example.com/private?key=secret',
    token: 'secret',
    count: 3,
    ignoredField: 'must not be logged'
  });

  const output = JSON.stringify(calls);
  assert.doesNotMatch(output, /example\.com|abc\.def|secret|authorization|ignoredField/i);
  assert.match(output, /redacted/);
  assert.match(output, /UPSTREAM_FAILURE/);
  assert.match(output, /"count":3/);
});

test('keeps only a bounded operational whitelist from unknown objects', () => {
  assert.deepEqual(sanitizeLogValue({
    itemId: 'public-item',
    status: 'retry',
    ownerKey: 'private-owner',
    config: { apiKey: 'private' },
    arbitrary: 'private'
  }), {
    itemId: 'public-item',
    status: 'retry'
  });
});

test('billing log strings redact common secret and URL shapes', () => {
  const value = safeBillingString(
    'POST https://api.example.com/pay?token=abc Authorization: Bearer very-secret'
  );
  assert.doesNotMatch(value, /api\.example\.com|very-secret|token=abc/i);
  assert.match(value, /redacted/);
});

test('renderer logs keep only exact machine error codes', () => {
  const sensitiveError = Object.assign(
    new Error(
      'GET https://source.example/article?token=query-secret failed '
      + 'Authorization: Bearer header-secret config={"apiKey":"config-secret"}'
    ),
    {
      code: 'ERR_NETWORK https://source.example/article?token=code-secret',
      headers: { authorization: 'Bearer nested-secret' },
      config: { token: 'nested-config-secret' }
    }
  );

  assert.deepEqual(
    safeErrorSummary(sensitiveError, 'SOURCE_PREVIEW_CAPTURE_FAILED'),
    { code: 'SOURCE_PREVIEW_CAPTURE_FAILED' }
  );
  assert.equal(
    safeErrorCode(new Error('SOURCE_PREVIEW_IMAGE_INVALID'), 'UNUSED_FALLBACK'),
    'SOURCE_PREVIEW_IMAGE_INVALID'
  );
  assert.equal(
    safeErrorCode(
      Object.assign(new Error('connect to https://private.example/?key=secret'), {
        code: 'ECONNREFUSED'
      }),
      'UNUSED_FALLBACK'
    ),
    'ECONNREFUSED'
  );

  const output = JSON.stringify(safeErrorSummary(
    sensitiveError,
    'SOURCE_PREVIEW_CAPTURE_FAILED'
  ));
  assert.doesNotMatch(
    output,
    /source\.example|query-secret|header-secret|config-secret|authorization|headers|apiKey/i
  );
});

test('renderer log enums reject URLs, credentials, and arbitrary config values', () => {
  assert.equal(normalizeErrorCode('PROXY_RELAY_UNAVAILABLE'), 'PROXY_RELAY_UNAVAILABLE');
  assert.equal(normalizeErrorCode('TOKEN=secret'), '');
  assert.equal(normalizeErrorCode('SUPER_SECRET_TOKEN'), '');
  assert.equal(normalizeErrorCode('https://source.example/?token=secret'), '');
  assert.equal(safeRendererAction('thumbnail'), 'thumbnail');
  assert.equal(
    safeRendererAction('https://source.example/?token=secret'),
    'unknown'
  );
  assert.equal(safeRendererAction({ token: 'secret' }), 'unknown');
});

test('all renderer failure log boundaries use the safe summary', () => {
  const rendererRoot = path.join(
    __dirname,
    '..',
    'cloudrun',
    'source-preview-renderer'
  );
  const sourceFiles = [
    'index.js',
    path.join('src', 'server.js'),
    path.join('src', 'ws-proxy-bridge.js'),
    path.join('src', 'fixed-ip-proxy.js')
  ];

  sourceFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(rendererRoot, relativePath), 'utf8');
    assert.match(source, /safeErrorSummary\(/, `${relativePath} must use safeErrorSummary`);
    assert.doesNotMatch(
      source,
      /(?:message|code):\s*error\s*&&\s*error\.message|new Error\(error\s*&&\s*error\.message/,
      `${relativePath} must not log or rethrow a raw error message`
    );
  });
});

test('the renderer client logs only bounded action and failure codes', () => {
  const clientPath = path.join(
    __dirname,
    '..',
    'cloudfunctions',
    'knowledgeFeed',
    'adapters',
    'source-preview-renderer-client.js'
  );
  const source = fs.readFileSync(clientPath, 'utf8');
  const {
    safeAction,
    safeFailureCode
  } = require(clientPath);

  assert.equal(safeAction('capture'), 'capture');
  assert.equal(safeAction('https://source.example/?token=secret'), 'unknown');
  assert.equal(
    safeFailureCode(new Error('PREVIEW_FUNCTION_TIMEOUT')),
    'PREVIEW_FUNCTION_TIMEOUT'
  );
  assert.equal(
    safeFailureCode(new Error('config={"apiKey":"secret"}')),
    'PREVIEW_FUNCTION_FAILED'
  );
  assert.doesNotMatch(source, /message:\s*error\s*&&\s*error\.message/);
});
