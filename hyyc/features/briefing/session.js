const { getBriefing } = require('./api.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

const briefingCache = createQueryCache({ ttlMs: 5 * 60 * 1000, maxEntries: 3 });

async function loadBriefing(windowKey, { force = false, scope = 'viewer' } = {}) {
  const key = `${scope}:${windowKey || '24h'}`;
  try {
    return await briefingCache.load(key, () => getBriefing(windowKey), { force });
  } catch (error) {
    if (error && error.code === 'ENTITLEMENT_REQUIRED') briefingCache.invalidate(key);
    throw error;
  }
}

function clearBriefings() {
  briefingCache.invalidate();
}

registerViewerCache(clearBriefings);

module.exports = { loadBriefing, clearBriefings };
