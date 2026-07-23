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

function logUnexpectedError(context, error, logger = console) {
  logger.error(safeString(context), {
    name: safeString(error && error.name || 'Error'),
    code: safeString(error && error.code || 'UNEXPECTED_ERROR'),
    statusCode: Number.isFinite(error && error.statusCode) ? error.statusCode : undefined,
    message: safeString(error && error.message || 'Unexpected error')
  });
}

module.exports = { logUnexpectedError, safeString };
