const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USER_COLLECTION = 'userInfo';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

exports.main = async (event = {}) => {
  const openid = pickStr(event.openid, event._openid, event.openId);
  if (!openid) {
    return { ok: false, code: 'MISSING_OPENID', msg: 'missing openid' };
  }

  try {
    const res = await db.collection(USER_COLLECTION)
      .where({ _openid: openid })
      .limit(1)
      .get();
    const list = (res && res.data) || [];
    const doc = list[0] || null;
    if (!doc) {
      return { ok: false, code: 'NOT_FOUND', msg: 'user not found' };
    }

    return {
      ok: true,
      profile: {
        _openid: pickStr(doc._openid),
        nickname: pickStr(doc.nickname, doc.nickName),
        name: pickStr(doc.name),
        realname: !!doc.realname,
        avatarFileID: pickStr(doc.avatarFileID),
        avatarUrl: pickStr(doc.avatarUrl)
      }
    };
  } catch (err) {
    console.error('getUserPublicProfile failed', err);
    return {
      ok: false,
      code: 'DB_ERROR',
      msg: pickStr(err && (err.errMsg || err.message), 'db error')
    };
  }
};
