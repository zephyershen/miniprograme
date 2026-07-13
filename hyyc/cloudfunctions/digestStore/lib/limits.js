const { AppError } = require('./errors');

const QUEUE_LIMIT = 5;
const CARD_LIMIT = 20;
const ALLOWED_TOPICS = new Set(['dev_efficiency', 'daily_life', 'english_reading', 'side_project', 'learning_growth']);

function validateTopics(input) {
  if (!Array.isArray(input)) throw new AppError('TEMPORARY_FAILURE', '关注方向格式不正确');
  const topics = [...new Set(input)].filter((topic) => ALLOWED_TOPICS.has(topic));
  if (topics.length < 1 || topics.length > 3 || topics.length !== input.length) {
    throw new AppError('TEMPORARY_FAILURE', '请选择 1–3 个有效关注方向');
  }
  return topics;
}

function validateDecision(decision) {
  if (decision !== 'keep' && decision !== 'discard') {
    throw new AppError('TEMPORARY_FAILURE', '处理动作无效');
  }
  return decision;
}

function assertCardCapacity(cardCount, replaceCardId) {
  if (Number(cardCount || 0) >= CARD_LIMIT && !replaceCardId) {
    throw new AppError('CARD_REPLACEMENT_REQUIRED', '结论卡已满，请选择一张旧卡替换');
  }
}

module.exports = {
  QUEUE_LIMIT,
  CARD_LIMIT,
  ALLOWED_TOPICS,
  validateTopics,
  validateDecision,
  assertCardCapacity
};
