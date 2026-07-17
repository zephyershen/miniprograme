const PREVIEW_ROLES = Object.freeze(['free', 'member', 'admin']);

function timestamp(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function activeAdminGrant(grant, now = Date.now()) {
  if (!grant || grant.status !== 'active' || grant.role !== 'admin') return false;
  const expiresAt = timestamp(grant.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt > now;
}

function normalizePreviewRole(value) {
  return PREVIEW_ROLES.includes(value) ? value : 'admin';
}

function previewRoleForGrant(grant, now = Date.now()) {
  return activeAdminGrant(grant, now) ? normalizePreviewRole(grant.previewRole) : null;
}

module.exports = {
  PREVIEW_ROLES,
  activeAdminGrant,
  normalizePreviewRole,
  previewRoleForGrant
};
