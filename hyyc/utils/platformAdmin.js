const PLATFORM_ADMIN_USER_ID = '6a0a1fb669ba051f009897926f6fb98b';
const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';
const PLATFORM_ADMIN_PHONE = '18451306773';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function isPlatformAdminUser(user = {}) {
  const source = user && typeof user === 'object' ? user : {};
  const openid = pickStr(source._openid, source.openid);
  if (openid) return openid === PLATFORM_ADMIN_OPENID;
  const userId = pickStr(source.id, source._id);
  if (userId && userId === PLATFORM_ADMIN_USER_ID) return true;
  const phone = pickStr(source.phone, source.mobileNo, source.mobile, source.adminPhone);
  return !!(phone && phone === PLATFORM_ADMIN_PHONE);
}

function normalizePlatformAdminUser(user = {}) {
  const source = user && typeof user === 'object' ? user : {};
  return {
    ...source,
    isPlatformAdmin: isPlatformAdminUser(source)
  };
}

module.exports = {
  PLATFORM_ADMIN_USER_ID,
  PLATFORM_ADMIN_OPENID,
  PLATFORM_ADMIN_PHONE,
  isPlatformAdminUser,
  normalizePlatformAdminUser,
};
