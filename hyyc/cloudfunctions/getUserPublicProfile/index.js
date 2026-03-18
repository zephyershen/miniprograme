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
  const userId = pickStr(event.userId, event.id, event.targetUserId);
  let doc = null;
  if (!openid) {
    if (!userId) {
      return { ok: false, code: 'MISSING_TARGET', msg: 'missing openid or userId' };
    }
  }

  try {
    if (openid) {
      const res = await db.collection(USER_COLLECTION)
        .where({ _openid: openid })
        .limit(1)
        .get();
      const list = (res && res.data) || [];
      doc = list[0] || null;
    }
    if (!doc && userId) {
      try {
        const docRes = await db.collection(USER_COLLECTION).doc(userId).get();
        doc = (docRes && docRes.data) || null;
      } catch (err) {
        // ignore doc lookup errors and fallback to id query
      }
    }
    if (!doc && userId) {
      const res = await db.collection(USER_COLLECTION)
        .where({ id: userId })
        .limit(1)
        .get();
      const list = (res && res.data) || [];
      doc = list[0] || null;
    }
    if (!doc) {
      return { ok: false, code: 'NOT_FOUND', msg: 'user not found' };
    }

    return {
      ok: true,
      profile: {
        id: pickStr(doc.id, doc._id),
        _openid: pickStr(doc._openid),
        nickname: pickStr(doc.nickname, doc.nickName),
        name: pickStr(doc.name),
        realname: !!doc.realname,
        avatarFileID: pickStr(doc.avatarFileID),
        avatarUrl: pickStr(doc.avatarUrl),
        community: pickStr(doc.community),
        building: pickStr(doc.building),
        door: pickStr(doc.door)
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
