// 云函数：deleteTaskWithMessages
// 功能：删除指定任务以及该任务下所有聊天记录（文字 + 图片消息）。
// 说明：
// - 为了绕过小程序端数据库权限（例如“仅创建者可写”），删除操作统一放在云函数里执行。
// - 调用方必须是任务发布者本人，否则返回错误。

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const TASK_COLLECTION = 'tasks';
const MSG_COLLECTION = 'messages';
const USER_COLLECTION = 'userInfo';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

exports.main = async (event, context) => {
  const { tid } = event || {};

  if (!tid) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      msg: '缺少任务 ID',
    };
  }

  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID || wxContext.openId || '';

    if (!openid) {
      return {
        ok: false,
        code: 'NO_OPENID',
        msg: '获取用户身份失败',
      };
    }

    // 1）根据 openid 找到当前用户在 userInfo 集合里的实名记录
    const userRes = await db
      .collection(USER_COLLECTION)
      .where({ _openid: openid })
      .limit(2)
      .get();

    const list = (userRes && userRes.data) || [];

    if (list.length > 1) {
      return {
        ok: false,
        code: 'MULTI_USER',
        msg: '当前微信账号存在多条实名记录，请联系管理员处理',
      };
    }

    const me = list[0] || null;

    if (!me || !me._id) {
      return {
        ok: false,
        code: 'USER_NOT_FOUND',
        msg: '当前用户未完成实名，无法删除任务',
      };
    }

    const myUserId = me._id;

    // 2）加载任务，校验当前用户是否是该任务的发布者
    const taskRes = await db.collection(TASK_COLLECTION).doc(tid).get();
    const task = (taskRes && taskRes.data) || null;

    if (!task || !task._id) {
      return {
        ok: false,
        code: 'TASK_NOT_FOUND',
        msg: '任务不存在或已被删除',
      };
    }

    if (!task.ownerId || task.ownerId !== myUserId) {
      return {
        ok: false,
        code: 'NOT_OWNER',
        msg: '只有任务发布者可以删除任务及相关聊天记录',
      };
    }

    const status = pickStr(task.status);
    const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
    const payStatus = pickStr(pay.status);
    const canDeleteRefundedCancelled = status === 'cancelled' && payStatus === 'refunded';
    const canDeleteCompleted = status === 'completed';
    const hasPaymentTrace = !!(
      task.paidAt
      || pickStr(pay.reqDate)
      || pickStr(pay.reqSeqId)
      || pickStr(pay.orgHfSeqId)
      || payStatus
    );
    if (!canDeleteRefundedCancelled && !canDeleteCompleted && (status !== 'pay_pending' || hasPaymentTrace)) {
      return {
        ok: false,
        code: 'PAID_TASK_DELETE_FORBIDDEN',
        msg: '该任务已发起或完成支付，当前删除不会自动退款，已禁止删除。请先走退款/取消流程。',
      };
    }

    // 3）分批删除该任务下的所有聊天记录（按 tid 过滤）
    const msgColl = db.collection(MSG_COLLECTION);
    const BATCH_LIMIT = 100; // 每批次最多处理 100 条，防止超出单次操作上限
    let deletedMessages = 0;

    // 使用循环 + 分批查询 + doc().remove() 的方式，确保权限和数量都可控
    // 注意：不要在 where().remove() 里一次性删太多，分批更安全。
    while (true) {
      const queryRes = await msgColl
        .where({ tid })
        .limit(BATCH_LIMIT)
        .get();

      const list = (queryRes && queryRes.data) || [];
      if (!list.length) {
        break;
      }

      // 并行删除本批次消息
      const removeTasks = list.map((doc) =>
        msgColl.doc(doc._id).remove()
      );
      await Promise.all(removeTasks);

      deletedMessages += list.length;

      if (list.length < BATCH_LIMIT) {
        // 本批次不足 BATCH_LIMIT，说明已经删完
        break;
      }
      // 如果正好等于 BATCH_LIMIT，再继续下一轮循环
    }

    // 4）删除任务本身
    await db.collection(TASK_COLLECTION).doc(tid).remove();

    return {
      ok: true,
      code: 'OK',
      msg: '任务及相关聊天记录已删除',
      deletedMessages,
      deletedTaskId: tid,
    };
  } catch (err) {
    console.error('deleteTaskWithMessages 执行失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'DELETE_ERROR',
      msg: err && err.errMsg ? err.errMsg : '删除任务失败，请稍后重试',
    };
  }
};
