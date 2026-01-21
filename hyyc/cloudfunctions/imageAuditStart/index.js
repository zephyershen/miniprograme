// 云函数：imageAuditStart
// 作用：
// - 给“业务数据”（如 goods / tasks）创建一次图片审核任务；
// - 先把图片的临时 URL 取出来，再调用 COS 的“图片批量审核”接口；
// - 结果通过回调（callback）打到 imageAuditCallback 云函数 URL。
//
// 说明（重要）：
// - 密钥不要写死在代码里（就像银行卡密码），用云函数环境变量。
//
// 需要的云函数环境变量：
// - COS_SECRET_ID / COS_SECRET_KEY：访问 COS 的密钥（不要外泄）
// - COS_AUDIT_BUCKET：审核用的桶名（格式如 imgs-check-1395663220）
// - COS_AUDIT_REGION：地域（上海一般是 ap-shanghai）
// - COS_AUDIT_CALLBACK_URL：回调地址（云函数 URL，必须 https）
// - COS_AUDIT_CALLBACK_TOKEN：可选，回调校验用的 token（像“暗号”）
// - COS_AUDIT_BIZ_TYPE：可选，内容审核策略 ID（推荐用它；更灵活）

const cloud = require('wx-server-sdk');
const COS = require('cos-nodejs-sdk-v5');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const AUDIT_JOB_COLLECTION = 'image_audit_jobs';

// 目前先接 goods（后续别的业务也能复用）
const BIZ_COLLECTION_MAP = {
  goods: 'goods',
  tasks: 'tasks'
};

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function mustEnv(name) {
  const v = pickStr(process.env[name]);
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

function buildCallbackUrl(baseUrl, token) {
  const u = pickStr(baseUrl);
  if (!u) return '';
  const t = pickStr(token);
  if (!t) return u;
  const join = u.indexOf('?') >= 0 ? '&' : '?';
  return `${u}${join}token=${encodeURIComponent(t)}`;
}

function escapeCData(s) {
  // 避免出现 "]]>" 破坏 XML；极少见，但做个兜底
  return String(s || '').replace(/]]>/g, ']]]]><![CDATA[>');
}

function normalizeDetectType(v) {
  // DetectType 不是“全场景”的开关，且官方文档里只明确给出了 Porn/Ads 的例子。
  // 为了避免因为传了不支持的值导致接口直接失败，这里只放行我们确认过的值。
  const s = pickStr(v);
  if (!s) return '';
  const allow = new Set(['Porn', 'Ads']);
  const map = { porn: 'Porn', ads: 'Ads' };
  const out = [];
  s.split(',')
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .forEach((x) => {
      const key = x.toLowerCase();
      const norm = map[key] || x;
      if (allow.has(norm) && out.indexOf(norm) < 0) out.push(norm);
    });
  return out.join(',');
}

function buildAuditingXml({ inputs, callbackUrl, detectType, ciBizType }) {
  const inputXml = (inputs || [])
    .map((it) => {
      const url = escapeCData(it.url);
      const dataId = escapeCData(it.dataId);
      return (
        '<Input>' +
          `<Url><![CDATA[${url}]]></Url>` +
          `<DataId><![CDATA[${dataId}]]></DataId>` +
        '</Input>'
      );
    })
    .join('');

  const bt = pickStr(ciBizType);
  // 优先用 BizType（策略）。BizType 有值时，就不再传 DetectType，避免互相影响。
  let dt = bt ? '' : normalizeDetectType(detectType);
  // 两个都没给时，为了避免请求缺关键字段导致直接失败，这里给一个最“稳”的兜底。
  if (!bt && !dt) dt = 'Porn,Ads';
  const cb = escapeCData(callbackUrl);

  // Async=1：异步审核，结果走回调
  return (
    '<Request>' +
      inputXml +
      '<Conf>' +
        (bt ? `<BizType><![CDATA[${escapeCData(bt)}]]></BizType>` : '') +
        (dt ? `<DetectType>${dt}</DetectType>` : '') +
        '<Async>1</Async>' +
        `<Callback><![CDATA[${cb}]]></Callback>` +
      '</Conf>' +
    '</Request>'
  );
}

async function ensureCollectionExists(name) {
  // 有的环境需要先在控制台创建集合，否则 add 会报 “collection not exists”。
  // 这里尽量自动创建，失败也不影响后续逻辑（会在 add 时报错并返回更明确的提示）。
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (e) {
    // ignore
  }
}

async function getTempUrlMap(fileIDs = []) {
  const uniq = Array.from(new Set((fileIDs || []).filter(Boolean)));
  if (!uniq.length) return {};

  const res = await cloud.getTempFileURL({
    fileList: uniq.map((fileID) => ({ fileID, maxAge: 60 * 60 }))
  });

  const list = (res && res.fileList) ? res.fileList : [];
  const map = {};
  list.forEach((it) => {
    if (!it || !it.fileID) return;
    if (it.tempFileURL) map[it.fileID] = it.tempFileURL;
  });
  return map;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openId || '';

  if (!openid) {
    return { ok: false, code: 'NO_OPENID', msg: '获取用户身份失败' };
  }

  const bizType = pickStr(event && event.bizType);
  const bizId = pickStr(event && event.bizId);
  const rawImages = Array.isArray(event && event.images) ? event.images : [];

  if (!bizType || !bizId || !rawImages.length) {
    return { ok: false, code: 'INVALID_PARAM', msg: '参数不完整' };
  }

  const collectionName = BIZ_COLLECTION_MAP[bizType];
  if (!collectionName) {
    return { ok: false, code: 'UNSUPPORTED_BIZ', msg: '不支持的业务类型' };
  }

  // 统一格式：[{ idx, fileID }]
  const images = rawImages
    .map((it, idx) => {
      if (typeof it === 'string') return { idx, fileID: it };
      const o = it || {};
      return { idx: Number(o.idx ?? idx), fileID: pickStr(o.fileID) };
    })
    .filter((it) => Number.isFinite(it.idx) && it.idx >= 0 && it.fileID);
  if (!images.length) {
    return { ok: false, code: 'INVALID_IMAGES', msg: '图片参数不正确' };
  }

  // 简单保护：最多 9 张（和你商品发布页的上限一致）
  if (images.length > 9) {
    return { ok: false, code: 'TOO_MANY', msg: '图片最多 9 张' };
  }

  try {
    // 1) 校验业务数据归属（只能给自己发布的内容做审核）
    const bizRes = await db.collection(collectionName).doc(bizId).get();
    const bizDoc = bizRes && bizRes.data ? bizRes.data : null;
    if (!bizDoc) {
      return { ok: false, code: 'BIZ_NOT_FOUND', msg: '未找到要审核的数据' };
    }
    const ownerOpenid = bizDoc._openid || '';
    if (!ownerOpenid || ownerOpenid !== openid) {
      return { ok: false, code: 'NO_PERMISSION', msg: '无权限操作' };
    }

    // 2) 创建审核任务（先落库，拿到 jobId，方便回调定位）
    await ensureCollectionExists(AUDIT_JOB_COLLECTION);
    const now = new Date();
    const jobAddRes = await db.collection(AUDIT_JOB_COLLECTION).add({
      data: {
        bizType,
        bizId,
        ownerOpenid: openid,
        status: 'pending', // pending | pass | need_fix | error
        images: images
          .slice()
          .sort((a, b) => a.idx - b.idx)
          .map((it) => ({
            idx: it.idx,
            fileID: it.fileID,
            state: 'pending', // pending | pass | block | error
            cosJobId: '',
            label: '',
            subLabel: '',
            score: null,
            result: null,
            updatedAt: now
          })),
        createdAt: now,
        updatedAt: now
      }
    });
    const auditJobId = (jobAddRes && jobAddRes._id) ? String(jobAddRes._id) : '';
    if (!auditJobId) throw new Error('create audit job failed');

    // 3) 把业务状态改成 pending（别人看不见，只在“我的”里能看见）
    // 注意：业务表里原本就有 status 字段；这里复用它。
    await db.collection(collectionName).doc(bizId).update({
      data: {
        status: 'pending',
        auditJobId,
        auditUpdatedAt: now,
        auditNeedFixIdx: [],
        auditError: ''
      }
    });

    // 4) 拿云存储的临时 URL（COS 审核支持 URL 输入，所以不用把图片再存一份到 COS）
    const fileIDs = images.map((it) => it.fileID);
    const urlMap = await getTempUrlMap(fileIDs);

    const inputs = images
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((it) => {
        const url = urlMap[it.fileID] || '';
        return {
          idx: it.idx,
          fileID: it.fileID,
          url,
          // 用 DataId 把“我们的 jobId + 第几张图”带回回调里
          dataId: `hyyc|${auditJobId}|${it.idx}`
        };
      });

    // 有 URL 拿不到时，直接标记 error，提醒用户重试
    const missing = inputs.filter((it) => !it.url);
    if (missing.length) {
      await db.collection(AUDIT_JOB_COLLECTION).doc(auditJobId).update({
        data: {
          status: 'error',
          errorMsg: '获取图片临时地址失败',
          updatedAt: now
        }
      });
      await db.collection(collectionName).doc(bizId).update({
        data: {
          status: 'need_fix',
          auditUpdatedAt: now,
          auditError: '获取图片地址失败，请稍后重试'
        }
      });
      return { ok: false, code: 'TEMP_URL_FAIL', msg: '获取图片地址失败，请重试', jobId: auditJobId };
    }

    // 5) 调 COS 图片批量审核（异步 + 回调）
    const secretId = mustEnv('COS_SECRET_ID');
    const secretKey = mustEnv('COS_SECRET_KEY');
    const bucket = mustEnv('COS_AUDIT_BUCKET');
    const region = mustEnv('COS_AUDIT_REGION');
    const callbackBase = mustEnv('COS_AUDIT_CALLBACK_URL');
    const callbackToken = pickStr(process.env.COS_AUDIT_CALLBACK_TOKEN);
    const callbackUrl = buildCallbackUrl(callbackBase, callbackToken);
    const ciBizType = pickStr(process.env.COS_AUDIT_BIZ_TYPE);

    const cos = new COS({
      SecretId: secretId,
      SecretKey: secretKey,
      // CI 的接口域名是 *.ci.*，这里直接让 SDK 走 ci 域名
      Domain: '{Bucket}.ci.{Region}.myqcloud.com'
    });

    const xmlBody = buildAuditingXml({
      inputs,
      callbackUrl,
      // 可选：DetectType 只建议 Porn/Ads；更多场景请在 COS 内容审核里配策略，然后用 ciBizType
      detectType: pickStr(event && event.detectType),
      ciBizType
    });

    const cosRes = await cos.request({
      Bucket: bucket,
      Region: region,
      Method: 'POST',
      Key: 'image/auditing',
      Headers: { 'Content-Type': 'application/xml' },
      Body: xmlBody
    });

    const jobs = cosRes
      ? (cosRes.JobsDetail || (cosRes.Response && cosRes.Response.JobsDetail) || [])
      : [];
    const jobList = Array.isArray(jobs) ? jobs : [jobs];

    const byDataId = {};
    const byUrl = {};
    jobList.forEach((j) => {
      if (!j) return;
      const jobId = pickStr(j.JobId);
      const url = pickStr(j.Url);
      const dataId = pickStr(j.DataId);
      if (jobId && dataId) byDataId[dataId] = jobId;
      if (jobId && url) byUrl[url] = jobId;
    });

    // 6) 回写 cosJobId（回调到达前，先把 jobId 存起来，方便排查问题）
    const updatedImages = inputs.map((it) => {
      const cosJobId = byDataId[it.dataId] || byUrl[it.url] || '';
      return {
        idx: it.idx,
        fileID: it.fileID,
        state: cosJobId ? 'pending' : 'error',
        cosJobId,
        label: '',
        subLabel: '',
        score: null,
        result: null,
        updatedAt: now
      };
    });

    const hasErr = updatedImages.some((it) => it.state === 'error');
    await db.collection(AUDIT_JOB_COLLECTION).doc(auditJobId).update({
      data: {
        images: updatedImages,
        status: hasErr ? 'error' : 'pending',
        errorMsg: hasErr ? '创建审核任务失败，请重试' : '',
        cosRequestId: pickStr((cosRes && (cosRes.RequestId || (cosRes.Response && cosRes.Response.RequestId))) || ''),
        updatedAt: now
      }
    });

    if (hasErr) {
      await db.collection(collectionName).doc(bizId).update({
        data: {
          status: 'need_fix',
          auditUpdatedAt: now,
          auditError: '创建审核任务失败，请稍后重试'
        }
      });
      return { ok: false, code: 'COS_CREATE_FAIL', msg: '创建审核任务失败，请重试', jobId: auditJobId };
    }

    return { ok: true, jobId: auditJobId };
  } catch (err) {
    console.error('imageAuditStart failed', err);
    // 给一个更直白的提示，避免用户只看到“启动失败”不知道从哪处理
    if (err && err.errCode === -502005 && String(err.errMsg || '').indexOf(AUDIT_JOB_COLLECTION) >= 0) {
      return {
        ok: false,
        code: 'COLLECTION_MISSING',
        msg: `请先在云开发数据库创建集合：${AUDIT_JOB_COLLECTION}`,
        errMsg: String(err.errMsg || '')
      };
    }
    return {
      ok: false,
      code: 'START_FAILED',
      msg: '启动审核失败，请稍后重试',
      errMsg: err && err.message ? String(err.message) : ''
    };
  }
};
