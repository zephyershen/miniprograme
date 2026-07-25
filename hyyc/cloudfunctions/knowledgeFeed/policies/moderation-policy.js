const DEFAULT_MIN_ALLOW_CONFIDENCE = 0.8;
const COMMENT_REJECTION_LABELS = Object.freeze({
  advertising: '包含广告推广、带货或交易招揽信息',
  diversion: '包含联系方式、拉群或站外引流信息',
  link: '包含链接、域名、小程序链接或二维码链接',
  illegal: '涉及违法交易、诈骗、赌博、毒品或其他违法违规信息',
  privacy: '包含个人敏感信息或侵犯隐私的内容',
  sexual: '包含色情或性暗示内容',
  violence: '包含血腥或暴力内容',
  hate: '包含仇恨或歧视内容',
  harassment: '包含严重辱骂或骚扰内容',
  self_harm: '包含自残或自伤诱导内容',
  spam: '包含垃圾灌水、重复营销或无关推广信息',
  prompt_injection: '包含试图绕过审核规则的内容',
  other: '包含其他不适合公开发布的内容'
});
const COMMENT_REJECTION_PRIORITY = Object.freeze([
  'advertising',
  'diversion',
  'link',
  'illegal',
  'privacy',
  'sexual',
  'violence',
  'hate',
  'harassment',
  'self_harm',
  'spam',
  'prompt_injection',
  'other'
]);

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

function commentRejectionReason(categories = []) {
  const selected = new Set(
    (Array.isArray(categories) ? categories : [])
      .filter((category) => typeof category === 'string')
  );
  const labels = COMMENT_REJECTION_PRIORITY
    .filter((category) => selected.has(category))
    .slice(0, 2)
    .map((category) => COMMENT_REJECTION_LABELS[category]);
  return labels.length ? labels.join('；') : '内容不符合社区发布规范';
}

module.exports = {
  DEFAULT_MIN_ALLOW_CONFIDENCE,
  normalizeConfidence,
  decideModeration,
  moderationApproved,
  commentRejectionReason
};
