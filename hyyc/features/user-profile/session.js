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
    const avatarUrl = await resolveAvatarUrl(decorated.avatarFileId);
    const displayAvatarUrl = decorated.displayAvatarFileId === decorated.avatarFileId
      ? avatarUrl
      : await resolveAvatarUrl(decorated.displayAvatarFileId);
    return applyUserProfileAvatar(decorated, avatarUrl, displayAvatarUrl);
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
  const current = profileCache.peek(scope, { allowStale: true });
  const merged = profile && profile.review
    ? profile
    : {
        ...(profile || {}),
        ...(current && current.review ? { review: current.review } : {})
      };
  return profileCache.remember(scope, await presentUserProfile(merged));
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
