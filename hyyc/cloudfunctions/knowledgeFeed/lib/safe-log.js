const SAFE_FIELDS = new Set([
  'attempts',
  'blocked',
  'code',
  'count',
  'created',
  'deleted',
  'durationMs',
  'errorCode',
  'failed',
  'itemId',
  'lane',
  'message',
  'mode',
  'name',
  'processed',
  'provider',
  'reason',
  'remaining',
  'reused',
  'skipped',
  'status',
  'statusCode',
  'success',
  'trigger',
  'updated'
]);

const SECRET_FIELD = /(authorization|cookie|credential|key|password|request|response|secret|session|token|url)/i;
const URL_VALUE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const AUTH_VALUE = /\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi;
const ASSIGNMENT_VALUE = /\b(api[_-]?key|authorization|password|secret|session|token)\s*[:=]\s*[^\s,;]+/gi;

function safeString(value) {
  return String(value || '')
    .replace(URL_VALUE, '[redacted-url]')
    .replace(AUTH_VALUE, '$1 [redacted]')
    .replace(ASSIGNMENT_VALUE, '$1=[redacted]')
    .slice(0, 240);
}

function safeScalar(value) {
  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function sanitizeLogValue(value, depth = 0) {
  if (depth > 2) return undefined;
  const scalar = safeScalar(value);
  if (scalar !== undefined) return scalar;
  if (value instanceof Error) {
    return {
      name: safeString(value.name || 'Error'),
      code: safeString(value.code || 'UNEXPECTED_ERROR'),
      message: safeString(value.message || 'Unexpected error')
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10)
      .map((entry) => sanitizeLogValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== 'object') return undefined;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) continue;
    if (!SAFE_FIELDS.has(key)) continue;
    const safeEntry = sanitizeLogValue(entry, depth + 1);
    if (safeEntry !== undefined) output[key] = safeEntry;
  }
  return output;
}

function createSafeLogger(base = console) {
  function write(level, args) {
    const values = args
      .map((value) => sanitizeLogValue(value))
      .filter((value) => value !== undefined);
    const method = typeof base[level] === 'function' ? base[level].bind(base) : base.log.bind(base);
    method(...values);
  }

  return Object.freeze({
    error: (...args) => write('error', args),
    warn: (...args) => write('warn', args),
    info: (...args) => write('info', args),
    log: (...args) => write('log', args)
  });
}

function logUnexpectedError(logger, context, error) {
  logger.error(context, {
    name: error && error.name,
    code: error && error.code || 'UNEXPECTED_ERROR',
    statusCode: error && (error.statusCode || error.status),
    message: error && error.message
  });
}

module.exports = {
  createSafeLogger,
  logUnexpectedError,
  safeString,
  sanitizeLogValue
};
