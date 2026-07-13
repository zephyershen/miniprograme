const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTopics,
  validateDecision,
  assertCardCapacity
} = require('../cloudfunctions/digestStore/lib/limits');
const { assertQueueCapacity } = require('../cloudfunctions/digestIngest/lib/limits');

test('enforces the five-item queue limit', () => {
  assert.doesNotThrow(() => assertQueueCapacity(4));
  assert.throws(() => assertQueueCapacity(5), { code: 'QUEUE_FULL' });
});

test('accepts one to three unique allowed topics', () => {
  assert.deepEqual(validateTopics(['dev_efficiency', 'english_reading']), ['dev_efficiency', 'english_reading']);
});

test('rejects missing, duplicate, unknown or excessive topics', () => {
  for (const topics of [[], ['unknown'], ['daily_life', 'daily_life'], ['dev_efficiency', 'daily_life', 'english_reading', 'side_project']]) {
    assert.throws(() => validateTopics(topics), { code: 'TEMPORARY_FAILURE' });
  }
});

test('allows only explicit keep or discard decisions', () => {
  assert.equal(validateDecision('keep'), 'keep');
  assert.equal(validateDecision('discard'), 'discard');
  assert.throws(() => validateDecision('archive'));
});

test('requires an explicit replacement when 20 cards already exist', () => {
  assert.doesNotThrow(() => assertCardCapacity(19));
  assert.throws(() => assertCardCapacity(20), { code: 'CARD_REPLACEMENT_REQUIRED' });
  assert.doesNotThrow(() => assertCardCapacity(20, 'card-id'));
});
