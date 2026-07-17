const crypto = require('node:crypto');

function maintenanceAuthorized(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

module.exports = { maintenanceAuthorized };
