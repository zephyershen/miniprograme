const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TASK_COLLECTION = 'tasks';
const MSG_COLLECTION = 'messages';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function isSystemCompensateCall(event = {}) {
  const token = pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);
  return !!(
    event
    && event.systemCompensate === true
    && token
    && pickStr(event.compensateToken) === token
  );
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toWalletDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function getPrimaryWalletId(openid) {
  return pickStr(openid);
}

function isLegacyShadowWallet(wallet = {}) {
  const role = pickStr(wallet && wallet.walletRole).toLowerCase();
  return role === 'legacy_shadow' || !!pickStr(wallet && wallet.shadowOf);
}

function sumWalletAmount(walletDocs = [], field = 'balance') {
  return roundMoney((Array.isArray(walletDocs) ? walletDocs : []).reduce((sum, item) => (
    sum + Number(item && item[field] ? item[field] : 0)
  ), 0));
}

function pickWalletBoundaryDate(walletDocs = [], field = 'updatedAt', mode = 'max', fallback = new Date()) {
  const list = Array.isArray(walletDocs) ? walletDocs : [];
  let chosen = fallback;
  let chosenMs = toWalletDateMs(fallback);
  for (const item of list) {
    const value = item && item[field];
    const ms = toWalletDateMs(value);
    if (!ms) continue;
    if (!chosenMs) {
      chosen = value;
      chosenMs = ms;
      continue;
    }
    if (mode === 'min' ? ms < chosenMs : ms > chosenMs) {
      chosen = value;
      chosenMs = ms;
    }
  }
  return chosen || fallback;
}

function buildPrimaryWalletSnapshot(openid, walletDocs = [], now = new Date()) {
  const ownerOpenid = pickStr(openid);
  const docs = (Array.isArray(walletDocs) ? walletDocs : []).filter((item) => item && pickStr(item._openid) === ownerOpenid);
  const primaryId = getPrimaryWalletId(ownerOpenid);
  const primaryDoc = docs.find((item) => pickStr(item._id) === primaryId) || null;
  const mergeDocs = docs.filter((item) => item && (pickStr(item._id) === primaryId || !isLegacyShadowWallet(item)));
  const legacyDocs = docs.filter((item) => pickStr(item._id) && pickStr(item._id) !== primaryId);
  const aggregateDocs = mergeDocs.length ? mergeDocs : docs;
  return {
    _openid: ownerOpenid,
    balance: sumWalletAmount(aggregateDocs, 'balance'),
    incomeTotal: sumWalletAmount(aggregateDocs, 'incomeTotal'),
    expenseTotal: sumWalletAmount(aggregateDocs, 'expenseTotal'),
    createdAt: primaryDoc && primaryDoc.createdAt
      ? primaryDoc.createdAt
      : pickWalletBoundaryDate(docs, 'createdAt', 'min', now),
    updatedAt: now,
    walletRole: 'primary',
    isPrimary: true,
    shadowedWalletIds: legacyDocs.map((item) => pickStr(item._id)).filter(Boolean),
    ...(legacyDocs.length ? { mergedAt: now } : {}),
  };
}

async function markLegacyWalletDocs(tx, legacyDocs = [], primaryId = '', now = new Date()) {
  for (const item of Array.isArray(legacyDocs) ? legacyDocs : []) {
    const legacyId = pickStr(item && item._id);
    if (!legacyId || legacyId === primaryId) continue;
    await tx.collection(WALLET_COLLECTION).doc(legacyId).update({
      data: {
        walletRole: 'legacy_shadow',
        isPrimary: false,
        shadowOf: primaryId,
        shadowedAt: now,
        updatedAt: now,
      }
    });
  }
}

async function ensurePrimaryWalletDoc(tx, openid, now = new Date()) {
  const ownerOpenid = pickStr(openid);
  const primaryId = getPrimaryWalletId(ownerOpenid);
  if (!ownerOpenid || !primaryId) return { walletId: '', wallet: null, legacyDocs: [] };

  const walletRes = await tx.collection(WALLET_COLLECTION)
    .where({ _openid: ownerOpenid })
    .limit(20)
    .get();
  const walletDocs = (walletRes && walletRes.data) || [];
  if (!walletDocs.length) return { walletId: primaryId, wallet: null, legacyDocs: [] };

  const primaryDoc = walletDocs.find((item) => pickStr(item._id) === primaryId) || null;
  const legacyDocs = walletDocs.filter((item) => pickStr(item._id) && pickStr(item._id) !== primaryId);
  const actionableLegacyDocs = legacyDocs.filter((item) => !isLegacyShadowWallet(item) || pickStr(item.shadowOf) !== primaryId);
  if (!primaryDoc || actionableLegacyDocs.length) {
    const snapshot = buildPrimaryWalletSnapshot(ownerOpenid, walletDocs, now);
    if (primaryDoc && primaryDoc._id) {
      await tx.collection(WALLET_COLLECTION).doc(primaryId).update({
        data: {
          balance: snapshot.balance,
          incomeTotal: snapshot.incomeTotal,
          expenseTotal: snapshot.expenseTotal,
          createdAt: snapshot.createdAt,
          updatedAt: now,
          walletRole: 'primary',
          isPrimary: true,
          shadowedWalletIds: snapshot.shadowedWalletIds,
          mergedAt: snapshot.mergedAt || now,
        }
      });
    } else {
      await tx.collection(WALLET_COLLECTION).doc(primaryId).set({ data: snapshot });
    }
    await markLegacyWalletDocs(tx, legacyDocs, primaryId, now);
    return { walletId: primaryId, wallet: { ...(primaryDoc || {}), ...snapshot, _id: primaryId }, legacyDocs };
  }
  return { walletId: primaryId, wallet: primaryDoc, legacyDocs };
}

function randomId(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function yyyymmdd(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatDateTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function cutText(text = '', max = 20) {
  const normalized = pickStr(text).replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function getSubscribeConfig() {
  return {
    templateId: pickStr(process.env.SUBSCRIBE_CHAT_TEMPLATE_ID),
    thingKey: pickStr(process.env.SUBSCRIBE_CHAT_THING_KEY, 'thing1'),
    nameKey: pickStr(process.env.SUBSCRIBE_CHAT_NAME_KEY, 'name2'),
    timeKey: pickStr(process.env.SUBSCRIBE_CHAT_TIME_KEY, 'time3'),
    miniprogramState: pickStr(process.env.MINIPROGRAM_STATE, 'formal'),
  };
}

async function sendSubscribeMessage({ touser = '', senderName = '', preview = '', page = '' }) {
  const targetOpenid = pickStr(touser);
  const cfg = getSubscribeConfig();
  if (!targetOpenid || !cfg.templateId) return;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: targetOpenid,
      templateId: cfg.templateId,
      page: pickStr(page),
      lang: 'zh_CN',
      miniprogramState: cfg.miniprogramState,
      data: {
        [cfg.thingKey]: { value: cutText(preview, 20) || '你收到一条新消息' },
        [cfg.nameKey]: { value: cutText(senderName, 10) || '邻里用户' },
        [cfg.timeKey]: { value: formatDateTime(new Date()) },
      }
    });
  } catch (err) {
    console.warn('[taskCancelFlow] subscribe send failed', err);
  }
}

function extractRespCode(huifuResp = {}) {
  return pickStr(
    huifuResp.sub_resp_code,
    huifuResp.resp_code,
    huifuResp.return_code,
    huifuResp.code,
    huifuResp.respCode
  );
}

function extractRespDesc(huifuResp = {}) {
  return pickStr(
    huifuResp.sub_resp_desc,
    huifuResp.resp_desc,
    huifuResp.resp_msg,
    huifuResp.return_msg,
    huifuResp.message,
    huifuResp.respDesc
  );
}

function isAlreadyRefundedDesc(desc = '') {
  const text = pickStr(desc);
  return text.includes('申请退款金额大于可退款余额');
}

function extractTransStatus(huifuResp = {}) {
  return pickStr(
    huifuResp.trans_status,
    huifuResp.trans_stat,
    huifuResp.transStat
  ).toUpperCase();
}

function resolveRefundStatus(huifuResp = {}) {
  const code = extractRespCode(huifuResp);
  const transStatus = extractTransStatus(huifuResp);
  const isBizSuccess = !code || code === '00000000' || code === '00000100';
  if (!isBizSuccess) return 'failed';
  if (transStatus === 'S') return 'success';
  if (transStatus === 'F' || transStatus === 'B') return 'failed';
  if (transStatus === 'P') return 'processing';
  return 'processing';
}

async function getTaskById(taskId) {
  const res = await db.collection(TASK_COLLECTION).doc(taskId).get();
  return (res && res.data) || null;
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
  counterpartOpenid,
  affectsBalance,
  fundChannel,
  createdAt = new Date(),
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

  return db.runTransaction(async (tx) => {
    const existsRes = await tx.collection(TRANSACTIONS_COLLECTION)
      .where({ _openid: ownerOpenid, bizKey: key })
      .limit(1)
      .get();
    const existsList = (existsRes && existsRes.data) || [];
    if (existsList.length) return { ok: true, duplicated: true };

    const walletState = await ensurePrimaryWalletDoc(tx, ownerOpenid, createdAt);
    const wallet = walletState && walletState.wallet ? walletState.wallet : null;
    const walletId = pickStr(walletState && walletState.walletId);
    const currentBalance = roundMoney(wallet && wallet.balance);
    const nextBalance = roundMoney(currentBalance + delta);
    const incomeDelta = delta > 0 ? delta : 0;
    const expenseDelta = delta < 0 ? Math.abs(delta) : 0;

    if (walletId && wallet) {
      await tx.collection(WALLET_COLLECTION).doc(walletId).update({
        data: {
          balance: nextBalance,
          incomeTotal: roundMoney(Number(wallet.incomeTotal || 0) + incomeDelta),
          expenseTotal: roundMoney(Number(wallet.expenseTotal || 0) + expenseDelta),
          walletRole: 'primary',
          isPrimary: true,
          updatedAt: createdAt,
        }
      });
    } else if (shouldAffectBalance) {
      await tx.collection(WALLET_COLLECTION).doc(walletId || getPrimaryWalletId(ownerOpenid)).set({
        data: {
          _openid: ownerOpenid,
          balance: nextBalance,
          incomeTotal: incomeDelta,
          expenseTotal: expenseDelta,
          createdAt,
          updatedAt: createdAt,
          walletRole: 'primary',
          isPrimary: true,
          shadowedWalletIds: [],
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
        counterpartOpenid: pickStr(counterpartOpenid),
        createdAt,
        updatedAt: createdAt,
      }
    });

    return { ok: true, balanceAfter: nextBalance };
  });
}

function buildCancelMessagePayload({ task = {}, requestId = '', status = 'pending', requesterName = '', approvedByName = '', refund = {} }) {
  return {
    requestId,
    status,
    taskTitle: pickStr(task.title, task.desc, '任务'),
    amount: roundMoney(task.amount),
    requesterName: pickStr(requesterName),
    approverUserId: pickStr(task.workerId),
    approvedByName: pickStr(approvedByName),
    refundStatus: pickStr(refund.status),
    refundDesc: pickStr(refund.respDesc),
  };
}

async function addCancelRequestMessage({ task, requestId, requesterName, now }) {
  const payload = buildCancelMessagePayload({
    task,
    requestId,
    status: 'pending',
    requesterName,
  });
  const res = await db.collection(MSG_COLLECTION).add({
    data: {
      tid: pickStr(task._id),
      ownerId: pickStr(task.ownerId),
      peerUserId: pickStr(task.workerId),
      fromUserId: pickStr(task.ownerId),
      fromNickname: requesterName,
      type: 'task_cancel_request',
      taskCancel: payload,
      text: '',
      imageUrl: '',
      createTime: now,
      readByOwner: true,
      readByPeer: false,
    }
  });
  return pickStr(res && res._id);
}

async function syncCancelRequestMessage(messageId, payload) {
  const msgId = pickStr(messageId);
  if (!msgId) return;
  await db.collection(MSG_COLLECTION).doc(msgId).update({
    data: {
      taskCancel: payload,
      updatedAt: new Date(),
    }
  });
}

async function callRefund({ task, refundDesc, reqDate = '', reqSeqId = '' }) {
  const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
  const orgReqDate = pickStr(pay.reqDate);
  const orgReqSeqId = pickStr(pay.reqSeqId);
  const orgHfSeqId = pickStr(pay.orgHfSeqId);
  if (!orgReqDate || (!orgReqSeqId && !orgHfSeqId)) {
    return { ok: false, err: { code: 'MISSING_ORG_TRADE', msg: '缺少原支付交易信息，无法退款' } };
  }

  const refundRes = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: {
      action: 'scanpay_refund',
      ordAmtYuan: Number(task.amount || 0),
      reqDate: pickStr(reqDate),
      reqSeqId: pickStr(reqSeqId),
      orgReqDate,
      orgReqSeqId,
      orgHfSeqId,
      refundDesc: pickStr(refundDesc, `任务取消退款:${pickStr(task._id)}`),
    }
  });

  const ret = refundRes && refundRes.result ? refundRes.result : null;
  if (!ret || !ret.ok) {
    const err = ret && ret.err
      ? (typeof ret.err === 'string' ? { code: 'REFUND_FAILED', msg: ret.err } : ret.err)
      : { code: 'REFUND_FAILED', msg: '退款接口调用失败' };
    return { ok: false, err };
  }

  const huifuResp = ret.huifuResp || {};
  const refundStatus = resolveRefundStatus(huifuResp);
  if (refundStatus === 'failed') {
    const respDesc = extractRespDesc(huifuResp);
    if (isAlreadyRefundedDesc(respDesc)) {
      return {
        ok: true,
        refund: {
          status: 'success',
          reqDate: pickStr(ret.reqDate),
          reqSeqId: pickStr(ret.reqSeqId),
          transStatus: extractTransStatus(huifuResp),
          respCode: extractRespCode(huifuResp),
          respDesc,
          inferredSuccess: true,
          huifuResp,
        }
      };
    }
    return {
      ok: false,
      err: {
        code: extractRespCode(huifuResp) || 'HUIFU_BIZ_ERROR',
        msg: respDesc || '退款失败',
        huifuResp,
      }
    };
  }

  return {
    ok: true,
    refund: {
      status: refundStatus,
      reqDate: pickStr(ret.reqDate),
      reqSeqId: pickStr(ret.reqSeqId),
      hfSeqId: pickStr(huifuResp.hf_seq_id, huifuResp.hfSeqId),
      orgReqDate,
      orgReqSeqId,
      orgHfSeqId,
      originalReqDate: orgReqDate,
      originalReqSeqId: orgReqSeqId,
      originalHfSeqId: orgHfSeqId,
      transStatus: extractTransStatus(huifuResp),
      respCode: extractRespCode(huifuResp),
      respDesc: extractRespDesc(huifuResp),
      huifuResp,
    }
  };
}

function buildPendingRefundMeta(task = {}, now = new Date()) {
  const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
  const reqDate = yyyymmdd(now);
  return {
    reqDate,
    reqSeqId: `RF${reqDate}${randomId(20)}`,
    orgReqDate: pickStr(pay.reqDate),
    orgReqSeqId: pickStr(pay.reqSeqId),
    orgHfSeqId: pickStr(pay.orgHfSeqId),
    originalReqDate: pickStr(pay.reqDate),
    originalReqSeqId: pickStr(pay.reqSeqId),
    originalHfSeqId: pickStr(pay.orgHfSeqId),
    status: 'requested',
  };
}

async function prepareTaskRefundTransition({ taskId = '', action = '', openid = '', requestId = '', now = new Date() }) {
  const normalizedTaskId = pickStr(taskId);
  const normalizedAction = pickStr(action);
  const normalizedOpenid = pickStr(openid);
  const normalizedRequestId = pickStr(requestId);
  if (!normalizedTaskId || !normalizedAction || !normalizedOpenid) {
    return { ok: false, code: 'MISSING_PARAM', msg: '缺少退款预处理参数' };
  }

  return db.runTransaction(async (tx) => {
    const docRes = await tx.collection(TASK_COLLECTION).doc(normalizedTaskId).get();
    const task = docRes && docRes.data ? docRes.data : null;
    if (!task) return { ok: false, code: 'TASK_NOT_FOUND', msg: '任务不存在' };

    const taskStatus = pickStr(task.status);
    const ownerOpenid = pickStr(task._openid);
    const workerOpenid = pickStr(task.workerOpenid, task.worker_openid);
    const workerId = pickStr(task.workerId);
    const ownerId = pickStr(task.ownerId);
    const requesterName = pickStr(task.ownerNickname, task.ownerName, '发布者');
    const approvedByName = pickStr(task.workerNickname, task.workerName, '接单人');
    const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
    const payStatus = pickStr(pay.status);
    const currentCancel = task.cancelRequest && typeof task.cancelRequest === 'object' ? task.cancelRequest : {};
    const mergedExistingRefund = {
      ...((currentCancel.refund && typeof currentCancel.refund === 'object') ? currentCancel.refund : {}),
      ...((pay.refund && typeof pay.refund === 'object') ? pay.refund : {}),
    };
    const hasPreparedRefund = !!(pickStr(mergedExistingRefund.reqDate) && pickStr(mergedExistingRefund.reqSeqId));

    if (normalizedAction === 'approve') {
      if (normalizedOpenid !== workerOpenid) {
        return { ok: false, code: 'NOT_WORKER', msg: '只有接单人可以同意取消' };
      }
      if (taskStatus === 'cancelled' && (payStatus === 'refunded' || payStatus === 'refund_pending')) {
        return { ok: true, already: true, task, payStatus, refund: mergedExistingRefund, currentCancel, requesterName, approvedByName };
      }
      if (taskStatus !== 'accepted' && taskStatus !== 'submitted') {
        return { ok: false, code: 'INVALID_STATUS', msg: '当前任务状态不支持取消退款', status: taskStatus };
      }
      if (pickStr(currentCancel.requestId) !== normalizedRequestId || pickStr(currentCancel.status) !== 'pending') {
        return { ok: false, code: 'INVALID_CANCEL_REQUEST', msg: '取消申请不存在或已处理' };
      }

      const pendingRefund = hasPreparedRefund
        ? { ...mergedExistingRefund, status: pickStr(mergedExistingRefund.status, 'requested') }
        : buildPendingRefundMeta(task, now);
      const nextCancel = {
        ...(currentCancel || {}),
        status: 'refund_pending',
        approvedAt: now,
        approvedByOpenid: normalizedOpenid,
        approvedByUserId: workerId,
        approvedByName,
        refund: {
          ...((currentCancel.refund && typeof currentCancel.refund === 'object') ? currentCancel.refund : {}),
          ...pendingRefund,
        },
      };
      const nextPay = {
        ...(pay || {}),
        status: 'refund_pending',
        refund: {
          ...((pay.refund && typeof pay.refund === 'object') ? pay.refund : {}),
          ...pendingRefund,
        },
      };

      await tx.collection(TASK_COLLECTION).doc(normalizedTaskId).update({
        data: {
          status: 'cancelled',
          cancelledAt: task.cancelledAt || now,
          updatedAt: now,
          cancelRequest: nextCancel,
          pay: nextPay,
        }
      });

      return {
        ok: true,
        shouldCall: true,
        task,
        taskStatus,
        pay,
        payStatus,
        currentCancel,
        nextCancel,
        nextPay,
        pendingRefund,
        requesterName,
        approvedByName,
        ownerOpenid,
        workerOpenid,
        workerId,
      };
    }

    if (normalizedAction === 'cancel_direct') {
      if (normalizedOpenid !== ownerOpenid) {
        return { ok: false, code: 'NOT_OWNER', msg: '只有发布者可以取消任务' };
      }
      if (taskStatus === 'cancelled' && (payStatus === 'refunded' || payStatus === 'refund_pending')) {
        return { ok: true, already: true, task, payStatus, refund: mergedExistingRefund, ownerOpenid };
      }
      if (taskStatus !== 'posted') {
        return { ok: false, code: 'INVALID_STATUS', msg: '当前任务状态不支持直接取消退款', status: taskStatus };
      }
      if (workerOpenid || workerId) {
        return { ok: false, code: 'TASK_ALREADY_ACCEPTED', msg: '任务已被接单，请先在聊天中发起取消申请' };
      }

      const pendingRefund = hasPreparedRefund
        ? { ...mergedExistingRefund, status: pickStr(mergedExistingRefund.status, 'requested') }
        : buildPendingRefundMeta(task, now);
      const nextPay = {
        ...(pay || {}),
        status: 'refund_pending',
        refund: {
          ...((pay.refund && typeof pay.refund === 'object') ? pay.refund : {}),
          ...pendingRefund,
        },
      };

      await tx.collection(TASK_COLLECTION).doc(normalizedTaskId).update({
        data: {
          status: 'cancelled',
          cancelledAt: task.cancelledAt || now,
          updatedAt: now,
          pay: nextPay,
        }
      });

      return {
        ok: true,
        shouldCall: true,
        task,
        taskStatus,
        pay,
        payStatus,
        pendingRefund,
        nextPay,
        ownerOpenid,
      };
    }

    return { ok: false, code: 'UNSUPPORTED_ACTION', msg: '不支持的退款预处理动作' };
  });
}

function buildPendingCancelRequest(cancelRequest = {}, extra = {}) {
  const base = cancelRequest && typeof cancelRequest === 'object'
    ? { ...cancelRequest }
    : {};
  delete base.approvedAt;
  delete base.approvedByOpenid;
  delete base.approvedByUserId;
  delete base.approvedByName;
  return {
    ...base,
    status: 'pending',
    ...extra,
  };
}

function normalizeRefundErr(err = {}) {
  const raw = err && typeof err === 'object' ? err : { msg: pickStr(err) };
  return {
    code: pickStr(raw.code),
    msg: pickStr(raw.msg, raw.message),
    huifuResp: raw.huifuResp && typeof raw.huifuResp === 'object' ? raw.huifuResp : {},
  };
}

function shouldKeepRefundPending(err = {}) {
  const normalized = normalizeRefundErr(err);
  const code = pickStr(normalized.code).toUpperCase();
  const msg = pickStr(normalized.msg);
  const respCode = pickStr(extractRespCode(normalized.huifuResp)).toUpperCase();
  const transStatus = pickStr(extractTransStatus(normalized.huifuResp)).toUpperCase();

  if (isAlreadyRefundedDesc(msg)) return true;
  if (['MISSING_ORG_TRADE', 'INVALID_ORD_AMT', 'MISSING_PARAM', 'HUIFU_BIZ_ERROR'].includes(code)) return false;
  if (respCode && respCode !== '00000000' && respCode !== '00000100') return false;
  if (transStatus === 'F' || transStatus === 'FAIL' || transStatus === 'FAILED' || transStatus === 'B') return false;
  if (msg.includes('缺少原支付交易信息') || msg.includes('退款金额不合法')) return false;
  return true;
}

function buildProcessingRefundMeta(refund = {}, err = {}, now = new Date()) {
  const base = refund && typeof refund === 'object' ? { ...refund } : {};
  const normalized = normalizeRefundErr(err);
  const huifuResp = normalized.huifuResp || {};
  const respCode = pickStr(extractRespCode(huifuResp), normalized.code);
  const respDesc = pickStr(extractRespDesc(huifuResp), normalized.msg);
  const hfSeqId = pickStr(base.hfSeqId, huifuResp.hf_seq_id, huifuResp.hfSeqId);
  return {
    ...base,
    ...(hfSeqId ? { hfSeqId } : {}),
    status: 'processing',
    respCode,
    respDesc,
    uncertainAt: now,
    ...(Object.keys(huifuResp).length ? { huifuResp } : {}),
  };
}

function buildRefundQueryMeta(task = {}) {
  const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
  const refund = pay.refund && typeof pay.refund === 'object'
    ? pay.refund
    : (((task.cancelRequest && task.cancelRequest.refund) && typeof task.cancelRequest.refund === 'object')
      ? task.cancelRequest.refund
      : {});
  const refundHuifuResp = refund.huifuResp && typeof refund.huifuResp === 'object' ? refund.huifuResp : {};
  return {
    refundReqDate: pickStr(refund.reqDate, refundHuifuResp.req_date, refundHuifuResp.reqDate, refundHuifuResp.org_req_date, refundHuifuResp.orgReqDate),
    refundReqSeqId: pickStr(refund.reqSeqId, refundHuifuResp.req_seq_id, refundHuifuResp.reqSeqId, refundHuifuResp.org_req_seq_id, refundHuifuResp.orgReqSeqId),
    refundHfSeqId: pickStr(refund.hfSeqId, refundHuifuResp.hf_seq_id, refundHuifuResp.hfSeqId, refundHuifuResp.org_hf_seq_id, refundHuifuResp.orgHfSeqId),
    originalReqDate: pickStr(refund.originalReqDate, refund.orgReqDate, pay.reqDate),
    originalReqSeqId: pickStr(refund.originalReqSeqId, refund.orgReqSeqId, pay.reqSeqId),
    originalHfSeqId: pickStr(refund.originalHfSeqId, refund.orgHfSeqId, pay.orgHfSeqId),
  };
}

function buildResolvedRefundMeta(task = {}, huifuResp = {}, status = '', now = new Date()) {
  const queryMeta = buildRefundQueryMeta(task);
  const existingRefund = ((task.pay && task.pay.refund) && typeof task.pay.refund === 'object')
    ? task.pay.refund
    : (((task.cancelRequest && task.cancelRequest.refund) && typeof task.cancelRequest.refund === 'object')
      ? task.cancelRequest.refund
      : {});
  const refundReqDate = pickStr(huifuResp.org_req_date, huifuResp.orgReqDate, queryMeta.refundReqDate, existingRefund.reqDate);
  const refundReqSeqId = pickStr(huifuResp.org_req_seq_id, huifuResp.orgReqSeqId, queryMeta.refundReqSeqId, existingRefund.reqSeqId);
  const refundHfSeqId = pickStr(
    huifuResp.org_hf_seq_id,
    huifuResp.orgHfSeqId,
    huifuResp.hf_seq_id,
    huifuResp.hfSeqId,
    queryMeta.refundHfSeqId,
    existingRefund.hfSeqId
  );
  return {
    ...existingRefund,
    reqDate: refundReqDate,
    reqSeqId: refundReqSeqId,
    ...(refundHfSeqId ? { hfSeqId: refundHfSeqId } : {}),
    originalReqDate: queryMeta.originalReqDate,
    originalReqSeqId: queryMeta.originalReqSeqId,
    originalHfSeqId: queryMeta.originalHfSeqId,
    orgReqDate: queryMeta.originalReqDate,
    orgReqSeqId: queryMeta.originalReqSeqId,
    orgHfSeqId: queryMeta.originalHfSeqId,
    status,
    transStatus: extractTransStatus(huifuResp),
    respCode: extractRespCode(huifuResp),
    respDesc: extractRespDesc(huifuResp),
    huifuResp,
    queriedAt: now,
  };
}

async function applyRefundStateToTask({ taskId = '', task = {}, refund = {}, now = new Date() }) {
  const normalizedTaskId = pickStr(taskId, task && task._id);
  if (!normalizedTaskId) return { ok: false, code: 'MISSING_TASK_ID' };

  const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
  const currentCancel = task.cancelRequest && typeof task.cancelRequest === 'object' ? task.cancelRequest : {};
  const refundStatus = pickStr(refund.status);
  let nextTaskStatus = pickStr(task.status);
  let nextPayStatus = pickStr(pay.status);
  let nextCancelStatus = pickStr(currentCancel.status);

  if (refundStatus === 'success') {
    nextTaskStatus = 'cancelled';
    nextPayStatus = 'refunded';
    if (currentCancel.requestId) nextCancelStatus = 'approved';
  } else if (refundStatus === 'processing') {
    nextTaskStatus = 'cancelled';
    nextPayStatus = 'refund_pending';
    if (currentCancel.requestId) nextCancelStatus = 'refund_pending';
  }

  await db.collection(TASK_COLLECTION).doc(normalizedTaskId).update({
    data: {
      status: nextTaskStatus || pickStr(task.status),
      cancelledAt: task.cancelledAt || (refundStatus === 'success' || refundStatus === 'processing' ? now : null),
      updatedAt: now,
      pay: {
        ...pay,
        status: nextPayStatus || pickStr(pay.status),
        refund,
      },
      ...(currentCancel.requestId ? {
        cancelRequest: {
          ...currentCancel,
          status: nextCancelStatus || pickStr(currentCancel.status),
          refund,
          approvedAt: currentCancel.approvedAt || (refundStatus !== 'failed' ? now : currentCancel.approvedAt),
        }
      } : {}),
    }
  });

  if (currentCancel.requestId && currentCancel.messageId) {
    await syncCancelRequestMessage(currentCancel.messageId, buildCancelMessagePayload({
      task,
      requestId: pickStr(currentCancel.requestId),
      status: nextCancelStatus || pickStr(currentCancel.status),
      requesterName: pickStr(currentCancel.requesterName, task.ownerNickname, task.ownerName, '发布者'),
      approvedByName: pickStr(currentCancel.approvedByName, task.workerNickname, task.workerName),
      refund,
    }));
  }

  if (refundStatus === 'success') {
    try {
      const amount = roundMoney(task.amount);
      if (pickStr(task._openid) && amount > 0) {
        await recordWalletTransaction({
          openid: pickStr(task._openid),
          amount,
          balanceDelta: 0,
          type: 'refund',
          bizKey: `task_refund:${normalizedTaskId}:${pickStr(refund.reqSeqId, currentCancel.requestId, normalizedTaskId)}`,
          title: pickStr(task.title, task.desc, '任务退款'),
          summary: `任务取消退款 ¥${amount.toFixed(2)}，原路退回支付账户`,
          relatedId: normalizedTaskId,
          counterpartOpenid: pickStr(task.workerOpenid, task.worker_openid),
          affectsBalance: false,
          fundChannel: 'wechat_pay_refund',
          createdAt: now,
        });
      }
    } catch (ledgerErr) {
      console.error('[taskCancelFlow] sync refund ledger write failed', ledgerErr);
    }
  }

  return {
    ok: true,
    taskStatus: nextTaskStatus,
    payStatus: nextPayStatus,
    cancelStatus: nextCancelStatus,
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const systemCompensate = isSystemCompensateCall(event);
  const action = pickStr(event.action);
  if (systemCompensate && action !== 'sync_refund_status') {
    return { ok: false, code: 'SYSTEM_ACTION_NOT_ALLOWED', msg: '系统补偿仅支持退款状态同步' };
  }
  if (!OPENID && !systemCompensate) return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID' };
  const taskId = pickStr(event.taskId, event.tid, event.id);
  if (!taskId) return { ok: false, code: 'MISSING_TASK_ID', msg: '缺少 taskId' };

  try {
    const now = new Date();
    const task = await getTaskById(taskId);
    if (!task) return { ok: false, code: 'TASK_NOT_FOUND', msg: '任务不存在' };

    const taskStatus = pickStr(task.status);
    const ownerOpenid = pickStr(task._openid);
    const workerOpenid = pickStr(task.workerOpenid, task.worker_openid);
    const workerId = pickStr(task.workerId);
    const ownerId = pickStr(task.ownerId);
    const requesterName = pickStr(task.ownerNickname, task.ownerName, '发布者');
    const pay = task.pay && typeof task.pay === 'object' ? task.pay : {};
    const payStatus = pickStr(pay.status);
    const currentCancel = task.cancelRequest && typeof task.cancelRequest === 'object' ? task.cancelRequest : {};

    if (action === 'request') {
      if (pickStr(OPENID) !== ownerOpenid) {
        return { ok: false, code: 'NOT_OWNER', msg: '只有发布者可以发起取消申请' };
      }
      if (taskStatus !== 'accepted' && taskStatus !== 'submitted') {
        return { ok: false, code: 'INVALID_STATUS', msg: '当前任务状态不支持发起取消申请', status: taskStatus };
      }
      if (!workerOpenid || !workerId) {
        return { ok: false, code: 'WORKER_MISSING', msg: '缺少接单人信息，无法发起取消申请' };
      }
      if (pickStr(currentCancel.status) === 'pending') {
        return { ok: true, already: true, requestId: pickStr(currentCancel.requestId), status: 'pending' };
      }

      const requestId = `CR${Date.now()}${randomId(8)}`;
      const messageId = await addCancelRequestMessage({
        task,
        requestId,
        requesterName,
        now,
      });

      const payload = buildCancelMessagePayload({
        task,
        requestId,
        status: 'pending',
        requesterName,
      });

      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          cancelRequest: {
            requestId,
            status: 'pending',
            requestedAt: now,
            requestedByOpenid: OPENID,
            requestedByUserId: ownerId,
            messageId,
            requesterName,
          },
          updatedAt: now,
        }
      });

      await sendSubscribeMessage({
        touser: workerOpenid,
        senderName: requesterName,
        preview: '申请取消任务',
        page: `/pages/chat/room/index?tid=${encodeURIComponent(taskId)}`,
      });

      return { ok: true, status: 'pending', requestId, messageId, taskCancel: payload };
    }

    if (action === 'approve') {
      const requestId = pickStr(event.requestId);
      if (!requestId) return { ok: false, code: 'MISSING_REQUEST_ID', msg: '缺少 requestId' };
      const prepared = await prepareTaskRefundTransition({
        taskId,
        action: 'approve',
        openid: OPENID,
        requestId,
        now,
      });
      if (!prepared || !prepared.ok) return prepared;
      if (prepared.already) {
        return {
          ok: true,
          already: true,
          status: 'cancelled',
          refund: prepared.refund || {},
          refundStatus: pickStr(prepared.payStatus, prepared.refund && prepared.refund.status),
          msg: pickStr(prepared.payStatus) === 'refunded' ? '退款已完成' : '退款处理中',
        };
      }

      const approvedByName = pickStr(prepared.approvedByName, task.workerNickname, task.workerName, '接单人');
      const pendingRefund = prepared.pendingRefund || {};
      const preparedTask = prepared.task || task;
      const preparedCancel = prepared.currentCancel && typeof prepared.currentCancel === 'object'
        ? prepared.currentCancel
        : currentCancel;
      const pendingPayload = buildCancelMessagePayload({
        task: preparedTask,
        requestId,
        status: 'refund_pending',
        requesterName: pickStr(preparedCancel.requesterName, prepared.requesterName, requesterName),
        approvedByName,
        refund: pendingRefund,
      });
      await syncCancelRequestMessage(pickStr(preparedCancel.messageId), pendingPayload);

      let refundRes = null;
      try {
        refundRes = await callRefund({
          task: preparedTask,
          reqDate: pendingRefund.reqDate,
          reqSeqId: pendingRefund.reqSeqId,
          refundDesc: `任务取消退款:${taskId}`,
        });
      } catch (refundErr) {
        refundRes = {
          ok: false,
          err: {
            code: 'REFUND_CALL_EXCEPTION',
            msg: refundErr && refundErr.message ? refundErr.message : '退款请求异常',
          }
        };
      }
      if (!refundRes.ok) {
        if (shouldKeepRefundPending(refundRes.err)) {
          const processingRefund = buildProcessingRefundMeta(pendingRefund, refundRes.err, now);
          await db.collection(TASK_COLLECTION).doc(taskId).update({
            data: {
              status: 'cancelled',
              cancelledAt: preparedTask.cancelledAt || now,
              updatedAt: now,
              cancelRequest: {
                ...(preparedCancel || {}),
                status: 'refund_pending',
                approvedAt: now,
                approvedByOpenid: OPENID,
                approvedByUserId: pickStr(prepared.workerId, workerId),
                approvedByName,
                refund: processingRefund,
              },
              pay: {
                ...((prepared.pay && typeof prepared.pay === 'object') ? prepared.pay : {}),
                status: 'refund_pending',
                refund: processingRefund,
              }
            }
          });
          await syncCancelRequestMessage(pickStr(preparedCancel.messageId), buildCancelMessagePayload({
            task: preparedTask,
            requestId,
            status: 'refund_pending',
            requesterName: pickStr(preparedCancel.requesterName, prepared.requesterName, requesterName),
            approvedByName,
            refund: processingRefund,
          }));
          await sendSubscribeMessage({
            touser: pickStr(prepared.ownerOpenid, ownerOpenid),
            senderName: approvedByName,
            preview: '已同意取消，退款处理中',
            page: `/pages/chat/room/index?tid=${encodeURIComponent(taskId)}&peerUserId=${encodeURIComponent(pickStr(prepared.workerId, workerId))}`,
          });
          return {
            ok: true,
            status: 'cancelled',
            refund: processingRefund,
            msg: '已同意，退款处理中'
          };
        }
        await db.collection(TASK_COLLECTION).doc(taskId).update({
          data: {
            status: prepared.taskStatus,
            cancelledAt: preparedTask.cancelledAt || null,
            updatedAt: now,
            cancelRequest: buildPendingCancelRequest(preparedCancel, {
              refund: {
                ...((preparedCancel.refund && typeof preparedCancel.refund === 'object') ? preparedCancel.refund : {}),
                ...pendingRefund,
              },
            }),
            pay: {
              ...((prepared.pay && typeof prepared.pay === 'object') ? prepared.pay : {}),
              refund: {
                ...(((prepared.pay && prepared.pay.refund) && typeof prepared.pay.refund === 'object') ? prepared.pay.refund : {}),
                ...pendingRefund,
              },
            }
          }
        });
        await syncCancelRequestMessage(pickStr(preparedCancel.messageId), buildCancelMessagePayload({
          task: preparedTask,
          requestId,
          status: 'pending',
          requesterName: pickStr(preparedCancel.requesterName, prepared.requesterName, requesterName),
          refund: pendingRefund,
        }));
        return { ok: false, code: refundRes.err.code || 'REFUND_FAILED', msg: refundRes.err.msg || '退款失败', err: refundRes.err };
      }

      const refund = refundRes.refund || {};
      const cancelStatus = refund.status === 'success' ? 'approved' : 'refund_pending';
      const nextPayStatus = refund.status === 'success' ? 'refunded' : 'refund_pending';
      const payload = buildCancelMessagePayload({
        task: preparedTask,
        requestId,
        status: cancelStatus,
        requesterName: pickStr(preparedCancel.requesterName, prepared.requesterName, requesterName),
        approvedByName,
        refund,
      });

      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'cancelled',
          cancelledAt: preparedTask.cancelledAt || now,
          updatedAt: now,
          cancelRequest: {
            ...(preparedCancel || {}),
            status: cancelStatus,
            approvedAt: now,
            approvedByOpenid: OPENID,
            approvedByUserId: pickStr(prepared.workerId, workerId),
            approvedByName,
            refund,
          },
          pay: {
            ...((prepared.pay && typeof prepared.pay === 'object') ? prepared.pay : {}),
            status: nextPayStatus,
            refund,
          }
        }
      });

      await syncCancelRequestMessage(pickStr(preparedCancel.messageId), payload);
      await sendSubscribeMessage({
        touser: pickStr(prepared.ownerOpenid, ownerOpenid),
        senderName: approvedByName,
        preview: refund.status === 'success' ? '已同意取消，退款已完成' : '已同意取消，退款处理中',
        page: `/pages/chat/room/index?tid=${encodeURIComponent(taskId)}&peerUserId=${encodeURIComponent(pickStr(prepared.workerId, workerId))}`,
      });

      if (refund.status === 'success') {
        try {
          const amount = roundMoney(preparedTask.amount);
          if (pickStr(prepared.ownerOpenid, ownerOpenid) && amount > 0) {
            await recordWalletTransaction({
              openid: pickStr(prepared.ownerOpenid, ownerOpenid),
              amount,
              balanceDelta: 0,
              type: 'refund',
              bizKey: `task_refund:${taskId}:${pickStr(refund.reqSeqId, requestId)}`,
              title: pickStr(preparedTask.title, preparedTask.desc, '任务退款'),
              summary: `任务取消退款 ¥${amount.toFixed(2)}，原路退回支付账户`,
              relatedId: taskId,
              counterpartOpenid: pickStr(prepared.workerOpenid, workerOpenid),
              affectsBalance: false,
              fundChannel: 'wechat_pay_refund',
              createdAt: now,
            });
          }
        } catch (ledgerErr) {
          console.error('[taskCancelFlow] refund ledger write failed', ledgerErr);
        }
      }

      return {
        ok: true,
        status: 'cancelled',
        refund,
        msg: refund.status === 'success' ? '已同意，退款已完成' : '已同意，退款处理中'
      };
    }

    if (action === 'cancel_direct') {
      const prepared = await prepareTaskRefundTransition({
        taskId,
        action: 'cancel_direct',
        openid: OPENID,
        now,
      });
      if (!prepared || !prepared.ok) return prepared;
      if (prepared.already) {
        return {
          ok: true,
          already: true,
          status: 'cancelled',
          refund: prepared.refund || {},
          refundStatus: pickStr(prepared.payStatus, prepared.refund && prepared.refund.status),
          msg: pickStr(prepared.payStatus) === 'refunded' ? '退款已完成' : '退款处理中',
        };
      }

      const preparedTask = prepared.task || task;
      const pendingRefund = prepared.pendingRefund || {};

      let refundRes = null;
      try {
        refundRes = await callRefund({
          task: preparedTask,
          reqDate: pendingRefund.reqDate,
          reqSeqId: pendingRefund.reqSeqId,
          refundDesc: `任务取消退款:${taskId}`,
        });
      } catch (refundErr) {
        refundRes = {
          ok: false,
          err: {
            code: 'REFUND_CALL_EXCEPTION',
            msg: refundErr && refundErr.message ? refundErr.message : '退款请求异常',
          }
        };
      }
      if (!refundRes.ok) {
        if (shouldKeepRefundPending(refundRes.err)) {
          const processingRefund = buildProcessingRefundMeta(pendingRefund, refundRes.err, now);
          await db.collection(TASK_COLLECTION).doc(taskId).update({
            data: {
              status: 'cancelled',
              cancelledAt: preparedTask.cancelledAt || now,
              updatedAt: now,
              pay: {
                ...((prepared.pay && typeof prepared.pay === 'object') ? prepared.pay : {}),
                status: 'refund_pending',
                refund: processingRefund,
              }
            }
          });
          return {
            ok: true,
            status: 'cancelled',
            refund: processingRefund,
            msg: '已取消，退款处理中'
          };
        }
        await db.collection(TASK_COLLECTION).doc(taskId).update({
          data: {
            status: prepared.taskStatus,
            cancelledAt: preparedTask.cancelledAt || null,
            updatedAt: now,
            pay: {
              ...((prepared.pay && typeof prepared.pay === 'object') ? prepared.pay : {}),
              refund: {
                ...(((prepared.pay && prepared.pay.refund) && typeof prepared.pay.refund === 'object') ? prepared.pay.refund : {}),
                ...pendingRefund,
              },
            }
          }
        });
        return { ok: false, code: refundRes.err.code || 'REFUND_FAILED', msg: refundRes.err.msg || '退款失败', err: refundRes.err };
      }

      const refund = refundRes.refund || {};
      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          status: 'cancelled',
          cancelledAt: preparedTask.cancelledAt || now,
          updatedAt: now,
          pay: {
            ...((prepared.pay && typeof prepared.pay === 'object') ? prepared.pay : {}),
            status: refund.status === 'success' ? 'refunded' : 'refund_pending',
            refund,
          }
        }
      });

      if (refund.status === 'success') {
        try {
          const amount = roundMoney(preparedTask.amount);
          if (pickStr(prepared.ownerOpenid, ownerOpenid) && amount > 0) {
            await recordWalletTransaction({
              openid: pickStr(prepared.ownerOpenid, ownerOpenid),
              amount,
              balanceDelta: 0,
              type: 'refund',
              bizKey: `task_refund:${taskId}:${pickStr(refund.reqSeqId, taskId)}`,
              title: pickStr(preparedTask.title, preparedTask.desc, '任务退款'),
              summary: `任务取消退款 ¥${amount.toFixed(2)}，原路退回支付账户`,
              relatedId: taskId,
              affectsBalance: false,
              fundChannel: 'wechat_pay_refund',
              createdAt: now,
            });
          }
        } catch (ledgerErr) {
          console.error('[taskCancelFlow] direct refund ledger write failed', ledgerErr);
        }
      }

      return {
        ok: true,
        status: 'cancelled',
        refund,
        msg: refund.status === 'success' ? '已取消，退款已完成' : '已取消，退款处理中'
      };
    }

    if (action === 'sync_refund_status') {
      if (!systemCompensate && pickStr(OPENID) !== ownerOpenid && pickStr(OPENID) !== workerOpenid) {
        return { ok: false, code: 'NO_PERMISSION', msg: '无权同步退款状态' };
      }

      const queryMeta = buildRefundQueryMeta(task);
      if (!queryMeta.refundHfSeqId && !(queryMeta.refundReqDate && queryMeta.refundReqSeqId)) {
        return { ok: false, code: 'MISSING_REFUND_META', msg: '缺少退款查询参数' };
      }

      if (payStatus === 'refunded') {
        return { ok: true, already: true, status: 'cancelled', refundStatus: 'success', msg: '退款已完成' };
      }

      const queryRes = await cloud.callFunction({
        name: 'huifuMiniappPay',
        data: {
          action: 'scanpay_refund_query',
          refundReqDate: queryMeta.refundReqDate,
          refundReqSeqId: queryMeta.refundReqSeqId,
          refundHfSeqId: queryMeta.refundHfSeqId,
        }
      });
      const ret = queryRes && queryRes.result ? queryRes.result : null;
      if (!ret || !ret.ok) {
        const err = ret && ret.err
          ? (typeof ret.err === 'string' ? { code: 'REFUND_QUERY_FAILED', msg: ret.err } : ret.err)
          : { code: 'REFUND_QUERY_FAILED', msg: '退款查询失败' };
        return { ok: false, code: err.code || 'REFUND_QUERY_FAILED', msg: err.msg || '退款查询失败', err };
      }

      const huifuResp = ret.huifuResp || {};
      const refundStatus = resolveRefundStatus(huifuResp);
      const refund = buildResolvedRefundMeta(task, huifuResp, refundStatus, now);

      if (refundStatus === 'failed') {
        return {
          ok: false,
          code: extractRespCode(huifuResp) || 'REFUND_QUERY_FAILED',
          msg: extractRespDesc(huifuResp) || '退款查询未返回成功结果',
          refund,
        };
      }

      await applyRefundStateToTask({ taskId, task, refund, now });
      return {
        ok: true,
        status: 'cancelled',
        refund,
        msg: refundStatus === 'success' ? '退款已完成' : '退款处理中',
      };
    }

    return { ok: false, code: 'UNSUPPORTED_ACTION', msg: `unsupported_action: ${action}` };
  } catch (err) {
    console.error('[taskCancelFlow] failed', err);
    return {
      ok: false,
      code: 'TASK_CANCEL_FLOW_ERROR',
      msg: err && err.message ? err.message : '任务取消流程失败',
    };
  }
};
