const { AppError } = require('./errors');

const MONTHLY_LIMIT_CNY = 10;
const MODEL_PRICING = {
  'hy3-preview': [
    { maxInputTokensExclusive: 16000, inputPerMillion: 1.2, outputPerMillion: 4 },
    { maxInputTokensExclusive: 32000, inputPerMillion: 1.6, outputPerMillion: 6.4 },
    { maxInputTokensExclusive: Infinity, inputPerMillion: 2, outputPerMillion: 8 }
  ],
  // DeepSeek has peak/off-peak pricing. Use the higher peak price so the hard cap fails safe.
  'deepseek-v4-flash-202605': [
    { maxInputTokensExclusive: Infinity, inputPerMillion: 2, outputPerMillion: 4 }
  ]
};

function timeZoneParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function monthKey(date = new Date()) {
  const parts = timeZoneParts(date);
  return `${parts.year}-${parts.month}`;
}

function dateKey(date = new Date()) {
  const parts = timeZoneParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeUsage(usage = {}, fallback = {}) {
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? fallback.inputTokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? fallback.outputTokens ?? 0);
  return {
    inputTokens: Math.max(0, Math.ceil(inputTokens)),
    outputTokens: Math.max(0, Math.ceil(outputTokens))
  };
}

function estimateCostCny(model, usage) {
  const tiers = MODEL_PRICING[model];
  if (!tiers) throw new AppError('TEMPORARY_FAILURE', '当前 AI 模型未配置价格，已停止调用以保护预算');
  const normalized = normalizeUsage(usage);
  const price = tiers.find((tier) => normalized.inputTokens < tier.maxInputTokensExclusive);
  if (!price) throw new AppError('TEMPORARY_FAILURE', '当前 AI 模型价格分档异常，已停止调用以保护预算');
  return Number(((normalized.inputTokens * price.inputPerMillion + normalized.outputTokens * price.outputPerMillion) / 1000000).toFixed(6));
}

function assertBudget(currentCost, model, maxInputTokens = 16000, maxOutputTokens = 1000) {
  const reserved = estimateCostCny(model, { inputTokens: maxInputTokens, outputTokens: maxOutputTokens });
  if (Number(currentCost || 0) + reserved > MONTHLY_LIMIT_CNY) {
    throw new AppError('AI_BUDGET_EXHAUSTED', '本月 AI 预算已到上限，下月自动恢复');
  }
  return reserved;
}

module.exports = {
  MONTHLY_LIMIT_CNY,
  MODEL_PRICING,
  monthKey,
  dateKey,
  normalizeUsage,
  estimateCostCny,
  assertBudget
};
