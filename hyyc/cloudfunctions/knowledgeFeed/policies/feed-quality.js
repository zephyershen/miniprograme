const QUALITY_POLICY_VERSION = 1;

function qualityTier(item) {
  if (item && item.qualityTier === 'curated') return 'curated';
  if (item && item.qualityTier === 'noise') return 'noise';
  return 'standard';
}

function qualityView(item) {
  const popularityScore = Number(item && item.score);
  return {
    qualityTier: qualityTier(item),
    qualityPolicyVersion: QUALITY_POLICY_VERSION,
    qualitySignals: {
      providerSelected: Boolean(item && item.selected === true),
      popularityScore: Number.isFinite(popularityScore) ? popularityScore : null
    }
  };
}

module.exports = { QUALITY_POLICY_VERSION, qualityTier, qualityView };
