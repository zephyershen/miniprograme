const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const USER_COLLECTION = 'userInfo';
const MSG_COLLECTION = 'messages';
const TASK_COLLECTION = 'tasks';
const GOODS_COLLECTION = 'goods';
const QUERY_LIMIT = 1000;
const BATCH_LIMIT = 100;

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function uniqueList(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((item) => pickStr(item)).filter(Boolean)));
}

function getLogicalUserId(user = {}) {
  return pickStr(user && user.id, user && user._id);
}

function toTs(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && Number.isFinite(value.$date)) return value.$date;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
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

async function fetchByIds(collectionName = '', ids = []) {
  const normalizedIds = uniqueList(ids);
  const map = {};
  for (let i = 0; i < normalizedIds.length; i += BATCH_LIMIT) {
    const part = normalizedIds.slice(i, i + BATCH_LIMIT);
    if (!part.length) continue;
    const res = await db.collection(collectionName)
      .where({ _id: _.in(part) })
      .get();
    ((res && res.data) || []).forEach((doc) => {
      if (doc && doc._id) map[doc._id] = doc;
    });
  }
  return map;
}

async function fetchMessagesForUser(currentUserId = '') {
  const userId = pickStr(currentUserId);
  if (!userId) return [];

  const runQuery = async (where = {}) => {
    try {
      return await db.collection(MSG_COLLECTION)
        .where(where)
        .orderBy('createTime', 'desc')
        .limit(QUERY_LIMIT)
        .get();
    } catch (err) {
      console.warn('getMessageCenter ordered query failed, fallback to unordered query', where, err);
      return db.collection(MSG_COLLECTION)
        .where(where)
        .limit(QUERY_LIMIT)
        .get();
    }
  };

  const [ownerRes, sellerRes, peerRes] = await Promise.all([
    runQuery({ ownerId: userId }),
    runQuery({ sellerId: userId }),
    runQuery({ peerUserId: userId }),
  ]);

  const mergedMap = {};
  [ownerRes, sellerRes, peerRes].forEach((res) => {
    ((res && res.data) || []).forEach((doc) => {
      const id = pickStr(doc && doc._id);
      if (!id) return;
      mergedMap[id] = doc;
    });
  });

  return Object.keys(mergedMap)
    .map((key) => mergedMap[key])
    .sort((a, b) => toTs(b && b.createTime) - toTs(a && a.createTime));
}

function buildPreview(doc = {}) {
  const type = pickStr(doc.type, 'text');
  if (type === 'image') return '[图片]';
  if (type === 'task_cancel_request') return '申请取消任务';
  if (type === 'task_release_request') return '申请释放任务';
  if (type === 'contact_request') return '申请查看手机号';
  return pickStr(doc.text, '[消息]');
}

function buildTaskSession(doc = {}, currentUserId = '', taskMap = {}) {
  const tid = pickStr(doc.tid);
  const peerUserId = pickStr(doc.peerUserId);
  if (!tid || !peerUserId) return null;

  const task = taskMap[tid] || {};
  const isOwner = pickStr(doc.ownerId) === pickStr(currentUserId);
  const ownerId = pickStr(doc.ownerId, task.ownerId);
  const fromUserId = pickStr(doc.fromUserId);
  const ownerName = pickStr(task.ownerNickname, task.ownerName, '发布者');
  const workerName = pickStr(
    fromUserId === peerUserId ? doc.fromNickname : '',
    task.workerNickname,
    task.workerName,
    '住户'
  );
  const preview = buildPreview(doc);
  const unread = !fromUserId || fromUserId === currentUserId
    ? 0
    : (isOwner ? (doc.readByOwner !== true ? 1 : 0) : (doc.readByPeer !== true ? 1 : 0));

  return {
    key: `task:${tid}:${peerUserId}`,
    kind: 'task',
    targetId: tid,
    peerUserId,
    peerName: isOwner ? workerName : ownerName,
    title: pickStr(task.title, task.desc, '任务聊天'),
    sceneText: '任务',
    lastText: preview,
    lastType: pickStr(doc.type, 'text'),
    lastTs: toTs(doc.createTime),
    unreadCount: unread,
    jumpUrl: isOwner
      ? `/pages/chat/room/index?tid=${encodeURIComponent(tid)}&peerUserId=${encodeURIComponent(peerUserId)}`
      : `/pages/chat/room/index?tid=${encodeURIComponent(tid)}`,
  };
}

function buildGoodsSession(doc = {}, currentUserId = '', goodsMap = {}) {
  const gid = pickStr(doc.gid, doc.goodsId);
  const sellerId = pickStr(doc.sellerId);
  const buyerId = pickStr(doc.peerUserId);
  if (!gid || !sellerId || !buyerId) return null;

  const goods = goodsMap[gid] || {};
  const isSeller = sellerId === pickStr(currentUserId);
  const fromUserId = pickStr(doc.fromUserId);
  const preview = buildPreview(doc);
  const unread = !fromUserId || fromUserId === currentUserId
    ? 0
    : (isSeller ? (doc.readBySeller !== true ? 1 : 0) : (doc.readByBuyer !== true ? 1 : 0));

  return {
    key: `goods:${gid}:${sellerId}:${buyerId}`,
    kind: 'goods',
    targetId: gid,
    peerUserId: isSeller ? buyerId : sellerId,
    peerName: isSeller
      ? pickStr(doc.peerNickname, fromUserId === buyerId ? doc.fromNickname : '', '买家')
      : pickStr(doc.sellerNickname, goods.ownerNickname, goods.ownerName, '卖家'),
    title: pickStr(doc.goodsTitle, goods.title, goods.desc, '商品咨询'),
    sceneText: '商品',
    lastText: preview,
    lastType: pickStr(doc.type, 'text'),
    lastTs: toTs(doc.createTime),
    unreadCount: unread,
    jumpUrl: isSeller
      ? `/pages/chat/goods-room/index?gid=${encodeURIComponent(gid)}&peerUserId=${encodeURIComponent(buyerId)}`
      : `/pages/chat/goods-room/index?gid=${encodeURIComponent(gid)}`,
  };
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID' };

  try {
    const user = await getUserByOpenid(OPENID);
    const currentUserId = getLogicalUserId(user);
    if (!currentUserId) {
      return { ok: false, code: 'USER_NOT_READY', msg: '用户信息未初始化' };
    }

    const messages = await fetchMessagesForUser(currentUserId);
    const taskIds = [];
    const goodsIds = [];
    messages.forEach((doc) => {
      if (pickStr(doc && doc.bizType) === 'goods') {
        goodsIds.push(pickStr(doc && doc.gid, doc && doc.goodsId));
      } else {
        taskIds.push(pickStr(doc && doc.tid));
      }
    });

    const [taskMap, goodsMap] = await Promise.all([
      fetchByIds(TASK_COLLECTION, taskIds),
      fetchByIds(GOODS_COLLECTION, goodsIds),
    ]);

    const sessionMap = {};
    messages.forEach((doc) => {
      const session = pickStr(doc && doc.bizType) === 'goods'
        ? buildGoodsSession(doc, currentUserId, goodsMap)
        : buildTaskSession(doc, currentUserId, taskMap);
      if (!session) return;

      const key = session.key;
      if (!sessionMap[key]) {
        sessionMap[key] = {
          ...session,
          unreadCount: session.unreadCount || 0,
        };
        return;
      }

      sessionMap[key].unreadCount += session.unreadCount || 0;
      if (session.lastTs >= (sessionMap[key].lastTs || 0)) {
        sessionMap[key] = {
          ...sessionMap[key],
          ...session,
          unreadCount: sessionMap[key].unreadCount,
        };
      } else if (!pickStr(sessionMap[key].peerName) && pickStr(session.peerName)) {
        sessionMap[key].peerName = session.peerName;
      }
    });

    const list = Object.keys(sessionMap)
      .map((key) => sessionMap[key])
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

    const summary = list.reduce((acc, item) => {
      const unread = Number(item.unreadCount) || 0;
      acc.totalUnread += unread;
      if (item.kind === 'goods') {
        acc.goodsUnread += unread;
        acc.goodsSessionCount += 1;
      } else {
        acc.taskUnread += unread;
        acc.taskSessionCount += 1;
      }
      return acc;
    }, {
      totalUnread: 0,
      taskUnread: 0,
      goodsUnread: 0,
      taskSessionCount: 0,
      goodsSessionCount: 0,
    });

    return {
      ok: true,
      list,
      summary: {
        ...summary,
        sessionCount: list.length,
      }
    };
  } catch (err) {
    console.error('getMessageCenter failed', err);
    return {
      ok: false,
      code: 'GET_MESSAGE_CENTER_ERROR',
      msg: pickStr(err && (err.errMsg || err.message), '消息中心加载失败'),
    };
  }
};
