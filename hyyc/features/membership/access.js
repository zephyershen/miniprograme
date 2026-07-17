const ROLE_ORDER = Object.freeze({ free: 0, member: 1, admin: 2 });
const FREE_TIME_KEYS = Object.freeze(['1d', '3d', '7d']);
const MEMBER_TIME_KEYS = Object.freeze(['1d', '3d', '7d', '30d']);
const ADMIN_TIME_KEYS = Object.freeze(['1d', '3d', '7d', '30d', 'all']);

function normalizeRole(viewer = {}) {
  if (viewer.role === 'admin' || viewer.isAdmin === true) return 'admin';
  if (viewer.role === 'member' || viewer.isMember === true) return 'member';
  return 'free';
}

function defaultTimeKeys(role) {
  if (role === 'admin') return [...ADMIN_TIME_KEYS];
  if (role === 'member') return [...MEMBER_TIME_KEYS];
  return [...FREE_TIME_KEYS];
}

function validTimeKeys(value, role) {
  const allowed = new Set(defaultTimeKeys(role));
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key) => allowed.has(key)))];
}

function normalizeHistory(role, entitlements = {}, access = {}) {
  const raw = entitlements.history || access.history;
  if (!raw && role === 'admin') return { mode: 'all' };
  if (raw && raw.mode === 'all' && role === 'admin') return { mode: 'all' };
  const fallbackDays = role === 'member' ? 30 : 7;
  const days = Math.max(1, Number(raw && raw.days) || Number(access.maxHistoryDays) || fallbackDays);
  return { mode: 'rolling', days: role === 'admin' ? days : Math.min(role === 'member' ? 30 : 7, days) };
}

function normalizeMembershipAccess(raw = {}) {
  const viewer = raw.viewer && typeof raw.viewer === 'object' ? raw.viewer : {};
  const entitlements = raw.entitlements && typeof raw.entitlements === 'object' ? raw.entitlements : {};
  const legacyAccess = raw.access && typeof raw.access === 'object' ? raw.access : {};
  const role = normalizeRole(viewer);
  const history = normalizeHistory(role, entitlements, legacyAccess);
  const explicitKeys = validTimeKeys(
    entitlements.allowedTimeRanges || legacyAccess.allowedTimeKeys || legacyAccess.allowedTimes,
    role
  );
  const allowedTimeRanges = explicitKeys.length ? explicitKeys : defaultTimeKeys(role);
  const preferredDefault = legacyAccess.defaultTimeKey || legacyAccess.defaultTime;
  const roleDefault = role === 'admin' ? 'all' : role === 'member' ? '30d' : '7d';
  const defaultTimeRange = allowedTimeRanges.includes(preferredDefault)
    ? preferredDefault
    : (allowedTimeRanges.includes(roleDefault) ? roleDefault : allowedTimeRanges[allowedTimeRanges.length - 1]);
  const membershipStatus = typeof viewer.membershipStatus === 'string'
    ? viewer.membershipStatus
    : role === 'member' ? 'active' : 'inactive';
  const normalizedViewer = {
    ...viewer,
    role,
    isAdmin: role === 'admin',
    isMember: role === 'member' || role === 'admin',
    membershipStatus,
    currentPeriodEnd: viewer.currentPeriodEnd || null,
    renewalState: viewer.renewalState || 'none'
  };
  const normalizedEntitlements = {
    ...entitlements,
    history,
    allowedTimeRanges,
    curatedFeed: role === 'admin' || entitlements.curatedFeed === true,
    digests: role === 'admin'
      ? ['24h', '7d', '30d']
      : Array.isArray(entitlements.digests) ? entitlements.digests : []
  };
  const label = role === 'admin'
    ? '可查看全部已归档资讯'
    : `可查看近 ${history.days || 7} 天`;
  return {
    viewer: normalizedViewer,
    entitlements: normalizedEntitlements,
    features: raw.features && typeof raw.features === 'object'
      ? raw.features
      : {
          membershipUi: true,
          liveCurated: false,
          liveDigests: false,
          memberPurchases: false
        },
    access: {
      ...legacyAccess,
      history,
      historyMode: history.mode,
      maxHistoryDays: history.mode === 'all' ? null : history.days,
      allowedTimeKeys: allowedTimeRanges,
      defaultTimeKey: defaultTimeRange,
      label
    },
    coverage: raw.coverage && typeof raw.coverage === 'object'
      ? raw.coverage
      : raw.archiveCoverage && typeof raw.archiveCoverage === 'object'
        ? raw.archiveCoverage
      : { state: 'partial', completeFrom: null }
  };
}

function canUseFeature(access, featureKey) {
  const normalized = normalizeMembershipAccess(access);
  if (normalized.viewer.role === 'admin') return true;
  if (featureKey === 'curated_feed') return normalized.entitlements.curatedFeed === true;
  if (featureKey.startsWith('digest_')) {
    return normalized.entitlements.digests.includes(featureKey.replace('digest_', ''));
  }
  if (featureKey === 'history_30d') {
    return normalized.access.allowedTimeKeys.includes('30d');
  }
  return false;
}

function roleAtLeast(access, role) {
  const current = normalizeMembershipAccess(access).viewer.role;
  return ROLE_ORDER[current] >= ROLE_ORDER[role];
}

module.exports = {
  FREE_TIME_KEYS,
  MEMBER_TIME_KEYS,
  ADMIN_TIME_KEYS,
  normalizeMembershipAccess,
  canUseFeature,
  roleAtLeast
};
