const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const USER_COLLECTION = 'userInfo';
const MSG_COLLECTION = 'messages';
const MESSAGE_CENTER_HIDDEN_COLLECTION = 'message_center_hidden';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function isCollectionNotExists(err = {}, collectionName = '') {
  const targetName = pickStr(collectionName);
  const errCode = Number(err && err.errCode);
  const errMsg = pickStr(err && err.errMsg, err && err.message);
  return errCode === -502005 && (!targetName || errMsg.indexOf(targetName) > -1);
}

async function ensureCollectionExists(name = '') {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (err) {
    // ignore
  }
}

function getLogicalUserId(user = {}) {
  return pickStr(user && user.id, user && user._id);
}

async function getUserByOpenid(openid = '') {
  const targetOpenid = pickStr(openid);
  if (!targetOpenid) return null;
  const res = await db.collection(USER_COLLECTION)
    .where({ _openid: targetOpenid })
    .limit(1)
    .get();
  return ((res && res.data) || [])[0] || null;
}

function buildSessionWhere(kind = '', targetId = '', peerUserId = '') {
  if (kind === 'goods') {
    return {
      bizType: 'goods',
      gid: targetId,
      peerUserId,
    };
  }
  return {
    tid: targetId,
    peerUserId,
  };
}

async function getLatestSessionMessage(where = {}) {
  try {
    const res = await db.collection(MSG_COLLECTION)
      .where(where)
      .orderBy('createTime', 'desc')
      .limit(1)
      .get();
    return ((res && res.data) || [])[0] || null;
  } catch (err) {
    const res = await db.collection(MSG_COLLECTION)
      .where(where)
      .limit(1)
      .get();
    return ((res && res.data) || [])[0] || null;
  }
}

function resolveReaderRole(kind = '', currentUserId = '', sample = {}) {
  const userId = pickStr(currentUserId);
  if (kind === 'goods') {
    const sellerId = pickStr(sample && sample.sellerId);
    const buyerId = pickStr(sample && sample.peerUserId);
    if (userId && userId === sellerId) return 'seller';
    if (userId && userId === buyerId) return 'buyer';
    return '';
  }
  const ownerId = pickStr(sample && sample.ownerId);
  const peerUserId = pickStr(sample && sample.peerUserId);
  if (userId && userId === ownerId) return 'owner';
  if (userId && userId === peerUserId) return 'peer';
  return '';
}

function resolveReadField(role = '') {
  const normalized = pickStr(role).toLowerCase();
  if (normalized === 'owner') return 'readByOwner';
  if (normalized === 'peer') return 'readByPeer';
  if (normalized === 'seller') return 'readBySeller';
  if (normalized === 'buyer') return 'readByBuyer';
  return '';
}

async function upsertHiddenSession({
  openid = '',
  userId = '',
  sessionKey = '',
  kind = '',
  targetId = '',
  peerUserId = '',
  hiddenAt = new Date(),
}) {
  const where = {
    userId: pickStr(userId),
    sessionKey: pickStr(sessionKey),
  };
  const payload = {
    _openid: pickStr(openid),
    userId: pickStr(userId),
    sessionKey: pickStr(sessionKey),
    kind: pickStr(kind),
    targetId: pickStr(targetId),
    peerUserId: pickStr(peerUserId),
    hiddenAt,
    updatedAt: hiddenAt,
  };
  let res = null;
  try {
    res = await db.collection(MESSAGE_CENTER_HIDDEN_COLLECTION)
      .where(where)
      .limit(1)
      .get();
  } catch (err) {
    if (!isCollectionNotExists(err, MESSAGE_CENTER_HIDDEN_COLLECTION)) {
      throw err;
    }
    await ensureCollectionExists(MESSAGE_CENTER_HIDDEN_COLLECTION);
    res = await db.collection(MESSAGE_CENTER_HIDDEN_COLLECTION)
      .where(where)
      .limit(1)
      .get();
  }
  const existing = ((res && res.data) || [])[0] || null;
  if (existing && existing._id) {
    await db.collection(MESSAGE_CENTER_HIDDEN_COLLECTION).doc(existing._id).update({
      data: payload,
    });
    return existing._id;
  }
  let addRes = null;
  try {
    addRes = await db.collection(MESSAGE_CENTER_HIDDEN_COLLECTION).add({
      data: {
        ...payload,
        createdAt: hiddenAt,
      }
    });
  } catch (err) {
    if (!isCollectionNotExists(err, MESSAGE_CENTER_HIDDEN_COLLECTION)) {
      throw err;
    }
    await ensureCollectionExists(MESSAGE_CENTER_HIDDEN_COLLECTION);
    addRes = await db.collection(MESSAGE_CENTER_HIDDEN_COLLECTION).add({
      data: {
        ...payload,
        createdAt: hiddenAt,
      }
    });
  }
  return pickStr(addRes && addRes._id);
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID' };
  }

  const kind = pickStr(event.kind);
  const targetId = pickStr(event.targetId);
  const peerUserId = pickStr(event.peerUserId);
  const sessionKey = pickStr(event.key, `${kind}:${targetId}:${peerUserId}`);

  if (!kind || !targetId || !peerUserId || !sessionKey) {
    return { ok: false, code: 'INVALID_PARAM', msg: '缺少必要参数' };
  }

  try {
    const user = await getUserByOpenid(OPENID);
    const currentUserId = getLogicalUserId(user);
    if (!currentUserId) {
      return { ok: false, code: 'USER_NOT_READY', msg: '用户信息未初始化' };
    }

    const sessionWhere = buildSessionWhere(kind, targetId, peerUserId);
    const sample = await getLatestSessionMessage(sessionWhere);
    if (!sample) {
      return { ok: false, code: 'SESSION_NOT_FOUND', msg: '会话不存在或已失效' };
    }

    const readerRole = resolveReaderRole(kind, currentUserId, sample);
    const readField = resolveReadField(readerRole);
    if (!readField) {
      return { ok: false, code: 'NO_PERMISSION', msg: '无权删除该会话' };
    }

    const hiddenAt = new Date();
    const unreadWhere = {
      ...sessionWhere,
      fromUserId: _.neq(currentUserId),
      [readField]: _.neq(true),
    };

    const [updateRes] = await Promise.all([
      db.collection(MSG_COLLECTION)
        .where(unreadWhere)
        .update({
          data: {
            [readField]: true,
          }
        }),
      upsertHiddenSession({
        openid: OPENID,
        userId: currentUserId,
        sessionKey,
        kind,
        targetId,
        peerUserId,
        hiddenAt,
      })
    ]);

    return {
      ok: true,
      updated: (updateRes && updateRes.stats && updateRes.stats.updated) || 0,
      hiddenAt,
    };
  } catch (err) {
    console.error('deleteMessageCenterSession failed', err);
    return {
      ok: false,
      code: pickStr(err && err.errCode, 'DELETE_MESSAGE_CENTER_SESSION_ERROR'),
      msg: pickStr(err && (err.errMsg || err.message), '删除会话失败'),
    };
  }
};
