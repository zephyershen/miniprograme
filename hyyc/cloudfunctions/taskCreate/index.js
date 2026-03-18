// 云函数：taskCreate
// 作用：
// - 创建一条“待付款(pay_pending)”的任务记录
// - 发布任务的用户先付款；付款成功后再由 taskPaySuccess 把状态改为 posted

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const TASK_COLLECTION = 'tasks';
const MIN_TASK_AMOUNT_YUAN = 0.5;

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isMoneyWithMaxTwoDecimals(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return false;
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-8;
}

async function getUserByOpenid(openid) {
  const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID' };

  const user = await getUserByOpenid(OPENID);
  if (!user || user.realname !== true) {
    return { ok: false, code: 'NOT_REALNAME', msg: '请先完成实名信息' };
  }

  const title = pickStr(event.title);
  const desc = pickStr(event.desc);
  const amount = safeNumber(event.amount);
  const deadline = event.deadline == null ? null : Number(event.deadline);
  const building = pickStr(event.building);
  const door = pickStr(event.door);
  const address = pickStr(event.address);
  const locationType = pickStr(event.locationType);
  const images = Array.isArray(event.images) ? event.images.filter(Boolean) : [];

  if (!title) return { ok: false, code: 'MISSING_TITLE', msg: '请填写标题' };
  if (!isMoneyWithMaxTwoDecimals(amount)) {
    return { ok: false, code: 'INVALID_AMOUNT', msg: '佣金最多支持两位小数' };
  }
  if (amount < MIN_TASK_AMOUNT_YUAN) {
    return { ok: false, code: 'INVALID_AMOUNT', msg: `佣金不能低于 ${MIN_TASK_AMOUNT_YUAN} 元` };
  }
  if (!building) return { ok: false, code: 'MISSING_BUILDING', msg: '请选择发布楼栋' };
  if (!door) return { ok: false, code: 'MISSING_DOOR', msg: '请选择门牌号' };

  const now = new Date();

  const addRes = await db.collection(TASK_COLLECTION).add({
    data: {
      // 为了兼容前端/其它云函数通过 _openid 判断“是否任务发布者”，这里手动写入
      _openid: OPENID,
      title,
      desc,
      amount,
      deadline: Number.isFinite(deadline) ? deadline : null,
      community: pickStr(user.community),
      building,
      door,
      address,
      locationType: locationType || '',
      images,

      ownerId: pickStr(user._id || user.id),
      ownerName: pickStr(user.name),
      ownerNickname: pickStr(user.nickname),
      ownerAvatarFileID: pickStr(user.avatarFileID, user.avatarUrl),

      status: 'pay_pending',
      createdAt: now,
      updatedAt: now,
    }
  });

  const taskId = pickStr(addRes && addRes._id);
  if (!taskId) return { ok: false, code: 'CREATE_FAILED', msg: '创建任务失败' };

  return { ok: true, taskId };
};
