const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const WALLET_COLLECTION = 'wallets';
const TRANSACTION_COLLECTION = 'wallet_transactions';
const WITHDRAW_COLLECTION = 'wallet_withdraw_requests';
const DRAW_COLLECTION = 'activity_draw_records';
const LOG_COLLECTION = 'admin_user_recovery_logs';

const BUILD_TAG = 'adminRestoreUserAccount@2026-03-19.1';
const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function uniqueList(list = []) {
  return Array.from(new Set(ensureArray(list).map((item) => pickStr(item)).filter(Boolean)));
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

function safeJsonParse(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch (err) {
    return null;
  }
}

function parseJsonField(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  const parsed = safeJsonParse(v);
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
}

function getRespCodeDesc(resp = {}) {
  return {
    code: pickStr(resp && (resp.resp_code || resp.return_code || resp.code || resp.respCode)),
    desc: pickStr(resp && (resp.resp_desc || resp.return_msg || resp.message || resp.respDesc)),
  };
}

function getBizSuccess(respData = {}) {
  const { code } = getRespCodeDesc(respData);
  return !code || code === '00000000';
}

function pickPreferredAcct(acctInfoList = []) {
  const list = ensureArray(acctInfoList).map((item) => ({
    ...item,
    acct_type: pickStr(item && item.acct_type, item && item.acctType),
    acct_id: pickStr(item && item.acct_id, item && item.acctId),
    avl_bal: Number(item && (item.avl_bal || item.avlBal || 0)),
  }));
  const byType = (type) => list.find((item) => item.acct_type === type && Number.isFinite(item.avl_bal) && item.avl_bal > 0);
  return byType('01')
    || byType('02')
    || list.find((item) => item.acct_type === '01')
    || list.find((item) => item.acct_type === '02')
    || list[0]
    || null;
}

async function ensureCollectionExists(name = '') {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (err) {
    // ignore
  }
}

async function querySingleByWhere(collectionName = '', where = {}) {
  const res = await db.collection(collectionName).where(where).limit(2).get();
  const list = (res && res.data) || [];
  if (!list.length) return { ok: false, code: 'NOT_FOUND', msg: '未找到匹配用户' };
  if (list.length > 1) return { ok: false, code: 'MULTIPLE_MATCHED', msg: '匹配到多条用户，请改用 openid 或用户ID' };
  return { ok: true, doc: list[0] };
}

async function resolveUser(selector = {}) {
  const targetUserId = pickStr(selector.targetUserId);
  const targetOpenid = pickStr(selector.targetOpenid);
  const targetPhone = pickStr(selector.targetPhone);
  const targetIdNumber = pickStr(selector.targetIdNumber);

  if (targetUserId) {
    try {
      const res = await db.collection(USER_COLLECTION).doc(targetUserId).get();
      const doc = res && res.data ? res.data : null;
      if (doc && doc._id) return { ok: true, doc };
    } catch (err) {
      // ignore
    }
  }
  if (targetOpenid) return querySingleByWhere(USER_COLLECTION, { _openid: targetOpenid });
  if (targetPhone) return querySingleByWhere(USER_COLLECTION, { phone: targetPhone });
  if (targetIdNumber) return querySingleByWhere(USER_COLLECTION, { idNumber: targetIdNumber });
  return { ok: false, code: 'MISSING_SELECTOR', msg: '请先填写用户 openid、手机号、用户ID 或身份证号之一' };
}

async function loadWalletSummaryByOpenid(openid = '') {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return { walletBalance: 0, walletCount: 0, txCount: 0 };
  const [walletRes, txCountRes] = await Promise.all([
    db.collection(WALLET_COLLECTION).where({ _openid: ownerOpenid }).limit(20).get().catch(() => ({ data: [] })),
    db.collection(TRANSACTION_COLLECTION).where({ _openid: ownerOpenid }).count().catch(() => ({ total: 0 })),
  ]);
  const wallets = (walletRes && walletRes.data) || [];
  const walletBalance = roundMoney(wallets.reduce((sum, item) => sum + Number(item && item.balance ? item.balance : 0), 0));
  return {
    walletBalance,
    walletBalanceText: formatMoney(walletBalance),
    walletCount: wallets.length,
    txCount: Number(txCountRes && txCountRes.total) || 0,
  };
}

async function loadWithdrawCandidates(openid = '') {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return [];
  const res = await db.collection(WITHDRAW_COLLECTION)
    .where({ _openid: ownerOpenid })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
    .catch(() => ({ data: [] }));
  const list = (res && res.data) || [];
  return list.map((item) => ({
    huifuId: pickStr(item && item.huifuId),
    source: 'withdraw_request',
    sourceLabel: '提现申请记录',
    reqDate: pickStr(item && item.reqDate),
    reqSeqId: pickStr(item && item.reqSeqId),
    createdAt: item && item.createdAt ? item.createdAt : null,
  })).filter((item) => item.huifuId);
}

async function loadActivityCandidates(openid = '') {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return [];
  const res = await db.collection(DRAW_COLLECTION)
    .where({ openid: ownerOpenid })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
    .catch(() => ({ data: [] }));
  const list = (res && res.data) || [];
  return list.map((item) => ({
    huifuId: pickStr(item && item.userHuifuId),
    source: 'activity_record',
    sourceLabel: '活动参与记录',
    campaignId: pickStr(item && item.campaignId),
    createdAt: item && item.createdAt ? item.createdAt : null,
  })).filter((item) => item.huifuId);
}

async function queryHuifuSnapshot(huifuId = '') {
  const targetHuifuId = pickStr(huifuId);
  if (!targetHuifuId) return null;
  try {
    const [infoRet, balanceRet] = await Promise.all([
      cloud.callFunction({
        name: 'huifuMiniappPay',
        data: { action: 'user_info_query', userHuifuId: targetHuifuId }
      }),
      cloud.callFunction({
        name: 'huifuMiniappPay',
        data: { action: 'acct_balance_query', userHuifuId: targetHuifuId }
      }),
    ]);

    const infoResult = (infoRet && infoRet.result) || infoRet || {};
    const balanceResult = (balanceRet && balanceRet.result) || balanceRet || {};
    const infoResp = infoResult && infoResult.huifuResp ? infoResult.huifuResp : {};
    const balanceResp = balanceResult && balanceResult.huifuResp ? balanceResult.huifuResp : {};
    const infoCode = getRespCodeDesc(infoResp);
    const balanceCode = getRespCodeDesc(balanceResp);
    const acctInfoList = ensureArray(parseJsonField(balanceResp.acctInfo_list));
    const preferredAcct = pickPreferredAcct(acctInfoList);
    const availableBalance = roundMoney(preferredAcct && Number(preferredAcct.avl_bal || 0));
    const cardInfo = parseJsonField(infoResp.card_info) || {};
    return {
      huifuId: targetHuifuId,
      queryOk: !!(infoResult && infoResult.ok && balanceResult && balanceResult.ok && getBizSuccess(infoResp) && getBizSuccess(balanceResp)),
      availableBalance,
      availableBalanceText: formatMoney(availableBalance),
      acctId: pickStr(preferredAcct && preferredAcct.acct_id),
      acctType: pickStr(preferredAcct && preferredAcct.acct_type),
      cardName: pickStr(cardInfo.card_name, cardInfo.cardName),
      cardNoMask: pickStr(cardInfo.card_no, cardInfo.cardNo),
      infoCode: infoCode.code,
      infoDesc: infoCode.desc,
      balanceCode: balanceCode.code,
      balanceDesc: balanceCode.desc,
      infoResult: infoResult && infoResult.ok === true,
      balanceResult: balanceResult && balanceResult.ok === true,
    };
  } catch (err) {
    return {
      huifuId: targetHuifuId,
      queryOk: false,
      availableBalance: 0,
      availableBalanceText: '0.00',
      infoCode: '',
      infoDesc: pickStr(err && (err.message || err.errMsg), '查询失败'),
      balanceCode: '',
      balanceDesc: '',
      infoResult: false,
      balanceResult: false,
    };
  }
}

function buildCandidateMap({ manualHuifuId = '', currentHuifuId = '', withdrawCandidates = [], activityCandidates = [] } = {}) {
  const map = {};
  const register = (huifuId = '', source = '', meta = {}) => {
    const key = pickStr(huifuId);
    if (!key) return;
    if (!map[key]) {
      map[key] = {
        huifuId: key,
        sources: [],
      };
    }
    if (source && !map[key].sources.includes(source)) map[key].sources.push(source);
    Object.assign(map[key], meta || {});
  };

  register(manualHuifuId, manualHuifuId ? 'manual_input' : '', { sourceLabel: manualHuifuId ? '手动输入' : '' });
  register(currentHuifuId, currentHuifuId ? 'current_user' : '', { sourceLabel: currentHuifuId ? '当前用户资料' : '' });
  ensureArray(withdrawCandidates).forEach((item) => {
    register(item.huifuId, 'withdraw_request', {
      lastWithdrawReqDate: pickStr(item.reqDate),
      lastWithdrawReqSeqId: pickStr(item.reqSeqId),
    });
  });
  ensureArray(activityCandidates).forEach((item) => {
    register(item.huifuId, 'activity_record', {
      lastActivityCampaignId: pickStr(item.campaignId),
    });
  });

  return Object.values(map);
}

function chooseRecommendedCandidate(candidates = [], currentHuifuId = '') {
  const current = pickStr(currentHuifuId);
  const sorted = ensureArray(candidates).slice().sort((a, b) => {
    const aScore = Number(a && a.availableBalance || 0);
    const bScore = Number(b && b.availableBalance || 0);
    return bScore - aScore;
  });
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i] || {};
    if (pickStr(item.huifuId) === current) continue;
    if (item.queryOk === true && Number(item.availableBalance || 0) > 0) return item.huifuId;
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i] || {};
    if (pickStr(item.huifuId) === current) continue;
    if (item.queryOk === true) return item.huifuId;
  }
  return '';
}

function summarizeUser(user = {}) {
  return {
    userId: pickStr(user._id, user.id),
    openid: pickStr(user._openid),
    phone: pickStr(user.phone),
    name: pickStr(user.name),
    idNumberLast4: pickStr(user.idNumber).slice(-4),
    currentHuifuId: pickStr(user.huifu_id, user.huifuId, user.huifuUserId),
    huifuOpenStatus: pickStr(user.huifu_open_status),
    userBusiStatus: pickStr(user.user_busi_status),
  };
}

async function buildPreview(selector = {}, manualHuifuId = '') {
  const userRet = await resolveUser(selector);
  if (!userRet.ok || !userRet.doc) return userRet;
  const user = userRet.doc;
  const openid = pickStr(user._openid);
  const currentHuifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);

  const [walletSummary, withdrawCandidates, activityCandidates] = await Promise.all([
    loadWalletSummaryByOpenid(openid),
    loadWithdrawCandidates(openid),
    loadActivityCandidates(openid),
  ]);

  const candidateSeeds = buildCandidateMap({
    manualHuifuId,
    currentHuifuId,
    withdrawCandidates,
    activityCandidates,
  }).slice(0, 8);

  const candidates = [];
  for (let i = 0; i < candidateSeeds.length; i += 1) {
    const seed = candidateSeeds[i] || {};
    const snapshot = await queryHuifuSnapshot(seed.huifuId);
    candidates.push({
      ...seed,
      ...(snapshot || { huifuId: seed.huifuId, queryOk: false }),
      isCurrent: pickStr(seed.huifuId) === currentHuifuId,
    });
  }

  const recommendedHuifuId = chooseRecommendedCandidate(candidates, currentHuifuId);

  return {
    ok: true,
    user,
    preview: {
      targetUser: summarizeUser(user),
      walletSummary,
      candidates,
      recommendedHuifuId,
      autoFound: candidates.length > 0,
      hint: candidates.length
        ? '已找到可用候选，请先确认余额和账号，再执行恢复'
        : '暂未自动找到旧收款账号。如果该用户从未提现，可去支付通道后台查旧收款账号后手动填入',
    }
  };
}

async function writeRecoveryLog(payload = {}) {
  try {
    await ensureCollectionExists(LOG_COLLECTION);
    await db.collection(LOG_COLLECTION).add({
      data: {
        ...payload,
        createdAt: new Date(),
      }
    });
  } catch (err) {
    console.error('[adminRestoreUserAccount] write log failed', err);
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  const operatorOpenid = pickStr(wxContext.OPENID, wxContext.openId);
  const action = pickStr(event.action, 'preview_restore');
  const manualHuifuId = pickStr(event.manualHuifuId, event.targetHuifuId);
  const selector = {
    targetUserId: pickStr(event.targetUserId),
    targetOpenid: pickStr(event.targetOpenid),
    targetPhone: pickStr(event.targetPhone),
    targetIdNumber: pickStr(event.targetIdNumber),
  };

  console.log('[adminRestoreUserAccount] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    operatorOpenid,
    selector,
    hasManualHuifuId: !!manualHuifuId,
  }));

  if (operatorOpenid !== PLATFORM_ADMIN_OPENID) {
    return { ok: false, code: 'AUTH_FAIL', msg: '仅管理员可操作', buildTag: BUILD_TAG };
  }

  if (action === 'preview_restore') {
    const previewRet = await buildPreview(selector, manualHuifuId);
    if (!previewRet.ok) return { ...previewRet, buildTag: BUILD_TAG };
    return {
      ok: true,
      action,
      buildTag: BUILD_TAG,
      preview: previewRet.preview,
    };
  }

  if (action === 'apply_restore') {
    const previewRet = await buildPreview(selector, manualHuifuId);
    if (!previewRet.ok || !previewRet.user) return { ...(previewRet || { ok: false, code: 'PREVIEW_FAILED', msg: '预检查失败' }), buildTag: BUILD_TAG };

    const user = previewRet.user;
    const currentHuifuId = pickStr(user.huifu_id, user.huifuId, user.huifuUserId);
    const targetHuifuId = pickStr(event.targetHuifuId, manualHuifuId, previewRet.preview && previewRet.preview.recommendedHuifuId);
    if (!targetHuifuId) {
      return { ok: false, code: 'TARGET_HUIFU_ID_REQUIRED', msg: '未找到可恢复的旧收款账号，请手动填写旧收款账号', buildTag: BUILD_TAG };
    }
    if (targetHuifuId === currentHuifuId) {
      return { ok: true, action, noChange: true, msg: '当前用户已经挂在这个收款账号上', buildTag: BUILD_TAG, restoredHuifuId: targetHuifuId };
    }

    const selectedCandidate = ensureArray(previewRet.preview && previewRet.preview.candidates).find((item) => pickStr(item && item.huifuId) === targetHuifuId)
      || await queryHuifuSnapshot(targetHuifuId);

    if (!selectedCandidate || !pickStr(selectedCandidate.huifuId)) {
      return { ok: false, code: 'TARGET_NOT_VALID', msg: '目标收款账号无效', buildTag: BUILD_TAG };
    }
    if (selectedCandidate.queryOk !== true) {
      return {
        ok: false,
        code: 'TARGET_QUERY_FAILED',
        msg: `旧收款账号校验失败：${pickStr(selectedCandidate.infoDesc, selectedCandidate.balanceDesc, '查询失败')}`,
        buildTag: BUILD_TAG,
      };
    }

    const now = new Date();
    const history = ensureArray(user.huifuRestoreHistory).slice(-9);
    const historyEntry = {
      restoredAt: now,
      operatorOpenid,
      fromHuifuId: currentHuifuId,
      toHuifuId: targetHuifuId,
      selectedAvailableBalance: Number(selectedCandidate.availableBalance || 0),
      selectedAvailableBalanceText: pickStr(selectedCandidate.availableBalanceText),
      sourceCandidates: ensureArray(previewRet.preview && previewRet.preview.candidates).map((item) => ({
        huifuId: pickStr(item && item.huifuId),
        availableBalanceText: pickStr(item && item.availableBalanceText),
        queryOk: item && item.queryOk === true,
        isCurrent: item && item.isCurrent === true,
      })),
    };

    const patch = {
      huifu_id: targetHuifuId,
      huifuId: targetHuifuId,
      huifu_open_status: 'success',
      huifu_open_fail_reason: '',
      user_busi_status: 'success',
      user_busi_fail_reason: '',
      user_busi_updated_at: now,
      huifuRestoreHistory: history.concat(historyEntry),
      lastHuifuRestore: historyEntry,
      updatedAt: now,
    };

    await db.collection(USER_COLLECTION).doc(user._id).update({ data: patch });
    await writeRecoveryLog({
      action,
      operatorOpenid,
      targetUserId: pickStr(user._id),
      targetOpenid: pickStr(user._openid),
      targetPhone: pickStr(user.phone),
      fromHuifuId: currentHuifuId,
      toHuifuId: targetHuifuId,
      candidate: selectedCandidate,
    });

    return {
      ok: true,
      action,
      buildTag: BUILD_TAG,
      restoredHuifuId: targetHuifuId,
      previousHuifuId: currentHuifuId,
      selectedCandidate,
      walletSummary: previewRet.preview && previewRet.preview.walletSummary,
      msg: `已把用户收款账号恢复到 ${targetHuifuId}`,
    };
  }

  return { ok: false, code: 'UNSUPPORTED_ACTION', msg: `unsupported_action:${action}`, buildTag: BUILD_TAG };
};
