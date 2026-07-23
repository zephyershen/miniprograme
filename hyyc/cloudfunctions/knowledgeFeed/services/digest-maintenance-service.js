const { AppError } = require('../lib/errors');
const { maintenanceAuthorized } = require('../policies/maintenance-auth');

const DIGEST_WINDOWS = Object.freeze(['24h', '7d', '30d']);

function normalizeDigestWindows(value) {
  const requested = Array.isArray(value) && value.length ? value : DIGEST_WINDOWS;
  const windowKeys = [...new Set(requested)];
  if (windowKeys.length > DIGEST_WINDOWS.length
    || windowKeys.some((key) => !DIGEST_WINDOWS.includes(key))) {
    throw new AppError('INVALID_REQUEST', '简报时间范围无效');
  }
  return windowKeys;
}

function createDigestMaintenanceService({
  digestGenerationService,
  maintenanceToken
}) {
  async function regenerate(event = {}) {
    if (!maintenanceAuthorized(event.token, maintenanceToken)) {
      throw new AppError('AUTH_REQUIRED', '该操作仅供云端维护');
    }
    return digestGenerationService.runDue({
      force: true,
      windowKeys: normalizeDigestWindows(event.windowKeys)
    });
  }

  return { regenerate };
}

module.exports = {
  DIGEST_WINDOWS,
  normalizeDigestWindows,
  createDigestMaintenanceService
};
