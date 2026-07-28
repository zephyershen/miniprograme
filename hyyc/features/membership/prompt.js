const {
  MEMBERSHIP_TERMS,
  membershipBenefits,
  membershipMetrics
} = require('./benefits.js');
const { isProductFeatureEnabled } = require('../../config/product-features.js');

const PROMPTS = Object.freeze({
  curated_feed: {
    eyebrow: '会员精选',
    title: '少刷一点，先看真正改变判断的事',
    copy: '精选会合并重复消息，说明变化、影响和下一步。前往“我的”可查看当前会员方案。'
  },
  comments: {
    eyebrow: '会员评论区',
    title: '和认真读完的人，继续聊这一条',
    copy: '评论区只对 Pro 会员开放，普通用户仍可喜欢、收藏和分享资讯。'
  },
  history_30d: {
    eyebrow: '30 天资料库',
    title: '把一周之外的变化，也连成线索',
    copy: 'Pro 可查看近 30 天资讯，并在收藏、精选和简报中继续回看。'
  },
  ai_column: {
    eyebrow: '实用学习专栏',
    title: '先把原理讲明白，再带你亲手做一遍',
    copy: '持续更新的基础课讲清原理，动手课提供按系统拆开的安装与操作步骤。'
  },
  digests: {
    eyebrow: '会员简报',
    title: '把一天、七天和三十天，压成可行动的结论',
    copy: '简报保留来源索引和关键变化，帮助你快速掌握一个周期的重要内容。'
  }
});

const AI_COLUMN_PROMPT = Object.freeze({
  eyebrow: '从听懂到会用',
  title: '先把原理讲明白，再带你亲手做一遍',
  copy: '基础课会持续用生活里的例子讲清概念，动手课带你安装和使用 Codex CLI、Claude Code 等工具。Pro 会员遇到安装或使用问题，可私聊我的微信排查，技术支持不另外收费。'
});

function membershipPrompt(featureKey) {
  const visibleFeatureKey = featureKey === 'comments' && !isProductFeatureEnabled('comments')
    ? 'curated_feed'
    : featureKey;
  const promptKey = /^digest_(?:24h|7d|30d)$/.test(visibleFeatureKey)
    ? 'digests'
    : visibleFeatureKey;
  const prompt = visibleFeatureKey === 'ai_column'
    ? AI_COLUMN_PROMPT
    : (PROMPTS[promptKey] || PROMPTS.curated_feed);
  const benefits = membershipBenefits(visibleFeatureKey);
  return {
    ...prompt,
    featureKey: visibleFeatureKey,
    focusBenefit: benefits.find((item) => item.featured) || benefits[0],
    benefits,
    metrics: membershipMetrics(),
    membershipTerms: { ...MEMBERSHIP_TERMS }
  };
}

module.exports = { membershipPrompt };
