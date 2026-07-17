const { getMembershipStatus } = require('./api.js');
const { normalizeMembershipAccess } = require('./access.js');

const CACHE_MS = 10 * 1000;
let pending = null;
let cachedAt = 0;

function appInstance() {
  try {
    return getApp();
  } catch (error) {
    return null;
  }
}

function cachedMembershipAccess() {
  const app = appInstance();
  return app && app.globalData && app.globalData.membership
    ? normalizeMembershipAccess(app.globalData.membership)
    : null;
}

async function refreshMembershipAccess({ force = false } = {}) {
  const cached = cachedMembershipAccess();
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (pending) return pending;
  pending = getMembershipStatus()
    .then((raw) => {
      const normalized = normalizeMembershipAccess(raw);
      const app = appInstance();
      if (app && app.globalData) {
        const previous = app.globalData.membership
          ? normalizeMembershipAccess(app.globalData.membership)
          : null;
        app.globalData.membership = normalized;
        if (previous && previous.entitlements.curatedFeed && !normalized.entitlements.curatedFeed) {
          app.globalData.curatedFeed = null;
        }
        if (previous && previous.entitlements.digests.length && !normalized.entitlements.digests.length) {
          app.globalData.briefing = null;
        }
      }
      cachedAt = Date.now();
      return normalized;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function clearProtectedSession() {
  const app = appInstance();
  if (!app || !app.globalData) return;
  app.globalData.membership = null;
  app.globalData.curatedFeed = null;
  app.globalData.briefing = null;
  cachedAt = 0;
}

module.exports = {
  cachedMembershipAccess,
  refreshMembershipAccess,
  clearProtectedSession
};
