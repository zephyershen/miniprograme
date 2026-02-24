// 云函数：adminLogin
// 作用：
// - 校验超级管理员账号密码
// - 返回指定 _openid 的 userInfo 记录（用于后台/排查时快速进入）
//
// 说明：云函数具备管理员权限，可绕过数据库权限规则；务必做权限校验。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USER_COLLECTION = 'userInfo';

const ADMIN_USERNAME = 'adminhyyc';
const ADMIN_PASSWORD = 'hyyc2026';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

exports.main = async (event, context) => {
  const username = pickStr(event && event.username);
  const password = pickStr(event && event.password);
  const targetOpenid = pickStr(event && event.targetOpenid);

  // 校验：管理员账号密码
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return { ok: false, code: 'AUTH_FAIL', msg: 'auth fail' };
  }
  if (!targetOpenid) {
    return { ok: false, code: 'MISSING_TARGET', msg: 'missing targetOpenid' };
  }

  const query = await db.collection(USER_COLLECTION)
    .where({ _openid: targetOpenid })
    .limit(2)
    .get();

  const list = (query && query.data) || [];
  if (list.length > 1) {
    return { ok: false, code: 'MULTI_USER', msg: 'multiple records' };
  }
  if (!list.length) {
    return { ok: false, code: 'NO_USER', msg: 'user not found' };
  }

  return { ok: true, user: list[0] };
};
