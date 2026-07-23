const { getMembershipStatus, setMembershipRolePreview } = require('./api.js');
const { normalizeMembershipAccess } = require('./access.js');
const { clearViewerCaches } = require('../runtime/viewer-cache-registry.js');

const MEMBERSHIP_CACHE_MS = 2 * 60 * 1000;
let revision = 0;
let cachedAt = 0;
let refreshPromise = null;
let requestGeneration = 0;

function accessRevisionKey(access) {
  const source = normalizeMembershipAccess(access);
  const viewer = source.viewer || {};
  const entitlements = source.entitlements || {};
  const history = entitlements.history || {};
  const features = source.features || {};
  return JSON.stringify({
    role: viewer.role,
    cachePartition: viewer.cachePartition || '',
    status: viewer.membershipStatus,
    periodEnd: viewer.currentPeriodEnd || null,
    history: [history.mode || 'rolling', history.days || null],
    timeRanges: [...(entitlements.allowedTimeRanges || [])].sort(),
    curatedFeed: entitlements.curatedFeed === true,
    aiColumn: entitlements.aiColumn === true,
    comments: entitlements.comments === true,
    digests: [...(entitlements.digests || [])].sort(),
    memberPurchases: features.memberPurchases === true
  });
}

function appInstance() {
  try {
    return getApp();
  } catch (error) {
    return null;
  }
}

function effectiveMembershipAccess(raw, now = Date.now()) {
  const normalized = normalizeMembershipAccess(raw);
  const viewer = normalized.viewer || {};
  const periodEnd = new Date(viewer.currentPeriodEnd || '').getTime();
  if (viewer.role !== 'member' || viewer.isActualAdmin === true
    || viewer.actualRole === 'admin'
    || !Number.isFinite(periodEnd) || periodEnd > Number(now)) {
    return normalized;
  }
  return normalizeMembershipAccess({
    ...normalized,
    viewer: {
      ...viewer,
      role: 'free',
      isAdmin: false,
      isMember: false,
      membershipStatus: 'expired'
    },
    entitlements: {
      ...normalized.entitlements,
      history: { mode: 'rolling', days: 1 },
      allowedTimeRanges: ['1d'],
      curatedFeed: false,
      aiColumn: false,
      comments: false,
      digests: []
    }
  });
}

function cachedMembershipAccess() {
  const app = appInstance();
  if (!app || !app.globalData || !app.globalData.membership) return null;
  const stored = normalizeMembershipAccess(app.globalData.membership);
  const effective = effectiveMembershipAccess(stored);
  if (accessRevisionKey(stored) !== accessRevisionKey(effective)) {
    return storeMembershipAccess(effective);
  }
  return effective;
}

function latestMembershipResult(staleRequest) {
  if (refreshPromise && refreshPromise !== staleRequest) return refreshPromise;
  return cachedMembershipAccess();
}

async function refreshMembershipAccess({ force = false } = {}) {
  const cached = cachedMembershipAccess();
  if (!force && refreshPromise) return refreshPromise;
  if (!force && cached && Date.now() - cachedAt <= MEMBERSHIP_CACHE_MS) return cached;

  const generation = requestGeneration + 1;
  requestGeneration = generation;
  const pending = (async () => {
    const normalized = normalizeMembershipAccess(await getMembershipStatus());
    if (generation !== requestGeneration) return latestMembershipResult(pending);
    cachedAt = Date.now();
    return storeMembershipAccess(normalized);
  })();
  refreshPromise = pending;
  try {
    return await pending;
  } finally {
    if (refreshPromise === pending) refreshPromise = null;
  }
}

function storeMembershipAccess(raw) {
  const normalized = effectiveMembershipAccess(raw);
  const app = appInstance();
  if (app && app.globalData) {
    const previous = app.globalData.membership
      ? normalizeMembershipAccess(app.globalData.membership)
      : null;
    const accessChanged = previous
      && accessRevisionKey(previous) !== accessRevisionKey(normalized);
    app.globalData.membership = normalized;
    if (accessChanged) {
      revision += 1;
      app.globalData.knowledgeFeed = null;
      app.globalData.curatedFeed = null;
      app.globalData.briefing = null;
      clearViewerCaches();
    } else {
      if (previous && previous.entitlements.curatedFeed && !normalized.entitlements.curatedFeed) {
        app.globalData.curatedFeed = null;
      }
      if (previous && previous.entitlements.digests.length && !normalized.entitlements.digests.length) {
        app.globalData.briefing = null;
      }
    }
  }
  return normalized;
}

async function changeMembershipRolePreview(role) {
  const generation = requestGeneration + 1;
  requestGeneration = generation;
  const pending = (async () => {
    const normalized = normalizeMembershipAccess(await setMembershipRolePreview(role));
    if (generation !== requestGeneration) return latestMembershipResult(pending);
    cachedAt = Date.now();
    return storeMembershipAccess(normalized);
  })();
  refreshPromise = pending;
  try {
    return await pending;
  } finally {
    if (refreshPromise === pending) refreshPromise = null;
  }
}

function membershipRevision() {
  return revision;
}

function membershipCacheScope(access = cachedMembershipAccess(), now = Date.now()) {
  if (!access) return `unresolved:${revision}`;
  const source = effectiveMembershipAccess(access, now);
  const viewer = source.viewer || {};
  const entitlements = source.entitlements || {};
  const history = entitlements.history || {};
  const role = viewer.role || 'free';
  return JSON.stringify({
    cachePartition: viewer.cachePartition || 'viewer',
    revision,
    role,
    status: viewer.membershipStatus || 'inactive',
    periodEnd: viewer.currentPeriodEnd || null,
    history: [history.mode || 'rolling', history.days || null],
    timeRanges: entitlements.allowedTimeRanges || [],
    curatedFeed: entitlements.curatedFeed === true,
    aiColumn: entitlements.aiColumn === true,
    comments: entitlements.comments === true,
    digests: entitlements.digests || []
  });
}

function clearProtectedSession() {
  const app = appInstance();
  requestGeneration += 1;
  revision += 1;
  cachedAt = 0;
  refreshPromise = null;
  if (app && app.globalData) {
    app.globalData.membership = null;
    app.globalData.knowledgeFeed = null;
    app.globalData.curatedFeed = null;
    app.globalData.briefing = null;
  }
  clearViewerCaches();
}

module.exports = {
  MEMBERSHIP_CACHE_MS,
  cachedMembershipAccess,
  refreshMembershipAccess,
  changeMembershipRolePreview,
  membershipRevision,
  membershipCacheScope,
  clearProtectedSession
};
