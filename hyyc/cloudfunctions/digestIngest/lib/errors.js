class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  const known = error instanceof AppError;
  if (!known) console.error(error);
  return {
    ok: false,
    error: {
      code: known ? error.code : 'TEMPORARY_FAILURE',
      message: known ? error.message : '服务暂时不可用，请稍后重试'
    }
  };
}

module.exports = {
  AppError,
  ok,
  fail
};
