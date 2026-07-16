const crypto = require('node:crypto');

function authorized(headerValue, expectedToken) {
  if (typeof expectedToken !== 'string' || expectedToken.length < 32) return false;
  const prefix = 'Bearer ';
  if (typeof headerValue !== 'string' || !headerValue.startsWith(prefix)) return false;
  const actualToken = headerValue.slice(prefix.length);
  const actual = Buffer.from(actualToken);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { authorized };
