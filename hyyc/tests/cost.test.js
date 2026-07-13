const test = require('node:test');
const assert = require('node:assert/strict');
const {
  monthKey,
  dateKey,
  normalizeUsage,
  estimateCostCny,
  assertBudget
} = require('../cloudfunctions/digestIngest/lib/cost');

test('uses Asia/Shanghai boundaries for usage buckets', () => {
  const instant = new Date('2026-06-30T16:30:00.000Z');
  assert.equal(monthKey(instant), '2026-07');
  assert.equal(dateKey(instant), '2026-07-01');
});

test('normalizes CloudBase token usage fields and estimates cost', () => {
  const usage = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 500 });
  assert.deepEqual(usage, { inputTokens: 1000, outputTokens: 500 });
  assert.equal(estimateCostCny('hy3-preview', usage), 0.0032);
});

test('uses conservative fallback usage when the SDK omits token counts', () => {
  assert.deepEqual(
    normalizeUsage(undefined, { inputTokens: 16000, outputTokens: 1000 }),
    { inputTokens: 16000, outputTokens: 1000 }
  );
});

test('uses the Hy3 input tier and conservative DeepSeek peak price', () => {
  assert.equal(estimateCostCny('hy3-preview', { inputTokens: 16000, outputTokens: 1000 }), 0.032);
  assert.equal(estimateCostCny('deepseek-v4-flash-202605', { inputTokens: 1000000, outputTokens: 500000 }), 4);
});

test('stops before a call could cross the monthly hard limit', () => {
  assert.doesNotThrow(() => assertBudget(9.9, 'hy3-preview', 1000, 100));
  assert.throws(() => assertBudget(9.9999, 'hy3-preview', 16000, 1000), { code: 'AI_BUDGET_EXHAUSTED' });
});

test('fails closed when a model has no pricing configuration', () => {
  assert.throws(() => estimateCostCny('unknown-model', { inputTokens: 1, outputTokens: 1 }), { code: 'TEMPORARY_FAILURE' });
});
