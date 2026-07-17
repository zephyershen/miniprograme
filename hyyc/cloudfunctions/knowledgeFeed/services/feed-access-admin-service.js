const { AppError } = require('../lib/errors');
const { maintenanceAuthorized } = require('../policies/maintenance-auth');
const { ownerKeyForOpenId } = require('./actor-service');

function createFeedAccessAdminService({ accessRepository, maintenanceToken, now = () => Date.now() }) {
  function authorize(providedToken) {
    if (!maintenanceAuthorized(providedToken, maintenanceToken)) {
      throw new AppError('AUTH_REQUIRED', '该操作仅供云端维护');
    }
  }

  async function grant(event = {}) {
    authorize(event.token);
    const ownerKey = event.ownerKey || ownerKeyForOpenId(event.targetOpenId);
    const role = event.role === 'free' ? 'free' : 'admin';
    const status = event.status === 'disabled' || role === 'free' ? 'disabled' : 'active';
    const expiresAt = event.expiresAt ? new Date(event.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new AppError('INVALID_REQUEST', '授权到期时间无效');
    }
    const updatedAt = new Date(now());
    const grantDocument = await accessRepository.grant(ownerKey, {
      role,
      status,
      expiresAt,
      source: 'maintenance',
      updatedAt
    });
    return {
      ownerKey: grantDocument.ownerKey,
      role: grantDocument.role,
      status: grantDocument.status,
      expiresAt: grantDocument.expiresAt,
      updatedAt
    };
  }

  return { authorize, grant };
}

module.exports = { createFeedAccessAdminService };
