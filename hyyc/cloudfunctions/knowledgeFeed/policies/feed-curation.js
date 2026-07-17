const crypto = require('node:crypto');

const CURATION_POLICY_VERSION = 1;
const CURATION_THRESHOLD = 70;
const SCORE_WEIGHTS = Object.freeze({
  importance: 0.35,
  novelty: 0.20,
  sourceTrust: 0.20,
  evidence: 0.15,
  actionability: 0.10
});

function boundedScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function analysisInput(item) {
  return {
    title: item && item.title || '',
    titleEn: item && item.titleEn || '',
    summary: item && item.summary || '',
    url: item && item.url || '',
    source: item && item.source || '',
    category: item && item.category || '',
    channelKey: item && item.channelKey || '',
    topicKeys: Array.isArray(item && item.topicKeys) ? [...item.topicKeys].sort() : []
  };
}

function analysisInputHash(item) {
  return crypto.createHash('sha256').update(JSON.stringify(analysisInput(item))).digest('hex');
}

function curationScore(signals = {}) {
  const base = Object.entries(SCORE_WEIGHTS).reduce(
    (sum, [key, weight]) => sum + (boundedScore(signals[key]) * weight),
    0
  );
  const duplicatePenalty = boundedScore(signals.duplicatePenalty);
  return Math.round(Math.max(0, Math.min(100, base - duplicatePenalty)) * 100) / 100;
}

function evaluateAnalysis(result = {}, policyVersion = CURATION_POLICY_VERSION) {
  const score = curationScore(result.signals || result);
  const noise = result.noise === true || result.duplicate === true;
  return {
    qualityTier: !noise && score >= CURATION_THRESHOLD ? 'curated' : (noise ? 'noise' : 'standard'),
    curationScore: score,
    curationReason: typeof result.shortReason === 'string' ? result.shortReason.slice(0, 80) : '',
    reasonCodes: Array.isArray(result.reasonCodes)
      ? result.reasonCodes.filter((value) => typeof value === 'string').slice(0, 8)
      : [],
    companyKeys: Array.isArray(result.companyKeys) ? result.companyKeys.slice(0, 12) : [],
    directionKeys: Array.isArray(result.directionKeys) ? result.directionKeys.slice(0, 12) : [],
    analysisPolicyVersion: Math.max(1, Number(policyVersion) || CURATION_POLICY_VERSION)
  };
}

module.exports = {
  CURATION_POLICY_VERSION,
  CURATION_THRESHOLD,
  SCORE_WEIGHTS,
  boundedScore,
  analysisInput,
  analysisInputHash,
  curationScore,
  evaluateAnalysis
};
