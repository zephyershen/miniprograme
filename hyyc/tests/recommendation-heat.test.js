const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_RECOMMENDATION_HEAT,
  MAX_RECOMMENDATION_HEAT,
  recommendationHeatValue,
  decorateRecommendationHeat
} = require('../features/knowledge-feed/recommendation-heat');

test('keeps recommendation heat stable and inside the declared display range', () => {
  const item = {
    id: 'heat_item_0001',
    title: '稳定推荐热度',
    url: 'https://example.com/heat'
  };
  const first = recommendationHeatValue(item);
  const second = recommendationHeatValue({
    ...item,
    engagement: { likeCount: 999, liked: true }
  });
  assert.ok(first >= MIN_RECOMMENDATION_HEAT);
  assert.ok(first <= MAX_RECOMMENDATION_HEAT);
  assert.equal(second, first);
  assert.equal(decorateRecommendationHeat(item).recommendationHeatLabel, `推荐热度 ${first}`);
});

test('uses stable fallbacks when an older item has no id', () => {
  assert.equal(
    recommendationHeatValue({ url: 'https://example.com/legacy', title: '旧资讯' }),
    recommendationHeatValue({ url: 'https://example.com/legacy', title: '标题已更新' })
  );
  assert.notEqual(
    recommendationHeatValue({ id: 'heat_item_alpha' }),
    recommendationHeatValue({ id: 'heat_item_beta' })
  );
});
