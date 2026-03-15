const AVATAR_TEMP_URL_CACHE_KEY = 'hyyc_avatar_temp_urls';
const DEFAULT_MAX_AGE_SEC = 60 * 30;
const EXPIRE_BUFFER_MS = 60 * 1000;

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function isCloudFileID(v = '') {
  return String(v || '').indexOf('cloud://') === 0;
}

function readAvatarTempURLCache() {
  try {
    const cached = wx.getStorageSync(AVATAR_TEMP_URL_CACHE_KEY);
    return cached && typeof cached === 'object' ? cached : {};
  } catch (e) {
    return {};
  }
}

function writeAvatarTempURLCache(cache = {}) {
  try {
    wx.setStorageSync(AVATAR_TEMP_URL_CACHE_KEY, cache);
  } catch (e) {
    // ignore
  }
}

function pruneAvatarTempURLCache(cache = {}) {
  const now = Date.now();
  const next = {};
  const src = cache && typeof cache === 'object' ? cache : {};
  Object.keys(src).forEach((fileID) => {
    const item = src[fileID] || {};
    const url = pickStr(item.url);
    const expiresAt = Number(item.expiresAt) || 0;
    if (!url) return;
    if (expiresAt && expiresAt <= now) return;
    next[fileID] = {
      url,
      expiresAt
    };
  });
  return next;
}

function getCachedAvatarTempURL(fileID = '') {
  const normalized = pickStr(fileID);
  if (!normalized || !isCloudFileID(normalized)) return '';
  const cache = pruneAvatarTempURLCache(readAvatarTempURLCache());
  const item = cache[normalized] || {};
  const url = pickStr(item.url);
  if (url) return url;
  return '';
}

function saveAvatarTempURL(fileID = '', url = '', maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const normalizedFileID = pickStr(fileID);
  const normalizedURL = pickStr(url);
  if (!normalizedFileID || !normalizedURL || !isCloudFileID(normalizedFileID)) return;

  const ttlMs = Math.max(60, Number(maxAgeSec) || DEFAULT_MAX_AGE_SEC) * 1000;
  const expiresAt = Date.now() + ttlMs - EXPIRE_BUFFER_MS;
  const cache = pruneAvatarTempURLCache(readAvatarTempURLCache());
  cache[normalizedFileID] = {
    url: normalizedURL,
    expiresAt,
  };
  writeAvatarTempURLCache(cache);
}

function saveAvatarTempURLMap(map = {}, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const src = map && typeof map === 'object' ? map : {};
  Object.keys(src).forEach((fileID) => {
    saveAvatarTempURL(fileID, src[fileID], maxAgeSec);
  });
}

function resolveAvatarURL(...sources) {
  for (let i = 0; i < sources.length; i += 1) {
    const src = pickStr(sources[i]);
    if (!src) continue;
    if (!isCloudFileID(src)) return src;
    const cached = getCachedAvatarTempURL(src);
    if (cached) return cached;
  }
  return '';
}

module.exports = {
  isCloudFileID,
  getCachedAvatarTempURL,
  saveAvatarTempURL,
  saveAvatarTempURLMap,
  resolveAvatarURL
};
