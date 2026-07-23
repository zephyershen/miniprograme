const { logUnexpectedError } = require('./safe-log');

class BillingError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  const known = error instanceof BillingError;
  if (!known) logUnexpectedError('Membership billing request failed', error);
  return {
    ok: false,
    error: {
      code: known ? error.code : 'TEMPORARY_FAILURE',
      message: known ? error.message : '支付服务暂时不可用，请稍后重试'
    }
  };
}

module.exports = { BillingError, ok, fail };
