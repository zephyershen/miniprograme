// 云函数：taskPaySuccess
// 作用：
// - 发布者支付完成后，把任务从 pay_pending -> posted
// - 最小闭环：不做支付验真（生产建议接入 notify / 订单查询）

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TASK_COLLECTION = 'tasks';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID' };

  const taskId = pickStr(event.taskId || event.tid || event.id);
  if (!taskId) return { ok: false, code: 'MISSING_TASK_ID' };

  const now = new Date();

  try {
    return await db.runTransaction(async (tx) => {
      const docRes = await tx.collection(TASK_COLLECTION).doc(taskId).get();
      const task = docRes && docRes.data ? docRes.data : null;
      if (!task) return { ok: false, code: 'TASK_NOT_FOUND' };

      const ownerOpenid = pickStr(task._openid);
      if (!ownerOpenid || ownerOpenid !== OPENID) return { ok: false, code: 'NOT_OWNER' };

      const status = pickStr(task.status) || '';
      if (status === 'posted') return { ok: true, status: 'posted', already: true };
      if (status && status !== 'pay_pending') return { ok: false, code: 'INVALID_STATUS', status };

      await tx.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'posted',
          paidAt: now,
          updatedAt: now,
          pay: {
            ...(task.pay || {}),
            status: 'paid',
            paidAt: now,
          }
        }
      });

      return { ok: true, status: 'posted' };
    });
  } catch (e) {
    console.error('[taskPaySuccess] tx error', e);
    return { ok: false, code: 'TX_ERROR', err: String(e && e.message ? e.message : e) };
  }
};

