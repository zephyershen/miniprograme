// 云函数：huifuPayNotify（云函数 URL / HTTP 访问）
// 作用：
// - 接收汇付交易回调（支付结果/退款结果等）
// - 校验 token（像“暗号”）+ 验签（确认是汇付发的）
// - 目前先做最小闭环：支持把任务从 pay_pending 自动改为 posted（防止用户支付后闪退导致状态不更新）
//
// 需要的环境变量（建议都配）：
// - HUIFU_NOTIFY_TOKEN：回调 token（URL 上 ?token=xxx）
// - HUIFU_PLATFORM_PUBLIC_KEY：汇付平台公钥（用于验签）
// - HUIFU_SYS_ID / HUIFU_PRODUCT_ID / HUIFU_HUIFU_ID：用于做基本一致性校验（可选但推荐）

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const TASK_COLLECTION = 'tasks';
const NOTIFY_LOG_COLLECTION = 'huifu_notify_logs';

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function stripWrappingQuotes(s = '') {
  const t = String(s || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function normalizePem(pemLike = '') {
  return stripWrappingQuotes(String(pemLike || ''))
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function looksLikePemPublicKey(pem = '') {
  const s = String(pem || '').trim();
  return Boolean(s && s.includes('-----BEGIN') && s.includes('PUBLIC KEY-----'));
}

function wordwrap64(s) {
  return String(s || '').replace(/\s+/g, '').replace(/(.{64})/g, '$1\n').trim();
}

function base64SpkiToPem(base64Key = '') {
  const b64 = String(base64Key || '').trim();
  if (!b64) return '';
  return `-----BEGIN PUBLIC KEY-----\n${wordwrap64(b64)}\n-----END PUBLIC KEY-----`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ''));
  } catch (e) {
    return null;
  }
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

  const json = safeJsonParse(text);
  return json || text;
}

function httpResp(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body || {})
  };
}

function sortObjectByAsciiKeys(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const keys = Object.keys(o).sort();
  const out = {};
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

function buildSortedJsonStringForSign(dataObj) {
  return JSON.stringify(sortObjectByAsciiKeys(dataObj));
}

function rsaSha256VerifyBase64({ message, signBase64, publicKeyPem }) {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(String(message || ''), 'utf8');
  verifier.end();
  return verifier.verify(publicKeyPem, String(signBase64 || ''), 'base64');
}

async function ensureCollectionExists(name) {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (e) {
    // ignore
  }
}

async function writeNotifyLog({ ok, code, msg, rawEvent, bodyObj }) {
  try {
    await ensureCollectionExists(NOTIFY_LOG_COLLECTION);
    await db.collection(NOTIFY_LOG_COLLECTION).add({
      data: {
        ok: !!ok,
        code: pickStr(code),
        msg: pickStr(msg),
        createdAt: new Date(),
        // 只存“摘要”，避免日志太大；需要全量时可以临时改
        bodyBrief: (() => {
          try {
            const s = JSON.stringify(bodyObj || {});
            return s.length <= 1200 ? s : `${s.slice(0, 1200)}...`;
          } catch (e) {
            return '';
          }
        })(),
        meta: {
          method: pickStr(rawEvent && rawEvent.httpMethod),
          ua: pickStr(rawEvent && rawEvent.headers && (rawEvent.headers['user-agent'] || rawEvent.headers['User-Agent'])),
          ip: pickStr(rawEvent && rawEvent.requestContext && rawEvent.requestContext.sourceIp)
        }
      }
    });
  } catch (e) {
    console.error('[huifuPayNotify] write log failed', e);
  }
}

function guessBizSuccess(data = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const respCode = pickStr(d.resp_code, d.return_code, d.code, d.respCode);
  if (respCode) return respCode === '00000000';

  // 有的回调会给“交易状态”，不同产品字段名可能不一样；这里做“尽量不误判”的兜底：
  const transStat = pickStr(d.trans_stat, d.trade_status, d.status, d.transStat);
  if (transStat) {
    const s = transStat.toUpperCase();
    if (['S', 'SUCCESS', 'PAY_SUCCESS', 'PAID', 'TRADE_SUCCESS'].includes(s)) return true;
    if (['F', 'FAIL', 'FAILED', 'CLOSED', 'PAY_FAIL', 'REFUND'].includes(s)) return false;
  }

  // 两个都没有时：不敢自动当作成功，交给上层逻辑/人工看日志
  return null;
}

async function tryMarkTaskPaidByReq({ reqDate, reqSeqId, huifuData, rawBody }) {
  const rd = pickStr(reqDate);
  const rs = pickStr(reqSeqId);
  if (!rd || !rs) return { ok: false, code: 'MISSING_REQ', msg: '缺少 req_date/req_seq_id' };

  // 只处理“任务支付”的下单（我们在 delay_jspay_task 里写入 tasks.pay.reqDate/reqSeqId）
  const res = await db.collection(TASK_COLLECTION)
    .where({
      status: 'pay_pending',
      'pay.reqDate': rd,
      'pay.reqSeqId': rs,
    })
    .limit(2)
    .get();

  const list = (res && res.data) || [];
  if (!list.length) return { ok: true, code: 'NO_TASK_MATCH', msg: '未找到匹配 pay_pending 任务（可能已处理）' };
  if (list.length > 1) return { ok: false, code: 'MULTI_TASK_MATCH', msg: '存在多条任务匹配同一笔支付（需要人工处理）' };

  const task = list[0] || {};
  const taskId = pickStr(task._id);
  if (!taskId) return { ok: false, code: 'TASK_ID_MISSING', msg: '任务ID缺失' };

  const now = new Date();
  await db.collection(TASK_COLLECTION).doc(taskId).update({
    data: {
      status: 'posted',
      paidAt: now,
      updatedAt: now,
      pay: {
        ...(task.pay || {}),
        status: 'paid',
        paidAt: now,
        notify: {
          at: now,
          // 存一个摘要，方便排查
          reqDate: rd,
          reqSeqId: rs,
          result: guessBizSuccess(huifuData),
        }
      },
      // 留一份回调数据摘要（不建议存太大）
      huifuNotify: (() => {
        try {
          const s = JSON.stringify(rawBody || {});
          return s.length <= 2000 ? s : `${s.slice(0, 2000)}...`;
        } catch (e) {
          return '';
        }
      })(),
    }
  });

  return { ok: true, code: 'TASK_MARKED_POSTED', msg: `任务已自动发布: ${taskId}` };
}

exports.main = async (event = {}) => {
  // 1) token 校验（推荐必须配）
  const needToken = pickStr(process.env.HUIFU_NOTIFY_TOKEN);
  const gotToken = getQueryToken(event);
  if (needToken && gotToken !== needToken) {
    await writeNotifyLog({ ok: false, code: 'BAD_TOKEN', msg: 'token 不匹配', rawEvent: event, bodyObj: null });
    return httpResp(403, { ok: false, code: 'BAD_TOKEN' });
  }

  // 2) 解析 body（汇付一般是 JSON）
  const bodyObj = decodeBody(event);
  if (!bodyObj || typeof bodyObj !== 'object') {
    await writeNotifyLog({ ok: false, code: 'BAD_BODY', msg: 'body 不是 JSON 对象', rawEvent: event, bodyObj: { body: bodyObj } });
    return httpResp(400, { ok: false, code: 'BAD_BODY' });
  }

  // 3) 取出 data + sign（按我们项目当前签名规则做验签）
  const top = bodyObj || {};
  const data = (top && typeof top === 'object' && top.data && typeof top.data === 'object')
    ? top.data
    : (top.data ? safeJsonParse(top.data) : null) || top;
  const sign = pickStr(top.sign, top.signature, (data && data.sign));

  // 4) 验签
  let pubKey = normalizePem(pickStr(process.env.HUIFU_PLATFORM_PUBLIC_KEY));
  if (pubKey && !looksLikePemPublicKey(pubKey) && /^[A-Za-z0-9+/=\r\n]+$/.test(pubKey)) {
    pubKey = base64SpkiToPem(pubKey);
  }

  if (!pubKey || !looksLikePemPublicKey(pubKey)) {
    await writeNotifyLog({ ok: false, code: 'MISSING_PUBKEY', msg: '缺少/无效的平台公钥', rawEvent: event, bodyObj });
    return httpResp(500, { ok: false, code: 'MISSING_PUBKEY' });
  }
  if (!sign) {
    await writeNotifyLog({ ok: false, code: 'MISSING_SIGN', msg: '缺少 sign', rawEvent: event, bodyObj });
    return httpResp(400, { ok: false, code: 'MISSING_SIGN' });
  }

  const msg = buildSortedJsonStringForSign(data);
  const pass = rsaSha256VerifyBase64({ message: msg, signBase64: sign, publicKeyPem: pubKey });
  if (!pass) {
    await writeNotifyLog({ ok: false, code: 'BAD_SIGN', msg: '验签失败', rawEvent: event, bodyObj });
    return httpResp(403, { ok: false, code: 'BAD_SIGN' });
  }

  // 5) 基本一致性校验（不通过也先记录，但不直接拒绝，避免联调阶段回调一直重试）
  const expectSysId = pickStr(process.env.HUIFU_SYS_ID);
  const expectProductId = pickStr(process.env.HUIFU_PRODUCT_ID);
  const expectHuifuId = pickStr(process.env.HUIFU_HUIFU_ID);
  const gotSysId = pickStr(top.sys_id, top.sysId);
  const gotProductId = pickStr(top.product_id, top.productId);
  const gotHuifuId = pickStr(data && (data.huifu_id || data.huifuId));
  const mismatch = [];
  if (expectSysId && gotSysId && expectSysId !== gotSysId) mismatch.push('sys_id');
  if (expectProductId && gotProductId && expectProductId !== gotProductId) mismatch.push('product_id');
  if (expectHuifuId && gotHuifuId && expectHuifuId !== gotHuifuId) mismatch.push('huifu_id');

  // 6) 先处理：任务支付成功 -> 自动发布
  const success = guessBizSuccess(data);
  const reqDate = pickStr(data && (data.req_date || data.reqDate));
  const reqSeqId = pickStr(data && (data.req_seq_id || data.reqSeqId));

  let handled = { ok: true, code: 'ACK', msg: 'ack' };
  if (success === true && reqDate && reqSeqId) {
    try {
      handled = await tryMarkTaskPaidByReq({ reqDate, reqSeqId, huifuData: data, rawBody: top });
    } catch (e) {
      console.error('[huifuPayNotify] mark task paid failed', e);
      handled = { ok: false, code: 'MARK_TASK_FAILED', msg: String(e && e.message ? e.message : e) };
    }
  }

  await writeNotifyLog({
    ok: handled.ok,
    code: handled.code,
    msg: `${handled.msg || ''}${mismatch.length ? ` (mismatch:${mismatch.join(',')})` : ''}`,
    rawEvent: event,
    bodyObj
  });

  // 重要：大多数支付回调是“返回 200 即表示我们收到了”，否则会反复重试。
  return httpResp(200, { ok: true, code: handled.code, msg: handled.msg });
};

