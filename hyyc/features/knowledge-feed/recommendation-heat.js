const MIN_RECOMMENDATION_HEAT = 100;
const MAX_RECOMMENDATION_HEAT = 1000;
const RECOMMENDATION_HEAT_SPAN = MAX_RECOMMENDATION_HEAT - MIN_RECOMMENDATION_HEAT + 1;

function recommendationIdentity(item = {}) {
  return [item.id, item.url, item.title]
    .find((value) => typeof value === 'string' && value.trim()) || 'knowledge-feed';
}

function stableHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recommendationHeatValue(item = {}) {
  return MIN_RECOMMENDATION_HEAT
    + (stableHash(recommendationIdentity(item)) % RECOMMENDATION_HEAT_SPAN);
}

function decorateRecommendationHeat(item = {}) {
  const recommendationHeat = recommendationHeatValue(item);
  return {
    ...item,
    recommendationHeat,
    recommendationHeatLabel: `推荐热度 ${recommendationHeat}`
  };
}

module.exports = {
  MIN_RECOMMENDATION_HEAT,
  MAX_RECOMMENDATION_HEAT,
  recommendationIdentity,
  stableHash,
  recommendationHeatValue,
  decorateRecommendationHeat
};
