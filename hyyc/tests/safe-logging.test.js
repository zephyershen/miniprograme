const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSafeLogger,
  sanitizeLogValue
} = require('../cloudfunctions/knowledgeFeed/lib/safe-log');
const {
  safeString: safeBillingString
} = require('../cloudfunctions/membershipBilling/lib/safe-log');

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
