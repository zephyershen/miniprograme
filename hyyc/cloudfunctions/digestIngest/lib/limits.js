const { AppError } = require('./errors');

const QUEUE_LIMIT = 5;

function assertQueueCapacity(pendingCount) {
  if (Number(pendingCount || 0) >= QUEUE_LIMIT) {
    throw new AppError('QUEUE_FULL', '待消化内容已满 5 条，请先处理一条');
  }
}

module.exports = {
  QUEUE_LIMIT,
  assertQueueCapacity
};
