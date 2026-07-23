const { AppError } = require('../lib/errors');
const { maintenanceAuthorized } = require('../policies/maintenance-auth');

function createFeedSyncMaintenanceService({ allFeedSyncService, maintenanceToken }) {
  async function refresh(event = {}) {
    if (!maintenanceAuthorized(event.token, maintenanceToken)) {
      throw new AppError('AUTH_REQUIRED', '该操作仅供云端维护');
    }
    return allFeedSyncService.run({ force: true });
  }

  return { refresh };
}

module.exports = { createFeedSyncMaintenanceService };
