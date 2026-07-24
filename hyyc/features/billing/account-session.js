const STORAGE_KEY = 'membership_account_verification_v1';
const STORAGE_VERSION = 1;

// This record controls only the two-step UI. createPayment always repeats
// wx.login + code2Session and remains the authoritative account check.
function currentWxApi() {
  return typeof wx === 'undefined' ? null : wx;
}

function accountPartition(access) {
  const value = access
    && access.viewer
    && access.viewer.cachePartition;
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length >= 8
    && normalized.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : '';
}

function membershipAccountVerified(access, wxApi = currentWxApi()) {
  const partition = accountPartition(access);
  if (!partition || !wxApi || typeof wxApi.getStorageSync !== 'function') return false;
  try {
    const record = wxApi.getStorageSync(STORAGE_KEY);
    return Boolean(
      record
      && record.version === STORAGE_VERSION
      && record.cachePartition === partition
      && record.verified === true
    );
  } catch (error) {
    return false;
  }
}

function rememberMembershipAccountVerification(access, wxApi = currentWxApi()) {
  const partition = accountPartition(access);
  if (!partition || !wxApi || typeof wxApi.setStorageSync !== 'function') return false;
  try {
    wxApi.setStorageSync(STORAGE_KEY, {
      version: STORAGE_VERSION,
      cachePartition: partition,
      verified: true,
      verifiedAt: Date.now()
    });
    return true;
  } catch (error) {
    return false;
  }
}

function forgetMembershipAccountVerification(access, wxApi = currentWxApi()) {
  const partition = accountPartition(access);
  if (!partition
    || !wxApi
    || typeof wxApi.getStorageSync !== 'function'
    || typeof wxApi.removeStorageSync !== 'function') return false;
  try {
    const record = wxApi.getStorageSync(STORAGE_KEY);
    if (!record) return true;
    if (record.cachePartition !== partition) return false;
    wxApi.removeStorageSync(STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  STORAGE_KEY,
  accountPartition,
  membershipAccountVerified,
  rememberMembershipAccountVerification,
  forgetMembershipAccountVerification
};
