const { isProductFeatureEnabled } = require('../../config/product-features.js');

const PRO_MEMBERSHIP_NAME = 'Pro 会员';

const PRO_BENEFITS = Object.freeze([
  Object.freeze({
    key: 'curated',
    featureKeys: Object.freeze(['curated_feed']),
    label: 'AI 精选',
    title: '真正值得看的 AI 精选',
    copy: '查看经过合并去重、标出影响理由的精选资讯。'
  }),
  Object.freeze({
    key: 'courses',
    featureKeys: Object.freeze(['ai_column']),
    label: '基础课持续更新',
    title: '基础课全文与高清手绘图文',
    copy: '解锁持续更新的基础课全文，以及课程配套的高清图文讲解。'
  }),
  Object.freeze({
    key: 'practicals',
    featureKeys: Object.freeze(['ai_column']),
    label: '动手课持续更新',
    title: '多系统动手操作手册',
    copy: '解锁持续更新的动手课，按 Windows、macOS、Linux 或 WSL 查看安装与操作步骤。'
  }),
  Object.freeze({
    key: 'briefings',
    featureKeys: Object.freeze(['digests', 'digest_24h', 'digest_7d', 'digest_30d']),
    label: '3 档简报',
    title: '三档简报与来源回看',
    copy: '查看 24 小时、7 天和 30 天简报，并从简报回到对应资讯来源。'
  }),
  Object.freeze({
    key: 'history',
    featureKeys: Object.freeze(['history_30d']),
    label: '30 天回看',
    title: '30 天资讯与收藏回看',
    copy: '资讯和已经收藏的内容都可回看近 30 天；普通用户只能查看最近 24 小时。'
  }),
  Object.freeze({
    key: 'comments',
    featureKeys: Object.freeze(['comments']),
    label: '会员评论',
    title: '会员评论区',
    copy: '读取并发布会员评论，支持文字和图片。'
  }),
  Object.freeze({
    key: 'support',
    featureKeys: Object.freeze(['ai_column']),
    label: '技术支持',
    title: '微信技术支持不另外收费',
    copy: '安装或使用课程工具时遇到问题，可以私聊微信一起排查。'
  })
]);

const MEMBERSHIP_TERMS = Object.freeze({
  purchaseKind: 'one_time',
  renewalCopy: '一次购买 30 天，不会自动续费',
  supportBoundary: '工具订阅、API 调用和云服务等第三方费用不包含在会员权益内。'
});

const PRO_METRICS = Object.freeze([
  Object.freeze({ label: '30 天', copy: '资讯回看' }),
  Object.freeze({ label: '3 档', copy: '滚动简报' }),
  Object.freeze({ label: '持续更新', copy: '基础课与动手课' })
]);

function cloneBenefit(item, featured = false) {
  return {
    key: item.key,
    label: item.label,
    title: item.title,
    copy: item.copy,
    featureKeys: [...item.featureKeys],
    featured
  };
}

function membershipBenefits(featureKey = '') {
  const normalizedFeatureKey = String(featureKey || '').trim();
  const benefits = PRO_BENEFITS
    .filter((item) => item.key !== 'comments' || isProductFeatureEnabled('comments'))
    .map((item) => cloneBenefit(
      item,
      Boolean(normalizedFeatureKey && item.featureKeys.includes(normalizedFeatureKey))
    ));
  if (!normalizedFeatureKey) return benefits;
  return benefits.filter((item) => item.featured)
    .concat(benefits.filter((item) => !item.featured));
}

function membershipMetrics() {
  return PRO_METRICS.map((item) => ({ ...item }));
}

function positiveInteger(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function centsLabel(cents) {
  const amount = positiveInteger(cents);
  if (!amount) return '';
  return `¥${(amount / 100).toFixed(2).replace(/\.?(?:0+)$/, '')}`;
}

function discountLabel(priceCents, compareAtPriceCents) {
  if (!priceCents || compareAtPriceCents <= priceCents) return '';
  const discount = Math.round((priceCents / compareAtPriceCents) * 100) / 10;
  return `${Number.isInteger(discount) ? discount.toFixed(0) : discount.toFixed(1)} 折`;
}

function membershipOffer(plan = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const priceCents = positiveInteger(source.priceCents);
  const rawCompareAtPriceCents = positiveInteger(source.compareAtPriceCents);
  const compareAtPriceCents = priceCents && rawCompareAtPriceCents > priceCents
    ? rawCompareAtPriceCents
    : 0;
  const savingsCents = compareAtPriceCents ? compareAtPriceCents - priceCents : 0;
  const durationDays = positiveInteger(source.durationDays) || 30;
  const percentOff = compareAtPriceCents
    ? Math.max(1, Math.min(99, Math.round((savingsCents / compareAtPriceCents) * 100)))
    : 0;
  return {
    ...source,
    key: typeof source.key === 'string' ? source.key : '',
    name: typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : `${durationDays} 天会员`,
    durationDays,
    durationLabel: `${durationDays} 天`,
    priceCents,
    priceLabel: centsLabel(priceCents),
    compareAtPriceCents,
    compareAtPriceLabel: centsLabel(compareAtPriceCents),
    savingsCents,
    savingsLabel: centsLabel(savingsCents),
    percentOff,
    percentOffLabel: percentOff ? `省 ${percentOff}%` : '',
    discountLabel: discountLabel(priceCents, compareAtPriceCents),
    hasDiscount: savingsCents > 0,
    offerTag: savingsCents > 0 ? '会员优惠' : ''
  };
}

function membershipBillingPresentation(
  raw = {},
  { memberPurchases = false, mutationsAllowed = false } = {}
) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const plan = membershipOffer(source.plan);
  return {
    ...source,
    available: source.available === true
      && memberPurchases === true
      && mutationsAllowed === true
      && Boolean(plan.key && plan.priceCents),
    plan
  };
}

module.exports = {
  PRO_MEMBERSHIP_NAME,
  PRO_BENEFITS,
  MEMBERSHIP_TERMS,
  PRO_METRICS,
  membershipBenefits,
  membershipMetrics,
  membershipOffer,
  membershipBillingPresentation,
  centsLabel
};
