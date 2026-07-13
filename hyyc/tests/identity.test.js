const test = require('node:test');
const assert = require('node:assert/strict');
const { digestIds } = require('../cloudfunctions/digestIngest/lib/identity');
const { normalizePublicHttpsUrl } = require('../cloudfunctions/digestIngest/lib/url-security');

test('maps duplicate normalized URLs to the same queue and card identifiers', () => {
  const ownerKey = 'owner-a';
  const first = digestIds(ownerKey, normalizePublicHttpsUrl('https://Example.com/a?utm_source=x&b=2&a=1'));
  const second = digestIds(ownerKey, normalizePublicHttpsUrl('https://example.com/a?a=1&b=2#section'));
  assert.deepEqual(first, second);
});

test('isolates deterministic identifiers between owners', () => {
  const url = normalizePublicHttpsUrl('https://example.com/article');
  const first = digestIds('owner-a', url);
  const second = digestIds('owner-b', url);
  assert.equal(first.urlHash, second.urlHash);
  assert.notEqual(first.queueId, second.queueId);
  assert.notEqual(first.cardId, second.cardId);
});
