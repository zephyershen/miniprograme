// 云函数：taskSubmit
// 作用：
// - 接单人提交“完成说明 + 照片凭证”
// - 把任务从 accepted -> submitted（等待发布者确认完成并打款）

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

  const note = pickStr(event.note);
  const images = Array.isArray(event.images) ? event.images.filter(Boolean) : [];
  if (!note && !images.length) {
    return { ok: false, code: 'MISSING_PROOF', msg: '请填写完成说明或上传至少 1 张凭证' };
  }
  const now = new Date();

  try {
    return await db.runTransaction(async (tx) => {
      const docRes = await tx.collection(TASK_COLLECTION).doc(taskId).get();
      const task = docRes && docRes.data ? docRes.data : null;
      if (!task) return { ok: false, code: 'TASK_NOT_FOUND' };

      const workerOpenid = pickStr(task.workerOpenid || task.worker_openid);
      if (!workerOpenid || workerOpenid !== OPENID) return { ok: false, code: 'NOT_WORKER' };

      const status = pickStr(task.status) || '';
      if (status === 'completed') return { ok: false, code: 'ALREADY_COMPLETED' };
      if (status !== 'accepted' && status !== 'submitted') return { ok: false, code: 'INVALID_STATUS', status };

      await tx.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'submitted',
          submit: {
            note,
            images,
            submittedAt: now,
          },
          updatedAt: now,
        }
      });

      return { ok: true, status: 'submitted' };
    });
  } catch (e) {
    console.error('[taskSubmit] tx error', e);
    return { ok: false, code: 'TX_ERROR', err: String(e && e.message ? e.message : e) };
  }
};
