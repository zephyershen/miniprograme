const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const BUILD_TAG = 'activityReveal@2026-03-20.1';
const USER_COLLECTION = 'userInfo';
const CAMPAIGN_COLLECTION = 'activity_campaigns';
const DRAW_COLLECTION = 'activity_draw_records';
const PAYOUT_COLLECTION = 'activity_payout_logs';
const LOCK_TTL_MS = Math.max(60 * 1000, Number(process.env.ACTIVITY_REVEAL_LOCK_TTL_MS) || 5 * 60 * 1000);
const AUTO_CREATE_COLLECTIONS = process.env.ACTIVITY_AUTO_CREATE_COLLECTIONS === '1';

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function clampInt(v, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeAmountMode(v = '') {
  return pickStr(v).toLowerCase() === 'equal' ? 'equal' : 'random_range';
}

function parseChinaLocalDateTimeMs(raw = '') {
  const text = pickStr(raw);
  if (!text || /(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return NaN;
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!matched) return NaN;
  const year = Number(matched[1]);
  const month = Number(matched[2]) - 1;
  const day = Number(matched[3]);
  const hour = Number(matched[4] || 0);
  const minute = Number(matched[5] || 0);
  const second = Number(matched[6] || 0);
  return Date.UTC(year, month, day, hour - 8, minute, second);
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && Number.isFinite(v.$date)) return Number(v.$date);
  const raw = pickStr(v);
  const cnTs = parseChinaLocalDateTimeMs(raw);
  const ts = Number.isFinite(cnTs) ? cnTs : Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function formatMoneyFen(fen = 0) {
  return (Math.round(Number(fen) || 0) / 100).toFixed(2);
}

function randomFloat() {
  return crypto.randomBytes(4).readUInt32BE(0) / 0xffffffff;
}

function randomIntInclusive(min = 0, max = 0) {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(randomFloat() * (hi - lo + 1));
}

function shuffleCopy(items = []) {
  const out = ensureArray(items).slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIntInclusive(0, i);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function getTemplateWeights(winnerCount = 0, templateId = '') {
  const count = clampInt(winnerCount, 0, 1, 5000);
  if (!count) return [];
  const key = pickStr(templateId).toLowerCase();
  if (count === 1) return [1];
  if (count === 2) return key === 'double_equal' ? [1, 1] : [3, 1];
  if (count === 3) return [4, 2, 1];
  if (count <= 5) return [5, 4, 3, 2, 1].slice(0, count);
  if (count <= 10) {
    const list = [];
    for (let i = 0; i < count; i += 1) {
      if (i < 2) list.push(4);
      else if (i < 5) list.push(2);
      else list.push(1);
    }
    return list;
  }
  const list = [];
  const topCount = Math.max(1, Math.ceil(count * 0.1));
  const midCount = Math.max(1, Math.ceil(count * 0.3));
  for (let i = 0; i < count; i += 1) {
    if (i < topCount) list.push(4);
    else if (i < topCount + midCount) list.push(2);
    else list.push(1);
  }
  return list;
}

function allocateByWeights(totalAmountFen = 0, winnerCount = 0, weights = []) {
  const count = clampInt(winnerCount, 0, 1, 5000);
  const totalFen = clampInt(totalAmountFen, 0, count, Number.MAX_SAFE_INTEGER);
  if (!count || totalFen < count) return [];
  const base = Array.from({ length: count }, () => 1);
  let remain = totalFen - count;
  const validWeights = Array.isArray(weights) && weights.length === count
    ? weights.map(item => Math.max(1, Number(item) || 1))
    : Array.from({ length: count }, () => 1);
  const totalWeight = validWeights.reduce((sum, item) => sum + item, 0) || count;
  const extras = validWeights.map(item => Math.floor(remain * item / totalWeight));
  let allocated = 0;
  extras.forEach((item, idx) => {
    base[idx] += item;
    allocated += item;
  });
  remain -= allocated;
  const sortedIdx = validWeights
    .map((item, idx) => ({ idx, weight: item }))
    .sort((a, b) => b.weight - a.weight || a.idx - b.idx);
  for (let i = 0; i < remain; i += 1) {
    base[sortedIdx[i % sortedIdx.length].idx] += 1;
  }
  return base;
}

function canSplitEqualExactly(totalAmountFen = 0, winnerCount = 0) {
  const count = clampInt(winnerCount, 0, 1, 5000);
  const totalFen = clampInt(totalAmountFen, 0, count, Number.MAX_SAFE_INTEGER);
  return !!count && totalFen >= count && totalFen % count === 0;
}

function splitEqualAmounts(totalAmountFen = 0, winnerCount = 0) {
  const count = clampInt(winnerCount, 0, 1, 5000);
  const totalFen = clampInt(totalAmountFen, 0, count, Number.MAX_SAFE_INTEGER);
  if (!count || totalFen < count || !canSplitEqualExactly(totalFen, count)) return [];
  const avg = Math.floor(totalFen / count);
  return Array.from({ length: count }, () => avg);
}

function splitRandomRangeAmounts(totalAmountFen = 0, winnerCount = 0, amountConfig = {}) {
  const count = clampInt(winnerCount, 0, 1, 5000);
  const totalFen = clampInt(totalAmountFen, 0, count, Number.MAX_SAFE_INTEGER);
  if (!count || totalFen < count) return [];
  const inputMin = clampInt(amountConfig.minFen, 1, 1, totalFen);
  const inputMax = clampInt(amountConfig.maxFen, totalFen, inputMin, totalFen);
  const minFen = Math.min(inputMin, Math.floor(totalFen / count));
  const maxFen = Math.max(minFen, Math.min(inputMax, totalFen));
  if (minFen * count > totalFen || maxFen * count < totalFen) {
    return allocateByWeights(totalFen, count, getTemplateWeights(count));
  }
  const out = Array.from({ length: count }, () => minFen);
  let remain = totalFen - minFen * count;
  for (let i = 0; i < count - 1; i += 1) {
    if (remain <= 0) break;
    const maxExtra = maxFen - out[i];
    const minRemainForTail = (count - i - 1) * minFen;
    const safeTop = Math.min(maxExtra, remain - minRemainForTail);
    const extra = safeTop > 0 ? randomIntInclusive(0, safeTop) : 0;
    out[i] += extra;
    remain -= extra;
  }
  out[count - 1] += remain;
  if (out[count - 1] > maxFen) return allocateByWeights(totalFen, count, getTemplateWeights(count));
  return out;
}

function buildPrizeAmountList(totalAmountFen = 0, winnerCount = 0, amountMode = 'equal', amountConfig = {}) {
  const count = clampInt(winnerCount, 0, 1, 5000);
  if (!count) return [];
  if (normalizeAmountMode(amountMode) === 'random_range') {
    return splitRandomRangeAmounts(totalAmountFen, count, amountConfig);
  }
  return splitEqualAmounts(totalAmountFen, count);
}

function buildConfiguredEqualAmounts(totalAmountFen = 0, configuredWinnerCount = 0, actualWinnerCount = 0) {
  const configuredCount = clampInt(configuredWinnerCount, 0, 1, 5000);
  const actualCount = clampInt(actualWinnerCount, 0, 0, configuredCount || 5000);
  const totalFen = clampInt(totalAmountFen, 0, configuredCount, Number.MAX_SAFE_INTEGER);
  if (!configuredCount || !actualCount || !canSplitEqualExactly(totalFen, configuredCount)) return [];
  const perWinnerFen = Math.floor(totalFen / configuredCount);
  return Array.from({ length: actualCount }, () => perWinnerFen);
}

function sumFenList(items = []) {
  return ensureArray(items).reduce((sum, item) => sum + clampInt(item, 0, 0, Number.MAX_SAFE_INTEGER), 0);
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

async function getCampaignById(campaignId = '') {
  const id = pickStr(campaignId);
  if (!id) return null;
  try {
    const res = await db.collection(CAMPAIGN_COLLECTION).doc(id).get();
    return (res && res.data) || null;
  } catch (err) {
    return null;
  }
}

async function listDocsByWhere(collectionName = '', where = {}, pageSize = 100) {
  const items = [];
  let skip = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await db.collection(collectionName).where(where || {}).skip(skip).limit(pageSize).get();
    const list = (res && res.data) || [];
    if (!list.length) break;
    items.push(...list);
    skip += list.length;
    hasMore = list.length >= pageSize;
  }
  return items;
}

function getDrawAtMs(campaign = {}) {
  return toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt);
}

function isRevealCompleted(campaign = {}) {
  const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
  return progress.revealCompleted === true || !!toDateMs(progress.revealedAt) || !!toDateMs(campaign.revealedAt);
}

async function lockCampaignForReveal(campaignId = '') {
  const id = pickStr(campaignId);
  if (!id) return { ok: false, err: { code: 'MISSING_CAMPAIGN_ID', msg: '缺少活动ID' } };
  return db.runTransaction(async (tx) => {
    let campaign;
    try {
      const res = await tx.collection(CAMPAIGN_COLLECTION).doc(id).get();
      campaign = (res && res.data) || null;
    } catch (err) {
      campaign = null;
    }
    if (!campaign || campaign.isDeleted === true) {
      return { ok: false, skipped: true, reason: 'not_found' };
    }
    if (isRevealCompleted(campaign)) {
      return { ok: true, already: true, campaign };
    }
    const nowMs = Date.now();
    const drawAtMs = getDrawAtMs(campaign);
    if (drawAtMs && nowMs < drawAtMs) {
      return { ok: false, skipped: true, reason: 'not_due', campaign };
    }
    const revealStatus = pickStr(campaign.revealStatus);
    const revealStartedMs = toDateMs(campaign.revealStartedAt);
    if (revealStatus === 'processing' && revealStartedMs && (nowMs - revealStartedMs) < LOCK_TTL_MS) {
      return { ok: false, skipped: true, reason: 'processing', campaign };
    }
    const now = new Date();
    await tx.collection(CAMPAIGN_COLLECTION).doc(id).update({
      data: {
        revealStatus: 'processing',
        revealStartedAt: now,
        updatedAt: now,
        status: 'open',
      }
    });
    return {
      ok: true,
      locked: true,
      campaign: {
        ...campaign,
        revealStatus: 'processing',
        revealStartedAt: now,
        status: 'open',
      }
    };
  });
}

async function updateDrawRecords(campaignId = '', winnerMap = new Map(), revealAt = new Date()) {
  const records = await listDocsByWhere(DRAW_COLLECTION, { campaignId: pickStr(campaignId) }, 100);
  const chunkSize = 20;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    await Promise.all(chunk.map((item) => {
      const winner = winnerMap.get(pickStr(item._id));
      return db.collection(DRAW_COLLECTION).doc(item._id).update({
        data: winner
          ? {
            result: 'win',
            amountFen: winner.amountFen,
            resultText: `恭喜中奖 ¥${formatMoneyFen(winner.amountFen)}`,
            payoutStatus: 'pending',
            payoutLogId: `payout_${pickStr(item._id)}`,
            drawAt: revealAt,
            revealedAt: revealAt,
            updatedAt: revealAt,
          }
          : {
            result: 'lose',
            amountFen: 0,
            resultText: '这次没有中奖，下次活动见',
            payoutStatus: 'none',
            payoutLogId: '',
            drawAt: revealAt,
            revealedAt: revealAt,
            updatedAt: revealAt,
          }
      }).catch(() => null);
    }));
  }
  return records;
}

async function upsertPayoutLogs(campaign = {}, winnerList = [], revealAt = new Date()) {
  const logs = [];
  const mode = pickStr(process.env.ACTIVITY_PAYOUT_MODE, 'delay_split').toLowerCase();
  const payoutMode = mode === 'delay_confirm_split' ? 'delay_split' : mode;
  for (const winner of ensureArray(winnerList)) {
    const logId = `payout_${pickStr(winner._id)}`;
    const logDoc = {
      campaignId: pickStr(campaign._id),
      drawRecordId: pickStr(winner._id),
      slotId: '',
      openid: pickStr(winner.openid),
      userId: pickStr(winner.userId),
      userHuifuId: pickStr(winner.userHuifuId),
      amountFen: clampInt(winner.amountFen, 0, 0, Number.MAX_SAFE_INTEGER),
      amountYuanText: formatMoneyFen(winner.amountFen || 0),
      payoutMode,
      status: 'pending',
      retryCount: 0,
      fundingOrderId: '',
      fundingOrderReqDate: '',
      fundingOrderReqSeqId: '',
      fundingOrderHfSeqId: '',
      fundingOrderAmountFen: 0,
      fundingReservedAmountFen: 0,
      lastErrorCode: '',
      lastErrorMsg: '',
      channelReqSeqId: '',
      channelReqDate: '',
      channelRespCode: '',
      channelRespDesc: '',
      channelSeqId: '',
      channelTransStatus: '',
      walletMirrorStatus: '',
      walletMirrorErrorMsg: '',
      clientIp: '',
      finishedAt: null,
      createdAt: revealAt,
      updatedAt: revealAt,
    };
    await db.collection(PAYOUT_COLLECTION).doc(logId).set({ data: logDoc }).catch(() => null);
    logs.push({ ...logDoc, _id: logId });
  }
  return logs;
}

async function finalizeCampaign(campaign = {}, {
  participantCount = 0,
  actualWinnerCount = 0,
  distributedAmountFen = 0,
  revealAt = new Date(),
} = {}) {
  const totalAmountFen = clampInt(campaign.totalAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const configuredWinnerCount = clampInt(campaign.winnerCount, 0, 0, 5000);
  const sentAmountFen = clampInt(distributedAmountFen, 0, 0, totalAmountFen);
  const remainingAmountFen = Math.max(0, totalAmountFen - sentAmountFen);
  const progress = {
    ...(campaign.progress || {}),
    drawCount: participantCount,
    participantCount,
    uniqueUserCount: participantCount,
    winCount: actualWinnerCount,
    loseCount: Math.max(0, participantCount - actualWinnerCount),
    remainingAmountFen,
    remainingWinnerCount: Math.max(0, configuredWinnerCount - actualWinnerCount),
    remainingSlotCount: 0,
    revealCompleted: true,
    revealedAt: revealAt,
    resolvedWinnerCount: actualWinnerCount,
  };
  const nextStatus = actualWinnerCount < configuredWinnerCount || remainingAmountFen > 0
    ? 'finished_partial'
    : 'finished';
  await db.collection(CAMPAIGN_COLLECTION).doc(campaign._id).update({
    data: {
      progress,
      revealStatus: 'done',
      revealedAt: revealAt,
      finishedAt: revealAt,
      status: nextStatus,
      updatedAt: revealAt,
    }
  }).catch(() => null);
  return { progress, status: nextStatus };
}

async function callInternalPayout(payoutLogId = '', operatorOpenid = '') {
  const token = pickStr(process.env.ACTIVITY_SYSTEM_TOKEN, process.env.SYSTEM_COMPENSATE_TOKEN);
  if (!token) {
    const err = { code: 'MISSING_SYSTEM_TOKEN', msg: '未配置自动发奖凭证，无法自动发放奖励' };
    console.error('[activityReveal] process payout skipped', JSON.stringify({
      payoutLogId: pickStr(payoutLogId),
      err,
    }));
    return { ok: false, err };
  }
  try {
    const res = await cloud.callFunction({
      name: 'activityPayout',
      data: {
        action: 'process_one',
        payoutLogId: pickStr(payoutLogId),
        operatorOpenid: pickStr(operatorOpenid),
        systemPayout: true,
        systemToken: token,
      }
    });
    return (res && res.result) || res || null;
  } catch (err) {
    console.error('[activityReveal] process payout failed', err);
    return {
      ok: false,
      err: {
        code: 'AUTO_PAYOUT_CALL_FAILED',
        msg: '自动发奖调用失败，请稍后重试',
      }
    };
  }
}

async function markAutoPayoutTriggerFailed(payoutLog = {}, err = {}) {
  const payoutLogId = pickStr(payoutLog._id);
  const drawRecordId = pickStr(payoutLog.drawRecordId);
  const updatedAt = new Date();
  const errorCode = pickStr(err && err.code, 'AUTO_PAYOUT_TRIGGER_FAILED');
  const errorMsg = pickStr(err && err.msg, '开奖后未能自动发放奖励，请管理员重试');

  if (payoutLogId) {
    await db.collection(PAYOUT_COLLECTION).doc(payoutLogId).update({
      data: {
        status: 'failed',
        lastErrorCode: errorCode,
        lastErrorMsg: errorMsg,
        updatedAt,
      }
    }).catch(() => null);
  }

  if (drawRecordId) {
    await db.collection(DRAW_COLLECTION).doc(drawRecordId).update({
      data: {
        payoutStatus: 'failed',
        updatedAt,
      }
    }).catch(() => null);
  }
}

async function revealCampaign(campaignId = '', operatorOpenid = '') {
  const lockRet = await lockCampaignForReveal(campaignId);
  if (!lockRet || lockRet.ok !== true) return lockRet || { ok: false, err: { code: 'REVEAL_LOCK_FAILED', msg: '开奖锁定失败' } };
  if (lockRet.already) {
    return { ok: true, already: true, campaignId: pickStr(campaignId), buildTag: BUILD_TAG };
  }

  const campaign = lockRet.campaign || await getCampaignById(campaignId);
  if (!campaign || !campaign._id) {
    return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
  }

  const revealAt = new Date();
  const participants = await listDocsByWhere(DRAW_COLLECTION, { campaignId: pickStr(campaign._id) }, 100);
  const participantCount = participants.length;
  const configuredWinnerCount = clampInt(campaign.winnerCount, 0, 0, 5000);
  const actualWinnerCount = Math.min(configuredWinnerCount, participantCount);
  const amountMode = normalizeAmountMode(campaign.amountMode);
  const amountList = amountMode === 'equal'
    ? buildConfiguredEqualAmounts(campaign.totalAmountFen, configuredWinnerCount, actualWinnerCount)
    : buildPrizeAmountList(
      campaign.totalAmountFen,
      actualWinnerCount,
      amountMode,
      campaign.amountConfig && typeof campaign.amountConfig === 'object' ? campaign.amountConfig : {}
    );
  if (actualWinnerCount > 0 && amountList.length !== actualWinnerCount) {
    return {
      ok: false,
      err: {
        code: 'INVALID_AMOUNT_PLAN',
        msg: amountMode === 'equal' ? '均分红包金额校验失败，请检查总奖金和中奖人数' : '随机红包金额拆分失败',
      },
      buildTag: BUILD_TAG,
    };
  }
  const distributedAmountFen = sumFenList(amountList);
  const winnerMap = new Map();
  const shuffled = shuffleCopy(participants);
  for (let i = 0; i < actualWinnerCount; i += 1) {
    const record = shuffled[i];
    if (!record || !record._id) continue;
    winnerMap.set(pickStr(record._id), {
      amountFen: clampInt(amountList[i], 0, 0, Number.MAX_SAFE_INTEGER),
    });
  }

  const updatedRecords = await updateDrawRecords(campaign._id, winnerMap, revealAt);
  const winnerRecords = updatedRecords
    .filter(item => winnerMap.has(pickStr(item._id)))
    .map(item => ({
      ...item,
      amountFen: winnerMap.get(pickStr(item._id)).amountFen,
    }));

  const payoutLogs = await upsertPayoutLogs(campaign, winnerRecords, revealAt);
  const finalizeRet = await finalizeCampaign(campaign, {
    participantCount,
    actualWinnerCount,
    distributedAmountFen,
    revealAt,
  });

  for (const log of payoutLogs) {
    const payoutRet = await callInternalPayout(log._id, operatorOpenid);
    if (!payoutRet || payoutRet.ok !== true) {
      await markAutoPayoutTriggerFailed(log, payoutRet && payoutRet.err);
    }
  }

  return {
    ok: true,
    campaignId: pickStr(campaign._id),
    participantCount,
    actualWinnerCount,
    payoutCount: payoutLogs.length,
    status: finalizeRet.status,
    buildTag: BUILD_TAG,
  };
}

exports.main = async (event = {}) => {
  if (AUTO_CREATE_COLLECTIONS) {
    await Promise.all([
      ensureCollectionExists(CAMPAIGN_COLLECTION),
      ensureCollectionExists(DRAW_COLLECTION),
      ensureCollectionExists(PAYOUT_COLLECTION),
    ]);
  }

  const { OPENID } = cloud.getWXContext();
  const action = pickStr(event.action, 'ensure_due_campaigns');
  if (!OPENID) {
    return { ok: false, err: { code: 'NO_OPENID', msg: '获取用户身份失败' }, buildTag: BUILD_TAG };
  }
  const user = await getUserByOpenid(OPENID);
  if (!user || !user._id) {
    return { ok: false, err: { code: 'USER_NOT_FOUND', msg: '未找到用户信息，请重新登录后重试' }, buildTag: BUILD_TAG };
  }

  console.log('[activityReveal] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid: OPENID,
  }));

  if (action === 'ensure_campaign') {
    const campaignId = pickStr(event.campaignId);
    const ret = await revealCampaign(campaignId, OPENID);
    return { ...(ret || { ok: false, err: { code: 'REVEAL_FAILED', msg: '开奖失败' } }), buildTag: BUILD_TAG };
  }

  if (action === 'ensure_due_campaigns') {
    const limit = clampInt(event.limit, 5, 1, 20);
    const nowMs = Date.now();
    const res = await db.collection(CAMPAIGN_COLLECTION)
      .where({
        status: _.in(['scheduled', 'open']),
      })
      .orderBy('endAt', 'asc')
      .limit(limit)
      .get();
    const list = ((res && res.data) || []).filter(item => item && item.isDeleted !== true && !isRevealCompleted(item));
    const items = [];
    for (const campaign of list) {
      const drawAtMs = getDrawAtMs(campaign);
      if (drawAtMs && drawAtMs > nowMs) continue;
      const ret = await revealCampaign(pickStr(campaign._id), OPENID);
      items.push({
        campaignId: pickStr(campaign._id),
        ok: !!(ret && ret.ok),
        status: pickStr(ret && ret.status),
        msg: pickStr(ret && ret.err && ret.err.msg),
      });
    }
    return { ok: true, items, buildTag: BUILD_TAG };
  }

  return { ok: false, err: { code: 'UNSUPPORTED_ACTION', msg: `unsupported_action:${action}` }, buildTag: BUILD_TAG };
};
