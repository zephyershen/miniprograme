const { getUserProfile, saveUserProfile } = require('./api.js');
const { decorateUserProfile, applyUserProfileAvatar } = require('./model.js');
const { resolveAvatarUrl } = require('./media.js');
const { membershipCacheScope } = require('../membership/session.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

const profileCache = createQueryCache({ ttlMs: 5 * 60 * 1000, maxEntries: 1 });

async function presentUserProfile(profile) {
  const decorated = decorateUserProfile(profile);
  try {
    return applyUserProfileAvatar(decorated, await resolveAvatarUrl(decorated.avatarFileId));
  } catch (error) {
    return decorated;
  }
}

async function loadUserProfile({ force = false, scope = membershipCacheScope() } = {}) {
  return profileCache.load(scope, async () => {
    const result = await getUserProfile();
    return presentUserProfile(result && result.profile);
  }, { force });
}

async function updateUserProfile(profile) {
  const scope = membershipCacheScope();
  const result = await saveUserProfile(profile);
  return profileCache.remember(scope, await presentUserProfile(result && result.profile));
}

async function rememberUserProfile(profile) {
  const scope = membershipCacheScope();
  return profileCache.remember(scope, await presentUserProfile(profile));
}

function clearUserProfile() {
  profileCache.invalidate();
}

registerViewerCache(clearUserProfile);

module.exports = {
  loadUserProfile,
  updateUserProfile,
  rememberUserProfile,
  presentUserProfile,
  clearUserProfile
};
