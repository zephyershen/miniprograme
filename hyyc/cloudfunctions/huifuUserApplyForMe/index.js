const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const BUILD_TAG = 'huifuUserApplyForMe@2026-03-13.3';

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function normalizeYmd(v) {
  const s = pickStr(v);
  if (!s) return '';
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return '';
}

function getRespCodeDesc(resp = {}) {
  return {
    code: pickStr(resp.resp_code, resp.return_code, resp.code, resp.respCode),
    desc: pickStr(resp.resp_desc, resp.return_msg, resp.message, resp.respDesc),
  };
}

function getHuifuUserIdFromResp(resp = {}) {
  return pickStr(
    resp.user_huifu_id,
    resp.huifu_id,
    resp.huifuId,
    resp.userHuifuId,
    resp.huifuUserId
  );
}

function safeJsonParse(v, label = 'JSON') {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  const s = pickStr(v);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`${label} 不是合法 JSON`);
  }
}

async function getUserByOpenid(openid) {
  const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

async function callHuifuAction(action, payload) {
  const res = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: { action, ...(payload || {}) }
  });
  const result = (res && res.result) || {};
  if (!result || result.ok !== true) {
    const err = result && result.err;
    const msg = typeof err === 'string'
      ? err
      : pickStr(err && err.msg, err && err.code, result && result.msg, '调用汇付失败');
    throw new Error(msg);
  }
  return result;
}

function getUserBusiStatusByResp(result = {}) {
  const resp = result.huifuResp || {};
  const { code } = getRespCodeDesc(resp);
  if (code === '00000000' || (!code && result.ok === true)) return 'success';
  if (code === '90000000') return 'pending';
  return 'failed';
}

function summarizeHuifuError(err, fallback) {
  return pickStr(err && (err.message || err.errMsg), fallback);
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID', buildTag: BUILD_TAG };

  const user = await getUserByOpenid(OPENID);
  if (!user) return { ok: false, code: 'USER_NOT_FOUND', msg: '未找到用户信息', buildTag: BUILD_TAG };

  if (user.realname !== true) {
    return { ok: false, code: 'NOT_REALNAME', msg: '请先完成实名', buildTag: BUILD_TAG };
  }

  const name = pickStr(user.name);
  const idNumber = pickStr(user.idNumber);
  const phone = pickStr(user.phone);
  const certValidityType = pickStr(user.certValidityType) === 'long' ? '1' : '0';
  const certBeginDate = normalizeYmd(user.certBeginDate);
  const certEndDate = normalizeYmd(user.certEndDate);

  if (!name || !idNumber || !phone || !certBeginDate || (certValidityType !== '1' && !certEndDate)) {
    return { ok: false, code: 'MISSING_USER_FIELDS', msg: '实名资料不完整，请先补全姓名/证件/手机号/证件有效期', buildTag: BUILD_TAG };
  }

  const patch = {};
  let huifuId = pickStr(user.huifu_id);
  let huifuOpenResult = null;
  let userBusiResult = null;

  try {
    if (!(huifuId && pickStr(user.huifu_open_status) === 'success')) {
      huifuOpenResult = await callHuifuAction('user_indv_open', {
        name,
        certNo: idNumber,
        certType: '00',
        certValidityType,
        certBeginDate,
        certEndDate: certValidityType === '1' ? '' : certEndDate,
        mobileNo: phone
      });

      const huifuResp = huifuOpenResult.huifuResp || {};
      const nextHuifuId = getHuifuUserIdFromResp(huifuResp);
      const { code, desc } = getRespCodeDesc(huifuResp);
      const bizOk = code ? code === '00000000' : Boolean(nextHuifuId);

      if (!bizOk || !nextHuifuId) {
        const reason = code
          ? `${code}${desc ? `:${desc}` : ''}`
          : '个人开户失败';
        patch.huifu_open_status = 'failed';
        patch.huifu_open_fail_reason = reason;
        await db.collection(USER_COLLECTION).doc(user._id).update({ data: patch });
        return { ok: false, code: 'USER_OPEN_FAILED', msg: reason, buildTag: BUILD_TAG };
      }

      huifuId = nextHuifuId;
      patch.huifu_id = huifuId;
      patch.huifu_open_status = 'success';
      patch.huifu_opened_at = new Date();
      patch.huifu_open_fail_reason = '';
    }

    userBusiResult = await callHuifuAction('user_busi_open', {
      userHuifuId: huifuId,
      upperHuifuId: pickStr(process.env.HUIFU_UPPER_HUIFU_ID),
    });

    const busiResp = userBusiResult.huifuResp || {};
    const busiCodeDesc = getRespCodeDesc(busiResp);
    const userBusiStatus = getUserBusiStatusByResp(userBusiResult);
    const userBusiLastError = userBusiStatus === 'failed'
      ? pickStr(busiCodeDesc.code ? `${busiCodeDesc.code}${busiCodeDesc.desc ? `:${busiCodeDesc.desc}` : ''}` : '', '用户业务入驻失败')
      : '';

    patch.user_busi_status = userBusiStatus;
    patch.user_busi_fail_reason = userBusiLastError;
    patch.user_busi_req_seq_id = pickStr(userBusiResult.reqSeqId);
    patch.user_busi_req_date = pickStr(userBusiResult.reqDate);
    patch.user_busi_updated_at = new Date();
    patch.userBusiApply = {
      status: userBusiStatus,
      reqSeqId: pickStr(userBusiResult.reqSeqId),
      reqDate: pickStr(userBusiResult.reqDate),
      respCode: busiCodeDesc.code,
      respDesc: busiCodeDesc.desc,
      updatedAt: new Date(),
      lastError: userBusiLastError,
      huifuResp: busiResp,
    };

    await db.collection(USER_COLLECTION).doc(user._id).update({ data: patch });

    return {
      ok: true,
      code: userBusiStatus === 'success' ? 'READY' : 'SUBMITTED',
      status: userBusiStatus,
      huifuId,
      huifuOpen: huifuOpenResult ? {
        reqSeqId: pickStr(huifuOpenResult.reqSeqId),
        reqDate: pickStr(huifuOpenResult.reqDate),
      } : null,
      userBusi: {
        status: userBusiStatus,
        reqSeqId: pickStr(userBusiResult.reqSeqId),
        reqDate: pickStr(userBusiResult.reqDate),
        respCode: busiCodeDesc.code,
        respDesc: busiCodeDesc.desc,
      },
      buildTag: BUILD_TAG,
    };
  } catch (err) {
    const msg = summarizeHuifuError(err, '汇付开通失败');
    console.error('[huifuUserApplyForMe] failed', err);
    try {
      const failPatch = {
        ...patch,
        user_busi_status: pickStr(patch.user_busi_status) || 'failed',
        user_busi_fail_reason: msg,
        user_busi_updated_at: new Date(),
        userBusiApply: {
          ...(user.userBusiApply || {}),
          ...(patch.userBusiApply || {}),
          status: pickStr(patch.user_busi_status) || 'failed',
          updatedAt: new Date(),
          lastError: msg,
        }
      };
      await db.collection(USER_COLLECTION).doc(user._id).update({ data: failPatch });
    } catch (saveErr) {
      console.error('[huifuUserApplyForMe] save fail reason error', saveErr);
    }
    return { ok: false, code: 'SUBMIT_FAILED', msg, buildTag: BUILD_TAG };
  }
};
