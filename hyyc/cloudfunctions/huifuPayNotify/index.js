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
const MSG_COLLECTION = 'messages';
const USER_COLLECTION = 'userInfo';
const NOTIFY_LOG_COLLECTION = 'huifu_notify_logs';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';
const WITHDRAW_COLLECTION = 'wallet_withdraw_requests';

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

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
}

function buildTopLevelMessageForSign(top = {}) {
  const payload = {};
  const src = top && typeof top === 'object' ? top : {};
  const keys = Object.keys(src);
  for (const key of keys) {
    if (key === 'sign' || key === 'signature') continue;
    const value = src[key];
    if (value === undefined || value === null) continue;
    payload[key] = value;
  }
  return buildSortedJsonStringForSign(payload);
}

function getQueryToken(event) {
  const q1 = event && event.queryStringParameters ? event.queryStringParameters : null;
  const q2 = event && event.query ? event.query : null;
  return pickStr((q1 && q1.token) || (q2 && q2.token), (q1 && q1.t) || (q2 && q2.t));
}

function looksLikeFormBody(text = '', contentType = '') {
  const body = String(text || '').trim();
  const type = String(contentType || '').toLowerCase();
  if (!body) return false;
  if (type.includes('application/x-www-form-urlencoded')) return true;
  return body.includes('=') && (body.includes('&') || body.includes('resp_data=') || body.includes('data='));
}

function parseFormBody(text = '') {
  const body = String(text || '').trim().replace(/^\?/, '');
  if (!body) return null;
  const params = new URLSearchParams(body);
  const out = {};
  for (const [key, value] of params.entries()) {
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      if (Array.isArray(out[key])) {
        out[key].push(value);
      } else {
        out[key] = [out[key], value];
      }
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function decodeBody(event) {
  const raw = event && event.body;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;

  const headers = event && event.headers && typeof event.headers === 'object' ? event.headers : {};
  const contentType = pickStr(headers['content-type'], headers['Content-Type']);
  const isB64 = !!(event && event.isBase64Encoded);
  const text = isB64
    ? Buffer.from(String(raw), 'base64').toString('utf8')
    : String(raw);

  const json = safeJsonParse(text);
  if (json) return json;

  if (looksLikeFormBody(text, contentType)) {
    const form = parseFormBody(text);
    if (form) return form;
  }

  return text;
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
  const respCode = pickStr(d.sub_resp_code, d.resp_code, d.return_code, d.code, d.respCode);
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

function extractRespCode(data = {}) {
  return pickStr(data.sub_resp_code, data.resp_code, data.return_code, data.code, data.respCode);
}

function extractRespDesc(data = {}) {
  return pickStr(data.sub_resp_desc, data.resp_desc, data.resp_msg, data.return_msg, data.message, data.respDesc);
}

function extractTransStatus(data = {}) {
  return pickStr(data.trans_status, data.trans_stat, data.transStatus).toUpperCase();
}

function resolveRefundStatus(data = {}) {
  const respCode = extractRespCode(data);
  const transStatus = extractTransStatus(data);
  const bizSuccess = !respCode || respCode === '00000000' || respCode === '00000100';
  if (!bizSuccess) return 'failed';
  if (transStatus === 'S' || transStatus === 'SUCCESS') return 'success';
  if (transStatus === 'P' || transStatus === 'PROCESSING') return 'processing';
  if (transStatus === 'F' || transStatus === 'FAIL' || transStatus === 'FAILED' || transStatus === 'B') return 'failed';
  return 'processing';
}

function buildTaskCancelMessagePayload(task = {}, cancelRequest = {}, refund = {}) {
  const refundObj = refund && typeof refund === 'object' ? refund : {};
  const cancelObj = cancelRequest && typeof cancelRequest === 'object' ? cancelRequest : {};
  return {
    requestId: pickStr(cancelObj.requestId),
    status: pickStr(cancelObj.status),
    taskTitle: pickStr(task.title, task.desc, '任务'),
    amount: roundMoney(task.amount),
    requesterName: pickStr(cancelObj.requesterName, task.ownerNickname, task.ownerName, '发布者'),
    approverUserId: pickStr(task.workerId),
    approvedByName: pickStr(cancelObj.approvedByName, task.workerNickname, task.workerName),
    refundStatus: pickStr(refundObj.status),
    refundDesc: pickStr(refundObj.respDesc),
  };
}

async function syncTaskCancelMessage(messageId, payload) {
  const id = pickStr(messageId);
  if (!id) return;
  try {
    await db.collection(MSG_COLLECTION).doc(id).update({
      data: {
        taskCancel: payload,
        updatedAt: new Date(),
      }
    });
  } catch (err) {
    console.error('[huifuPayNotify] sync task cancel message failed', err);
  }
}

async function recordWalletTransaction({
  openid,
  amount,
  balanceDelta,
  type,
  bizKey,
  title,
  summary,
  relatedId,
  affectsBalance,
  fundChannel,
  extra = {},
}) {
  const ownerOpenid = pickStr(openid);
  const txType = pickStr(type);
  const key = pickStr(bizKey);
  const amt = roundMoney(amount);
  let delta = roundMoney(balanceDelta);
  if (!Number.isFinite(delta)) delta = amt;
  const shouldAffectBalance = typeof affectsBalance === 'boolean' ? affectsBalance : delta !== 0;
  if (!shouldAffectBalance) delta = 0;
  const channel = pickStr(fundChannel, shouldAffectBalance ? 'huifu_balance' : 'wechat_pay');
  if (!ownerOpenid || !txType || !key || (!amt && !delta)) return { ok: false, code: 'INVALID_LEDGER_INPUT' };

  await ensureCollectionExists(WALLET_COLLECTION);
  await ensureCollectionExists(TRANSACTIONS_COLLECTION);

  return db.runTransaction(async (tx) => {
    const existsRes = await tx.collection(TRANSACTIONS_COLLECTION)
      .where({ _openid: ownerOpenid, bizKey: key })
      .limit(1)
      .get();
    const existsList = (existsRes && existsRes.data) || [];
    if (existsList.length) return { ok: true, existed: true };

    const walletRes = await tx.collection(WALLET_COLLECTION)
      .where({ _openid: ownerOpenid })
      .limit(1)
      .get();
    const walletList = (walletRes && walletRes.data) || [];
    const walletDoc = walletList[0] || null;
    const currentBalance = Number(walletDoc && walletDoc.balance || 0);
    const nextBalance = roundMoney(currentBalance + delta);
    const createdAt = new Date();

    if (walletDoc && walletDoc._id) {
      await tx.collection(WALLET_COLLECTION).doc(walletDoc._id).update({
        data: {
          balance: nextBalance,
          updatedAt: createdAt,
        }
      });
    } else if (shouldAffectBalance) {
      await tx.collection(WALLET_COLLECTION).add({
        data: {
          _openid: ownerOpenid,
          balance: nextBalance,
          createdAt,
          updatedAt: createdAt,
        }
      });
    }

    await tx.collection(TRANSACTIONS_COLLECTION).add({
      data: {
        _openid: ownerOpenid,
        bizKey: key,
        type: txType,
        amount: amt,
        balanceDelta: delta,
        affectsBalance: shouldAffectBalance,
        fundChannel: channel,
        balanceAfter: nextBalance,
        title: pickStr(title),
        summary: pickStr(summary),
        relatedId: pickStr(relatedId),
        extra,
        createdAt,
        updatedAt: createdAt,
      }
    });

    return { ok: true, balanceAfter: nextBalance };
  });
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

async function tryMarkTaskRefundByReq({ reqDate, reqSeqId, huifuData, rawBody }) {
  const rd = pickStr(reqDate);
  const rs = pickStr(reqSeqId);
  const orgReqDate = pickStr(huifuData && (huifuData.org_req_date || huifuData.orgReqDate));
  const orgReqSeqId = pickStr(huifuData && (huifuData.org_req_seq_id || huifuData.orgReqSeqId));
  const orgHfSeqId = pickStr(huifuData && (huifuData.org_hf_seq_id || huifuData.orgHfSeqId));

  if (!rd || !rs) return { ok: false, code: 'MISSING_REQ', msg: '缺少 req_date/req_seq_id' };

  const findOneTask = async (where) => {
    const res = await db.collection(TASK_COLLECTION).where(where).limit(2).get();
    const list = (res && res.data) || [];
    if (!list.length) return { task: null, code: 'NO_TASK_MATCH' };
    if (list.length > 1) return { task: null, code: 'MULTI_TASK_MATCH' };
    return { task: list[0], code: 'MATCHED' };
  };

  let matched = await findOneTask({
    'pay.refund.reqDate': rd,
    'pay.refund.reqSeqId': rs,
  });

  if (!matched.task && orgReqDate && orgReqSeqId) {
    matched = await findOneTask({
      'pay.reqDate': orgReqDate,
      'pay.reqSeqId': orgReqSeqId,
    });
  }

  if (!matched.task && orgHfSeqId) {
    matched = await findOneTask({
      'pay.orgHfSeqId': orgHfSeqId,
    });
  }

  if (!matched.task) {
    if (matched.code === 'MULTI_TASK_MATCH') {
      return { ok: false, code: 'MULTI_TASK_MATCH', msg: '任务退款回调匹配到多条任务，需要人工处理' };
    }
    return { ok: true, code: 'NO_TASK_REFUND_MATCH', msg: '未找到匹配的任务退款记录' };
  }

  const task = matched.task || {};
  const taskId = pickStr(task._id);
  if (!taskId) return { ok: false, code: 'TASK_ID_MISSING', msg: '任务ID缺失' };

  const refundStatus = resolveRefundStatus(huifuData);
  const now = new Date();
  const prevPay = task.pay && typeof task.pay === 'object' ? task.pay : {};
  const prevRefund = prevPay.refund && typeof prevPay.refund === 'object' ? prevPay.refund : {};
  const prevCancel = task.cancelRequest && typeof task.cancelRequest === 'object' ? task.cancelRequest : {};
  const nextRefund = {
    ...prevRefund,
    status: refundStatus,
    reqDate: rd || pickStr(prevRefund.reqDate),
    reqSeqId: rs || pickStr(prevRefund.reqSeqId),
    hfSeqId: pickStr(huifuData && (huifuData.hf_seq_id || huifuData.hfSeqId), prevRefund.hfSeqId),
    orgReqDate: orgReqDate || pickStr(prevRefund.orgReqDate),
    orgReqSeqId: orgReqSeqId || pickStr(prevRefund.orgReqSeqId),
    orgHfSeqId: orgHfSeqId || pickStr(prevRefund.orgHfSeqId),
    originalReqDate: orgReqDate || pickStr(prevRefund.originalReqDate, prevRefund.orgReqDate),
    originalReqSeqId: orgReqSeqId || pickStr(prevRefund.originalReqSeqId, prevRefund.orgReqSeqId),
    originalHfSeqId: orgHfSeqId || pickStr(prevRefund.originalHfSeqId, prevRefund.orgHfSeqId),
    transStatus: extractTransStatus(huifuData),
    respCode: extractRespCode(huifuData),
    respDesc: extractRespDesc(huifuData),
    huifuResp: huifuData,
    notifyAt: now,
  };

  let taskStatus = pickStr(task.status);
  let payStatus = pickStr(prevPay.status);
  let cancelStatus = pickStr(prevCancel.status);

  if (refundStatus === 'success') {
    taskStatus = 'cancelled';
    payStatus = 'refunded';
    if (prevCancel.requestId) cancelStatus = 'approved';
  } else if (refundStatus === 'processing') {
    taskStatus = 'cancelled';
    payStatus = 'refund_pending';
    if (prevCancel.requestId) cancelStatus = 'refund_pending';
  }

  await db.collection(TASK_COLLECTION).doc(taskId).update({
    data: {
      status: taskStatus || 'cancelled',
      cancelledAt: task.cancelledAt || now,
      updatedAt: now,
      pay: {
        ...prevPay,
        status: payStatus || pickStr(prevPay.status),
        refund: nextRefund,
      },
      ...(prevCancel.requestId ? {
        cancelRequest: {
          ...prevCancel,
          status: cancelStatus || pickStr(prevCancel.status),
          refund: nextRefund,
          approvedAt: prevCancel.approvedAt || (refundStatus !== 'failed' ? now : prevCancel.approvedAt),
        }
      } : {}),
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

  if (prevCancel.requestId && prevCancel.messageId) {
    const payload = buildTaskCancelMessagePayload(task, {
      ...prevCancel,
      status: cancelStatus || pickStr(prevCancel.status),
    }, nextRefund);
    await syncTaskCancelMessage(prevCancel.messageId, payload);
  }

  return {
    ok: true,
    code: refundStatus === 'success'
      ? 'TASK_REFUND_SUCCESS'
      : (refundStatus === 'processing' ? 'TASK_REFUND_PROCESSING' : 'TASK_REFUND_FAILED'),
    msg: `任务退款状态已更新:${taskId}`,
  };
}

async function tryMarkUserBusiByReq({ reqDate, reqSeqId, huifuData }) {
  const rd = pickStr(reqDate);
  const rs = pickStr(reqSeqId);
  if (!rd || !rs) return { ok: false, code: 'MISSING_REQ', msg: '缺少 req_date/req_seq_id' };

  const res = await db.collection(USER_COLLECTION)
    .where({
      'userBusiApply.reqDate': rd,
      'userBusiApply.reqSeqId': rs,
    })
    .limit(2)
    .get();
  const list = (res && res.data) || [];
  if (!list.length) return { ok: true, code: 'NO_USER_BUSI_MATCH', msg: '未找到匹配的用户业务入驻申请' };
  if (list.length > 1) return { ok: false, code: 'MULTI_USER_BUSI_MATCH', msg: '用户业务入驻申请匹配到多条用户' };

  const user = list[0] || {};
  const userId = pickStr(user._id);
  if (!userId) return { ok: false, code: 'USER_ID_MISSING', msg: '用户ID缺失' };

  const businessStat = pickStr(huifuData.business_stat, huifuData.businessStatus).toUpperCase();
  const businessDesc = pickStr(huifuData.business_desc, huifuData.businessDesc);
  const subRespCode = pickStr(huifuData.sub_resp_code, huifuData.resp_code);
  const subRespDesc = pickStr(huifuData.sub_resp_desc, huifuData.resp_desc);
  const huifuId = pickStr(huifuData.huifu_id, huifuData.huifuId);
  const prevApply = user.userBusiApply && typeof user.userBusiApply === 'object' ? user.userBusiApply : {};

  let status = pickStr(user.user_busi_status, prevApply.status) || 'pending';
  if (businessStat === 'S' || subRespCode === '00000000') status = 'success';
  if (businessStat === 'F' || (subRespCode && subRespCode !== '00000000')) status = 'failed';

  await db.collection(USER_COLLECTION).doc(userId).update({
    data: {
      huifu_id: huifuId || pickStr(user.huifu_id),
      user_busi_status: status,
      user_busi_fail_reason: status === 'failed' ? pickStr(businessDesc, subRespDesc) : '',
      user_busi_updated_at: new Date(),
      userBusiApply: {
        ...prevApply,
        status,
        updatedAt: new Date(),
        respCode: subRespCode || pickStr(prevApply.respCode),
        respDesc: subRespDesc || pickStr(prevApply.respDesc),
        businessStat,
        businessDesc,
        huifuResp: huifuData,
        lastError: status === 'failed' ? pickStr(businessDesc, subRespDesc) : '',
      }
    }
  });

  return { ok: true, code: 'USER_BUSI_UPDATED', msg: `用户业务入驻状态已更新:${userId}` };
}

async function tryMarkUserWithdrawCardByReq({ reqDate, reqSeqId, huifuData }) {
  const rd = pickStr(reqDate);
  const rs = pickStr(reqSeqId);
  if (!rd || !rs) return { ok: false, code: 'MISSING_REQ', msg: '缺少 req_date/req_seq_id' };

  const res = await db.collection(USER_COLLECTION)
    .where({
      'withdrawCard.reqDate': rd,
      'withdrawCard.reqSeqId': rs,
    })
    .limit(2)
    .get();
  const list = (res && res.data) || [];
  if (!list.length) return { ok: true, code: 'NO_WITHDRAW_CARD_MATCH', msg: '未找到匹配的提现绑卡申请' };
  if (list.length > 1) return { ok: false, code: 'MULTI_WITHDRAW_CARD_MATCH', msg: '提现绑卡申请匹配到多条用户' };

  const user = list[0] || {};
  const userId = pickStr(user._id);
  if (!userId) return { ok: false, code: 'USER_ID_MISSING', msg: '用户ID缺失' };

  const withdrawCard = user.withdrawCard && typeof user.withdrawCard === 'object' ? user.withdrawCard : {};
  const auditInfo = safeJsonParse(huifuData.audit_info) || (huifuData.audit_info && typeof huifuData.audit_info === 'object' ? huifuData.audit_info : {}) || {};
  const auditStatus = pickStr(auditInfo.audit_status, auditInfo.auditStatus).toUpperCase();
  const auditDesc = pickStr(auditInfo.audit_desc, auditInfo.auditDesc, huifuData.state_desc, huifuData.sub_resp_desc, huifuData.resp_desc);
  const tokenNo = pickStr(auditInfo.token_no, auditInfo.tokenNo, huifuData.token_no, huifuData.tokenNo);
  const applyNo = pickStr(auditInfo.apply_no, auditInfo.applyNo, withdrawCard.applyNo);

  let status = pickStr(withdrawCard.status) || 'pending';
  if (tokenNo || auditStatus === 'Y') status = 'success';
  if (auditStatus === 'P') status = 'pending';
  if (auditStatus === 'N' || auditStatus === 'F') status = 'failed';

  await db.collection(USER_COLLECTION).doc(userId).update({
    data: {
      withdrawCard: {
        ...withdrawCard,
        status,
        tokenNo: tokenNo || pickStr(withdrawCard.tokenNo),
        applyNo,
        lastError: status === 'failed' ? auditDesc : '',
        auditStatus,
        auditDesc,
        updatedAt: new Date(),
      },
      updatedAt: new Date(),
    }
  });

  return { ok: true, code: 'WITHDRAW_CARD_UPDATED', msg: `提现绑卡状态已更新:${userId}` };
}

async function tryMarkWithdrawByReq({ reqDate, reqSeqId, huifuData }) {
  const rd = pickStr(reqDate);
  const rs = pickStr(reqSeqId);
  if (!rd || !rs) return { ok: false, code: 'MISSING_REQ', msg: '缺少 req_date/req_seq_id' };

  const res = await db.collection(WITHDRAW_COLLECTION)
    .where({ reqDate: rd, reqSeqId: rs })
    .limit(2)
    .get();
  const list = (res && res.data) || [];
  if (!list.length) return { ok: true, code: 'NO_WITHDRAW_MATCH', msg: '未找到匹配的提现申请' };
  if (list.length > 1) return { ok: false, code: 'MULTI_WITHDRAW_MATCH', msg: '提现申请匹配到多条记录' };

  const reqDoc = list[0] || {};
  const docId = pickStr(reqDoc._id);
  if (!docId) return { ok: false, code: 'WITHDRAW_ID_MISSING', msg: '提现申请ID缺失' };

  const subRespCode = pickStr(huifuData.sub_resp_code, huifuData.resp_code);
  const subRespDesc = pickStr(huifuData.sub_resp_desc, huifuData.resp_desc);
  const transStatus = pickStr(huifuData.trans_status, huifuData.trans_stat, huifuData.transStat).toUpperCase();
  const acctStatus = pickStr(huifuData.acct_status, huifuData.acctStatus).toUpperCase();
  const channelStatus = pickStr(huifuData.channel_status, huifuData.channelStatus).toUpperCase();
  const feeAmt = roundMoney(Number(huifuData.fee_amt || 0));
  const cashAmt = roundMoney(Number(huifuData.cash_amt || reqDoc.amount || 0));

  let status = pickStr(reqDoc.status) || 'processing';
  let statusText = pickStr(reqDoc.statusText) || '处理中';
  const isProcessing = transStatus === 'P' || acctStatus === 'P' || channelStatus === 'P';
  const isSuccess = subRespCode === '00000000' && (transStatus === 'S' || acctStatus === 'S' || channelStatus === 'S');
  const isFailed = (subRespCode && subRespCode !== '00000000')
    || transStatus === 'F'
    || acctStatus === 'F'
    || acctStatus === 'B'
    || channelStatus === 'F';

  if (isSuccess) {
    status = 'success';
    statusText = '成功';
  } else if (isProcessing) {
    status = 'processing';
    statusText = '处理中';
  } else if (isFailed) {
    status = 'failed';
    statusText = acctStatus === 'B' ? '已退回' : '失败';
  }

  let ledgerReverted = !!reqDoc.ledgerReverted;
  let feeLedgerWritten = !!reqDoc.feeLedgerWritten;
  const relatedId = `${rd}_${rs}`;

  if (isSuccess && feeAmt > 0 && !feeLedgerWritten) {
    const feeRes = await recordWalletTransaction({
      openid: pickStr(reqDoc._openid),
      amount: -feeAmt,
      type: 'withdraw_fee',
      bizKey: `withdraw_fee:${rd}:${rs}`,
      title: '提现手续费',
      summary: `提现手续费 ¥${formatMoney(feeAmt)}`,
      relatedId,
      extra: { reqDate: rd, reqSeqId: rs }
    });
    feeLedgerWritten = !!(feeRes && feeRes.ok);
  }

  if (isFailed && !ledgerReverted) {
    const refundAmount = roundMoney(Number(reqDoc.amount || cashAmt || 0));
    if (refundAmount > 0) {
      const refundRes = await recordWalletTransaction({
        openid: pickStr(reqDoc._openid),
        amount: refundAmount,
        type: 'withdraw_refund',
        bizKey: `withdraw_refund:${rd}:${rs}`,
        title: '提现退回',
        summary: `提现退回 ¥${formatMoney(refundAmount)}${subRespDesc ? `，原因：${subRespDesc}` : ''}`,
        relatedId,
        extra: { reqDate: rd, reqSeqId: rs }
      });
      ledgerReverted = !!(refundRes && refundRes.ok);
    }
  }

  await db.collection(WITHDRAW_COLLECTION).doc(docId).update({
    data: {
      status,
      statusText,
      transStatus,
      acctStatus,
      channelStatus,
      feeAmt,
      cashAmt,
      lastRespCode: subRespCode || pickStr(reqDoc.lastRespCode),
      lastRespDesc: subRespDesc || pickStr(reqDoc.lastRespDesc),
      ledgerReverted,
      feeLedgerWritten,
      updatedAt: new Date(),
      rawRespBrief: (() => {
        try {
          const s = JSON.stringify(huifuData || {});
          return s.length <= 1200 ? s : `${s.slice(0, 1200)}...`;
        } catch (e) {
          return '';
        }
      })(),
    }
  });

  return { ok: true, code: 'WITHDRAW_UPDATED', msg: `提现状态已更新:${docId}` };
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

  // 3) 取出 data / resp_data + sign
  const top = bodyObj || {};
  const parsedData = (top && typeof top === 'object' && top.data && typeof top.data === 'object')
    ? top.data
    : (top && top.data ? safeJsonParse(top.data) : null);
  const parsedRespData = (top && typeof top === 'object' && top.resp_data && typeof top.resp_data === 'object')
    ? top.resp_data
    : (top && top.resp_data ? safeJsonParse(top.resp_data) : null);
  const data = parsedData || parsedRespData || top;
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

  const verifyMessages = [];
  if (parsedData && typeof parsedData === 'object') {
    verifyMessages.push(buildSortedJsonStringForSign(parsedData));
  }
  if (parsedRespData && typeof parsedRespData === 'object') {
    verifyMessages.push(buildSortedJsonStringForSign(parsedRespData));
  }
  verifyMessages.push(buildTopLevelMessageForSign(top));

  const pass = verifyMessages.some((message) => {
    try {
      return !!message && rsaSha256VerifyBase64({ message, signBase64: sign, publicKeyPem: pubKey });
    } catch (e) {
      return false;
    }
  });
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

  if (reqDate && reqSeqId) {
    try {
      const taskRefund = await tryMarkTaskRefundByReq({ reqDate, reqSeqId, huifuData: data, rawBody: top });
      if (taskRefund && taskRefund.code !== 'NO_TASK_REFUND_MATCH') handled = taskRefund;
    } catch (e) {
      console.error('[huifuPayNotify] mark task refund failed', e);
    }
  }

  if (reqDate && reqSeqId) {
    try {
      const userBusi = await tryMarkUserBusiByReq({ reqDate, reqSeqId, huifuData: data });
      if (userBusi && userBusi.code !== 'NO_USER_BUSI_MATCH') handled = userBusi;
    } catch (e) {
      console.error('[huifuPayNotify] mark user busi failed', e);
    }
  }

  if (reqDate && reqSeqId) {
    try {
      const withdrawCard = await tryMarkUserWithdrawCardByReq({ reqDate, reqSeqId, huifuData: data });
      if (withdrawCard && withdrawCard.code !== 'NO_WITHDRAW_CARD_MATCH') handled = withdrawCard;
    } catch (e) {
      console.error('[huifuPayNotify] mark withdraw card failed', e);
    }
  }

  if (reqDate && reqSeqId) {
    try {
      const withdraw = await tryMarkWithdrawByReq({ reqDate, reqSeqId, huifuData: data });
      if (withdraw && withdraw.code !== 'NO_WITHDRAW_MATCH') handled = withdraw;
    } catch (e) {
      console.error('[huifuPayNotify] mark withdraw failed', e);
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
