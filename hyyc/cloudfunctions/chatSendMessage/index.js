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

function formatDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function cutText(text = '', max = 20) {
  const normalized = pickStr(text).replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function buildPreview(type = 'text', text = '') {
  return type === 'image' ? '[图片]' : pickStr(text);
}

function getSubscribeConfig() {
  return {
    templateId: pickStr(process.env.SUBSCRIBE_CHAT_TEMPLATE_ID),
    thingKey: pickStr(process.env.SUBSCRIBE_CHAT_THING_KEY, 'thing1'),
    nameKey: pickStr(process.env.SUBSCRIBE_CHAT_NAME_KEY, 'name2'),
    timeKey: pickStr(process.env.SUBSCRIBE_CHAT_TIME_KEY, 'time3'),
    miniprogramState: pickStr(process.env.MINIPROGRAM_STATE, 'formal'),
  };
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
  const res = await db.collection(USER_COLLECTION)
    .where({ id: targetUserId })
    .limit(1)
    .get();
  const matched = ((res && res.data) || [])[0] || null;
  if (matched) return matched;

  try {
    const docRes = await db.collection(USER_COLLECTION).doc(targetUserId).get();
    return (docRes && docRes.data) || null;
  } catch (err) {
    return null;
  }
}

async function sendSubscribeMessage({ touser = '', senderName = '', preview = '', page = '' }) {
  const targetOpenid = pickStr(touser);
  const cfg = getSubscribeConfig();
  if (!targetOpenid || !cfg.templateId) return { ok: false, skipped: true };

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: targetOpenid,
      templateId: cfg.templateId,
      page: pickStr(page),
      lang: 'zh_CN',
      miniprogramState: cfg.miniprogramState,
      data: {
        [cfg.thingKey]: { value: cutText(preview, 20) || '你收到一条新消息' },
        [cfg.nameKey]: { value: cutText(senderName, 10) || '邻里用户' },
        [cfg.timeKey]: { value: formatDateTime(new Date()) },
      },
    });
    return { ok: true };
  } catch (err) {
    console.warn('chatSendMessage subscribe send failed', err);
    return {
      ok: false,
      code: pickStr(err && err.errCode, err && err.code, 'SUBSCRIBE_SEND_FAILED'),
      msg: pickStr(err && (err.errMsg || err.message), '订阅消息发送失败'),
    };
  }
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

  const receiverUserId = senderUserId === normalizedOwnerId ? normalizedPeerUserId : normalizedOwnerId;
  const receiver = await getUserById(receiverUserId);
  await sendSubscribeMessage({
    touser: pickStr(receiver && receiver._openid),
    senderName: fromNickname,
    preview: buildPreview(type, text),
    page: senderUserId === normalizedOwnerId
      ? `/pages/chat/room/index?tid=${encodeURIComponent(taskId)}`
      : `/pages/chat/room/index?tid=${encodeURIComponent(taskId)}&peerUserId=${encodeURIComponent(senderUserId)}`,
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

  const receiverOpenid = senderUserId === sellerId ? pickStr(buyer._openid) : sellerOpenid;
  await sendSubscribeMessage({
    touser: receiverOpenid,
    senderName: fromNickname,
    preview: buildPreview(type, text),
    page: senderUserId === sellerId
      ? `/pages/chat/goods-room/index?gid=${encodeURIComponent(goodsId)}`
      : `/pages/chat/goods-room/index?gid=${encodeURIComponent(goodsId)}&peerUserId=${encodeURIComponent(buyerUserId)}`,
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
