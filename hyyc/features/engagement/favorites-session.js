const { getFavorites, toggleFavorite } = require('./api.js');
const { membershipCacheScope } = require('../membership/session.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

const favoritesCache = createQueryCache({ ttlMs: 60 * 1000, maxEntries: 1 });

function loadFavorites({ force = false, scope = membershipCacheScope() } = {}) {
  return favoritesCache.load(scope, getFavorites, { force });
}

async function updateFavorite(itemId, favorited) {
  const result = await toggleFavorite(itemId, favorited);
  favoritesCache.invalidate();
  return result;
}

function clearFavorites() {
  favoritesCache.invalidate();
}

registerViewerCache(clearFavorites);

module.exports = { loadFavorites, updateFavorite, clearFavorites };
