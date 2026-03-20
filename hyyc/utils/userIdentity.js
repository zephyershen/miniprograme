const { normalizePlatformAdminUser } = require('./platformAdmin');

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function pickUserId(user = {}) {
  return pickStr(user && user.id, user && user._id);
}

function normalizeStoredUser(user = {}) {
  const source = user && typeof user === 'object' ? user : {};
  const normalized = { ...source };
  const userId = pickUserId(source);
  if (userId) normalized.id = userId;
  return normalizePlatformAdminUser(normalized);
}

function getStoredUser() {
  try {
    return normalizeStoredUser(wx.getStorageSync('hyyc_user') || {});
  } catch (err) {
    return {};
  }
}

function setStoredUser(user = {}) {
  const next = normalizeStoredUser(user);
  try {
    wx.setStorageSync('hyyc_user', next);
  } catch (err) {
    // ignore
  }
  return next;
}

function patchStoredUser(patch = {}) {
  const current = getStoredUser();
  return setStoredUser({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
}

module.exports = {
  pickUserId,
  normalizeStoredUser,
  getStoredUser,
  setStoredUser,
  patchStoredUser,
};
