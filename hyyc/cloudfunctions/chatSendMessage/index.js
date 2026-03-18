const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USER_COLLECTION = 'userInfo';
const TASK_COLLECTION = 'tasks';
const GOODS_COLLECTION = 'goods';
const MSG_COLLECTION = 'messages';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function buildDisplayName(user = {}, fallback = '用户') {
  return pickStr(user.nickname, user.nickName, user.name, fallback);
}

function buildAvatarSource(user = {}) {
  return pickStr(user.avatarFileID, user.avatarUrl);
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

async function getUserById(userId = '') {
  const targetUserId = pickStr(userId);
  if (!targetUserId) return null;
  try {
    const docRes = await db.collection(USER_COLLECTION).doc(targetUserId).get();
    const matched = (docRes && docRes.data) || null;
    if (matched) return matched;
  } catch (err) {
    // ignore
  }
  const res = await db.collection(USER_COLLECTION)
    .where({ id: targetUserId })
    .limit(1)
    .get();
  return ((res && res.data) || [])[0] || null;
}

async function sendTaskMessage({ sender = {}, event = {} }) {
  const taskId = pickStr(event.tid, event.taskId, event.id);
  const ownerId = pickStr(event.ownerId);
  const peerUserId = pickStr(event.peerUserId);
  const type = pickStr(event.type, 'text');
  const text = pickStr(event.text);
  const imageUrl = pickStr(event.imageUrl, event.imageFileID, event.fileID);

  if (!taskId || !ownerId || !peerUserId) {
    return { ok: false, code: 'MISSING_TASK_ROOM', msg: '缺少聊天房间信息' };
  }
  if (type === 'text' && !text) {
    return { ok: false, code: 'EMPTY_TEXT', msg: '消息内容不能为空' };
  }
  if (type === 'image' && !imageUrl) {
    return { ok: false, code: 'EMPTY_IMAGE', msg: '图片消息缺少 fileID' };
  }

  const taskRes = await db.collection(TASK_COLLECTION).doc(taskId).get();
  const task = taskRes && taskRes.data ? taskRes.data : null;
  if (!task) return { ok: false, code: 'TASK_NOT_FOUND', msg: '任务不存在' };

  const senderUserId = getLogicalUserId(sender);
  const normalizedOwnerId = pickStr(task.ownerId, ownerId);
  const normalizedPeerUserId = pickStr(task.workerId, peerUserId);
  if (!normalizedOwnerId || !normalizedPeerUserId) {
    return { ok: false, code: 'TASK_PARTICIPANT_MISSING', msg: '任务聊天参与方信息不完整' };
  }
  if (senderUserId !== normalizedOwnerId && senderUserId !== normalizedPeerUserId) {
    return { ok: false, code: 'NOT_TASK_PARTICIPANT', msg: '只有任务双方可以发送消息' };
  }

  const fromNickname = buildDisplayName(
    sender,
    senderUserId === normalizedOwnerId
      ? pickStr(task.ownerNickname, task.ownerName, '发布者')
      : pickStr(task.workerNickname, task.workerName, '接单人')
  );
  const now = new Date();
  const addRes = await db.collection(MSG_COLLECTION).add({
    data: {
      tid: taskId,
      ownerId: normalizedOwnerId,
      peerUserId: normalizedPeerUserId,
      fromUserId: senderUserId,
      fromNickname,
      type,
      text: type === 'text' ? text : '',
      imageUrl: type === 'image' ? imageUrl : '',
      createTime: now,
      readByOwner: senderUserId === normalizedOwnerId,
      readByPeer: senderUserId === normalizedPeerUserId,
    }
  });

  return { ok: true, messageId: pickStr(addRes && addRes._id) };
}

async function sendGoodsMessage({ sender = {}, event = {} }) {
  const goodsId = pickStr(event.gid, event.goodsId, event.id);
  const buyerUserId = pickStr(event.peerUserId);
  const type = pickStr(event.type, 'text');
  const text = pickStr(event.text);
  const imageUrl = pickStr(event.imageUrl, event.imageFileID, event.fileID);

  if (!goodsId || !buyerUserId) {
    return { ok: false, code: 'MISSING_GOODS_ROOM', msg: '缺少商品聊天房间信息' };
  }
  if (type === 'text' && !text) {
    return { ok: false, code: 'EMPTY_TEXT', msg: '消息内容不能为空' };
  }
  if (type === 'image' && !imageUrl) {
    return { ok: false, code: 'EMPTY_IMAGE', msg: '图片消息缺少 fileID' };
  }

  const goodsRes = await db.collection(GOODS_COLLECTION).doc(goodsId).get();
  const goods = goodsRes && goodsRes.data ? goodsRes.data : null;
  if (!goods) return { ok: false, code: 'GOODS_NOT_FOUND', msg: '商品不存在' };

  const sellerId = pickStr(goods.ownerId, event.sellerId);
  const sellerOpenid = pickStr(goods._openid, event.sellerOpenid);
  const senderUserId = getLogicalUserId(sender);
  if (!sellerId || !sellerOpenid) {
    return { ok: false, code: 'SELLER_NOT_READY', msg: '商品卖家信息不完整' };
  }
  if (senderUserId !== sellerId && senderUserId !== buyerUserId) {
    return { ok: false, code: 'NOT_GOODS_PARTICIPANT', msg: '只有商品咨询双方可以发送消息' };
  }

  const seller = senderUserId === sellerId ? sender : await getUserByOpenid(sellerOpenid);
  const buyer = senderUserId === buyerUserId ? sender : await getUserById(buyerUserId);
  if (!seller || !buyer) {
    return { ok: false, code: 'GOODS_PARTICIPANT_NOT_FOUND', msg: '商品聊天参与方信息不完整' };
  }

  const now = new Date();
  const fromNickname = buildDisplayName(sender, senderUserId === sellerId ? '卖家' : '买家');
  const addRes = await db.collection(MSG_COLLECTION).add({
    data: {
      bizType: 'goods',
      gid: goodsId,
      goodsTitle: pickStr(goods.title, goods.desc, '商品咨询'),
      goodsImage: pickStr(Array.isArray(goods.images) ? goods.images[0] : ''),
      sellerId,
      sellerOpenid,
      sellerNickname: buildDisplayName(seller, '卖家'),
      sellerAvatarFileID: buildAvatarSource(seller),
      peerUserId: buyerUserId,
      peerOpenid: pickStr(buyer._openid),
      peerNickname: buildDisplayName(buyer, '买家'),
      peerAvatarFileID: buildAvatarSource(buyer),
      fromUserId: senderUserId,
      fromOpenid: pickStr(sender._openid),
      fromNickname,
      fromAvatarFileID: buildAvatarSource(sender),
      type,
      text: type === 'text' ? text : '',
      imageUrl: type === 'image' ? imageUrl : '',
      createTime: now,
      readBySeller: senderUserId === sellerId,
      readByBuyer: senderUserId === buyerUserId,
    }
  });

  return { ok: true, messageId: pickStr(addRes && addRes._id) };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID' };

  try {
    const sender = await getUserByOpenid(OPENID);
    if (!sender || !getLogicalUserId(sender)) {
      return { ok: false, code: 'USER_NOT_READY', msg: '请先完成实名注册' };
    }

    const bizType = pickStr(event.bizType, 'task');
    if (bizType === 'goods') {
      return sendGoodsMessage({ sender, event });
    }
    return sendTaskMessage({ sender, event });
  } catch (err) {
    console.error('chatSendMessage failed', err);
    return {
      ok: false,
      code: 'CHAT_SEND_MESSAGE_ERROR',
      msg: pickStr(err && (err.errMsg || err.message), '发送消息失败'),
    };
  }
};
