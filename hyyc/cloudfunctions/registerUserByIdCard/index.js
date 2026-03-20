// 云函数：registerUserByIdCard
// 作用：
// - 前端上传身份证正反面照片到云存储，传 fileID 过来；
// - 云函数把身份证正面 fileID 转成临时链接（ImageUrl），调用腾讯 FaceID 的 IdCardOCRVerification 做识别+核验；
// - 核验通过才注册；注册成功后保留身份证正反面 fileID，供后续汇付开户注册复用；失败时删除云存储里的身份证照片。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const USER_COMMUNITY_COLLECTION = 'user_community';
const LEGAL_COLLECTION = 'legal_docs';
const VERIFY_LOG_COLLECTION = 'realname_verify_logs';
const WALLET_COLLECTION = 'wallets';
const BUILD_TAG = 'registerUserByIdCard@2026-03-20.4';

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

function getUserBusiStatusByResp(result = {}) {
  const resp = result && result.huifuResp ? result.huifuResp : {};
  const { code } = getHuifuRespCodeDesc(resp);
  if (code === '00000000' || (!code && result && result.ok === true)) return 'success';
  if (code === '90000000') return 'pending';
  return 'failed';
}

function summarizeHuifuFailReason({ err, result, respData }) {
  if (typeof err === 'string' && err.trim()) return err.trim();
  const errObj = err && typeof err === 'object' ? err : null;
  const fromErr = pickStr(errObj && (errObj.msg || errObj.code));
  if (fromErr) return fromErr;
  const fromResult = pickStr(result && (result.msg || result.code));
  if (fromResult) return fromResult;
  const { code, desc } = getHuifuRespCodeDesc(respData);
  if (code || desc) return code ? `${code}${desc ? `:${desc}` : ''}` : desc;
  try {
    const resp = respData && typeof respData === 'object' ? respData : null;
    const s = resp ? JSON.stringify(resp) : '';
    if (s && s !== '{}') return s.slice(0, 180);
  } catch (e) {
    // ignore
  }
  return '开户失败';
}

function safeJsonStringifyBrief(v, maxLen = 240) {
  try {
    const s = JSON.stringify(v);
    if (!s) return '';
    return s.length <= maxLen ? s : `${s.slice(0, maxLen)}...`;
  } catch (e) {
    return '';
  }
}

function getAllowedCommunities() {
  // 云端鉴权：避免只靠前端限制导致被绕过
  // - 支持云函数环境变量 ALLOWED_COMMUNITIES=花语云萃,其它小区...
  // - 未配置时默认只允许“花语云萃”（与你当前业务一致）
  const raw = pickStr(process.env.ALLOWED_COMMUNITIES);
  const list = raw
    ? raw.split(',').map((s) => pickStr(s)).filter(Boolean)
    : [];
  return list.length ? list : ['花语云萃'];
}

function last4(s) {
  const v = pickStr(s);
  if (!v) return '';
  return v.slice(-4);
}

async function ensureCollectionExists(name) {
  // 有的环境需要先在控制台创建集合，否则 add 会报 “collection not exists”。
  // 这里尽量自动创建；失败也不影响主流程（会在 add 时再报错）。
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (e) {
    // ignore
  }
}

async function safeAddVerifyLog({ openid, status, failCode, requestId, idNumber }) {
  try {
    await ensureCollectionExists(VERIFY_LOG_COLLECTION);
    await db.collection(VERIFY_LOG_COLLECTION).add({
      data: {
        _openid: pickStr(openid),
        status: status === 'pass' ? 'pass' : 'fail',
        failCode: pickStr(failCode),
        requestId: pickStr(requestId),
        createdAt: new Date(),
        idNumberLast4: last4(idNumber)
      }
    });
  } catch (err) {
    console.error('写入 realname_verify_logs 失败', err);
  }
}

async function safeDeleteFile(fileID) {
  const fid = pickStr(fileID);
  if (!fid) return;
  try {
    await cloud.deleteFile({ fileList: [fid] });
  } catch (err) {
    console.error('删除身份证照片失败', err);
  }
}

async function getTempUrl(fileID, maxAgeSeconds = 300) {
  const fid = pickStr(fileID);
  if (!fid) return '';
  const res = await cloud.getTempFileURL({
    fileList: [{ fileID: fid, maxAge: maxAgeSeconds }]
  });
  const list = (res && res.fileList) || [];
  const first = list[0] || {};
  return pickStr(first.tempFileURL);
}

function mustEnv(name) {
  const v = pickStr(process.env[name]);
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

function buildTencentFaceIdClient() {
  // 依赖：tencentcloud-sdk-nodejs（部署云函数时选择“云端安装依赖”）
  const tencentcloud = require('tencentcloud-sdk-nodejs');
  const FaceidClient = tencentcloud.faceid.v20180301.Client;

  return new FaceidClient({
    credential: {
      secretId: mustEnv('TENCENT_SECRET_ID'),
      secretKey: mustEnv('TENCENT_SECRET_KEY')
    },
    region: pickStr(process.env.TENCENT_REGION) || 'ap-beijing',
    profile: {
      httpProfile: {
        endpoint: 'faceid.tencentcloudapi.com'
      }
    }
  });
}

function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:-v(\d+))?/);
    if (m) {
      const t = Date.parse(m[1]);
      if (!Number.isNaN(t)) return t + (m[2] ? Number(m[2]) : 0);
    }
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    return 0;
  }
  if (v && typeof v.getTime === 'function') return v.getTime();
  return 0;
}

function docTs(doc) {
  const d = doc || {};
  return Math.max(
    toTs(d.updatedAt),
    toTs(d.effectiveAt),
    toTs(d.createdAt),
    toTs(d.effectiveDate),
    toTs(d.version)
  );
}

function pickLatest(list) {
  let best = null;
  let bestTs = -1;
  const arr = list || [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item) continue;
    const ts = docTs(item);
    if (ts > bestTs) {
      best = item;
      bestTs = ts;
    }
  }
  return best || arr[0] || null;
}

async function getActiveLegalDoc(transaction, type) {
  const activeRes = await transaction.collection(LEGAL_COLLECTION).where({ type, status: 'active' }).limit(20).get();
  const activeList = (activeRes && activeRes.data) || [];
  if (activeList.length) return pickLatest(activeList);

  const res = await transaction.collection(LEGAL_COLLECTION).where({ type }).limit(20).get();
  const list = (res && res.data) || [];
  return pickLatest(list);
}

function buildPrimaryWalletDoc(openid = '', now = new Date()) {
  return {
    _openid: pickStr(openid),
    balance: 0,
    incomeTotal: 0,
    expenseTotal: 0,
    createdAt: now,
    updatedAt: now,
    walletRole: 'primary',
    isPrimary: true,
    shadowedWalletIds: [],
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openId || '';

  const agree = !!(event && event.agree);
  const idCardFrontFileID = pickStr(event && event.idCardFrontFileID);
  const idCardBackFileID = pickStr(event && event.idCardBackFileID);
  const avatarFileID = pickStr(event && event.avatarFileID);
  const form = (event && event.form) || {};
  let keepIdCardFiles = false;

  const phone = pickStr(form.phone);
  const community = pickStr(form.community);
  const building = pickStr(form.building);
  const door = pickStr(form.door);
  const certValidityTypeRaw = pickStr(form.certValidityType);
  const certBeginDateRaw = pickStr(form.certBeginDate);
  const certEndDateRaw = pickStr(form.certEndDate);

  try {
    if (!agree) {
      return { ok: false, code: 'AGREEMENT_REQUIRED', msg: '请先阅读并同意用户协议和隐私政策' };
    }

    if (!openid) {
      return { ok: false, code: 'NO_OPENID', msg: '获取用户身份失败' };
    }

    if (!idCardFrontFileID || !idCardBackFileID || !phone || !community || !building || !door) {
      return { ok: false, code: 'INVALID_PARAM', msg: '缺少必要参数' };
    }
    if (!certBeginDateRaw || (certValidityTypeRaw !== 'long' && !certEndDateRaw)) {
      return { ok: false, code: 'CERT_VALIDITY_REQUIRED', msg: '请先选择身份证有效期' };
    }
    if (certValidityTypeRaw !== 'long' && certEndDateRaw < certBeginDateRaw) {
      return { ok: false, code: 'CERT_VALIDITY_INVALID', msg: '身份证有效期结束日期不能早于开始日期' };
    }

    // 特定人群鉴权：仅允许合作小区注册（服务端强校验）
    const allowed = getAllowedCommunities();
    if (allowed.indexOf(community) < 0) {
      return {
        ok: false,
        code: 'COMMUNITY_NOT_ALLOWED',
        msg: '账号仅限合作小区业主/住户使用，请联系物业或管理员开通'
      };
    }

    // 先做“重复注册”拦截（省钱也省时间）：同一个微信（openid）只允许一条实名记录
    const openidRes = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
    const openidList = (openidRes && openidRes.data) || [];
    if (openidList.length > 0) {
      return { ok: false, code: 'OPENID_EXISTS', msg: '该用户已存在，请直接登录' };
    }

    // 1) fileID -> 临时链接（给腾讯接口下载用，有效期 5 分钟）
    let imageUrl = '';
    try {
      imageUrl = await getTempUrl(idCardFrontFileID, 60 * 5);
    } catch (err) {
      console.error('getTempFileURL 失败', err);
    }
    if (!imageUrl) {
      await safeAddVerifyLog({
        openid,
        status: 'fail',
        failCode: 'TEMP_URL_FAIL',
        requestId: '',
        idNumber: ''
      });
      return { ok: false, code: 'TEMP_URL_FAIL', msg: '身份校验失败，请重新上传身份证照片' };
    }

    // 2) 调腾讯 FaceID：IdCardOCRVerification（只传 ImageUrl）
    let apiRes = null;
    try {
      const client = buildTencentFaceIdClient();
      apiRes = await client.IdCardOCRVerification({ ImageUrl: imageUrl });
    } catch (err) {
      console.error('IdCardOCRVerification 调用失败', err);
      await safeAddVerifyLog({
        openid,
        status: 'fail',
        failCode: 'API_FAIL',
        requestId: pickStr(err && err.requestId),
        idNumber: ''
      });
      return { ok: false, code: 'API_FAIL', msg: '身份校验失败，请重新上传身份证照片' };
    }

    const requestId = pickStr(apiRes && apiRes.RequestId);
    const resultNum = Number(apiRes && apiRes.Result);
    const name = pickStr(apiRes && apiRes.Name);
    const idNumber = pickStr((apiRes && (apiRes.IdCard || apiRes.IdNumber)) || '');
    const ocrLegalAddr = pickStr(apiRes && apiRes.Address, apiRes && apiRes.address, form.legalAddr);

    if (resultNum !== 0 || !name || !idNumber) {
      await safeAddVerifyLog({
        openid,
        status: 'fail',
        failCode: 'VERIFY_FAIL',
        requestId,
        idNumber
      });
      return { ok: false, code: 'VERIFY_FAIL', msg: '身份校验失败，请重新上传身份证照片' };
    }

    // 记录一条“通过”的核验流水（不存照片）
    await safeAddVerifyLog({
      openid,
      status: 'pass',
      failCode: '',
      requestId,
      idNumber
    });

    // 3) 身份证唯一：同一个身份证只允许注册一次
    const idRes = await db.collection(USER_COLLECTION).where({ idNumber }).limit(1).get();
    const idList = (idRes && idRes.data) || [];
    if (idList.length > 0) {
      return { ok: false, code: 'ID_EXISTS', msg: '该用户已存在，请直接登录' };
    }

    // 4) 写入注册信息（事务：避免并发重复写入）
    await ensureCollectionExists(WALLET_COLLECTION);
    const txRes = await db.runTransaction(async (transaction) => {
      const coll = transaction.collection(USER_COLLECTION);

      // 再兜底一次：同一个微信只允许一条记录
      const txOpenidRes = await coll.where({ _openid: openid }).limit(1).get();
      const txOpenidList = (txOpenidRes && txOpenidRes.data) || [];
      if (txOpenidList.length > 0) {
        return { ok: false, code: 'OPENID_EXISTS', msg: '该用户已存在，请直接登录' };
      }

      // 再兜底一次：同一个身份证只允许一条记录
      const txIdRes = await coll.where({ idNumber }).limit(1).get();
      const txIdList = (txIdRes && txIdRes.data) || [];
      if (txIdList.length > 0) {
        return { ok: false, code: 'ID_EXISTS', msg: '该用户已存在，请直接登录' };
      }

      const now = new Date();

      // 读取当前生效的协议版本（只保存元信息，不把全文写进 userInfo）
      const userAgreement = await getActiveLegalDoc(transaction, 'user_agreement');
      const privacyPolicy = await getActiveLegalDoc(transaction, 'privacy_policy');
      if (!userAgreement || !privacyPolicy) {
        return { ok: false, code: 'LEGAL_DOC_MISSING', msg: '协议未配置，请联系管理员' };
      }

      const legalAcceptance = {
        acceptedAt: now,
        userAgreement: {
          docId: userAgreement._id || '',
          title: userAgreement.title || '',
          version: userAgreement.version || '',
          hash: userAgreement.hash || ''
        },
        privacyPolicy: {
          docId: privacyPolicy._id || '',
          title: privacyPolicy.title || '',
          version: privacyPolicy.version || '',
          hash: privacyPolicy.hash || ''
        }
      };

      const dataToAdd = {
        ...form,
        // 统一去掉前后空格，避免 “community 不一致” 导致权限判断失败
        community,
        name,
        idNumber,
        legalAddr: ocrLegalAddr,
        idCardFrontFileID,
        idCardBackFileID,
        // 用户头像（云存储 fileID）
        avatarFileID,
        // 为了兼容登录流程中通过 _openid 查询 userInfo，这里手动写入 _openid
        _openid: openid,
        realname: true,
        verified: true,
        // 注册后自动开户：先标记为 pending，后续再更新成功/失败
        huifu_open_status: 'pending',
        legalAcceptance,
        createdAt: now
      };

      const addRes = await coll.add({ data: dataToAdd });
      const newId = (addRes && addRes._id) || '';

      // 同步写入 user_community：用 openid 作为 docId（有则更新，无则创建）
      const ucColl = transaction.collection(USER_COMMUNITY_COLLECTION);
      const ucRes = await ucColl.where({ _id: openid }).limit(1).get();
      const ucList = (ucRes && ucRes.data) || [];
      const ucExists = ucList.length > 0;
      if (ucExists) {
        await ucColl.doc(openid).update({
          data: { community, updatedAt: now }
        });
      } else {
        await ucColl.add({
          data: { _id: openid, community, updatedAt: now, createdAt: now }
        });
      }

      const walletColl = transaction.collection(WALLET_COLLECTION);
      const walletRes = await walletColl.where({ _openid: openid }).limit(5).get();
      const walletList = (walletRes && walletRes.data) || [];
      if (!walletList.length) {
        await walletColl.doc(openid).set({
          data: buildPrimaryWalletDoc(openid, now)
        });
      }

      return {
        ok: true,
        id: newId,
        user: {
          ...dataToAdd,
          _id: newId,
          id: newId
        }
      };
    });

    if (!txRes || !txRes.ok) return txRes;
    keepIdCardFiles = true;

    if (txRes.id) {
      try {
        await db.collection(USER_COLLECTION).doc(txRes.id).update({
          data: { id: txRes.id }
        });
      } catch (err) {
        console.error('回写 userInfo.id 失败', err);
      }
    }

    // 5) 注册后自动开户（失败不影响注册）
    const certValidityType = certValidityTypeRaw === 'long' ? 'long' : 'fixed';
    const certBeginDate = normalizeCertDateInput(certBeginDateRaw);
    const certEndDate = normalizeCertDateInput(certEndDateRaw);
    const huifuCertValidityType = certValidityType === 'long' ? '1' : '0';

    let huifuOpen = null;
    let userBusiOpen = null;
    let huifuPatch = null;
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
      const result = (callRes && callRes.result) || callRes || null;
      const respData = result && result.huifuResp;
      const huifuId = getHuifuUserIdFromResp(respData);
      const { code: respCode, desc: respDesc } = getHuifuRespCodeDesc(respData);
      // 这里的 ok 仅代表“云函数调用成功/HTTP 成功”，不等同于业务成功。
      const bizOk = respCode ? respCode === '00000000' : !!(result && result.ok && huifuId);

      if (bizOk && huifuId) {
        huifuPatch = {
          huifu_id: huifuId,
          huifu_open_status: 'success',
          huifu_opened_at: new Date(),
          huifu_open_fail_reason: '',
          user_busi_status: 'pending',
          user_busi_fail_reason: ''
        };
      } else {
        const err = result && result.err;
        let reason = summarizeHuifuFailReason({ err, result, respData });
        // 出现“返回成功但我们没拿到 huifu_id”的情况时，给出更直白的原因，避免误判。
        if (bizOk && !huifuId) {
          reason = `开户返回成功${respCode ? `(${respCode}${respDesc ? `:${respDesc}` : ''})` : ''}，但未获取到 huifu_id`;
        }
        if (reason === '开户失败') {
          const brief = safeJsonStringifyBrief(result, 260);
          if (brief) reason = `开户失败:${brief}`;
        }
        huifuPatch = {
          huifu_open_status: 'failed',
          huifu_open_fail_reason: reason,
          user_busi_status: 'failed',
          user_busi_fail_reason: '个人开户失败，未发起用户业务入驻'
        };
      }
      console.error('[huifuOpen] result=', safeJsonStringifyBrief(result, 600));
      huifuOpen = { ok: !!(result && result.ok), bizOk, huifuId, respCode, raw: result };
    } catch (err) {
      const reason = pickStr(err && (err.errMsg || err.message) || '开户失败');
      huifuPatch = {
        huifu_open_status: 'failed',
        huifu_open_fail_reason: reason,
        user_busi_status: 'failed',
        user_busi_fail_reason: '个人开户失败，未发起用户业务入驻'
      };
      huifuOpen = { ok: false, bizOk: false, huifuId: '', respCode: '', raw: { err: reason } };
      console.error('自动开户失败', err);
    }

    if (huifuPatch && txRes.id && pickStr(huifuPatch.huifu_open_status) === 'success' && pickStr(huifuPatch.huifu_id)) {
      try {
        const callRes = await cloud.callFunction({
          name: 'huifuMiniappPay',
          data: {
            action: 'user_busi_open',
            userHuifuId: pickStr(huifuPatch.huifu_id),
            upperHuifuId: pickStr(process.env.HUIFU_UPPER_HUIFU_ID),
          }
        });
        const result = (callRes && callRes.result) || callRes || null;
        const respData = result && result.huifuResp;
        const { code: respCode, desc: respDesc } = getHuifuRespCodeDesc(respData);
        const userBusiStatus = getUserBusiStatusByResp(result);
        const failReason = userBusiStatus === 'failed'
          ? pickStr(respCode ? `${respCode}${respDesc ? `:${respDesc}` : ''}` : '', '用户业务入驻失败')
          : '';

        huifuPatch = {
          ...huifuPatch,
          user_busi_status: userBusiStatus,
          user_busi_fail_reason: failReason,
          user_busi_req_seq_id: pickStr(result && result.reqSeqId),
          user_busi_req_date: pickStr(result && result.reqDate),
          user_busi_updated_at: new Date(),
          userBusiApply: {
            status: userBusiStatus,
            reqSeqId: pickStr(result && result.reqSeqId),
            reqDate: pickStr(result && result.reqDate),
            respCode,
            respDesc,
            updatedAt: new Date(),
            lastError: failReason,
            huifuResp: respData,
          }
        };
        userBusiOpen = {
          ok: !!(result && result.ok),
          status: userBusiStatus,
          respCode,
          raw: result,
        };
      } catch (err) {
        const reason = pickStr(err && (err.errMsg || err.message), '用户业务入驻失败');
        huifuPatch = {
          ...huifuPatch,
          user_busi_status: 'failed',
          user_busi_fail_reason: reason,
          user_busi_updated_at: new Date(),
          userBusiApply: {
            status: 'failed',
            updatedAt: new Date(),
            lastError: reason,
          }
        };
        userBusiOpen = { ok: false, status: 'failed', respCode: '', raw: { err: reason } };
        console.error('自动用户业务入驻失败', err);
      }
    }

    if (huifuPatch && txRes.id) {
      try {
        await db.collection(USER_COLLECTION).doc(txRes.id).update({ data: huifuPatch });
      } catch (err) {
        console.error('写入 huifu 开户结果失败', err);
      }
    }

    return {
      ...txRes,
      buildTag: BUILD_TAG,
      user: { ...(txRes.user || {}), ...(huifuPatch || {}) },
      huifuOpen,
      userBusiOpen
    };
  } catch (err) {
    console.error('registerUserByIdCard 失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'TRANSACTION_ERROR',
      msg: err && err.errMsg ? err.errMsg : '注册失败，请稍后重试'
    };
  } finally {
    if (!keepIdCardFiles) {
      await safeDeleteFile(idCardFrontFileID);
      await safeDeleteFile(idCardBackFileID);
    }
  }
};
