const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUALITY_POLICY_VERSION,
  qualityTier,
  qualityView
} = require('../cloudfunctions/knowledgeFeed/policies/feed-quality');

test('keeps upstream selection as a signal without publishing it as member curation', () => {
  const curated = qualityView({ selected: true, score: 72 });
  const standard = qualityView({ selected: false, score: null });
  assert.equal(QUALITY_POLICY_VERSION, 1);
  assert.equal(curated.qualityTier, 'standard');
  assert.equal(curated.qualitySignals.providerSelected, true);
  assert.equal(curated.qualitySignals.popularityScore, 72);
  assert.equal(Object.prototype.hasOwnProperty.call(curated, 'isPremium'), false);
  assert.equal(standard.qualityTier, 'standard');
  assert.equal(qualityTier({ qualityTier: 'curated', selected: false }), 'curated');
});
