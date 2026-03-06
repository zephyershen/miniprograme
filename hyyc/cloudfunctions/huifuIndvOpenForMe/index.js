const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USER_COLLECTION = 'userInfo';
const BUILD_TAG = 'huifuIndvOpenForMe@2026-02-27.2';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function normalizeCertDateInput(v) {
  const s = pickStr(v);
  if (!s) return '';
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return '';
}

function getHuifuUserIdFromResp(resp) {
  const r = resp && typeof resp === 'object' ? resp : {};
  return pickStr(
    r.user_huifu_id,
    r.huifu_id,
    r.huifuId,
    r.userHuifuId,
    r.huifuUserId
  );
}

function getHuifuRespCodeDesc(resp) {
  const r = resp && typeof resp === 'object' ? resp : null;
  const code = pickStr(r && (r.resp_code || r.return_code || r.code || r.err_code));
  const desc = pickStr(r && (r.resp_desc || r.resp_msg || r.return_msg || r.message || r.err_msg));
  return { code, desc };
}

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openId || '';
  if (!openid) return { ok: false, code: 'NO_OPENID', msg: '获取用户身份失败', buildTag: BUILD_TAG };

  const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
  const user = ((res && res.data) || [])[0] || null;
  if (!user) return { ok: false, code: 'NO_USER', msg: '未找到用户信息', buildTag: BUILD_TAG };

  const name = pickStr(user.name);
  const idNumber = pickStr(user.idNumber);
  const phone = pickStr(user.phone);
  if (!name || !idNumber || !phone) {
    return { ok: false, code: 'MISSING_USER_FIELDS', msg: '用户信息不完整（缺少姓名/身份证号/手机号）', buildTag: BUILD_TAG };
  }

  const certValidityTypeRaw = pickStr(user.certValidityType);
  const certBeginDateRaw = pickStr(user.certBeginDate);
  const certEndDateRaw = pickStr(user.certEndDate);
  const certValidityType = certValidityTypeRaw === 'long' ? 'long' : 'fixed';
  const certBeginDate = normalizeCertDateInput(certBeginDateRaw);
  const certEndDate = normalizeCertDateInput(certEndDateRaw);
  const huifuCertValidityType = certValidityType === 'long' ? '1' : '0';

  // 如果已经成功开户过，就不重复调（避免浪费接口次数）
  const existedHuifuId = pickStr(user.huifu_id);
  if (existedHuifuId && pickStr(user.huifu_open_status) === 'success') {
    return { ok: true, updated: false, huifu_id: existedHuifuId, msg: '已开户', buildTag: BUILD_TAG };
  }

  let result = null;
  try {
    const callRes = await cloud.callFunction({
      name: 'huifuMiniappPay',
      data: {
        action: 'user_indv_open',
        name,
        certNo: idNumber,
        certType: '00',
        certValidityType: huifuCertValidityType,
        certBeginDate,
        certEndDate: certValidityType === 'long' ? '' : certEndDate,
        mobileNo: phone
      }
    });
    result = (callRes && callRes.result) || callRes || null;
  } catch (err) {
    const msg = pickStr(err && (err.errMsg || err.message) || '调用开户失败');
    await db.collection(USER_COLLECTION).doc(user._id).update({
      data: { huifu_open_status: 'failed', huifu_open_fail_reason: msg }
    });
    return { ok: false, code: 'CALL_FAIL', msg, buildTag: BUILD_TAG };
  }

  const respData = result && result.huifuResp;
  const huifuId = getHuifuUserIdFromResp(respData);
  const { code: respCode, desc: respDesc } = getHuifuRespCodeDesc(respData);
  const bizOk = respCode ? respCode === '00000000' : !!(result && result.ok && huifuId);

  const patch = bizOk && huifuId
    ? {
      huifu_id: huifuId,
      huifu_open_status: 'success',
      huifu_opened_at: new Date(),
      huifu_open_fail_reason: ''
    }
    : {
      huifu_open_status: 'failed',
      huifu_open_fail_reason: respCode ? `${respCode}${respDesc ? `:${respDesc}` : ''}` : pickStr((result && result.err) || '开户失败')
    };

  await db.collection(USER_COLLECTION).doc(user._id).update({ data: patch });
  return { ok: true, updated: true, patch, huifuOpen: { bizOk, huifuId, respCode }, raw: result, buildTag: BUILD_TAG };
};
