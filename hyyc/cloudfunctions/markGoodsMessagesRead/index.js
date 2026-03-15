// 云函数：markGoodsMessagesRead
// 作用：在服务端把某个商品聊天房间的消息标记为买家/卖家已读。

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const MSG_COLLECTION = 'messages';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

exports.main = async (event = {}) => {
  const gid = pickStr(event.gid, event.goodsId, event.id);
  const sellerId = pickStr(event.sellerId);
  const peerUserId = pickStr(event.peerUserId, event.buyerUserId);
  const readerRole = pickStr(event.readerRole).toLowerCase();

  if (!gid || !sellerId || !peerUserId || !readerRole) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      msg: '缺少必要参数',
    };
  }

  const readField = readerRole === 'seller'
    ? 'readBySeller'
    : (readerRole === 'buyer' ? 'readByBuyer' : '');
  if (!readField) {
    return {
      ok: false,
      code: 'INVALID_ROLE',
      msg: 'readerRole 仅支持 seller / buyer',
    };
  }

  try {
    const res = await db.collection(MSG_COLLECTION)
      .where({
        bizType: 'goods',
        gid,
        sellerId,
        peerUserId,
      })
      .update({
        data: {
          [readField]: true,
        },
      });

    return {
      ok: true,
      updated: (res && res.stats && res.stats.updated) || 0,
    };
  } catch (err) {
    console.error('markGoodsMessagesRead 更新失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'UPDATE_ERROR',
      msg: err && err.errMsg ? err.errMsg : '更新失败',
    };
  }
};
