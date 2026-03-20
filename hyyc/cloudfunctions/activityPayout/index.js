const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const BUILD_TAG = 'activityPayout@2026-03-20.2';
const USER_COLLECTION = 'userInfo';
const CAMPAIGN_COLLECTION = 'activity_campaigns';
const SLOT_COLLECTION = 'activity_draw_slots';
const DRAW_COLLECTION = 'activity_draw_records';
const PAYOUT_COLLECTION = 'activity_payout_logs';
const FUNDING_COLLECTION = 'activity_funding_orders';
const ADMIN_LOG_COLLECTION = 'activity_admin_logs';
const AUTO_CREATE_COLLECTIONS = process.env.ACTIVITY_AUTO_CREATE_COLLECTIONS === '1';

const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function formatMoneyFen(fen = 0) {
  const amount = Math.round(Number(fen) || 0);
  return (amount / 100).toFixed(2);
}

function nowDate() {
  return new Date();
}

async function ensureCollectionExists(name) {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (err) {
    // ignore
  }
}

async function getUserByOpenid(openid = '') {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return null;
  const res = await db.collection(USER_COLLECTION).where({ _openid: ownerOpenid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

async function getDocById(collectionName = '', docId = '') {
  const name = pickStr(collectionName);
  const id = pickStr(docId);
  if (!name || !id) return null;
  try {
    const res = await db.collection(name).doc(id).get();
    return (res && res.data) || null;
  } catch (err) {
    return null;
  }
}

function getSystemToken() {
  return pickStr(process.env.ACTIVITY_SYSTEM_TOKEN, process.env.SYSTEM_COMPENSATE_TOKEN);
}

function isSystemPayoutCall(event = {}) {
  const token = getSystemToken();
  return !!(
    event
    && event.systemPayout === true
    && token
    && pickStr(event.systemToken) === token
  );
}

function resolvePayoutMode() {
  const raw = pickStr(process.env.ACTIVITY_PAYOUT_MODE, 'local_wallet').toLowerCase();
  if (raw === 'delay_split' || raw === 'delay_confirm_split') return 'delay_split';
  if (raw === 'official_balance' || raw === 'provider_balance' || raw === 'huifu_adapter') return 'official_balance';
  if (raw === 'manual_pending') return 'manual_pending';
  return 'local_wallet';
}

function getUserChannelId(user = {}) {
  return pickStr(
    user.huifu_id,
    user.huifuId,
    user.huifuUserId,
    user.channelUserId
  );
}

function getRespCode(resp = {}) {
  return pickStr(resp.resp_code, resp.respCode, resp.sub_resp_code, resp.subRespCode);
}

function getRespDesc(resp = {}) {
  return pickStr(resp.resp_desc, resp.respDesc, resp.sub_resp_desc, resp.subRespDesc);
}

function getTransStatus(resp = {}) {
  return pickStr(resp.trans_stat, resp.transStat, resp.trans_status, resp.transStatus).toUpperCase();
}

function isBizSuccess(resp = {}) {
  return getRespCode(resp) === '00000000';
}

function buildChannelMeta(resp = {}, fallback = {}) {
  return {
    channelReqSeqId: pickStr(resp.req_seq_id, resp.org_req_seq_id, fallback.channelReqSeqId, fallback.reqSeqId),
    channelReqDate: pickStr(resp.req_date, resp.org_req_date, fallback.channelReqDate, fallback.reqDate),
    channelSeqId: pickStr(resp.hf_seq_id, resp.org_hf_seq_id, fallback.channelSeqId),
    channelRespCode: pickStr(getRespCode(resp), fallback.channelRespCode),
    channelRespDesc: pickStr(getRespDesc(resp), fallback.channelRespDesc),
    channelTransStatus: pickStr(getTransStatus(resp), fallback.channelTransStatus),
  };
}

async function updatePayoutLog(logId = '', data = {}) {
  const targetId = pickStr(logId);
  if (!targetId || !data || typeof data !== 'object') return;
  await db.collection(PAYOUT_COLLECTION).doc(targetId).update({ data });
}

function toFenInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

function yuanToFen(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100);
}

function getFundingTradeAmountFen(order = {}) {
  return toFenInt(order.orderAmountFen, toFenInt(order.amountFen));
}

function getFundingSplitSuccessFen(order = {}) {
  return toFenInt(order.splitSuccessAmountFen, 0);
}

function getFundingSplitPendingFen(order = {}) {
  return toFenInt(order.splitPendingAmountFen, 0);
}

function getFundingRefundedFen(order = {}) {
  return toFenInt(order.refundedAmountFen, 0);
}

function getFundingConfirmableFen(order = {}) {
  const fallbackFen = Math.max(
    0,
    getFundingTradeAmountFen(order) - getFundingSplitSuccessFen(order) - getFundingRefundedFen(order)
  );
  return toFenInt(order.unconfirmAmountFen, fallbackFen);
}

function getFundingAvailableFen(order = {}) {
  return Math.max(0, getFundingConfirmableFen(order) - getFundingSplitPendingFen(order));
}

function buildFundingShortageMsg() {
  return '活动支付单可确认金额不足，通常是支付手续费占用了部分金额。请先补活动金额后再重试派奖';
}

function normalizeDelaySplitRespMsg(resp = {}, fallback = '奖金发放失败') {
  const code = pickStr(getRespCode(resp));
  const desc = pickStr(getRespDesc(resp));
  if (code === '23000003') return buildFundingShortageMsg();
  return pickStr(desc, fallback);
}

function buildDelaySplitBunch({ userChannelId = '', amountFen = 0 }) {
  const targetHuifuId = pickStr(userChannelId);
  const targetAmountFen = toFenInt(amountFen, 0);
  if (!targetHuifuId) return { ok: false, err: { code: 'USER_CHANNEL_ID_MISSING', msg: '中奖用户收款账号缺失' } };
  if (targetAmountFen <= 0) return { ok: false, err: { code: 'INVALID_PAYOUT_AMOUNT', msg: '派奖金额不合法' } };
  const acctSplitBunchObj = {
    acct_infos: [
      {
        huifu_id: targetHuifuId,
        div_amt: formatMoneyFen(targetAmountFen),
      },
    ],
  };
  return {
    ok: true,
    acctSplitBunchObj,
    acctSplitBunch: JSON.stringify(acctSplitBunchObj),
  };
}

function buildFundingTradeMeta(resp = {}, fallback = {}) {
  const orderAmountFen = yuanToFen(
    pickStr(resp.trans_amt, resp.ord_amt),
    toFenInt(fallback.orderAmountFen, 0)
  );
  const confirmedAmountFen = yuanToFen(
    pickStr(resp.confirmed_amt),
    toFenInt(fallback.confirmedAmountFen, 0)
  );
  const unconfirmAmountFen = yuanToFen(
    pickStr(resp.unconfirm_amt),
    Math.max(0, orderAmountFen - confirmedAmountFen)
  );
  return {
    orderAmountFen,
    confirmedAmountFen,
    unconfirmAmountFen,
  };
}

async function reserveFundingForDelaySplit({ payoutLog = {}, amountFen = 0 }) {
  const payoutLogId = pickStr(payoutLog._id);
  const campaignId = pickStr(payoutLog.campaignId);
  const reserveFen = toFenInt(amountFen, 0);
  if (!payoutLogId || !campaignId || reserveFen <= 0) {
    return { ok: false, err: { code: 'FUNDING_CONTEXT_MISSING', msg: '缺少活动资金上下文' } };
  }

  return db.runTransaction(async (tx) => {
    const liveLogRes = await tx.collection(PAYOUT_COLLECTION).doc(payoutLogId).get();
    const liveLog = (liveLogRes && liveLogRes.data) || null;
    if (!liveLog) return { ok: false, err: { code: 'PAYOUT_LOG_NOT_FOUND', msg: '未找到派奖日志' } };

    const existingFundingOrderId = pickStr(liveLog.fundingOrderId);
    if (existingFundingOrderId && toFenInt(liveLog.fundingReservedAmountFen, 0) >= reserveFen) {
      const existingOrderRes = await tx.collection(FUNDING_COLLECTION).doc(existingFundingOrderId).get().catch(() => null);
      const existingOrder = existingOrderRes && existingOrderRes.data ? existingOrderRes.data : null;
      return {
        ok: true,
        alreadyReserved: true,
        payoutLog: liveLog,
        fundingOrder: existingOrder,
        reservedAmountFen: reserveFen,
      };
    }

    const ordersRes = await tx.collection(FUNDING_COLLECTION)
      .where({ campaignId, status: 'paid' })
      .limit(50)
      .get();
    const orders = (ordersRes && ordersRes.data) || [];
    const candidate = orders
      .filter(item => getFundingAvailableFen(item) >= reserveFen && pickStr(item.orgReqDate, item.reqDate) && pickStr(item.orgReqSeqId, item.reqSeqId))
      .sort((a, b) => {
        const availDiff = getFundingAvailableFen(b) - getFundingAvailableFen(a);
        if (availDiff !== 0) return availDiff;
        return toFenInt(b.orderAmountFen || b.amountFen, 0) - toFenInt(a.orderAmountFen || a.amountFen, 0);
      })[0];

    if (!candidate || !pickStr(candidate._id)) {
      return { ok: false, err: { code: 'FUNDING_NOT_ENOUGH', msg: buildFundingShortageMsg() } };
    }

    const nextPendingFen = getFundingSplitPendingFen(candidate) + reserveFen;
    const current = nowDate();
    await tx.collection(FUNDING_COLLECTION).doc(candidate._id).update({
      data: {
        splitPendingAmountFen: nextPendingFen,
        updatedAt: current,
      }
    });
    await tx.collection(PAYOUT_COLLECTION).doc(payoutLogId).update({
      data: {
        fundingOrderId: pickStr(candidate._id),
        fundingReservedAmountFen: reserveFen,
        fundingOrderReqDate: pickStr(candidate.orgReqDate, candidate.reqDate),
        fundingOrderReqSeqId: pickStr(candidate.orgReqSeqId, candidate.reqSeqId),
        fundingOrderHfSeqId: pickStr(candidate.orgHfSeqId, candidate.channelSeqId),
        fundingOrderAmountFen: getFundingTradeAmountFen(candidate),
        status: 'processing',
        updatedAt: current,
      }
    });

    return {
      ok: true,
      payoutLog: {
        ...liveLog,
        fundingOrderId: pickStr(candidate._id),
        fundingReservedAmountFen: reserveFen,
        fundingOrderReqDate: pickStr(candidate.orgReqDate, candidate.reqDate),
        fundingOrderReqSeqId: pickStr(candidate.orgReqSeqId, candidate.reqSeqId),
        fundingOrderHfSeqId: pickStr(candidate.orgHfSeqId, candidate.channelSeqId),
        fundingOrderAmountFen: getFundingTradeAmountFen(candidate),
        status: 'processing',
      },
      fundingOrder: {
        ...candidate,
        splitPendingAmountFen: nextPendingFen,
      },
      reservedAmountFen: reserveFen,
    };
  });
}

async function updateFundingAfterDelaySplit({
  payoutLog = {},
  amountFen = 0,
  releaseOnly = false,
  resp = {},
}) {
  const payoutLogId = pickStr(payoutLog._id);
  const fundingOrderId = pickStr(payoutLog.fundingOrderId);
  const targetFen = toFenInt(amountFen || payoutLog.fundingReservedAmountFen, 0);
  if (!payoutLogId || !fundingOrderId || targetFen <= 0) return;

  await db.runTransaction(async (tx) => {
    const orderRes = await tx.collection(FUNDING_COLLECTION).doc(fundingOrderId).get();
    const order = (orderRes && orderRes.data) || null;
    if (!order) return;

    const tradeMeta = buildFundingTradeMeta(resp, order);
    const currentPendingFen = getFundingSplitPendingFen(order);
    const nextPendingFen = Math.max(0, currentPendingFen - targetFen);
    const nextSuccessFen = releaseOnly
      ? getFundingSplitSuccessFen(order)
      : getFundingSplitSuccessFen(order) + targetFen;
    const orderTradeFen = Math.max(getFundingTradeAmountFen(order), tradeMeta.orderAmountFen, nextSuccessFen + nextPendingFen);
    const nextConfirmedFen = Math.max(tradeMeta.confirmedAmountFen, nextSuccessFen);
    const nextUnconfirmFen = Math.max(0, Math.min(orderTradeFen - nextConfirmedFen, tradeMeta.unconfirmAmountFen || (orderTradeFen - nextConfirmedFen)));

    await tx.collection(FUNDING_COLLECTION).doc(fundingOrderId).update({
      data: {
        orderAmountFen: orderTradeFen,
        orderAmountYuanText: formatMoneyFen(orderTradeFen),
        confirmedAmountFen: nextConfirmedFen,
        unconfirmAmountFen: nextUnconfirmFen,
        splitSuccessAmountFen: nextSuccessFen,
        splitPendingAmountFen: nextPendingFen,
        orgReqDate: pickStr(order.orgReqDate, order.reqDate, payoutLog.fundingOrderReqDate),
        orgReqSeqId: pickStr(order.orgReqSeqId, order.reqSeqId, payoutLog.fundingOrderReqSeqId),
        orgHfSeqId: pickStr(resp.org_hf_seq_id, resp.orgHfSeqId, order.orgHfSeqId, order.channelSeqId, payoutLog.fundingOrderHfSeqId),
        updatedAt: nowDate(),
      }
    });
    await tx.collection(PAYOUT_COLLECTION).doc(payoutLogId).update({
      data: {
        fundingReservedAmountFen: 0,
        updatedAt: nowDate(),
      }
    });
  });
}

async function writeAdminLog({
  action = '',
  operatorOpenid = '',
  campaignId = '',
  payloadSnapshot = {},
  result = 'success',
  errorMsg = '',
}) {
  try {
    await ensureCollectionExists(ADMIN_LOG_COLLECTION);
    await db.collection(ADMIN_LOG_COLLECTION).add({
      data: {
        action: pickStr(action),
        campaignId: pickStr(campaignId),
        operatorOpenid: pickStr(operatorOpenid),
        payloadSnapshot: payloadSnapshot && typeof payloadSnapshot === 'object' ? payloadSnapshot : {},
        result: pickStr(result, 'success'),
        errorMsg: pickStr(errorMsg),
        createdAt: nowDate(),
      }
    });
  } catch (err) {
    console.error('[activityPayout] write admin log failed', err);
  }
}

async function setPayoutPending(payoutLog = {}, payoutMode = 'manual_pending', note = '', extra = {}) {
  const logId = pickStr(payoutLog._id);
  const drawRecordId = pickStr(payoutLog.drawRecordId);
  const slotId = pickStr(payoutLog.slotId);
  const current = nowDate();
  if (logId) {
    await db.collection(PAYOUT_COLLECTION).doc(logId).update({
      data: {
        payoutMode,
        status: 'pending',
        lastErrorMsg: pickStr(note),
        ...extra,
        updatedAt: current,
      }
    });
  }
  if (drawRecordId) {
    await db.collection(DRAW_COLLECTION).doc(drawRecordId).update({
      data: {
        payoutStatus: 'pending',
        updatedAt: current,
      }
    });
  }
  if (slotId) {
    await db.collection(SLOT_COLLECTION).doc(slotId).update({
      data: {
        payoutStatus: 'pending',
        updatedAt: current,
      }
    });
  }
  return {
    ok: true,
    status: 'pending',
    payoutMode,
    msg: pickStr(note, '奖励已登记，等待发放'),
  };
}

async function markPayoutFailed(payoutLog = {}, errCode = '', errMsg = '') {
  const logId = pickStr(payoutLog._id);
  const drawRecordId = pickStr(payoutLog.drawRecordId);
  const slotId = pickStr(payoutLog.slotId);
  const nextRetry = Number(payoutLog.retryCount || 0) + 1;
  const current = nowDate();
  if (logId) {
    await db.collection(PAYOUT_COLLECTION).doc(logId).update({
      data: {
        status: 'failed',
        retryCount: nextRetry,
        lastErrorCode: pickStr(errCode),
        lastErrorMsg: pickStr(errMsg),
        updatedAt: current,
      }
    });
  }
  if (drawRecordId) {
    await db.collection(DRAW_COLLECTION).doc(drawRecordId).update({
      data: {
        payoutStatus: 'failed',
        updatedAt: current,
      }
    });
  }
  if (slotId) {
    await db.collection(SLOT_COLLECTION).doc(slotId).update({
      data: {
        payoutStatus: 'failed',
        updatedAt: current,
      }
    });
  }
  return {
    ok: false,
    status: 'failed',
    err: {
      code: pickStr(errCode, 'PAYOUT_FAILED'),
      msg: pickStr(errMsg, '奖励发放失败')
    }
  };
}

async function markPayoutSuccess(payoutLog = {}, extra = {}) {
  const logId = pickStr(payoutLog._id);
  const drawRecordId = pickStr(payoutLog.drawRecordId);
  const slotId = pickStr(payoutLog.slotId);
  const current = nowDate();
  if (logId) {
    await db.collection(PAYOUT_COLLECTION).doc(logId).update({
      data: {
        status: 'success',
        finishedAt: current,
        updatedAt: current,
        lastErrorCode: '',
        lastErrorMsg: '',
        walletLedgerId: pickStr(extra.walletLedgerId),
        payoutMode: pickStr(extra.payoutMode, payoutLog.payoutMode, 'local_wallet'),
        walletMirrorStatus: pickStr(extra.walletMirrorStatus, pickStr(extra.walletLedgerId) ? 'success' : ''),
        walletMirrorErrorMsg: pickStr(extra.walletMirrorErrorMsg),
        channelReqSeqId: pickStr(extra.channelReqSeqId),
        channelReqDate: pickStr(extra.channelReqDate),
        channelSeqId: pickStr(extra.channelSeqId),
        channelRespCode: pickStr(extra.channelRespCode),
        channelRespDesc: pickStr(extra.channelRespDesc),
        channelTransStatus: pickStr(extra.channelTransStatus),
      }
    });
  }
  if (drawRecordId) {
    await db.collection(DRAW_COLLECTION).doc(drawRecordId).update({
      data: {
        payoutStatus: 'success',
        updatedAt: current,
      }
    });
  }
  if (slotId) {
    await db.collection(SLOT_COLLECTION).doc(slotId).update({
      data: {
        payoutStatus: 'success',
        updatedAt: current,
      }
    });
  }
  return {
    ok: true,
    status: 'success',
    payoutMode: pickStr(extra.payoutMode, 'local_wallet'),
    msg: '奖励已发到钱包余额'
  };
}

async function callWalletActivityCredit({
  openid = '',
  amountFen = 0,
  campaignId = '',
  drawRecordId = '',
  payoutLogId = '',
  title = '',
  summary = '',
}) {
  const token = pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);
  if (!token) {
    return { ok: false, err: { code: 'MISSING_SYSTEM_TOKEN', msg: '未配置 SYSTEM_COMPENSATE_TOKEN' } };
  }
  const amountYuan = (Math.round(Number(amountFen) || 0) / 100).toFixed(2);
  const res = await cloud.callFunction({
    name: 'walletWithdraw',
    data: {
      action: 'activity_credit',
      systemCompensate: true,
      compensateToken: token,
      targetOpenid: pickStr(openid),
      amount: Number(amountYuan),
      campaignId: pickStr(campaignId),
      drawRecordId: pickStr(drawRecordId),
      payoutLogId: pickStr(payoutLogId),
      title: pickStr(title, '活动奖励'),
      summary: pickStr(summary, `活动奖励到账 ¥${amountYuan}`),
      relatedId: pickStr(drawRecordId, payoutLogId),
      bizKey: `activity_income:${pickStr(campaignId)}:${pickStr(drawRecordId)}`,
    }
  });
  const ret = (res && res.result) || res || null;
  if (!ret || ret.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(ret && ret.err && ret.err.code, 'WALLET_ACTIVITY_CREDIT_FAILED'),
        msg: pickStr(ret && ret.err && ret.err.msg, '写入奖励记录失败')
      }
    };
  }
  return {
    ok: true,
    walletLedgerId: pickStr(ret.tx && ret.tx._id, ret.tx && ret.tx.id, ret.ledgerId),
    raw: ret,
  };
}

async function callDelaySplitConfirm({
  payoutLog = {},
  fundingOrder = {},
  user = {},
  amountFen = 0,
}) {
  const userChannelId = getUserChannelId(user);
  const split = buildDelaySplitBunch({ userChannelId, amountFen });
  if (!split.ok) return split;

  const orgReqDate = pickStr(fundingOrder.orgReqDate, fundingOrder.reqDate, payoutLog.fundingOrderReqDate);
  const orgReqSeqId = pickStr(fundingOrder.orgReqSeqId, fundingOrder.reqSeqId, payoutLog.fundingOrderReqSeqId);
  const orgHfSeqId = pickStr(fundingOrder.orgHfSeqId, fundingOrder.channelSeqId, payoutLog.fundingOrderHfSeqId);
  if (!orgReqDate || (!orgReqSeqId && !orgHfSeqId)) {
    return { ok: false, err: { code: 'FUNDING_TRADE_MISSING', msg: '活动支付单缺少原交易信息，暂时无法发放' } };
  }

  const res = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: {
      action: 'delay_confirm',
      reqSeqId: pickStr(payoutLog.channelReqSeqId, `ADC${Date.now()}${String(payoutLog._id || '').slice(-8)}`),
      reqDate: pickStr(payoutLog.channelReqDate),
      orgReqDate,
      orgReqSeqId,
      orgHfSeqId,
      acctSplitBunch: split.acctSplitBunchObj,
    }
  });
  const ret = (res && res.result) || res || null;
  if (!ret || ret.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(ret && ret.err && ret.err.code, 'DELAY_CONFIRM_FAILED'),
        msg: pickStr(ret && ret.err && ret.err.msg, '奖金发放失败')
      }
    };
  }
  return {
    ok: true,
    resp: ret.huifuResp || {},
    reqSeqId: pickStr(ret.reqSeqId),
    reqDate: pickStr(ret.reqDate),
    sourceTrade: {
      fundingOrderId: pickStr(fundingOrder._id),
      orgReqDate,
      orgReqSeqId,
      orgHfSeqId,
    },
    raw: ret,
  };
}

async function queryDelaySplitConfirm(payoutLog = {}) {
  const reqSeqId = pickStr(payoutLog.channelReqSeqId);
  const reqDate = pickStr(payoutLog.channelReqDate);
  if (!reqSeqId || !reqDate) {
    return { ok: false, err: { code: 'QUERY_CONTEXT_MISSING', msg: '缺少发放查询信息' } };
  }
  const res = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: {
      action: 'delay_confirm_query',
      orgReqDate: reqDate,
      orgReqSeqId: reqSeqId,
    }
  });
  const ret = (res && res.result) || res || null;
  if (!ret || ret.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(ret && ret.err && ret.err.code, 'DELAY_CONFIRM_QUERY_FAILED'),
        msg: pickStr(ret && ret.err && ret.err.msg, '发放状态查询失败')
      }
    };
  }
  return {
    ok: true,
    resp: ret.huifuResp || {},
    raw: ret,
  };
}

async function callOfficialBalancePay({
  payoutLog = {},
  campaign = {},
  user = {},
  amountFen = 0,
}) {
  const userChannelId = getUserChannelId(user);
  if (!userChannelId) {
    return { ok: false, err: { code: 'USER_CHANNEL_ID_MISSING', msg: '中奖用户收款账号缺失' } };
  }
  const amountYuan = formatMoneyFen(amountFen);
  const res = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: {
      action: 'acct_payment_pay',
      reqSeqId: pickStr(payoutLog.channelReqSeqId),
      reqDate: pickStr(payoutLog.channelReqDate),
      outHuifuId: pickStr(process.env.HUIFU_HUIFU_ID),
      recipientHuifuId: userChannelId,
      amountYuan,
      goodDesc: pickStr(campaign.title, '活动奖励'),
      remark: `活动奖励 ${amountYuan} 元`,
      transferType: pickStr(process.env.HUIFU_ACTIVITY_TRANSFER_TYPE, '01'),
      subProduct: pickStr(process.env.HUIFU_ACTIVITY_SUB_PRODUCT),
      clientIp: pickStr(payoutLog.clientIp, process.env.HUIFU_ACTIVITY_IP_ADDR),
    }
  });
  const ret = (res && res.result) || res || null;
  if (!ret || ret.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(ret && ret.err && ret.err.code, 'CHANNEL_PAY_FAILED'),
        msg: pickStr(ret && ret.err && ret.err.msg, '正式发放失败')
      }
    };
  }
  return {
    ok: true,
    resp: ret.huifuResp || {},
    reqSeqId: pickStr(ret.reqSeqId),
    reqDate: pickStr(ret.reqDate),
    raw: ret,
  };
}

async function queryOfficialBalancePay(payoutLog = {}) {
  const reqSeqId = pickStr(payoutLog.channelReqSeqId);
  const reqDate = pickStr(payoutLog.channelReqDate);
  const outHuifuId = pickStr(process.env.HUIFU_HUIFU_ID);
  if (!reqSeqId || !reqDate || !outHuifuId) {
    return { ok: false, err: { code: 'QUERY_CONTEXT_MISSING', msg: '缺少发放查询信息' } };
  }
  const res = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: {
      action: 'acct_payment_query',
      huifuIdToQuery: outHuifuId,
      orgReqSeqId: reqSeqId,
      orgReqDate: reqDate,
      orgHfSeqId: pickStr(payoutLog.channelSeqId),
    }
  });
  const ret = (res && res.result) || res || null;
  if (!ret || ret.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(ret && ret.err && ret.err.code, 'CHANNEL_QUERY_FAILED'),
        msg: pickStr(ret && ret.err && ret.err.msg, '发放状态查询失败')
      }
    };
  }
  return {
    ok: true,
    resp: ret.huifuResp || {},
    raw: ret,
  };
}

async function mirrorWalletAfterOfficialSuccess({ payoutLog = {}, campaign = {}, amountFen = 0 }) {
  const creditResult = await callWalletActivityCredit({
    openid: pickStr(payoutLog.openid),
    amountFen,
    campaignId: pickStr(payoutLog.campaignId),
    drawRecordId: pickStr(payoutLog.drawRecordId),
    payoutLogId: pickStr(payoutLog._id),
    title: pickStr(campaign.title, '活动奖励'),
    summary: `${pickStr(campaign.title, '活动奖励')}到账 ¥${formatMoneyFen(amountFen)}`,
  });
  if (!creditResult.ok) {
    return {
      ok: false,
      err: {
        code: pickStr(creditResult.err && creditResult.err.code, 'WALLET_MIRROR_FAILED'),
        msg: pickStr(creditResult.err && creditResult.err.msg, '奖励已到账，记录同步失败')
      }
    };
  }
  return { ok: true, walletLedgerId: pickStr(creditResult.walletLedgerId) };
}

async function processOnePayout({ payoutLogId = '', operatorOpenid = '', systemCall = false, preferQuery = false, forcePayoutMode = '' } = {}) {
  const logId = pickStr(payoutLogId);
  if (!logId) {
    return { ok: false, err: { code: 'MISSING_PAYOUT_LOG_ID', msg: '缺少 payoutLogId' }, buildTag: BUILD_TAG };
  }

  const payoutLog = await getDocById(PAYOUT_COLLECTION, logId);
  if (!payoutLog) {
    return { ok: false, err: { code: 'PAYOUT_LOG_NOT_FOUND', msg: '未找到派奖日志' }, buildTag: BUILD_TAG };
  }
  if (pickStr(payoutLog.status) === 'success') {
    return { ok: true, already: true, status: 'success', payoutLogId: logId, buildTag: BUILD_TAG };
  }

  const campaign = await getDocById(CAMPAIGN_COLLECTION, pickStr(payoutLog.campaignId));
  const drawRecord = await getDocById(DRAW_COLLECTION, pickStr(payoutLog.drawRecordId));
  const user = await getUserByOpenid(pickStr(payoutLog.openid));

  if (!campaign || !drawRecord || !user) {
    return markPayoutFailed(payoutLog, 'PAYOUT_CONTEXT_MISSING', '派奖上下文缺失');
  }

  const forcedMode = systemCall ? pickStr(forcePayoutMode).toLowerCase() : '';
  const payoutMode = ['local_wallet', 'delay_split', 'official_balance', 'manual_pending'].includes(forcedMode)
    ? forcedMode
    : (pickStr(payoutLog.payoutMode) || resolvePayoutMode());
  if (payoutMode === 'manual_pending') {
    return {
      ...(await setPayoutPending(payoutLog, payoutMode, '奖励已登记，等待人工处理')),
      payoutLogId: logId,
      buildTag: BUILD_TAG,
    };
  }
  if (!['local_wallet', 'delay_split', 'official_balance'].includes(payoutMode)) {
    return markPayoutFailed(payoutLog, 'UNSUPPORTED_PAYOUT_MODE', `不支持的派奖模式: ${payoutMode}`);
  }

  const amountFen = Math.round(Number(payoutLog.amountFen || drawRecord.amountFen || 0));
  if (amountFen <= 0) {
    return markPayoutFailed(payoutLog, 'INVALID_PAYOUT_AMOUNT', '派奖金额不合法');
  }

  await updatePayoutLog(logId, {
    status: 'processing',
    payoutMode,
    updatedAt: nowDate(),
  });

  if (payoutMode === 'delay_split') {
    const shouldQueryExisting = !!(
      pickStr(payoutLog.channelReqSeqId)
      && (preferQuery || ['pending', 'processing'].includes(pickStr(payoutLog.status)))
    );

    let workingLog = { ...payoutLog, _id: logId };
    let fundingOrder = pickStr(workingLog.fundingOrderId)
      ? await getDocById(FUNDING_COLLECTION, pickStr(workingLog.fundingOrderId))
      : null;

    if (!shouldQueryExisting) {
      const reserveRet = await reserveFundingForDelaySplit({ payoutLog: workingLog, amountFen });
      if (!reserveRet || !reserveRet.ok) {
        return {
          ...(await markPayoutFailed(
            workingLog,
            pickStr(reserveRet && reserveRet.err && reserveRet.err.code, 'FUNDING_NOT_ENOUGH'),
            pickStr(reserveRet && reserveRet.err && reserveRet.err.msg, buildFundingShortageMsg())
          )),
          payoutLogId: logId,
          buildTag: BUILD_TAG,
        };
      }
      workingLog = { ...workingLog, ...(reserveRet.payoutLog || {}), _id: logId };
      fundingOrder = reserveRet.fundingOrder || fundingOrder;
    }

    if (!fundingOrder && pickStr(workingLog.fundingOrderId)) {
      fundingOrder = await getDocById(FUNDING_COLLECTION, pickStr(workingLog.fundingOrderId));
    }
    if (!fundingOrder) {
      if (!shouldQueryExisting) {
        await updateFundingAfterDelaySplit({ payoutLog: workingLog, amountFen, releaseOnly: true });
      }
      return {
        ...(await markPayoutFailed(
          workingLog,
          'FUNDING_ORDER_NOT_FOUND',
          '活动支付单不存在，暂时无法发放'
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    const channelResult = shouldQueryExisting
      ? await queryDelaySplitConfirm(workingLog)
      : await callDelaySplitConfirm({ payoutLog: workingLog, fundingOrder, user, amountFen });

    if (!channelResult.ok) {
      if (shouldQueryExisting) {
        return {
          ...(await setPayoutPending(
            workingLog,
            'delay_split',
            pickStr(channelResult.err && channelResult.err.msg, '奖励正在确认，请稍后刷新'),
            {
              fundingOrderId: pickStr(workingLog.fundingOrderId),
              fundingOrderReqDate: pickStr(workingLog.fundingOrderReqDate),
              fundingOrderReqSeqId: pickStr(workingLog.fundingOrderReqSeqId),
              fundingOrderHfSeqId: pickStr(workingLog.fundingOrderHfSeqId),
            }
          )),
          payoutLogId: logId,
          buildTag: BUILD_TAG,
        };
      }

      await updateFundingAfterDelaySplit({ payoutLog: workingLog, amountFen, releaseOnly: true });
      return {
        ...(await markPayoutFailed(
          workingLog,
          pickStr(channelResult.err && channelResult.err.code, 'DELAY_CONFIRM_FAILED'),
          pickStr(channelResult.err && channelResult.err.msg, '奖金发放失败')
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    const channelResp = channelResult.resp || {};
    const channelMeta = buildChannelMeta(channelResp, channelResult);
    const fundingMeta = {
      fundingOrderId: pickStr(workingLog.fundingOrderId, fundingOrder._id),
      fundingOrderReqDate: pickStr(workingLog.fundingOrderReqDate, fundingOrder.orgReqDate, fundingOrder.reqDate),
      fundingOrderReqSeqId: pickStr(workingLog.fundingOrderReqSeqId, fundingOrder.orgReqSeqId, fundingOrder.reqSeqId),
      fundingOrderHfSeqId: pickStr(workingLog.fundingOrderHfSeqId, fundingOrder.orgHfSeqId, fundingOrder.channelSeqId),
      fundingReservedAmountFen: toFenInt(workingLog.fundingReservedAmountFen, amountFen),
    };
    await updatePayoutLog(logId, {
      ...channelMeta,
      ...fundingMeta,
      payoutMode: 'delay_split',
      updatedAt: nowDate(),
    });

    const payoutWithMeta = { ...workingLog, ...channelMeta, ...fundingMeta, _id: logId };
    if (!isBizSuccess(channelResp)) {
      const channelErrMsg = normalizeDelaySplitRespMsg(channelResp, '奖金发放失败');
      await updateFundingAfterDelaySplit({ payoutLog: payoutWithMeta, amountFen, releaseOnly: true, resp: channelResp });
      return {
        ...(await markPayoutFailed(
          payoutWithMeta,
          pickStr(channelMeta.channelRespCode, 'CHANNEL_BIZ_FAILED'),
          channelErrMsg
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    const transStatus = pickStr(channelMeta.channelTransStatus);
    if (transStatus === 'P' || transStatus === 'C' || !transStatus) {
      return {
        ...(await setPayoutPending(
          payoutWithMeta,
          'delay_split',
          '奖励正在发放，请稍后刷新',
          {
            ...channelMeta,
            ...fundingMeta,
          }
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    if (transStatus !== 'S') {
      await updateFundingAfterDelaySplit({ payoutLog: payoutWithMeta, amountFen, releaseOnly: true, resp: channelResp });
      return {
        ...(await markPayoutFailed(
          payoutWithMeta,
          pickStr(channelMeta.channelRespCode, 'CHANNEL_TRANS_FAILED'),
          pickStr(channelMeta.channelRespDesc, '奖金发放失败')
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    await updateFundingAfterDelaySplit({ payoutLog: payoutWithMeta, amountFen, releaseOnly: false, resp: channelResp });
    const mirrorResult = await mirrorWalletAfterOfficialSuccess({
      payoutLog: payoutWithMeta,
      campaign,
      amountFen,
    });

    if (!mirrorResult.ok) {
      return {
        ...(await markPayoutSuccess(
          payoutWithMeta,
          {
            ...channelMeta,
            payoutMode: 'delay_split',
            walletMirrorStatus: 'failed',
            walletMirrorErrorMsg: pickStr(mirrorResult.err && mirrorResult.err.msg),
          }
        )),
        payoutLogId: logId,
        warn: {
          code: pickStr(mirrorResult.err && mirrorResult.err.code, 'WALLET_MIRROR_FAILED'),
          msg: pickStr(mirrorResult.err && mirrorResult.err.msg, '奖励已到账，记录同步失败')
        },
        buildTag: BUILD_TAG,
      };
    }

    return {
      ...(await markPayoutSuccess(
        payoutWithMeta,
        {
          ...channelMeta,
          payoutMode: 'delay_split',
          walletLedgerId: pickStr(mirrorResult.walletLedgerId),
          walletMirrorStatus: 'success',
        }
      )),
      payoutLogId: logId,
      walletLedgerId: pickStr(mirrorResult.walletLedgerId),
      buildTag: BUILD_TAG,
    };
  }

  if (payoutMode === 'official_balance') {
    const shouldQueryExisting = !!(
      pickStr(payoutLog.channelReqSeqId)
      && (preferQuery || ['pending', 'processing'].includes(pickStr(payoutLog.status)))
    );
    const channelResult = shouldQueryExisting
      ? await queryOfficialBalancePay(payoutLog)
      : await callOfficialBalancePay({ payoutLog, campaign, user, amountFen });

    if (!channelResult.ok) {
      return {
        ...(await markPayoutFailed(
          payoutLog,
          pickStr(channelResult.err && channelResult.err.code, 'CHANNEL_PAY_FAILED'),
          pickStr(channelResult.err && channelResult.err.msg, '正式发放失败')
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    const channelResp = channelResult.resp || {};
    const channelMeta = buildChannelMeta(channelResp, channelResult);
    await updatePayoutLog(logId, {
      ...channelMeta,
      payoutMode: 'official_balance',
      updatedAt: nowDate(),
    });

    if (!isBizSuccess(channelResp)) {
      return {
        ...(await markPayoutFailed(
          { ...payoutLog, ...channelMeta, _id: logId },
          pickStr(channelMeta.channelRespCode, 'CHANNEL_BIZ_FAILED'),
          pickStr(channelMeta.channelRespDesc, '正式发放失败')
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    const transStatus = pickStr(channelMeta.channelTransStatus);
    if (transStatus === 'P' || transStatus === 'C' || !transStatus) {
      return {
        ...(await setPayoutPending(
          { ...payoutLog, ...channelMeta, _id: logId },
          'official_balance',
          '奖励正在发放，请稍后刷新',
          channelMeta
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    if (transStatus !== 'S') {
      return {
        ...(await markPayoutFailed(
          { ...payoutLog, ...channelMeta, _id: logId },
          pickStr(channelMeta.channelRespCode, 'CHANNEL_TRANS_FAILED'),
          pickStr(channelMeta.channelRespDesc, '正式发放失败')
        )),
        payoutLogId: logId,
        buildTag: BUILD_TAG,
      };
    }

    const mirrorResult = await mirrorWalletAfterOfficialSuccess({
      payoutLog: { ...payoutLog, ...channelMeta, _id: logId },
      campaign,
      amountFen,
    });

    if (!mirrorResult.ok) {
      return {
        ...(await markPayoutSuccess(
          { ...payoutLog, ...channelMeta, _id: logId },
          {
            ...channelMeta,
            payoutMode: 'official_balance',
            walletMirrorStatus: 'failed',
            walletMirrorErrorMsg: pickStr(mirrorResult.err && mirrorResult.err.msg),
          }
        )),
        payoutLogId: logId,
        warn: {
          code: pickStr(mirrorResult.err && mirrorResult.err.code, 'WALLET_MIRROR_FAILED'),
          msg: pickStr(mirrorResult.err && mirrorResult.err.msg, '奖励已到账，记录同步失败')
        },
        buildTag: BUILD_TAG,
      };
    }

    return {
      ...(await markPayoutSuccess(
        { ...payoutLog, ...channelMeta, _id: logId },
        {
          ...channelMeta,
          payoutMode: 'official_balance',
          walletLedgerId: pickStr(mirrorResult.walletLedgerId),
          walletMirrorStatus: 'success',
        }
      )),
      payoutLogId: logId,
      walletLedgerId: pickStr(mirrorResult.walletLedgerId),
      buildTag: BUILD_TAG,
    };
  }

  const creditResult = await callWalletActivityCredit({
    openid: pickStr(payoutLog.openid),
    amountFen,
    campaignId: pickStr(payoutLog.campaignId),
    drawRecordId: pickStr(payoutLog.drawRecordId),
    payoutLogId: logId,
    title: pickStr(campaign.title, '活动奖励'),
    summary: `${pickStr(campaign.title, '活动奖励')}到账 ¥${formatMoneyFen(amountFen)}`,
  });
  if (!creditResult.ok) {
    return {
      ...(await markPayoutFailed(
        payoutLog,
        pickStr(creditResult.err && creditResult.err.code, 'WALLET_ACTIVITY_CREDIT_FAILED'),
        pickStr(creditResult.err && creditResult.err.msg, '写入奖励记录失败')
      )),
      payoutLogId: logId,
      buildTag: BUILD_TAG,
    };
  }

  return {
    ...(await markPayoutSuccess(payoutLog, {
      payoutMode: 'local_wallet',
      walletLedgerId: pickStr(creditResult.walletLedgerId),
      walletMirrorStatus: 'success',
    })),
    payoutLogId: logId,
    walletLedgerId: pickStr(creditResult.walletLedgerId),
    buildTag: BUILD_TAG,
  };
}

exports.main = async (event = {}) => {
  if (AUTO_CREATE_COLLECTIONS) {
    await Promise.all([
      ensureCollectionExists(PAYOUT_COLLECTION),
      ensureCollectionExists(ADMIN_LOG_COLLECTION),
    ]);
  }

  const { OPENID } = cloud.getWXContext();
  const action = pickStr(event.action, 'process_one');
  const systemCall = isSystemPayoutCall(event);
  const operatorOpenid = pickStr(systemCall ? event.operatorOpenid : '', OPENID);
  const isAdmin = operatorOpenid === PLATFORM_ADMIN_OPENID;

  if (!systemCall && !isAdmin) {
    return { ok: false, err: { code: 'NO_PERMISSION', msg: '仅管理员可执行派奖操作' }, buildTag: BUILD_TAG };
  }

  console.log('[activityPayout] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid: operatorOpenid,
    systemCall,
    payoutMode: resolvePayoutMode(),
    forcePayoutMode: pickStr(event.forcePayoutMode),
  }));

  if (action === 'enqueue_payout') {
    const payoutLogId = pickStr(event.payoutLogId);
    if (!payoutLogId) {
      return { ok: false, err: { code: 'MISSING_PAYOUT_LOG_ID', msg: '缺少 payoutLogId' }, buildTag: BUILD_TAG };
    }
    const payoutLog = await getDocById(PAYOUT_COLLECTION, payoutLogId);
    if (!payoutLog) {
      return { ok: false, err: { code: 'PAYOUT_LOG_NOT_FOUND', msg: '未找到派奖日志' }, buildTag: BUILD_TAG };
    }
    const result = await setPayoutPending(payoutLog, resolvePayoutMode(), '奖励已进入发放队列');
    await writeAdminLog({
      action,
      operatorOpenid,
      campaignId: pickStr(payoutLog.campaignId),
      payloadSnapshot: { payoutLogId },
      result: result.ok ? 'success' : 'failed',
      errorMsg: pickStr(result && result.err && result.err.msg),
    });
    return { ...result, payoutLogId, buildTag: BUILD_TAG };
  }

  if (action === 'process_one' || action === 'sync_status') {
    const result = await processOnePayout({
      payoutLogId: event.payoutLogId,
      operatorOpenid,
      systemCall,
      preferQuery: action === 'sync_status',
      forcePayoutMode: event.forcePayoutMode,
    });
    await writeAdminLog({
      action,
      operatorOpenid,
      campaignId: pickStr(result && result.campaignId, event.campaignId),
      payloadSnapshot: { payoutLogId: pickStr(event.payoutLogId) },
      result: result.ok ? 'success' : 'failed',
      errorMsg: pickStr(result && result.err && result.err.msg),
    });
    return result;
  }

  if (action === 'retry_failed') {
    const singleLogId = pickStr(event.payoutLogId);
    if (singleLogId) {
      const result = await processOnePayout({
        payoutLogId: singleLogId,
        operatorOpenid,
        systemCall,
        forcePayoutMode: event.forcePayoutMode,
      });
      await writeAdminLog({
        action,
        operatorOpenid,
        campaignId: pickStr(event.campaignId),
        payloadSnapshot: { payoutLogId: singleLogId },
        result: result.ok ? 'success' : 'failed',
        errorMsg: pickStr(result && result.err && result.err.msg),
      });
      return result;
    }

    const limit = Math.max(1, Math.min(20, Number(event.limit) || 5));
    let query = db.collection(PAYOUT_COLLECTION).where({ status: 'failed' });
    const campaignId = pickStr(event.campaignId);
    if (campaignId) query = db.collection(PAYOUT_COLLECTION).where({ status: 'failed', campaignId });
    const res = await query.orderBy('updatedAt', 'desc').limit(limit).get();
    const list = (res && res.data) || [];
    const items = [];
    for (const item of list) {
      const one = await processOnePayout({
        payoutLogId: pickStr(item._id),
        operatorOpenid,
        systemCall,
      });
      items.push({
        payoutLogId: pickStr(item._id),
        ok: !!one.ok,
        status: pickStr(one.status),
        errMsg: pickStr(one && one.err && one.err.msg),
      });
    }
    await writeAdminLog({
      action,
      operatorOpenid,
      campaignId,
      payloadSnapshot: { limit, count: items.length },
      result: 'success',
    });
    return {
      ok: true,
      items,
      buildTag: BUILD_TAG,
    };
  }

  return { ok: false, err: { code: 'UNSUPPORTED_ACTION', msg: `unsupported_action:${action}` }, buildTag: BUILD_TAG };
};
