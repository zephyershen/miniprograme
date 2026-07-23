const { getKnowledgeItem } = require('./api.js');
const {
  membershipCacheScope
} = require('../membership/session.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

const itemCache = createQueryCache({ ttlMs: 2 * 60 * 1000, maxEntries: 20 });

function accessScope() {
  return membershipCacheScope();
}

function cacheKey(id, scope = accessScope()) {
  return `${scope}:${id}`;
}

async function loadKnowledgeItem(id, { scope = accessScope() } = {}) {
  const key = cacheKey(id, scope);
  try {
    // Detail access is authoritative. Revalidate on every open so an expired
    // entitlement or deleted item cannot be masked by a still-fresh cache.
    return await itemCache.load(key, () => getKnowledgeItem(id), { force: true });
  } catch (error) {
    if (error && (error.code === 'ENTITLEMENT_REQUIRED' || error.code === 'ITEM_NOT_FOUND')) {
      itemCache.invalidate(key);
      throw error;
    }
    throw error;
  }
}

function clearKnowledgeItemCache() {
  itemCache.invalidate();
}

registerViewerCache(clearKnowledgeItemCache);

module.exports = {
  loadKnowledgeItem,
  clearKnowledgeItemCache
};
