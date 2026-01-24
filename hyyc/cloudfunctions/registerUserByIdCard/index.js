// 云函数：registerUserByIdCard
// 作用：
// - 前端只上传身份证正面（人像面）照片到云存储，传 fileID 过来；
// - 云函数把 fileID 转成临时链接（ImageUrl），调用腾讯 FaceID 的 IdCardOCRVerification 做识别+核验；
// - 核验通过才注册；成功/失败都删除云存储里的身份证照片（不落库）。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const USER_COMMUNITY_COLLECTION = 'user_community';
const LEGAL_COLLECTION = 'legal_docs';
const VERIFY_LOG_COLLECTION = 'realname_verify_logs';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
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
  const res = await transaction.collection(LEGAL_COLLECTION).where({ type }).limit(20).get();
  const list = (res && res.data) || [];
  const activeList = list.filter((d) => d && d.status === 'active');
  return activeList.length ? pickLatest(activeList) : pickLatest(list);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openId || '';

  const agree = !!(event && event.agree);
  const idCardFrontFileID = pickStr(event && event.idCardFrontFileID);
  const avatarFileID = pickStr(event && event.avatarFileID);
  const form = (event && event.form) || {};

  const phone = pickStr(form.phone);
  const community = pickStr(form.community);
  const building = pickStr(form.building);
  const door = pickStr(form.door);

  // 无论成功/失败都删照片：用 finally 兜底
  try {
    if (!agree) {
      return { ok: false, code: 'AGREEMENT_REQUIRED', msg: '请先阅读并同意用户协议和隐私政策' };
    }

    if (!openid) {
      return { ok: false, code: 'NO_OPENID', msg: '获取用户身份失败' };
    }

    if (!idCardFrontFileID || !phone || !community || !building || !door) {
      return { ok: false, code: 'INVALID_PARAM', msg: '缺少必要参数' };
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
        // 用户头像（云存储 fileID）
        avatarFileID,
        // 为了兼容登录流程中通过 _openid 查询 userInfo，这里手动写入 _openid
        _openid: openid,
        realname: true,
        verified: true,
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

    return txRes;
  } catch (err) {
    console.error('registerUserByIdCard 失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'TRANSACTION_ERROR',
      msg: err && err.errMsg ? err.errMsg : '注册失败，请稍后重试'
    };
  } finally {
    // 成功/失败都删：不保存身份证照片
    await safeDeleteFile(idCardFrontFileID);
  }
};

