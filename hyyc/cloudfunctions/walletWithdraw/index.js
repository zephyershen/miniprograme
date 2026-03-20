const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const USER_COLLECTION = 'userInfo';
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';
const WITHDRAW_COLLECTION = 'wallet_withdraw_requests';
const BUILD_TAG = 'walletWithdraw@2026-03-20.4';
const DEFAULT_AUTO_CASH_TYPE = 'D1';
const ALLOWED_CASH_TYPES = ['DM', 'D1', 'T1'];
const WITHDRAW_SUBMIT_LOCK_TTL_MS = Math.max(60 * 1000, Number(process.env.WITHDRAW_SUBMIT_LOCK_TTL_MS) || 2 * 60 * 1000);

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
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

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ''));
  } catch (e) {
    return null;
  }
}

function yyyymmdd(d = new Date()) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function randomId(len = 24) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
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

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, Number(ms) || 0));
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
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

function buildEmptyPrimaryWalletSnapshot(openid, now = new Date()) {
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
  if (!walletDocs.length) {
    const snapshot = buildEmptyPrimaryWalletSnapshot(ownerOpenid, now);
    await tx.collection(WALLET_COLLECTION).doc(primaryId).set({ data: snapshot });
    return { walletId: primaryId, wallet: { ...snapshot, _id: primaryId }, legacyDocs: [] };
  }

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

async function ensurePrimaryWalletByOpenid(openid) {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return null;
  await ensureCollectionExists(WALLET_COLLECTION);
  return db.runTransaction(async (tx) => {
    const walletState = await ensurePrimaryWalletDoc(tx, ownerOpenid, new Date());
    return walletState && walletState.wallet ? walletState.wallet : null;
  });
}

function maskCardNo(cardNo = '') {
  const digits = String(cardNo || '').replace(/\s+/g, '');
  if (!digits) return '';
  if (digits.length <= 8) return digits;
  return `${digits.slice(0, 4)} **** **** ${digits.slice(-4)}`;
}

function digitsOnly(v = '') {
  return String(v || '').replace(/\D+/g, '');
}

function getRespCodeDesc(respData = {}) {
  return {
    code: pickStr(respData.resp_code, respData.return_code, respData.code, respData.respCode),
    desc: pickStr(respData.resp_desc, respData.resp_msg, respData.return_msg, respData.message, respData.respDesc),
  };
}

function getBizSuccess(respData = {}) {
  const { code } = getRespCodeDesc(respData);
  return !code || code === '00000000';
}

function resolveWithdrawQueryStatus(huifuData = {}) {
  const subRespCode = pickStr(huifuData.sub_resp_code, huifuData.resp_code);
  const transStatus = pickStr(huifuData.trans_status, huifuData.trans_stat, huifuData.transStat).toUpperCase();
  const acctStatus = pickStr(huifuData.acct_status, huifuData.acctStatus).toUpperCase();
  const channelStatus = pickStr(huifuData.channel_status, huifuData.channelStatus).toUpperCase();
  const isProcessing = transStatus === 'P' || acctStatus === 'P' || channelStatus === 'P';
  const isSuccess = subRespCode === '00000000' && (transStatus === 'S' || acctStatus === 'S' || channelStatus === 'S');
  const isFailed = (subRespCode && subRespCode !== '00000000')
    || transStatus === 'F'
    || acctStatus === 'F'
    || acctStatus === 'B'
    || channelStatus === 'F';
  if (isSuccess) return 'success';
  if (isFailed) return 'failed';
  if (isProcessing) return 'processing';
  return '';
}

function buildSyncWithdrawUserMsg(status = '', statusText = '') {
  if (status === 'success') return '提现已到账';
  if (status === 'failed') {
    return pickStr(statusText) === '已退回'
      ? '提现已退回，请查看钱包明细'
      : '提现状态已更新，请查看结果';
  }
  if (status === 'cleared') return '提现状态已更新';
  return '当前仍在处理中，请稍后再试';
}

function buildAutoOpenCashUserMsg(status = '', { cashType = DEFAULT_AUTO_CASH_TYPE, alreadyOpen = false } = {}) {
  const normalized = pickStr(status).toLowerCase();
  if (alreadyOpen || normalized === 'already_open' || normalized === 'success') {
    return cashType === DEFAULT_AUTO_CASH_TYPE ? '提现功能已准备好' : '提现功能已开通';
  }
  if (normalized === 'pending') {
    return '银行卡已绑定，提现功能准备中，请稍后再试';
  }
  return '银行卡已绑定，提现功能暂未准备好，请稍后刷新';
}

function parseJsonField(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  const parsed = safeJsonParse(v);
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
}

function ensureArray(v) {
  if (Array.isArray(v)) return v;
  return [];
}

function toJsonString(v, maxLen = 12000) {
  if (v == null) return '';
  try {
    const s = JSON.stringify(v);
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch (e) {
    return String(v).slice(0, maxLen);
  }
}

function decorateCashTypeError(msg = '') {
  const text = pickStr(msg);
  if (!text) return '';
  const matched = text.match(/用户未开通([A-Z0-9]+)取现/i);
  if (!matched) return text;
  const cashType = String(matched[1] || '').toUpperCase();
  return `${text}，请联系平台客服开通 ${cashType} 提现权限，然后回到小程序再试一次`;
}

function pickTokenNo({ cardInfo = null, cashCardList = [] } = {}) {
  const direct = pickStr(cardInfo && cardInfo.token_no, cardInfo && cardInfo.tokenNo);
  if (direct) return direct;
  for (const item of ensureArray(cashCardList)) {
    const tokenNo = pickStr(item && item.token_no, item && item.tokenNo);
    if (tokenNo) return tokenNo;
  }
  return '';
}

function pickEnabledCashTypes(cashConfigList = []) {
  const out = [];
  for (const item of ensureArray(cashConfigList)) {
    const switchState = pickStr(item && item.switch_state, item && item.switchState, item && item.status);
    const cashType = pickStr(item && item.cash_type, item && item.cashType).toUpperCase();
    if (switchState === '1' && cashType && !out.includes(cashType)) out.push(cashType);
  }
  return out;
}

function mergeCashTypes(...lists) {
  const out = [];
  for (const list of lists) {
    for (const item of ensureArray(list)) {
      const cashType = pickStr(item).toUpperCase();
      if (cashType && !out.includes(cashType)) out.push(cashType);
    }
  }
  return out;
}

function pickPreferredAcct(acctInfoList = []) {
  const list = ensureArray(acctInfoList).map(item => ({
    ...item,
    acct_type: pickStr(item && item.acct_type, item && item.acctType),
    acct_id: pickStr(item && item.acct_id, item && item.acctId),
    avl_bal: Number(item && (item.avl_bal || item.avlBal || 0)),
    balance_amt: Number(item && (item.balance_amt || item.balanceAmt || 0)),
  }));
  const byType = (type) => list.find(item => item.acct_type === type && Number.isFinite(item.avl_bal) && item.avl_bal > 0);
  return byType('01')
    || byType('02')
    || list.find(item => item.acct_type === '01')
    || list.find(item => item.acct_type === '02')
    || list[0]
    || null;
}

function pickBoundCashCard(cashCardInfoList = [], tokenNo = '') {
  const targetTokenNo = pickStr(tokenNo);
  const list = ensureArray(cashCardInfoList);
  if (targetTokenNo) {
    const matched = list.find(item => pickStr(item && item.token_no, item && item.tokenNo) === targetTokenNo);
    if (matched) return matched;
  }
  return list[0] || null;
}

function buildCardInfoForModify(cashCard = {}, cert = {}) {
  const cardInfo = {
    card_type: pickStr(cashCard.card_type, cashCard.cardType, '1'),
    card_name: pickStr(cashCard.card_name, cashCard.cardName),
    card_no: pickStr(cashCard.card_no, cashCard.cardNo),
    prov_id: pickStr(cashCard.prov_id, cashCard.provId),
    area_id: pickStr(cashCard.area_id, cashCard.areaId),
    cert_type: pickStr(cashCard.cert_type, cashCard.certType, cert.certType),
    cert_no: pickStr(cashCard.cert_no, cashCard.certNo, cert.certNo),
    cert_validity_type: pickStr(cashCard.cert_validity_type, cashCard.certValidityType, cert.certValidityType),
    cert_begin_date: pickStr(cashCard.cert_begin_date, cashCard.certBeginDate, cert.certBeginDate),
    is_settle_default: pickStr(cashCard.is_settle_default, cashCard.isSettleDefault, 'Y'),
  };
  const bankMobile = pickStr(cashCard.mp, cashCard.mobile_no, cashCard.mobileNo);
  if (bankMobile) cardInfo.mp = bankMobile;
  const certEndDate = pickStr(cashCard.cert_end_date, cashCard.certEndDate, cert.certEndDate);
  if (cardInfo.cert_validity_type === '0' && certEndDate) cardInfo.cert_end_date = certEndDate;
  if (!cardInfo.card_name || !cardInfo.card_no || !cardInfo.prov_id || !cardInfo.area_id || !cardInfo.cert_no || !cardInfo.cert_begin_date) {
    return null;
  }
  return cardInfo;
}

async function ensureCashTypeOpenedForUser({
  openid = '',
  user = {},
  huifuId = '',
  cashType = DEFAULT_AUTO_CASH_TYPE,
  tokenNo = '',
  boundCardInfo = null,
  currentCashTypes = [],
} = {}) {
  const targetCashType = pickStr(cashType, DEFAULT_AUTO_CASH_TYPE).toUpperCase();
  if (!ALLOWED_CASH_TYPES.includes(targetCashType)) {
    return { ok: false, err: { code: 'UNSUPPORTED_CASH_TYPE', msg: '当前提现方式暂不支持' } };
  }
  if (!pickStr(openid) || !pickStr(huifuId)) {
    return { ok: false, err: { code: 'USER_NOT_READY', msg: '提现功能暂时不可用' } };
  }

  const mergedCurrentCashTypes = mergeCashTypes(currentCashTypes, user && user.withdrawCard && user.withdrawCard.cashTypes);
  if (mergedCurrentCashTypes.includes(targetCashType)) {
    return {
      ok: true,
      status: 'already_open',
      cashType: targetCashType,
      alreadyOpen: true,
      msg: buildAutoOpenCashUserMsg('already_open', { cashType: targetCashType, alreadyOpen: true }),
    };
  }

  const cardInfo = buildCardInfoForModify(boundCardInfo || {}, normalizeUserCertInfo(user));
  if (!pickStr(tokenNo) || !cardInfo) {
    return { ok: false, err: { code: 'CARD_NOT_BOUND', msg: '银行卡信息尚未准备好' } };
  }

  const openResult = await callHuifu('user_busi_open', {
    userHuifuId: huifuId,
    cashType: targetCashType,
    cardInfo,
  });
  if (!openResult || !openResult.ok) {
    return { ok: false, err: { code: 'USER_BUSI_OPEN_FAILED', msg: pickStr(openResult && openResult.err && openResult.err.msg, '提现功能开通失败') } };
  }
  const openRespData = openResult.huifuResp || {};
  const openCodeDesc = getRespCodeDesc(openRespData);
  if (!getBizSuccess(openRespData)) {
    return {
      ok: false,
      err: {
        code: 'USER_BUSI_OPEN_BIZ_FAILED',
        msg: decorateCashTypeError(openCodeDesc.desc ? `${openCodeDesc.code}:${openCodeDesc.desc}` : (openCodeDesc.code || '提现功能开通失败')),
        respData: openRespData,
      },
    };
  }
  const openRespBusiness = ensureArray(parseJsonField(openRespData.resp_business));
  const openCashBiz = openRespBusiness.find(item => pickStr(item && item.type) === '2');
  const openBizCode = pickStr(openCashBiz && openCashBiz.code).toUpperCase();
  const openBizMsg = pickStr(openCashBiz && openCashBiz.msg);
  if (!openCashBiz || (openBizCode && openBizCode !== 'S' && openBizCode !== 'P')) {
    return {
      ok: false,
      err: {
        code: 'USER_BUSI_OPEN_CASH_NOT_CONFIRMED',
        msg: decorateCashTypeError(
          pickStr(
            openBizMsg,
            openCodeDesc.desc ? `${openCodeDesc.code}:${openCodeDesc.desc}` : '',
            `补开用户业务入驻未返回 type=2 的${targetCashType}取现开通结果`
          )
        ),
        respData: openRespData,
      },
    };
  }

  const cashConfig = [{
    switch_state: '1',
    cash_type: targetCashType,
    fix_amt: '0.00',
    fee_rate: '0.00',
  }];

  const result = await callHuifu('user_busi_modify', {
    userHuifuId: huifuId,
    cardInfo,
    cashConfig,
  });
  if (!result || !result.ok) {
    return { ok: false, err: { code: 'OPEN_CASH_FAILED', msg: pickStr(result && result.err && result.err.msg, '提现功能开通失败') } };
  }

  const respData = result.huifuResp || {};
  const { code, desc } = getRespCodeDesc(respData);
  if (!getBizSuccess(respData)) {
    await updateUserWithdrawSnapshot(openid, {
      reqDate: pickStr(result.reqDate),
      reqSeqId: pickStr(result.reqSeqId),
      lastRespCode: code,
      lastRespDesc: desc,
      lastError: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '提现功能开通失败')),
    });
    return {
      ok: false,
      err: {
        code: 'HUIFU_BIZ_ERROR',
        msg: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '提现功能开通失败')),
        respData,
      },
    };
  }

  const withdrawCard = user.withdrawCard && typeof user.withdrawCard === 'object' ? user.withdrawCard : {};
  const respBusiness = ensureArray(parseJsonField(respData.resp_business));
  const cashBiz = respBusiness.find(item => pickStr(item && item.type) === '2');
  const bizCode = pickStr(cashBiz && cashBiz.code).toUpperCase();
  const bizMsg = pickStr(cashBiz && cashBiz.msg);
  const status = bizCode === 'P' ? 'pending' : (bizCode && bizCode !== 'S' ? 'failed' : 'success');
  const mergedCashTypes = status === 'success'
    ? mergeCashTypes(mergedCurrentCashTypes, [targetCashType])
    : mergeCashTypes(mergedCurrentCashTypes);

  await updateUserWithdrawSnapshot(openid, {
    cashTypes: mergedCashTypes,
    reqDate: pickStr(result.reqDate),
    reqSeqId: pickStr(result.reqSeqId),
    lastRespCode: code,
    lastRespDesc: desc,
    lastError: status === 'failed'
      ? decorateCashTypeError(pickStr(bizMsg, desc || code))
      : '',
  });

  if (status === 'failed') {
    return {
      ok: false,
      err: {
        code: 'OPEN_CASH_BIZ_FAILED',
        msg: decorateCashTypeError(pickStr(bizMsg, desc || '提现功能开通失败')),
        respData,
      },
    };
  }

  return {
    ok: true,
    status,
    cashType: targetCashType,
    reqDate: pickStr(result.reqDate),
    reqSeqId: pickStr(result.reqSeqId),
    msg: buildAutoOpenCashUserMsg(status, { cashType: targetCashType }),
  };
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

async function getUserByOpenid(openid) {
  const res = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

async function getWalletByOpenid(openid) {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return null;
  await ensureCollectionExists(WALLET_COLLECTION);
  const res = await db.collection(WALLET_COLLECTION).where({ _openid: ownerOpenid }).limit(20).get();
  const list = (res && res.data) || [];
  if (!list.length) {
    try {
      const created = await ensurePrimaryWalletByOpenid(ownerOpenid);
      if (created) return created;
    } catch (err) {
      console.error('[walletWithdraw] init wallet doc failed', err);
    }
    return null;
  }
  const primaryId = getPrimaryWalletId(ownerOpenid);
  const primaryDoc = list.find((item) => pickStr(item && item._id) === primaryId) || null;
  const hasActionableLegacy = list.some((item) => {
    const walletId = pickStr(item && item._id);
    if (!walletId || walletId === primaryId) return false;
    return !isLegacyShadowWallet(item) || pickStr(item && item.shadowOf) !== primaryId;
  });
  const needsRepair = !primaryDoc || hasActionableLegacy;
  if (needsRepair && list.length) {
    try {
      const repaired = await ensurePrimaryWalletByOpenid(ownerOpenid);
      if (repaired) return repaired;
    } catch (err) {
      console.error('[walletWithdraw] repair wallet doc failed', err);
    }
  }
  return primaryDoc || list[0] || null;
}

async function callHuifu(action, data = {}) {
  const callRes = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: { action, ...data },
  });
  return (callRes && callRes.result) || callRes || null;
}

async function updateUserWithdrawSnapshot(openid, patch = {}) {
  if (!openid || !patch || typeof patch !== 'object') return;
  const user = await getUserByOpenid(openid);
  if (!user || !user._id) return;
  const prev = user.withdrawCard && typeof user.withdrawCard === 'object' ? user.withdrawCard : {};
  await db.collection(USER_COLLECTION).doc(user._id).update({
    data: {
      withdrawCard: {
        ...prev,
        ...patch,
        updatedAt: new Date(),
      },
      updatedAt: new Date(),
    }
  });
}

function isWithdrawSubmitLockActive(lock = {}, nowMs = Date.now()) {
  const status = pickStr(lock.status).toLowerCase();
  if (['released', 'done', 'failed'].includes(status)) return false;
  return !!pickStr(lock.lockId) && toDateMs(lock.expiresAt) > nowMs;
}

async function acquireWithdrawSubmitLock(userId) {
  const normalizedUserId = pickStr(userId);
  if (!normalizedUserId) {
    return { ok: false, err: { code: 'MISSING_USER_ID', msg: '缺少用户信息' } };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const lockId = `WS${yyyymmdd(now)}${randomId(18)}`;
  const expiresAt = new Date(nowMs + WITHDRAW_SUBMIT_LOCK_TTL_MS);

  return db.runTransaction(async (tx) => {
    const docRes = await tx.collection(USER_COLLECTION).doc(normalizedUserId).get();
    const user = docRes && docRes.data ? docRes.data : null;
    if (!user) return { ok: false, err: { code: 'USER_NOT_FOUND', msg: '未找到用户信息' } };

    const currentLock = user.withdrawSubmitLock && typeof user.withdrawSubmitLock === 'object'
      ? user.withdrawSubmitLock
      : {};
    if (isWithdrawSubmitLockActive(currentLock, nowMs)) {
      return { ok: false, err: { code: 'WITHDRAW_SUBMIT_LOCKED', msg: '正在处理上一笔提现请求，请稍后再试' } };
    }

    await tx.collection(USER_COLLECTION).doc(normalizedUserId).update({
      data: {
        withdrawSubmitLock: {
          lockId,
          status: 'locked',
          createdAt: now,
          updatedAt: now,
          expiresAt,
        },
        updatedAt: now,
      }
    });

    return { ok: true, lock: { lockId, expiresAt } };
  });
}

async function releaseWithdrawSubmitLock(userId, lockId, extra = {}) {
  const normalizedUserId = pickStr(userId);
  const normalizedLockId = pickStr(lockId);
  if (!normalizedUserId || !normalizedLockId) return;

  try {
    const docRes = await db.collection(USER_COLLECTION).doc(normalizedUserId).get();
    const user = docRes && docRes.data ? docRes.data : null;
    if (!user) return;
    const currentLock = user.withdrawSubmitLock && typeof user.withdrawSubmitLock === 'object'
      ? user.withdrawSubmitLock
      : {};
    if (pickStr(currentLock.lockId) !== normalizedLockId) return;

    await db.collection(USER_COLLECTION).doc(normalizedUserId).update({
      data: {
        withdrawSubmitLock: {
          ...currentLock,
          ...extra,
          status: pickStr(extra.status, 'released'),
          updatedAt: new Date(),
          releasedAt: new Date(),
          expiresAt: new Date(),
        },
        updatedAt: new Date(),
      }
    });
  } catch (e) {
    console.error('[walletWithdraw] release submit lock failed', e);
  }
}

async function upsertWithdrawRequestDoc({ openid, reqDate, reqSeqId, patch = {}, base = {} }) {
  if (!openid || !reqDate || !reqSeqId) return;
  const existsReq = await db.collection(WITHDRAW_COLLECTION)
    .where({ _openid: openid, reqDate, reqSeqId })
    .limit(1)
    .get();
  const existsList = (existsReq && existsReq.data) || [];
  const now = new Date();
  if (existsList.length && existsList[0] && existsList[0]._id) {
    await db.collection(WITHDRAW_COLLECTION).doc(existsList[0]._id).update({
      data: {
        ...patch,
        updatedAt: now,
      }
    });
    return;
  }
  await db.collection(WITHDRAW_COLLECTION).add({
    data: {
      _openid: openid,
      reqDate,
      reqSeqId,
      ...base,
      ...patch,
      createdAt: now,
      updatedAt: now,
    }
  });
}

async function findActiveWithdrawRequest(openid) {
  const res = await db.collection(WITHDRAW_COLLECTION)
    .where({
      _openid: openid,
      status: _.in(['processing', 'pending', 'submitting', 'request_sent']),
    })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

async function findWithdrawRequestByReq(openid, reqDate, reqSeqId) {
  const rd = pickStr(reqDate);
  const rs = pickStr(reqSeqId);
  if (!openid || !rd || !rs) return null;
  const res = await db.collection(WITHDRAW_COLLECTION)
    .where({ _openid: openid, reqDate: rd, reqSeqId: rs })
    .limit(1)
    .get();
  const list = (res && res.data) || [];
  return list[0] || null;
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
  startingBalance,
  affectsBalance,
  fundChannel,
  extra = {},
}) {
  const ownerOpenid = pickStr(openid);
  const txType = pickStr(type);
  const key = pickStr(bizKey);
  const amt = roundMoney(amount);
  const baseline = Number(startingBalance);
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
    if (existsList.length) {
      const doc = existsList[0] || {};
      return { ok: true, existed: true, balanceAfter: Number(doc.balanceAfter || 0) };
    }

    const createdAt = new Date();
    const walletState = await ensurePrimaryWalletDoc(tx, ownerOpenid, createdAt);
    const walletDoc = walletState && walletState.wallet ? walletState.wallet : null;
    const walletId = pickStr(walletState && walletState.walletId);

    let currentBalance = Number(walletDoc && walletDoc.balance || 0);
    if (Number.isFinite(baseline) && baseline > currentBalance) currentBalance = roundMoney(baseline);

    const nextBalance = roundMoney(currentBalance + delta);
    const incomeDelta = delta > 0 ? delta : 0;
    const expenseDelta = delta < 0 ? Math.abs(delta) : 0;

    if (walletDoc && walletId) {
      await tx.collection(WALLET_COLLECTION).doc(walletId).update({
        data: {
          balance: nextBalance,
          incomeTotal: roundMoney(Number(walletDoc.incomeTotal || 0) + incomeDelta),
          expenseTotal: roundMoney(Number(walletDoc.expenseTotal || 0) + expenseDelta),
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
        createdAt,
        updatedAt: createdAt,
        extra,
      }
    });

    return { ok: true, balanceAfter: nextBalance };
  });
}

async function applyWithdrawQueryResult({ reqDoc, huifuData }) {
  if (!reqDoc || !reqDoc._id) return false;
  const rd = pickStr(reqDoc.reqDate);
  const rs = pickStr(reqDoc.reqSeqId);
  const subRespCode = pickStr(huifuData.sub_resp_code, huifuData.resp_code);
  const subRespDesc = pickStr(huifuData.sub_resp_desc, huifuData.resp_desc);
  const transStatus = pickStr(huifuData.trans_status, huifuData.trans_stat, huifuData.transStat).toUpperCase();
  const acctStatus = pickStr(huifuData.acct_status, huifuData.acctStatus).toUpperCase();
  const channelStatus = pickStr(huifuData.channel_status, huifuData.channelStatus).toUpperCase();
  const feeAmt = roundMoney(Number(huifuData.fee_amt || reqDoc.feeAmt || 0));
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

  await db.collection(WITHDRAW_COLLECTION).doc(reqDoc._id).update({
    data: {
      status,
      statusText,
      hfSeqId: pickStr(huifuData.hf_seq_id, huifuData.hfSeqId, reqDoc.hfSeqId),
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
  return true;
}

async function refreshActiveWithdrawStatus({ openid, huifuId, activeWithdraw }) {
  const reqDate = pickStr(activeWithdraw && activeWithdraw.reqDate);
  const reqSeqId = pickStr(activeWithdraw && activeWithdraw.reqSeqId);
  if (!openid || !huifuId || !reqDate || !reqSeqId) return { ok: false, code: 'MISSING_ACTIVE_WITHDRAW' };
  const queryResult = await callHuifu('withdraw_query', {
    userHuifuId: huifuId,
    orgReqDate: reqDate,
    orgReqSeqId: reqSeqId,
    orgHfSeqId: pickStr(activeWithdraw && activeWithdraw.hfSeqId),
  });
  if (!queryResult || !queryResult.ok) {
    return {
      ok: false,
      code: 'WITHDRAW_QUERY_FAILED',
      msg: pickStr(queryResult && queryResult.err && queryResult.err.msg, '提现结果查询失败')
    };
  }
  const respData = queryResult.huifuResp || {};
  if (!getBizSuccess(respData)) {
    return {
      ok: false,
      code: 'WITHDRAW_QUERY_BIZ_FAILED',
      msg: pickStr(getRespCodeDesc(respData).desc, getRespCodeDesc(respData).code, '提现结果查询失败'),
      respData,
    };
  }
  const reqDoc = await findWithdrawRequestByReq(openid, reqDate, reqSeqId);
  if (!reqDoc) return { ok: false, code: 'WITHDRAW_DOC_NOT_FOUND' };
  await applyWithdrawQueryResult({ reqDoc, huifuData: respData });
  return { ok: true, respData };
}

function normalizeUserCertInfo(user = {}) {
  const certBeginDate = digitsOnly(user.certBeginDate);
  const certEndDate = digitsOnly(user.certEndDate);
  const certValidityType = pickStr(user.certValidityType) === 'long' ? '1' : '0';
  return {
    certType: '00',
    certNo: pickStr(user.idNumber),
    certValidityType,
    certBeginDate,
    certEndDate: certValidityType === '0' ? certEndDate : '',
  };
}

async function loadHuifuProfile(user = {}, opts = {}) {
  const huifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);
  if (!huifuId) {
    return { ok: false, err: { code: 'MISSING_HUIFU_ID', msg: '请先完成收款开通' } };
  }
  if (pickStr(user.huifu_open_status) !== 'success' || pickStr(user.user_busi_status) !== 'success') {
    return { ok: false, err: { code: 'USER_NOT_READY', msg: '收款未就绪，暂时无法提现' } };
  }

  const [infoResult, balanceResult, walletDoc, activeWithdraw] = await Promise.all([
    callHuifu('user_info_query', { userHuifuId: huifuId }),
    callHuifu('acct_balance_query', { userHuifuId: huifuId }),
    getWalletByOpenid(pickStr(user._openid)),
    findActiveWithdrawRequest(pickStr(user._openid)),
  ]);

  if (!infoResult || !infoResult.ok) {
    return { ok: false, err: { code: 'USER_INFO_QUERY_FAILED', msg: pickStr(infoResult && infoResult.err && infoResult.err.msg, '用户信息查询失败') } };
  }
  if (!balanceResult || !balanceResult.ok) {
    return { ok: false, err: { code: 'BALANCE_QUERY_FAILED', msg: pickStr(balanceResult && balanceResult.err && balanceResult.err.msg, '账户余额查询失败') } };
  }

  const infoResp = infoResult.huifuResp || {};
  const balanceResp = balanceResult.huifuResp || {};
  const infoCode = getRespCodeDesc(infoResp);
  const balanceCode = getRespCodeDesc(balanceResp);
  if (!getBizSuccess(infoResp)) {
    return { ok: false, err: { code: 'USER_INFO_BIZ_FAILED', msg: infoCode.desc ? `${infoCode.code}:${infoCode.desc}` : (infoCode.code || '用户信息查询失败') } };
  }
  if (!getBizSuccess(balanceResp)) {
    return { ok: false, err: { code: 'BALANCE_BIZ_FAILED', msg: balanceCode.desc ? `${balanceCode.code}:${balanceCode.desc}` : (balanceCode.code || '账户余额查询失败') } };
  }

  const cardInfo = parseJsonField(infoResp.card_info) || {};
  const cashConfigList = ensureArray(parseJsonField(infoResp.qry_cash_config_list));
  const cashCardInfoList = ensureArray(parseJsonField(infoResp.qry_cash_card_info_list));
  const acctInfoList = ensureArray(parseJsonField(balanceResp.acctInfo_list));
  const preferredAcct = pickPreferredAcct(acctInfoList);
  const availableBalance = roundMoney(preferredAcct && Number(preferredAcct.avl_bal || 0));
  const tokenNo = pickTokenNo({ cardInfo, cashCardList: cashCardInfoList });
  const enabledCashTypes = pickEnabledCashTypes(cashConfigList);
  const localBalance = roundMoney(walletDoc && Number(walletDoc.balance || 0));
  let withdrawRefresh = opts.withdrawRefresh || null;
  let autoOpenCash = opts.autoOpenCash || null;

  if (activeWithdraw && !opts.skipWithdrawRefresh) {
    const refreshed = await refreshActiveWithdrawStatus({
      openid: pickStr(user._openid),
      huifuId,
      activeWithdraw,
    });
    withdrawRefresh = refreshed && refreshed.ok
      ? {
        queried: true,
        ok: true,
        msg: `主动查询成功：${pickStr(
          refreshed.respData && (
            refreshed.respData.sub_resp_desc
            || refreshed.respData.resp_desc
            || refreshed.respData.trans_status
            || refreshed.respData.trans_stat
          ),
          '已刷新提现状态'
        )}`,
      }
      : {
        queried: true,
        ok: false,
        msg: pickStr(refreshed && refreshed.msg, '主动查询失败，仍显示旧状态'),
      };
    if (refreshed && refreshed.ok) {
      return loadHuifuProfile(user, { ...opts, skipWithdrawRefresh: true, withdrawRefresh });
    }
  }

  if (tokenNo && !enabledCashTypes.includes(DEFAULT_AUTO_CASH_TYPE) && !opts.skipAutoOpenCash) {
    const autoOpenResult = await ensureCashTypeOpenedForUser({
      openid: pickStr(user._openid),
      user,
      huifuId,
      cashType: DEFAULT_AUTO_CASH_TYPE,
      tokenNo,
      boundCardInfo: pickBoundCashCard(cashCardInfoList, tokenNo) || cardInfo,
      currentCashTypes: enabledCashTypes,
    });
    autoOpenCash = autoOpenResult && autoOpenResult.ok
      ? {
        attempted: true,
        ok: true,
        status: pickStr(autoOpenResult.status),
        msg: pickStr(autoOpenResult.msg),
      }
      : {
        attempted: true,
        ok: false,
        msg: pickStr(autoOpenResult && autoOpenResult.err && autoOpenResult.err.msg, '提现功能自动开通失败'),
      };
    if (autoOpenResult && autoOpenResult.ok) {
      await sleep(800);
      return loadHuifuProfile(user, { ...opts, skipAutoOpenCash: true, autoOpenCash });
    }
  }

  return {
    ok: true,
    data: {
      huifuId,
      infoResp,
      balanceResp,
      cardInfo,
      cashConfigList,
      cashCardInfoList,
      acctInfoList,
      preferredAcct,
      availableBalance,
      tokenNo,
      enabledCashTypes,
      localBalance,
      activeWithdraw,
    }
  };
}

async function loadWalletSummary(user = {}) {
  const huifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);
  if (!huifuId) {
    return { ok: false, err: { code: 'MISSING_HUIFU_ID', msg: '用户尚未开通收款' } };
  }
  if (pickStr(user.huifu_open_status) !== 'success' || pickStr(user.user_busi_status) !== 'success') {
    return { ok: false, err: { code: 'USER_NOT_READY', msg: '收款未就绪' } };
  }

  const balanceResult = await callHuifu('acct_balance_query', { userHuifuId: huifuId });

  if (!balanceResult || !balanceResult.ok) {
    return { ok: false, err: { code: 'BALANCE_QUERY_FAILED', msg: pickStr(balanceResult && balanceResult.err && balanceResult.err.msg, '账户余额查询失败') } };
  }

  const balanceResp = balanceResult.huifuResp || {};
  const balanceCode = getRespCodeDesc(balanceResp);
  if (!getBizSuccess(balanceResp)) {
    return { ok: false, err: { code: 'BALANCE_BIZ_FAILED', msg: balanceCode.desc ? `${balanceCode.code}:${balanceCode.desc}` : (balanceCode.code || '账户余额查询失败') } };
  }

  const acctInfoList = ensureArray(parseJsonField(balanceResp.acctInfo_list));
  const preferredAcct = pickPreferredAcct(acctInfoList);
  const availableBalance = roundMoney(preferredAcct && Number(preferredAcct.avl_bal || 0));
  const walletDoc = await getWalletByOpenid(pickStr(user._openid));
  const localBalance = roundMoney(walletDoc && Number(walletDoc.balance || 0));

  return {
    ok: true,
    data: {
      huifuId,
      availableBalance,
      localBalance,
    }
  };
}

exports.main = async (event = {}) => {
  const action = pickStr(event.action, 'profile');
  if (action !== 'wallet_summary') {
    await ensureCollectionExists(WITHDRAW_COLLECTION);
  }

  const { OPENID } = cloud.getWXContext();
  const systemCompensate = isSystemCompensateCall(event);
  if (systemCompensate && !['sync_active_withdraw', 'activity_credit', 'activity_revert', 'wallet_summary'].includes(action)) {
    return { ok: false, err: { code: 'SYSTEM_ACTION_NOT_ALLOWED', msg: '当前系统只支持同步提现状态、补发活动奖励或回退测试奖励' }, buildTag: BUILD_TAG };
  }
  const effectiveOpenid = pickStr(systemCompensate ? event.targetOpenid : '', OPENID);
  console.log('[walletWithdraw] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid: effectiveOpenid,
    systemCompensate,
    eventKeys: Object.keys(event || {}).sort().slice(0, 30),
  }));
  if (!effectiveOpenid) {
    return { ok: false, err: { code: 'NO_OPENID', msg: '获取用户身份失败' }, buildTag: BUILD_TAG };
  }

  const user = await getUserByOpenid(effectiveOpenid);
  if (!user || !user._id) {
    return { ok: false, err: { code: 'USER_NOT_FOUND', msg: '未找到用户信息，请重新登录后重试' }, buildTag: BUILD_TAG };
  }

  if (action === 'profile') {
    const profile = await loadHuifuProfile(user);
    if (!profile.ok) return { ...profile, buildTag: BUILD_TAG };

    let data = profile.data || {};
    const cardInfo = data.cardInfo || {};
    const withdrawCard = user.withdrawCard && typeof user.withdrawCard === 'object' ? user.withdrawCard : {};
    const activeWithdraw = data.activeWithdraw || null;

    const cardStatus = pickStr(
      withdrawCard.status,
      data.tokenNo ? 'success' : ''
    ) || 'unbound';

    const snapshot = {
      status: data.tokenNo ? 'success' : pickStr(withdrawCard.status, 'unbound'),
      tokenNo: pickStr(data.tokenNo, withdrawCard.tokenNo),
      applyNo: pickStr(withdrawCard.applyNo),
      cardNoMask: maskCardNo(pickStr(cardInfo.card_no, cardInfo.cardNo, withdrawCard.cardNoMask)),
      cardName: pickStr(cardInfo.card_name, cardInfo.cardName, withdrawCard.cardName, user.name),
      provId: pickStr(cardInfo.prov_id, cardInfo.provId, withdrawCard.provId),
      areaId: pickStr(cardInfo.area_id, cardInfo.areaId, withdrawCard.areaId),
      bankMobile: pickStr(cardInfo.mp, cardInfo.mobile_no, withdrawCard.bankMobile),
      cashTypes: data.enabledCashTypes,
      lastError: pickStr(withdrawCard.lastError),
      reqDate: pickStr(withdrawCard.reqDate),
      reqSeqId: pickStr(withdrawCard.reqSeqId),
      updatedAt: new Date(),
    };
    await updateUserWithdrawSnapshot(effectiveOpenid, snapshot);

    return {
      ok: true,
      profile: {
        huifuId: data.huifuId,
        realname: pickStr(user.name),
        phone: pickStr(user.phone),
        idNumberLast4: pickStr(user.idNumber).slice(-4),
        availableBalance: data.availableBalance,
        availableBalanceText: formatMoney(data.availableBalance),
        localBalance: data.localBalance,
        localBalanceText: formatMoney(data.localBalance),
        preferredAcct: data.preferredAcct ? {
          acctId: pickStr(data.preferredAcct.acct_id),
          acctType: pickStr(data.preferredAcct.acct_type),
          avlBal: formatMoney(data.preferredAcct.avl_bal),
        } : null,
        hasBoundCard: !!data.tokenNo,
        tokenNo: pickStr(data.tokenNo),
        cardStatus,
        cardStatusText: cardStatus === 'success'
          ? '已绑定'
          : (cardStatus === 'processing' ? '处理中' : (cardStatus === 'failed' ? '失败' : '未绑定')),
        cardInfo: {
          cardNoMask: snapshot.cardNoMask,
          cardName: snapshot.cardName,
          provId: snapshot.provId,
          areaId: snapshot.areaId,
          bankMobile: snapshot.bankMobile,
        },
        enabledCashTypes: data.enabledCashTypes,
        activeWithdraw: activeWithdraw ? {
          amount: formatMoney(activeWithdraw.amount),
          reqDate: pickStr(activeWithdraw.reqDate),
          reqSeqId: pickStr(activeWithdraw.reqSeqId),
          hfSeqId: pickStr(activeWithdraw.hfSeqId),
          status: pickStr(activeWithdraw.status),
          statusText: pickStr(activeWithdraw.statusText, activeWithdraw.status),
        } : null,
      },
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'activity_credit') {
    if (!systemCompensate) {
      return { ok: false, err: { code: 'NO_PERMISSION', msg: '活动奖励发放仅支持系统调用' }, buildTag: BUILD_TAG };
    }
    const amount = roundMoney(event.amount);
    if (!(amount > 0)) {
      return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '活动奖励金额不正确' }, buildTag: BUILD_TAG };
    }
    const campaignId = pickStr(event.campaignId);
    const drawRecordId = pickStr(event.drawRecordId);
    const payoutLogId = pickStr(event.payoutLogId);
    const bizKey = pickStr(event.bizKey, `activity_income:${campaignId}:${drawRecordId || payoutLogId || randomId(12)}`);
    const ledgerRes = await recordWalletTransaction({
      openid: effectiveOpenid,
      amount,
      type: 'activity_income',
      bizKey,
      title: pickStr(event.title, '活动奖金'),
      summary: pickStr(event.summary, `活动奖金到账 ¥${formatMoney(amount)}`),
      relatedId: pickStr(event.relatedId, drawRecordId, payoutLogId, campaignId),
      extra: {
        campaignId,
        drawRecordId,
        payoutLogId,
      }
    });
    if (!ledgerRes || !ledgerRes.ok) {
      return { ok: false, err: { code: 'LEDGER_FAILED', msg: '活动奖励记录写入失败' }, buildTag: BUILD_TAG };
    }
    return {
      ok: true,
      ledgerId: pickStr(ledgerRes.tx && ledgerRes.tx._id, ledgerRes.tx && ledgerRes.tx.id),
      tx: ledgerRes.tx || null,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'activity_revert') {
    if (!systemCompensate) {
      return { ok: false, err: { code: 'NO_PERMISSION', msg: '活动奖励回退仅支持系统调用' }, buildTag: BUILD_TAG };
    }
    const campaignId = pickStr(event.campaignId);
    const drawRecordId = pickStr(event.drawRecordId);
    const payoutLogId = pickStr(event.payoutLogId);
    const sourceBizKey = pickStr(
      event.sourceBizKey,
      campaignId && drawRecordId ? `activity_income:${campaignId}:${drawRecordId}` : ''
    );
    if (!sourceBizKey) {
      return { ok: false, err: { code: 'MISSING_SOURCE_BIZKEY', msg: '缺少原奖励记录标识' }, buildTag: BUILD_TAG };
    }
    const revertBizKey = pickStr(
      event.revertBizKey,
      `activity_revert:${campaignId}:${drawRecordId || payoutLogId || randomId(12)}`
    );

    const [sourceRes, revertRes] = await Promise.all([
      db.collection(TRANSACTIONS_COLLECTION).where({
        _openid: effectiveOpenid,
        bizKey: sourceBizKey,
      }).limit(1).get(),
      db.collection(TRANSACTIONS_COLLECTION).where({
        _openid: effectiveOpenid,
        bizKey: revertBizKey,
      }).limit(1).get(),
    ]);
    const sourceTx = ((sourceRes && sourceRes.data) || [])[0] || null;
    const existingRevertTx = ((revertRes && revertRes.data) || [])[0] || null;
    if (existingRevertTx) {
      return {
        ok: true,
        existed: true,
        ledgerId: pickStr(existingRevertTx._id),
        tx: existingRevertTx,
        buildTag: BUILD_TAG,
      };
    }
    if (!sourceTx) {
      return { ok: false, err: { code: 'SOURCE_LEDGER_NOT_FOUND', msg: '未找到原活动奖励记录' }, buildTag: BUILD_TAG };
    }

    const amount = roundMoney(
      event.amount != null && event.amount !== ''
        ? event.amount
        : Number(sourceTx.amount || 0)
    );
    if (!(amount > 0)) {
      return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '活动奖励回退金额不正确' }, buildTag: BUILD_TAG };
    }

    const revertSummary = pickStr(
      event.summary,
      `测试活动删除，已回退本地奖励 ¥${formatMoney(amount)}`
    );
    const ledgerRes = await recordWalletTransaction({
      openid: effectiveOpenid,
      amount: -amount,
      balanceDelta: -amount,
      type: 'activity_revert',
      bizKey: revertBizKey,
      title: pickStr(event.title, '活动奖励回退'),
      summary: revertSummary,
      relatedId: pickStr(event.relatedId, drawRecordId, payoutLogId, campaignId),
      extra: {
        campaignId,
        drawRecordId,
        payoutLogId,
        sourceBizKey,
        sourceLedgerId: pickStr(sourceTx._id),
      }
    });
    if (!ledgerRes || !ledgerRes.ok) {
      return { ok: false, err: { code: 'LEDGER_FAILED', msg: '活动奖励回退记录写入失败' }, buildTag: BUILD_TAG };
    }
    return {
      ok: true,
      ledgerId: pickStr(ledgerRes.tx && ledgerRes.tx._id, ledgerRes.tx && ledgerRes.tx.id),
      tx: ledgerRes.tx || null,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'sync_active_withdraw') {
    const huifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);
    if (!huifuId) {
      return { ok: false, err: { code: 'MISSING_HUIFU_ID', msg: '暂时无法同步提现状态' }, buildTag: BUILD_TAG };
    }
    if (pickStr(user.huifu_open_status) !== 'success' || pickStr(user.user_busi_status) !== 'success') {
      return { ok: false, err: { code: 'USER_NOT_READY', msg: '暂时无法同步提现状态' }, buildTag: BUILD_TAG };
    }

    const reqDate = pickStr(event.reqDate);
    const reqSeqId = pickStr(event.reqSeqId);
    let targetWithdraw = null;
    if (reqDate && reqSeqId) {
      targetWithdraw = await findWithdrawRequestByReq(effectiveOpenid, reqDate, reqSeqId);
    }
    if (!targetWithdraw) {
      targetWithdraw = await findActiveWithdrawRequest(effectiveOpenid);
    }
    if (!targetWithdraw) {
      return {
        ok: true,
        sync: {
          status: 'cleared',
          statusText: '已完成',
          userMsg: '当前没有处理中提现吗'
        },
        buildTag: BUILD_TAG,
      };
    }

    const syncTarget = {
      ...targetWithdraw,
      hfSeqId: pickStr(event.hfSeqId, targetWithdraw.hfSeqId),
    };
    let refreshed = await refreshActiveWithdrawStatus({
      openid: effectiveOpenid,
      huifuId,
      activeWithdraw: syncTarget,
    });

    if (refreshed && refreshed.ok && resolveWithdrawQueryStatus(refreshed.respData) === 'processing') {
      await sleep(1200);
      const latestTarget = await findWithdrawRequestByReq(effectiveOpenid, pickStr(syncTarget.reqDate), pickStr(syncTarget.reqSeqId));
      refreshed = await refreshActiveWithdrawStatus({
        openid: effectiveOpenid,
        huifuId,
        activeWithdraw: latestTarget || syncTarget,
      });
    }

    if (!refreshed || !refreshed.ok) {
      return {
        ok: false,
        err: {
          code: pickStr(refreshed && refreshed.code, 'SYNC_WITHDRAW_FAILED'),
          msg: pickStr(refreshed && refreshed.msg, '同步提现状态失败')
        },
        buildTag: BUILD_TAG,
      };
    }

    const latestDoc = await findWithdrawRequestByReq(effectiveOpenid, pickStr(syncTarget.reqDate), pickStr(syncTarget.reqSeqId));
    const latestStatus = pickStr(
      latestDoc && latestDoc.status,
      resolveWithdrawQueryStatus(refreshed.respData),
      'processing'
    );
    const latestStatusText = pickStr(
      latestDoc && latestDoc.statusText,
      latestStatus === 'success' ? '成功' : (latestStatus === 'failed' ? '失败' : '处理中')
    );

    return {
      ok: true,
      sync: {
        status: latestStatus,
        statusText: latestStatusText,
        userMsg: buildSyncWithdrawUserMsg(latestStatus, latestStatusText),
      },
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'wallet_summary') {
    const summary = await loadWalletSummary(user);
    if (!summary.ok) return { ...summary, buildTag: BUILD_TAG };

    const data = summary.data || {};
    return {
      ok: true,
      summary: {
        availableBalance: data.availableBalance,
        availableBalanceText: formatMoney(data.availableBalance),
        localBalance: data.localBalance,
        localBalanceText: formatMoney(data.localBalance),
      },
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'bind_card') {
    const inputCardNo = digitsOnly(event.cardNo);
    let cardNo = inputCardNo;
    const provId = digitsOnly(event.provId);
    const areaId = digitsOnly(event.areaId);
    let bankMobile = digitsOnly(event.bankMobile);
    const cert = normalizeUserCertInfo(user);

    if (!/^\d{6}$/.test(provId) || !/^\d{6}$/.test(areaId)) {
      return { ok: false, err: { code: 'INVALID_AREA', msg: '请选择银行卡开户地址（省、市）' }, buildTag: BUILD_TAG };
    }
    if (bankMobile && !/^1\d{10}$/.test(bankMobile)) {
      return { ok: false, err: { code: 'INVALID_BANK_MOBILE', msg: '银行卡预留手机号格式不正确' }, buildTag: BUILD_TAG };
    }
    if (!pickStr(user.name) || !cert.certNo || !cert.certBeginDate) {
      return { ok: false, err: { code: 'MISSING_REALNAME_DATA', msg: '实名资料不完整，无法绑定银行卡' }, buildTag: BUILD_TAG };
    }
    if (cert.certValidityType === '0' && !cert.certEndDate) {
      return { ok: false, err: { code: 'MISSING_CERT_END_DATE', msg: '身份证有效期截止日期缺失，无法绑定银行卡' }, buildTag: BUILD_TAG };
    }

    const huifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);
    if (!huifuId || pickStr(user.huifu_open_status) !== 'success' || pickStr(user.user_busi_status) !== 'success') {
      return { ok: false, err: { code: 'USER_NOT_READY', msg: '收款未就绪，暂时无法绑定提现卡' }, buildTag: BUILD_TAG };
    }

    if (!cardNo) {
      const infoResult = await callHuifu('user_info_query', { userHuifuId: huifuId });
      if (!infoResult || !infoResult.ok) {
        return {
          ok: false,
          err: { code: 'BOUND_CARD_LOOKUP_FAILED', msg: pickStr(infoResult && infoResult.err && infoResult.err.msg, '读取已绑卡信息失败，请重新输入银行卡号') },
          buildTag: BUILD_TAG,
        };
      }
      const infoResp = infoResult.huifuResp || {};
      const infoCode = getRespCodeDesc(infoResp);
      if (!getBizSuccess(infoResp)) {
        return {
          ok: false,
          err: { code: 'BOUND_CARD_LOOKUP_BIZ_FAILED', msg: infoCode.desc ? `${infoCode.code}:${infoCode.desc}` : '读取已绑卡信息失败，请重新输入银行卡号' },
          buildTag: BUILD_TAG,
        };
      }
      const currentCardInfo = parseJsonField(infoResp.card_info) || {};
      const currentCashCardInfoList = ensureArray(parseJsonField(infoResp.qry_cash_card_info_list));
      const tokenNo = pickTokenNo({ cardInfo: currentCardInfo, cashCardList: currentCashCardInfoList });
      const boundCardInfo = pickBoundCashCard(currentCashCardInfoList, tokenNo) || currentCardInfo;
      cardNo = digitsOnly(pickStr(boundCardInfo && (boundCardInfo.card_no || boundCardInfo.cardNo)));
      if (!bankMobile) {
        bankMobile = digitsOnly(pickStr(boundCardInfo && (boundCardInfo.mp || boundCardInfo.mobile_no || boundCardInfo.mobileNo)));
      }
    }
    if (!cardNo || cardNo.length < 10) {
      return {
        ok: false,
        err: { code: 'INVALID_CARD_NO', msg: inputCardNo ? '银行卡号格式不正确' : '已绑卡信息不完整，请重新输入银行卡号后再保存' },
        buildTag: BUILD_TAG
      };
    }

    const cardInfo = {
      card_type: '1',
      card_name: pickStr(user.name),
      card_no: cardNo,
      prov_id: provId,
      area_id: areaId,
      cert_type: cert.certType,
      cert_no: cert.certNo,
      cert_validity_type: cert.certValidityType,
      cert_begin_date: cert.certBeginDate,
      is_settle_default: 'Y',
    };
    if (bankMobile) cardInfo.mp = bankMobile;
    if (cert.certValidityType === '0') cardInfo.cert_end_date = cert.certEndDate;

    const result = await callHuifu('user_busi_modify', {
      userHuifuId: huifuId,
      cardInfo,
    });
    if (!result || !result.ok) {
      return { ok: false, err: { code: 'USER_BUSI_MODIFY_FAILED', msg: pickStr(result && result.err && result.err.msg, '绑定银行卡失败') }, buildTag: BUILD_TAG };
    }

    const respData = result.huifuResp || {};
    const { code, desc } = getRespCodeDesc(respData);
    if (!getBizSuccess(respData)) {
      await updateUserWithdrawSnapshot(effectiveOpenid, {
        status: 'failed',
        cardNoMask: maskCardNo(cardNo),
        cardName: pickStr(user.name),
        provId,
        areaId,
        bankMobile,
        reqDate: pickStr(result.reqDate),
        reqSeqId: pickStr(result.reqSeqId),
        lastRespCode: code,
        lastRespDesc: desc,
        lastError: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '绑定银行卡失败')),
      });
      return {
        ok: false,
        err: {
          code: 'HUIFU_BIZ_ERROR',
          msg: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '绑定银行卡失败')),
          respData
        },
        buildTag: BUILD_TAG,
      };
    }

    const respBusiness = ensureArray(parseJsonField(respData.resp_business));
    const applyNo = pickStr(respData.apply_no, respData.applyNo);
    const tokenNo = pickStr(respData.token_no, respData.tokenNo);
    const bindBiz = respBusiness.find(item => pickStr(item && item.type) === '1');
    const bindOk = !!tokenNo || pickStr(bindBiz && bindBiz.code).toUpperCase() === 'S';
    const status = tokenNo && bindOk ? 'success' : (applyNo ? 'pending' : (bindOk ? 'success' : 'failed'));

    await updateUserWithdrawSnapshot(effectiveOpenid, {
      status,
      tokenNo,
      applyNo,
      cardNoMask: maskCardNo(cardNo),
      cardName: pickStr(user.name),
      provId,
      areaId,
      bankMobile,
      reqDate: pickStr(result.reqDate),
      reqSeqId: pickStr(result.reqSeqId),
      lastRespCode: code,
      lastRespDesc: desc,
      lastError: status === 'failed'
        ? pickStr((bindBiz && bindBiz.msg), desc || code)
        : '',
    });

    if (status === 'failed') {
      return {
        ok: false,
        err: {
          code: 'BIND_CARD_FAILED',
          msg: pickStr((bindBiz && bindBiz.msg), desc || '绑定银行卡失败'),
          respData,
        },
        buildTag: BUILD_TAG
      };
    }

    let autoOpen = null;
    if (status === 'success' && tokenNo) {
      autoOpen = await ensureCashTypeOpenedForUser({
        openid: effectiveOpenid,
        user,
        huifuId,
        cashType: DEFAULT_AUTO_CASH_TYPE,
        tokenNo,
        boundCardInfo: cardInfo,
        currentCashTypes: mergeCashTypes(user && user.withdrawCard && user.withdrawCard.cashTypes),
      });
    }

    const successPrefix = inputCardNo ? '银行卡已绑定' : '银行卡信息已更新';
    const pendingMsg = inputCardNo
      ? '银行卡申请已提交，审核通过后会自动开通提现功能'
      : '银行卡信息更新申请已提交，审核通过后会自动开通提现功能';
    const userMsg = status !== 'success'
      ? pendingMsg
      : (
        autoOpen && autoOpen.ok
          ? (pickStr(autoOpen.status) === 'pending'
            ? `${successPrefix}，提现功能准备中，请稍后再试`
            : `${successPrefix}，可直接提现`)
          : (autoOpen && autoOpen.err
            ? `${successPrefix}，提现功能暂未准备好，请稍后刷新`
            : successPrefix)
      );

    return {
      ok: true,
      status,
      tokenNo,
      applyNo,
      reqDate: pickStr(result.reqDate),
      reqSeqId: pickStr(result.reqSeqId),
      autoOpen: autoOpen ? {
        ok: !!autoOpen.ok,
        status: pickStr(autoOpen.status),
        msg: pickStr(autoOpen.ok ? autoOpen.msg : autoOpen.err && autoOpen.err.msg),
      } : null,
      canWithdrawNow: status === 'success' && !!(autoOpen && autoOpen.ok && pickStr(autoOpen.status) !== 'pending'),
      msg: userMsg,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'open_cash') {
    const cashType = pickStr(event.cashType, DEFAULT_AUTO_CASH_TYPE).toUpperCase();
    if (!ALLOWED_CASH_TYPES.includes(cashType)) {
      return { ok: false, err: { code: 'UNSUPPORTED_CASH_TYPE', msg: '当前仅支持 DM / D1 / T1 取现方式，请不要选择 D0' }, buildTag: BUILD_TAG };
    }

    const huifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);
    if (!huifuId || pickStr(user.huifu_open_status) !== 'success' || pickStr(user.user_busi_status) !== 'success') {
      return { ok: false, err: { code: 'USER_NOT_READY', msg: '收款未就绪，暂时无法开通到账方式' }, buildTag: BUILD_TAG };
    }
    const profile = await loadHuifuProfile(user);
    if (!profile.ok) return { ...profile, buildTag: BUILD_TAG };

    const data = profile.data || {};
    if (!data.tokenNo) {
      return { ok: false, err: { code: 'CARD_NOT_BOUND', msg: '请先绑定提现银行卡' }, buildTag: BUILD_TAG };
    }
    const boundCashCard = pickBoundCashCard(data.cashCardInfoList, data.tokenNo);
    const cardInfo = buildCardInfoForModify(boundCashCard, normalizeUserCertInfo(user));
    if (!cardInfo) {
      return { ok: false, err: { code: 'BOUND_CARD_INFO_MISSING', msg: '已绑卡信息不完整，请重新绑定银行卡后再开通到账方式' }, buildTag: BUILD_TAG };
    }

    const openResult = await callHuifu('user_busi_open', {
      userHuifuId: huifuId,
      cashType,
      cardInfo,
    });
    if (!openResult || !openResult.ok) {
      return { ok: false, err: { code: 'USER_BUSI_OPEN_FAILED', msg: pickStr(openResult && openResult.err && openResult.err.msg, '补开用户业务入驻失败') }, buildTag: BUILD_TAG };
    }
    const openRespData = openResult.huifuResp || {};
    const openCodeDesc = getRespCodeDesc(openRespData);
    if (!getBizSuccess(openRespData)) {
      return {
        ok: false,
        err: {
          code: 'USER_BUSI_OPEN_BIZ_FAILED',
          msg: decorateCashTypeError(openCodeDesc.desc ? `${openCodeDesc.code}:${openCodeDesc.desc}` : (openCodeDesc.code || '补开用户业务入驻失败')),
          respData: openRespData,
        },
        buildTag: BUILD_TAG,
      };
    }
    const openRespBusiness = ensureArray(parseJsonField(openRespData.resp_business));
    const openCashBiz = openRespBusiness.find(item => pickStr(item && item.type) === '2');
    const openBizCode = pickStr(openCashBiz && openCashBiz.code).toUpperCase();
    const openBizMsg = pickStr(openCashBiz && openCashBiz.msg);
    if (!openCashBiz || (openBizCode && openBizCode !== 'S' && openBizCode !== 'P')) {
      const openCashMsg = decorateCashTypeError(
        pickStr(
          openBizMsg,
          openCodeDesc.desc ? `${openCodeDesc.code}:${openCodeDesc.desc}` : '',
          `补开用户业务入驻未返回 type=2 的${cashType}取现开通结果`
        )
      );
      await updateUserWithdrawSnapshot(effectiveOpenid, {
        reqDate: pickStr(openResult.reqDate),
        reqSeqId: pickStr(openResult.reqSeqId),
        lastRespCode: openCodeDesc.code,
        lastRespDesc: openCodeDesc.desc,
        lastError: openCashMsg,
      });
      return {
        ok: false,
        err: {
          code: 'USER_BUSI_OPEN_CASH_NOT_CONFIRMED',
          msg: openCashMsg,
          respData: openRespData,
        },
        buildTag: BUILD_TAG,
      };
    }

    const cashConfig = [{
      switch_state: '1',
      cash_type: cashType,
      fix_amt: '0.00',
      fee_rate: '0.00',
    }];

    const result = await callHuifu('user_busi_modify', {
      userHuifuId: huifuId,
      cardInfo,
      cashConfig,
    });
    if (!result || !result.ok) {
      return { ok: false, err: { code: 'OPEN_CASH_FAILED', msg: pickStr(result && result.err && result.err.msg, '开通到账方式失败') }, buildTag: BUILD_TAG };
    }

    const respData = result.huifuResp || {};
    const { code, desc } = getRespCodeDesc(respData);
    if (!getBizSuccess(respData)) {
      await updateUserWithdrawSnapshot(effectiveOpenid, {
        reqDate: pickStr(result.reqDate),
        reqSeqId: pickStr(result.reqSeqId),
        lastRespCode: code,
        lastRespDesc: desc,
        lastError: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '开通到账方式失败')),
      });
      return {
        ok: false,
        err: {
          code: 'HUIFU_BIZ_ERROR',
          msg: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '开通到账方式失败')),
          respData,
        },
        buildTag: BUILD_TAG,
      };
    }

    const withdrawCard = user.withdrawCard && typeof user.withdrawCard === 'object' ? user.withdrawCard : {};
    const respBusiness = ensureArray(parseJsonField(respData.resp_business));
    const cashBiz = respBusiness.find(item => pickStr(item && item.type) === '2');
    const bizCode = pickStr(cashBiz && cashBiz.code).toUpperCase();
    const bizMsg = pickStr(cashBiz && cashBiz.msg);
    const status = bizCode === 'P' ? 'pending' : (bizCode && bizCode !== 'S' ? 'failed' : 'success');
    const mergedCashTypes = status === 'success'
      ? mergeCashTypes(withdrawCard.cashTypes, [cashType])
      : mergeCashTypes(withdrawCard.cashTypes);

    await updateUserWithdrawSnapshot(effectiveOpenid, {
      cashTypes: mergedCashTypes,
      reqDate: pickStr(result.reqDate),
      reqSeqId: pickStr(result.reqSeqId),
      lastRespCode: code,
      lastRespDesc: desc,
      lastError: status === 'failed'
        ? decorateCashTypeError(pickStr(bizMsg, desc || code))
        : '',
    });

    if (status === 'failed') {
      return {
        ok: false,
        err: {
          code: 'OPEN_CASH_BIZ_FAILED',
          msg: decorateCashTypeError(pickStr(bizMsg, desc || '开通到账方式失败')),
          respData,
        },
        buildTag: BUILD_TAG,
      };
    }

    return {
      ok: true,
      status,
      cashType,
      reqDate: pickStr(result.reqDate),
      reqSeqId: pickStr(result.reqSeqId),
      msg: status === 'success'
        ? `到账方式 ${cashType} 已开通`
        : `到账方式 ${cashType} 开通申请已提交，请稍后刷新查看`,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'submit') {
    const amount = roundMoney(event.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, err: { code: 'INVALID_AMOUNT', msg: '提现金额不合法' }, buildTag: BUILD_TAG };
    }

    const profile = await loadHuifuProfile(user);
    if (!profile.ok) return { ...profile, buildTag: BUILD_TAG };

    let data = profile.data || {};
    const activeWithdraw = data.activeWithdraw || null;
    if (activeWithdraw) {
      return { ok: false, err: { code: 'WITHDRAW_PENDING', msg: '当前有一笔提现处理中，预计次日到账，请留意银行卡余额变动。' }, buildTag: BUILD_TAG };
    }
    if (!data.tokenNo) {
      return { ok: false, err: { code: 'CARD_NOT_BOUND', msg: '请先绑定提现银行卡' }, buildTag: BUILD_TAG };
    }
    if (!data.preferredAcct || !pickStr(data.preferredAcct.acct_id)) {
      return { ok: false, err: { code: 'NO_ACCOUNT', msg: '未找到可提现账户' }, buildTag: BUILD_TAG };
    }
    if (amount > Number(data.availableBalance || 0)) {
      return { ok: false, err: { code: 'AMOUNT_EXCEEDS_BALANCE', msg: `提现金额不能超过可提现余额 ¥${formatMoney(data.availableBalance)}` }, buildTag: BUILD_TAG };
    }

    const intoAcctDateType = pickStr(event.intoAcctDateType, (data.enabledCashTypes || [])[0], DEFAULT_AUTO_CASH_TYPE).toUpperCase();
    if (!ALLOWED_CASH_TYPES.includes(intoAcctDateType)) {
      return { ok: false, err: { code: 'UNSUPPORTED_CASH_TYPE', msg: '当前仅支持 DM / D1 / T1 取现方式，请不要选择 D0' }, buildTag: BUILD_TAG };
    }

    if (!data.enabledCashTypes.includes(intoAcctDateType)) {
      const autoOpenResult = await ensureCashTypeOpenedForUser({
        openid: effectiveOpenid,
        user,
        huifuId: data.huifuId,
        cashType: intoAcctDateType,
        tokenNo: pickStr(data.tokenNo),
        boundCardInfo: pickBoundCashCard(data.cashCardInfoList, data.tokenNo) || data.cardInfo,
        currentCashTypes: data.enabledCashTypes,
      });
      if (!autoOpenResult || !autoOpenResult.ok) {
        return { ok: false, err: { code: 'CASH_TYPE_PREPARING', msg: '提现功能准备中，请稍后再试' }, buildTag: BUILD_TAG };
      }
      if (pickStr(autoOpenResult.status) === 'pending') {
        return { ok: false, err: { code: 'CASH_TYPE_PREPARING', msg: '提现功能准备中，请稍后再试' }, buildTag: BUILD_TAG };
      }

      await sleep(800);
      const refreshedProfile = await loadHuifuProfile(user, { skipAutoOpenCash: true });
      if (!refreshedProfile.ok) return { ...refreshedProfile, buildTag: BUILD_TAG };
      data = refreshedProfile.data || data;
    }
    if (!data.enabledCashTypes.includes(intoAcctDateType)) {
      return { ok: false, err: { code: 'CASH_TYPE_NOT_OPENED', msg: '提现功能准备中，请稍后再试' }, buildTag: BUILD_TAG };
    }

    const submitLockResult = await acquireWithdrawSubmitLock(user._id);
    if (!submitLockResult || !submitLockResult.ok) {
      return {
        ok: false,
        err: submitLockResult && submitLockResult.err
          ? submitLockResult.err
          : { code: 'WITHDRAW_SUBMIT_LOCKED', msg: '正在处理上一笔提现请求，请稍后再试' },
        buildTag: BUILD_TAG,
      };
    }

    const submitLockId = pickStr(submitLockResult && submitLockResult.lock && submitLockResult.lock.lockId);

    try {
      const remark = pickStr(event.remark, '钱包提现');
      const requestReqDate = yyyymmdd(new Date());
      const requestReqSeqId = pickStr(event.reqSeqId, `WDAPP${requestReqDate}${randomId(18)}`);
      const debugCardNoMask = maskCardNo(pickStr(data.cardInfo && (data.cardInfo.card_no || data.cardInfo.cardNo)));
      await upsertWithdrawRequestDoc({
        openid: effectiveOpenid,
        reqDate: requestReqDate,
        reqSeqId: requestReqSeqId,
        base: {
          huifuId: data.huifuId,
          amount,
          amountText: formatMoney(amount),
          tokenNo: pickStr(data.tokenNo),
          intoAcctDateType,
          acctId: pickStr(data.preferredAcct && data.preferredAcct.acct_id),
          acctType: pickStr(data.preferredAcct && data.preferredAcct.acct_type),
          cardNoMask: debugCardNoMask,
        },
        patch: {
          status: 'submitting',
          statusText: '提交中',
          lastRespCode: '',
          lastRespDesc: '',
          replacedActiveWithdrawReqSeqId: pickStr(activeWithdraw && activeWithdraw.reqSeqId),
        }
      });
      const result = await callHuifu('withdraw_apply', {
        reqDate: requestReqDate,
        reqSeqId: requestReqSeqId,
        userHuifuId: data.huifuId,
        acctId: pickStr(data.preferredAcct && data.preferredAcct.acct_id),
        tokenNo: pickStr(data.tokenNo),
        intoAcctDateType,
        amount: formatMoney(amount),
        remark,
      });

      const debugReqDate = pickStr(result && result.reqDate, requestReqDate);
      const debugReqSeqId = pickStr(result && result.reqSeqId, requestReqSeqId);
      if (debugReqDate && debugReqSeqId) {
        await upsertWithdrawRequestDoc({
          openid: effectiveOpenid,
          reqDate: debugReqDate,
          reqSeqId: debugReqSeqId,
          base: {
            huifuId: data.huifuId,
            amount,
            amountText: formatMoney(amount),
            tokenNo: pickStr(data.tokenNo),
            intoAcctDateType,
            acctId: pickStr(data.preferredAcct && data.preferredAcct.acct_id),
            acctType: pickStr(data.preferredAcct && data.preferredAcct.acct_type),
            cardNoMask: debugCardNoMask,
          },
          patch: {
            status: 'request_sent',
            statusText: '已发起请求',
            copyableRequestJson: toJsonString(result && result.copyableRequest),
            copyableResponseJson: toJsonString(result && result.copyableResponse),
            lastRespCode: '',
            lastRespDesc: '',
            replacedActiveWithdrawReqSeqId: pickStr(activeWithdraw && activeWithdraw.reqSeqId),
          }
        });
      }

      if (!result || !result.ok) {
        if (debugReqDate && debugReqSeqId) {
          await upsertWithdrawRequestDoc({
            openid: effectiveOpenid,
            reqDate: debugReqDate,
            reqSeqId: debugReqSeqId,
            patch: {
              status: 'failed',
              statusText: '失败',
              lastRespCode: pickStr(result && result.err && result.err.code),
              lastRespDesc: pickStr(result && result.err && result.err.msg),
              copyableRequestJson: toJsonString(result && result.copyableRequest),
              copyableResponseJson: toJsonString(result && result.copyableResponse),
            }
          });
        }
        return {
          ok: false,
          err: { code: 'WITHDRAW_CALL_FAILED', msg: pickStr(result && result.err && result.err.msg, '提现申请失败') },
          buildTag: BUILD_TAG,
        };
      }

      const respData = result.huifuResp || {};
      const { code, desc } = getRespCodeDesc(respData);
      const transStat = pickStr(respData.trans_stat, respData.transStat).toUpperCase();
      if (!getBizSuccess(respData) || !['S', 'P'].includes(transStat || 'P')) {
        const failReqDate = pickStr(result.reqDate, respData.req_date, respData.reqDate, requestReqDate);
        const failReqSeqId = pickStr(result.reqSeqId, respData.req_seq_id, respData.reqSeqId, requestReqSeqId);
        if (failReqDate && failReqSeqId) {
          await upsertWithdrawRequestDoc({
            openid: effectiveOpenid,
            reqDate: failReqDate,
            reqSeqId: failReqSeqId,
            patch: {
              status: 'failed',
              statusText: '失败',
              lastRespCode: code,
              lastRespDesc: desc,
              rawRespBrief: JSON.stringify(respData || {}).slice(0, 1200),
              copyableRequestJson: toJsonString(result && result.copyableRequest),
              copyableResponseJson: toJsonString(result && result.copyableResponse),
            }
          });
        }
        return {
          ok: false,
          err: {
            code: 'HUIFU_BIZ_ERROR',
            msg: decorateCashTypeError(desc ? `${code}:${desc}` : (code || '提现申请失败')),
            respData,
          },
          buildTag: BUILD_TAG,
        };
      }

      const reqDate = pickStr(result.reqDate, respData.req_date, respData.reqDate, requestReqDate);
      const reqSeqId = pickStr(result.reqSeqId, respData.req_seq_id, respData.reqSeqId, requestReqSeqId);
      const hfSeqId = pickStr(respData.hf_seq_id, respData.hfSeqId);
      const bizKey = `withdraw:${reqDate}:${reqSeqId}`;
      const relatedId = `${reqDate}_${reqSeqId}`;
      const cardNoMask = debugCardNoMask;
      const status = transStat === 'S' ? 'success' : 'processing';
      const statusText = status === 'success' ? '成功' : '处理中';

      const ledgerRes = await recordWalletTransaction({
        openid: effectiveOpenid,
        amount: -amount,
        type: 'withdraw',
        bizKey,
        title: '提现',
        summary: `提现 ¥${formatMoney(amount)} 到 ${cardNoMask || '银行卡'}`,
        relatedId,
        startingBalance: Number(data.availableBalance || 0),
        extra: {
          reqDate,
          reqSeqId,
          hfSeqId,
          status,
        }
      });
      if (!ledgerRes || !ledgerRes.ok) {
        return { ok: false, err: { code: 'LEDGER_FAILED', msg: '提现账本写入失败，请检查后重试' }, buildTag: BUILD_TAG };
      }

      const reqDoc = {
        huifuId: data.huifuId,
        hfSeqId,
        amount,
        amountText: formatMoney(amount),
        tokenNo: pickStr(data.tokenNo),
        intoAcctDateType,
        acctId: pickStr(data.preferredAcct && data.preferredAcct.acct_id),
        acctType: pickStr(data.preferredAcct && data.preferredAcct.acct_type),
        cardNoMask,
        status,
        statusText,
        lastRespCode: code,
        lastRespDesc: desc,
        rawRespBrief: JSON.stringify(respData || {}).slice(0, 1200),
        copyableRequestJson: toJsonString(result && result.copyableRequest),
        copyableResponseJson: toJsonString(result && result.copyableResponse),
        ledgerBizKey: bizKey,
        ledgerReverted: false,
        replacedActiveWithdrawReqSeqId: pickStr(activeWithdraw && activeWithdraw.reqSeqId),
      };

      await upsertWithdrawRequestDoc({
        openid: effectiveOpenid,
        reqDate,
        reqSeqId,
        base: {
          huifuId: data.huifuId,
        },
        patch: reqDoc
      });

      return {
        ok: true,
        status,
        statusText,
        amount: formatMoney(amount),
        reqDate,
        reqSeqId,
        hfSeqId,
        msg: status === 'success' ? '提现成功' : '提现申请已提交，正在处理中',
        buildTag: BUILD_TAG,
      };
    } finally {
      await releaseWithdrawSubmitLock(user._id, submitLockId, { status: 'done' });
    }
  }

  return { ok: false, err: { code: 'UNSUPPORTED_ACTION', msg: `不支持的 action: ${action}` }, buildTag: BUILD_TAG };
};
