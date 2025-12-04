// 云函数：markMessagesReadByPeer
// 作用：在服务端把某个任务下、某个住户会话的所有消息标记为
//      “住户本人已读”（readByPeer = true），避免小程序端权限限制。

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const MSG_COLLECTION = 'messages';

exports.main = async (event, context) => {
  const { tid, ownerId, peerUserId } = event || {};

  if (!tid || !ownerId || !peerUserId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      msg: '缺少必要参数',
    };
  }

  try {
    const res = await db
      .collection(MSG_COLLECTION)
      .where({
        tid,
        ownerId,
        peerUserId,
      })
      .update({
        data: {
          readByPeer: true,
        },
      });

    const updated = (res && res.stats && res.stats.updated) || 0;
    return {
      ok: true,
      updated,
    };
  } catch (err) {
    console.error('markMessagesReadByPeer 更新失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'UPDATE_ERROR',
      msg: err && err.errMsg ? err.errMsg : '更新失败',
    };
  }
};

