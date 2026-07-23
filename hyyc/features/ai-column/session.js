const {
  getColumnHome,
  getColumnLesson,
  getColumnPractical,
  getColumnCases,
  getColumnCase,
  getTrendDossier
} = require('./api.js');
const { createQueryCache } = require('../runtime/query-cache.js');
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

const homeCache = createQueryCache({ ttlMs: 5 * 60 * 1000, maxEntries: 3 });
const lessonCache = createQueryCache({ ttlMs: 30 * 60 * 1000, maxEntries: 12 });
const practicalCache = createQueryCache({ ttlMs: 30 * 60 * 1000, maxEntries: 12 });
const casePageCache = createQueryCache({ ttlMs: 5 * 60 * 1000, maxEntries: 12 });
const caseCache = createQueryCache({ ttlMs: 15 * 60 * 1000, maxEntries: 20 });
const trendCache = createQueryCache({ ttlMs: 15 * 60 * 1000, maxEntries: 12 });

function scopedKey(scope, value) {
  return `${scope || 'viewer'}:${value}`;
}

async function loadProtected(cache, key, loader, force) {
  try {
    return await cache.load(key, loader, { force });
  } catch (error) {
    if (error && (error.code === 'ENTITLEMENT_REQUIRED' || error.code === 'ITEM_NOT_FOUND')) {
      cache.invalidate(key);
    }
    throw error;
  }
}

function loadColumnHome({ force = false, scope = 'viewer' } = {}) {
  const key = scopedKey(scope, 'home');
  return loadProtected(homeCache, key, getColumnHome, force);
}

function loadColumnLesson(id, { force = false, scope = 'viewer' } = {}) {
  const key = scopedKey(scope, id);
  return loadProtected(lessonCache, key, () => getColumnLesson(id), force);
}

function loadColumnPractical(id, { force = false, scope = 'viewer' } = {}) {
  const key = scopedKey(scope, id);
  return loadProtected(practicalCache, key, () => getColumnPractical(id), force);
}

function loadColumnCases({ cursor = null, limit = 8, force = false, scope = 'viewer' } = {}) {
  const key = scopedKey(scope, JSON.stringify({ cursor, limit }));
  return loadProtected(casePageCache, key, () => getColumnCases({ cursor, limit }), force);
}

function loadColumnCase(id, { force = false, scope = 'viewer' } = {}) {
  const key = scopedKey(scope, id);
  return loadProtected(caseCache, key, () => getColumnCase(id), force);
}

function loadTrendDossier(id, { force = false, scope = 'viewer' } = {}) {
  const key = scopedKey(scope, id);
  return loadProtected(trendCache, key, () => getTrendDossier(id), force);
}

function clearColumnCache() {
  homeCache.invalidate();
  lessonCache.invalidate();
  practicalCache.invalidate();
  casePageCache.invalidate();
  caseCache.invalidate();
  trendCache.invalidate();
}

registerViewerCache(clearColumnCache);

module.exports = {
  loadColumnHome,
  loadColumnLesson,
  loadColumnPractical,
  loadColumnCases,
  loadColumnCase,
  loadTrendDossier,
  clearColumnCache
};
