const { AppError } = require('../lib/errors');
const {
  activeAdminGrant,
  normalizePreviewRole
} = require('../policies/role-preview');

function createRolePreviewService({ accessRepository, now = () => Date.now() }) {
  async function set(actor, requestedRole) {
    const currentTime = now();
    const grant = await accessRepository.get(actor.ownerKey);
    if (!activeAdminGrant(grant, currentTime)) {
      throw new AppError('ADMIN_REQUIRED', '只有管理员可以切换身份预览');
    }
    const previewRole = normalizePreviewRole(requestedRole);
    if (previewRole !== requestedRole) {
      throw new AppError('INVALID_REQUEST', '不支持的预览身份');
    }
    await accessRepository.setPreviewRole(actor.ownerKey, previewRole, new Date(currentTime));
    return { previewRole };
  }

  return { set };
}

module.exports = { createRolePreviewService };
