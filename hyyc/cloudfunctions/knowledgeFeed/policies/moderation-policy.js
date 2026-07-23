const DEFAULT_MIN_ALLOW_CONFIDENCE = 0.8;

function normalizeConfidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function decideModeration(result = {}, options = {}) {
  const confidence = normalizeConfidence(result.confidence);
  const categories = Array.isArray(result.categories)
    ? result.categories.filter((category) => typeof category === 'string' && category)
    : [];
  const minimum = normalizeConfidence(
    options.minAllowConfidence ?? DEFAULT_MIN_ALLOW_CONFIDENCE
  );
  const reportedVerdict = ['allow', 'reject', 'unsure'].includes(result.verdict)
    ? result.verdict
    : 'unsure';
  const safeAllow = reportedVerdict === 'allow'
    && confidence >= minimum
    && categories.length === 0;
  return {
    verdict: safeAllow ? 'allow' : (reportedVerdict === 'reject' ? 'reject' : 'unsure'),
    reportedVerdict,
    confidence,
    categories
  };
}

function moderationApproved(moderation) {
  if (!moderation || typeof moderation !== 'object') return false;
  if (moderation.status === 'approved') return true;
  return decideModeration(moderation).verdict === 'allow';
}

module.exports = {
  DEFAULT_MIN_ALLOW_CONFIDENCE,
  normalizeConfidence,
  decideModeration,
  moderationApproved
};
