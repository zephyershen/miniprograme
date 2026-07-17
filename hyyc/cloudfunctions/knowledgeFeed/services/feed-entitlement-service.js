const { AppError } = require('../lib/errors');
const { normalizeMembership, membershipActive } = require('./membership-service');
const {
  activeAdminGrant,
  previewRoleForGrant
} = require('../policies/role-preview');

const FREE_TIME_KEYS = Object.freeze(['1d', '3d', '7d']);
const MEMBER_TIME_KEYS = Object.freeze(['1d', '3d', '7d', '30d']);
const ADMIN_TIME_KEYS = Object.freeze(['1d', '3d', '7d', '30d', 'all']);
const DIGEST_FEATURES = Object.freeze({
  '24h': 'digest_24h',
  '7d': 'digest_7d',
  '30d': 'digest_30d'
});

function roleAccess(role, config) {
  if (role === 'admin') {
    return {
      history: { mode: 'all' },
      historyDays: null,
      allowedTimeKeys: [...ADMIN_TIME_KEYS],
      defaultTimeKey: 'all',
      label: '可查看全部已归档资讯'
    };
  }
  const member = role === 'member';
  const historyDays = member
    ? Math.max(1, Number(config.memberWindowDays) || 30)
    : Math.max(1, Number(config.freeWindowDays) || 7);
  return {
    history: { mode: 'rolling', days: historyDays },
    historyDays,
    allowedTimeKeys: member ? [...MEMBER_TIME_KEYS] : [...FREE_TIME_KEYS],
    defaultTimeKey: member ? '30d' : '7d',
    label: `可查看近 ${historyDays} 天`
  };
}

function entitlementView(
  role,
  config,
  membershipDocument = null,
  coverage = null,
  now = Date.now(),
  featureFlags = null
) {
  const access = roleAccess(role, config);
  const membership = normalizeMembership(membershipDocument, now);
  const paid = role === 'member' || role === 'admin';
  return {
    role,
    historyDays: access.historyDays,
    history: access.history,
    viewer: {
      role,
      isAdmin: role === 'admin',
      membershipStatus: membership.status,
      currentPeriodEnd: membership.currentPeriodEnd,
      renewalState: membership.renewalState
    },
    entitlements: {
      history: access.history,
      allowedTimeRanges: [...access.allowedTimeKeys],
      curatedFeed: paid,
      digests: paid ? ['24h', '7d', '30d'] : []
    },
    features: {
      membershipUi: featureFlags ? featureFlags.membershipUi === true : true,
      liveCurated: featureFlags ? featureFlags.liveCurated === true : false,
      liveDigests: featureFlags ? featureFlags.liveDigests === true : false,
      memberPurchases: featureFlags ? featureFlags.memberPurchases === true : false
    },
    coverage: coverage || { state: 'partial', completeFrom: null },
    access: {
      historyMode: access.history.mode,
      maxHistoryDays: access.historyDays,
      allowedTimeKeys: [...access.allowedTimeKeys],
      defaultTimeKey: access.defaultTimeKey,
      label: access.label
    }
  };
}

function featureEnabled(entitlement, featureKey) {
  if (!entitlement || !entitlement.entitlements) return false;
  if (featureKey === 'curated_feed') return entitlement.entitlements.curatedFeed === true;
  if (featureKey === 'history_30d') {
    const history = entitlement.entitlements.history || {};
    return history.mode === 'all' || Number(history.days) >= 30;
  }
  const digest = Object.entries(DIGEST_FEATURES).find(([, key]) => key === featureKey);
  return Boolean(digest && entitlement.entitlements.digests.includes(digest[0]));
}

function requireFeature(entitlement, featureKey, message = '此功能需要 Pro 会员') {
  if (!featureEnabled(entitlement, featureKey)) {
    throw new AppError('ENTITLEMENT_REQUIRED', message, { featureKey });
  }
}

function createFeedEntitlementService({
  accessRepository,
  membershipRepository = null,
  config,
  featureFlags = null,
  now = () => Date.now()
}) {
  async function resolve(actor) {
    const currentTime = now();
    const [grant, membershipDocument] = await Promise.all([
      accessRepository.get(actor.ownerKey),
      membershipRepository ? membershipRepository.get(actor.ownerKey) : null
    ]);
    const actualRole = activeAdminGrant(grant, currentTime)
      ? 'admin'
      : (membershipActive(membershipDocument, currentTime) ? 'member' : 'free');
    const previewRole = actualRole === 'admin'
      ? previewRoleForGrant(grant, currentTime)
      : null;
    const role = previewRole || actualRole;
    const entitlement = entitlementView(
      role,
      config,
      membershipDocument,
      null,
      currentTime,
      featureFlags
    );
    return {
      ...entitlement,
      viewer: {
        ...entitlement.viewer,
        membershipStatus: actualRole === 'admin' && role === 'member'
          ? 'active'
          : entitlement.viewer.membershipStatus,
        actualRole,
        isActualAdmin: actualRole === 'admin',
        canPreviewRoles: actualRole === 'admin',
        previewRole: actualRole === 'admin' ? role : null,
        isRolePreview: actualRole === 'admin' && role !== 'admin'
      }
    };
  }

  return { resolve };
}

module.exports = {
  ADMIN_TIME_KEYS,
  MEMBER_TIME_KEYS,
  FREE_TIME_KEYS,
  DIGEST_FEATURES,
  activeAdminGrant,
  roleAccess,
  entitlementView,
  featureEnabled,
  requireFeature,
  createFeedEntitlementService
};
