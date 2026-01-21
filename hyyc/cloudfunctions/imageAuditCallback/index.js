// 云函数：imageAuditCallback（云函数 URL）
// 作用：接收 COS 内容审核的回调，更新审核任务与业务数据状态。
//
// 安全提示：
// - 建议配置 COS_AUDIT_CALLBACK_TOKEN（像“暗号”），回调 URL 上带 token，
//   这样别人伪造请求就没法把内容“偷着上架”。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const AUDIT_JOB_COLLECTION = 'image_audit_jobs';

const BIZ_COLLECTION_MAP = {
  goods: 'goods',
  tasks: 'tasks'
};

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function getQueryToken(event) {
  const q1 = event && event.queryStringParameters ? event.queryStringParameters : null;
  const q2 = event && event.query ? event.query : null;
  return pickStr((q1 && q1.token) || (q2 && q2.token));
}

function decodeBody(event) {
  const raw = event && event.body;
  if (!raw) return null;

  if (typeof raw === 'object') return raw;

  const isB64 = !!(event && event.isBase64Encoded);
  const text = isB64
    ? Buffer.from(String(raw), 'base64').toString('utf8')
    : String(raw);

  try {
    return JSON.parse(text);
  } catch (e) {
    // 不是 JSON 就直接返回字符串，后面会忽略
    return text;
  }
}

function parseDataId(dataId) {
  // 我们在 imageAuditStart 里把 DataId 组装成：hyyc|{auditJobId}|{idx}
  const s = pickStr(dataId);
  const parts = s.split('|');
  if (parts.length < 3) return null;
  if (parts[0] !== 'hyyc') return null;
  const auditJobId = pickStr(parts[1]);
  const idx = Number(parts[2]);
  if (!auditJobId || !Number.isFinite(idx) || idx < 0) return null;
  return { auditJobId, idx };
}

function toImageStateFromJobs(jobs = {}) {
  // 先看任务状态：不是 Success 时，直接记为 error（避免永远 pending）
  const state = pickStr(jobs.State);
  if (state && state !== 'Success') return 'error';

  // COS 文档里 Result 一般是：
  // 0：正常；1：违规；2：疑似（建议人工复核）
  // 我们这里按“是否需要用户修改”来分：
  // - 0 => pass
  // - 其他 => block（需要换图）
  const n = Number(jobs.Result);
  return n === 0 ? 'pass' : 'block';
}

function httpResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body || {})
  };
}

function isDbConflict(err) {
  // 并发写同一条 doc 时，云开发可能会返回“事务冲突/资源冲突”。
  // 这是“短暂问题”，通常重试几次就能成功。
  const code = err && (err.errCode || err.code);
  const msg = String((err && (err.errMsg || err.message)) || '');
  return (
    code === -501001 ||
    msg.indexOf('TransactionConflict') >= 0 ||
    msg.indexOf('Transaction is conflict') >= 0 ||
    msg.indexOf('resource operated by others') >= 0
  );
}

function sleep(ms) {
  const t = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, t));
}

async function withDbRetry(fn, opt = {}) {
  const retries = Math.max(0, Number(opt.retries ?? 5) || 0);
  const baseDelayMs = Math.max(20, Number(opt.baseDelayMs ?? 80) || 80);
  let lastErr = null;

  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (!isDbConflict(e) || i >= retries) throw e;
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delay = Math.min(1500, baseDelayMs * Math.pow(2, i) + jitter);
      await sleep(delay);
    }
  }

  throw lastErr || new Error('withDbRetry failed');
}

function normalizeJobsDetails(payload) {
  // 有的回调会给单个对象，有的会给数组；统一成数组处理
  const jd = payload ? (payload.JobsDetail || payload.jobsDetail || null) : null;
  if (!jd) return [];
  if (Array.isArray(jd)) return jd.filter((x) => x && typeof x === 'object');
  if (typeof jd === 'object') return [jd];
  return [];
}

async function applyOneDetail({ auditJobId, idx, jobs, now }) {
  // 为了避免多个回调同时到达时“互相覆盖 images 整个数组”，这里只更新对应下标的字段。
  // 同时做“冲突重试”：9 张图并发回调时，更新同一条 doc 很容易撞上 TransactionConflict。
  return withDbRetry(async () => {
    const jobRes = await db.collection(AUDIT_JOB_COLLECTION).doc(auditJobId).get();
    const job = jobRes && jobRes.data ? jobRes.data : null;
    if (!job) return { ok: false, code: 'JOB_NOT_FOUND', auditJobId, idx };

    const images = Array.isArray(job.images) ? job.images : [];
    const pos = images.findIndex((it) => Number(it && it.idx) === idx);
    if (pos < 0) return { ok: false, code: 'IDX_NOT_FOUND', auditJobId, idx };

    const imageState = toImageStateFromJobs(jobs);
    const prefix = `images.${pos}`;

    const scoreNum = Number(jobs.Score);
    const score = Number.isFinite(scoreNum) ? scoreNum : null;
    const resultNum = Number(jobs.Result);
    const result = Number.isFinite(resultNum) ? resultNum : null;

    await db.collection(AUDIT_JOB_COLLECTION).doc(auditJobId).update({
      data: {
        [`${prefix}.state`]: imageState,
        [`${prefix}.cosJobId`]: pickStr(jobs.JobId) || images[pos].cosJobId || '',
        [`${prefix}.label`]: pickStr(jobs.Label) || '',
        [`${prefix}.subLabel`]: pickStr(jobs.SubLabel) || '',
        [`${prefix}.score`]: score,
        [`${prefix}.result`]: result,
        [`${prefix}.updatedAt`]: now,
        [`${prefix}.raw`]: {
          State: pickStr(jobs.State),
          Message: pickStr(jobs.Message),
          Category: pickStr(jobs.Category),
          SubLabel: pickStr(jobs.SubLabel)
        },
        updatedAt: now
      }
    });

    return { ok: true, auditJobId, idx, imageState };
  }, { retries: 6, baseDelayMs: 60 });
}

async function finalizeIfDone(auditJobId) {
  // 兜底收口：当所有图片都不再 pending 时，统一把 job/goods 状态收敛到最终态
  return withDbRetry(async () => {
    const now = new Date();
    return db.runTransaction(async (transaction) => {
      const jobRes = await transaction.collection(AUDIT_JOB_COLLECTION).doc(auditJobId).get();
      const job = jobRes && jobRes.data ? jobRes.data : null;
      if (!job) return { ok: false, code: 'JOB_NOT_FOUND', auditJobId };

      const images = Array.isArray(job.images) ? job.images : [];
      const stillPending = images.some((it) => it && it.state === 'pending');
      if (stillPending) {
        return { ok: true, status: 'pending', stillPending: true };
      }

      const currentStatus = pickStr(job.status);
      if (currentStatus && currentStatus !== 'pending' && job.finishedAt) {
        return { ok: true, status: currentStatus, stillPending: false, alreadyFinal: true };
      }

      const allPass = images.length > 0 && images.every((it) => it && it.state === 'pass');
      const jobStatus = allPass ? 'pass' : 'need_fix';

      // 注意：这里把非 pass 的都当成需要用户处理（包含 block/error）
      const needFixIdx = allPass
        ? []
        : images
          .filter((x) => x && x.state !== 'pass')
          .map((x) => Number(x.idx))
          .filter((n) => Number.isFinite(n) && n >= 0);

      await transaction.collection(AUDIT_JOB_COLLECTION).doc(auditJobId).update({
        data: {
          status: jobStatus,
          finishedAt: now,
          updatedAt: now
        }
      });

      // 如果是“最新的一次审核”，就更新业务状态
      const bizType = pickStr(job.bizType);
      const bizId = pickStr(job.bizId);
      const bizColl = BIZ_COLLECTION_MAP[bizType];
      if (bizColl && bizId) {
        const bizRes = await transaction.collection(bizColl).doc(bizId).get();
        const bizDoc = bizRes && bizRes.data ? bizRes.data : null;
        const latestJobId = bizDoc ? pickStr(bizDoc.auditJobId) : '';
        if (bizDoc && latestJobId === auditJobId) {
          await transaction.collection(bizColl).doc(bizId).update({
            data: {
              status: allPass ? 'posted' : 'need_fix',
              auditFinishedAt: now,
              auditUpdatedAt: now,
              auditError: '',
              auditNeedFixIdx: needFixIdx
            }
          });
        }
      }

      return { ok: true, status: jobStatus, stillPending: false, allPass, needFixIdx };
    });
  }, { retries: 6, baseDelayMs: 80 });
}

exports.main = async (event, context) => {
  try {
    // 1) token 校验（可选，但强烈建议开）
    const expected = pickStr(process.env.COS_AUDIT_CALLBACK_TOKEN);
    if (expected) {
      const got = getQueryToken(event);
      if (!got || got !== expected) {
        return httpResp(403, { ok: false, msg: 'forbidden' });
      }
    }

    // 2) 解析回调体
    const payload = decodeBody(event);
    if (!payload || typeof payload !== 'object') {
      // 返回 200，避免 COS 反复重试
      return httpResp(200, { ok: true });
    }

    const jobList = normalizeJobsDetails(payload);
    if (!jobList.length) return httpResp(200, { ok: true });

    // 3) 逐条落库（用“只更新对应下标字段”的方式，避免并发回调互相覆盖）
    const now = new Date();
    const touchedJobIds = {};
    const applied = [];
    const skipped = [];
    let needRetry = false;

    for (const jobs of jobList) {
      const info = parseDataId(jobs && jobs.DataId);
      if (!info) {
        skipped.push({ code: 'NO_DATA_ID' });
        continue;
      }
      const { auditJobId, idx } = info;
      touchedJobIds[auditJobId] = true;
      try {
        const r = await applyOneDetail({ auditJobId, idx, jobs, now });
        (r && r.ok ? applied : skipped).push(r);
      } catch (e) {
        // 这种错误大多是“并发冲突”，建议让 COS 重试这次回调（我们用 503 提示重试）
        if (isDbConflict(e)) needRetry = true;
        console.error('applyOneDetail failed', auditJobId, idx, e);
        skipped.push({
          ok: false,
          code: 'APPLY_FAIL',
          auditJobId,
          idx,
          retryable: isDbConflict(e),
          errMsg: pickStr(e && (e.errMsg || e.message))
        });
      }
    }

    // 4) 每个 auditJobId 再做一次“是否已全部完成”的收口
    const finalized = [];
    for (const auditJobId of Object.keys(touchedJobIds)) {
      try {
        const r = await finalizeIfDone(auditJobId);
        finalized.push({ auditJobId, ...r });
      } catch (e) {
        if (isDbConflict(e)) needRetry = true;
        console.error('finalizeIfDone failed', auditJobId, e);
        finalized.push({
          auditJobId,
          ok: false,
          code: 'FINALIZE_FAIL',
          retryable: isDbConflict(e),
          errMsg: pickStr(e && (e.errMsg || e.message))
        });
      }
    }

    // 如果出现“冲突类错误”，返回 503 让 COS 过一会儿再重试回调；
    // 否则返回 200 告诉 COS “本次回调已处理”。
    const statusCode = needRetry ? 503 : 200;
    return httpResp(statusCode, {
      ok: !needRetry,
      handled: { total: jobList.length, applied: applied.length, skipped: skipped.length },
      applied,
      skipped,
      finalized
    });
  } catch (err) {
    console.error('imageAuditCallback failed', err);
    // 真失败：返回 503，让 COS 后续重试（否则这次回调就“丢”了）
    return httpResp(503, { ok: false, retry: true });
  }
};
