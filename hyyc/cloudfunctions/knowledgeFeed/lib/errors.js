const { createSafeLogger, logUnexpectedError } = require('./safe-log');

const logger = createSafeLogger(console);

class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = publicErrorDetails(details);
  }
}

function publicErrorDetails(details) {
  const result = {};
  if (details && typeof details.featureKey === 'string'
    && /^[a-z0-9_]{3,64}$/.test(details.featureKey)) {
    result.featureKey = details.featureKey;
  }
  return result;
}

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  const known = error instanceof AppError;
  if (!known) logUnexpectedError(logger, 'Knowledge feed request failed', error);
  return {
    ok: false,
    error: {
      code: known ? error.code : 'TEMPORARY_FAILURE',
      message: known ? error.message : '资讯服务暂时不可用，请稍后重试',
      ...(known ? publicErrorDetails(error.details) : {})
    }
  };
}

module.exports = { AppError, publicErrorDetails, ok, fail };
