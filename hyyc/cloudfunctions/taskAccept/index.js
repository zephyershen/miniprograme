// 云函数：taskAccept
// 作用：
// - 住户接单：把任务从 posted -> accepted，并写入 worker 信息
// - 同时做一个关键校验：接单人必须已完成“汇付开户成功”，否则后续无法打款

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const TASK_COLLECTION = 'tasks';
const USER_COLLECTION = 'userInfo';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function getHuifuUserIdFromUserDoc(user = {}) {
  const u = user && typeof user === 'object' ? user : {};
  const huifuObj = u.huifu && typeof u.huifu === 'object' ? u.huifu : null;
  return pickStr(
    u.huifuUserId,
    u.huifu_id,
    u.huifuId,
    huifuObj && (huifuObj.huifuId || huifuObj.huifu_id || huifuObj.user_huifu_id)
  );
}

function isHuifuOpenSuccess(user = {}) {
  const s = pickStr(user.huifu_open_status);
  if (!s) return true; // 兼容旧数据：没有字段时先放行（有 huifu_id 才会通过后续校验）
  return s === 'success';
}

async function getUserByOpenid(openid) {
  const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

function isTaskExpired(task) {
  const t = task || {};
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  const rawDeadline = t.deadline;
  const createdAt = t.createdAt;
  const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : (createdAt ? Date.parse(createdAt) : null);
  const effectiveDeadline = rawDeadline != null
    ? Number(rawDeadline)
    : (createdTs ? (createdTs + ONE_WEEK) : null);
  return effectiveDeadline != null && effectiveDeadline <= now;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID' };

  const taskId = pickStr(event.taskId || event.tid || event.id);
  if (!taskId) return { ok: false, code: 'MISSING_TASK_ID' };

  const worker = await getUserByOpenid(OPENID);
  if (!worker || worker.realname !== true) {
    return { ok: false, code: 'NOT_REALNAME', msg: '请先完成实名信息' };
  }

  const workerHuifuId = getHuifuUserIdFromUserDoc(worker);
  if (!workerHuifuId || !isHuifuOpenSuccess(worker)) {
    return {
      ok: false,
      code: 'WORKER_NOT_HUIFU_READY',
      msg: '你还没开通收款（汇付开户未成功），暂时不能接单',
      hint: '请先完成实名注册（会自动开户）；如开户失败，可在“我的-账户”里尝试补偿开户。'
    };
  }

  const now = new Date();

  try {
    return await db.runTransaction(async (tx) => {
      const docRes = await tx.collection(TASK_COLLECTION).doc(taskId).get();
      const task = docRes && docRes.data ? docRes.data : null;
      if (!task) return { ok: false, code: 'TASK_NOT_FOUND' };

      // 不能接自己的单
      if (pickStr(task._openid) && pickStr(task._openid) === OPENID) return { ok: false, code: 'CANNOT_ACCEPT_SELF' };

      const status = pickStr(task.status) || '';
      if (status !== 'posted' && status !== '') return { ok: false, code: 'INVALID_STATUS', status };

      if (isTaskExpired(task)) return { ok: false, code: 'TASK_EXPIRED', msg: '任务已过期，无法接单' };

      const existingWorkerOpenid = pickStr(task.workerOpenid || task.worker_openid);
      if (existingWorkerOpenid) {
        if (existingWorkerOpenid === OPENID) return { ok: true, status: 'accepted', already: true };
        return { ok: false, code: 'ALREADY_ACCEPTED' };
      }

      await tx.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'accepted',
          workerOpenid: OPENID,
          workerId: pickStr(worker._id || worker.id),
          workerName: pickStr(worker.name),
          workerNickname: pickStr(worker.nickname),
          workerHuifuId,
          acceptedAt: now,
          updatedAt: now,
        }
      });

      return { ok: true, status: 'accepted' };
    });
  } catch (e) {
    console.error('[taskAccept] tx error', e);
    return { ok: false, code: 'TX_ERROR', err: String(e && e.message ? e.message : e) };
  }
};

