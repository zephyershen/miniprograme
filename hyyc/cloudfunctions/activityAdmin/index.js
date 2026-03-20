const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const BUILD_TAG = 'activityAdmin@2026-03-20.7';
const USER_COLLECTION = 'userInfo';
const CAMPAIGN_COLLECTION = 'activity_campaigns';
const DRAW_COLLECTION = 'activity_draw_records';
const PAYOUT_COLLECTION = 'activity_payout_logs';
const FUNDING_COLLECTION = 'activity_funding_orders';
const ADMIN_LOG_COLLECTION = 'activity_admin_logs';
const WALLET_COLLECTION = 'wallets';
const TRANSACTION_COLLECTION = 'wallet_transactions';

const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';
const PLATFORM_ADMIN_USER_ID = '6a0a1fb669ba051f009897926f6fb98b';
const PLATFORM_ADMIN_PHONE = '18451306773';
const ACTIVITY_SYSTEM_TOKEN = () => pickStr(process.env.ACTIVITY_SYSTEM_TOKEN, process.env.SYSTEM_COMPENSATE_TOKEN);
const COMPENSATE_SYSTEM_TOKEN = () => pickStr(process.env.SYSTEM_COMPENSATE_TOKEN);
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const FUNDING_PENDING_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.ACTIVITY_FUNDING_PENDING_TTL_MS) || 30 * 60 * 1000);

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

function parseDateInput(v) {
  const ts = toDateMs(v);
  return Number.isFinite(ts) ? new Date(ts) : null;
}

function formatDateTime(v) {
  const ts = toDateMs(v);
  if (!ts) return '';
  const d = new Date(ts + CHINA_TIME_OFFSET_MS);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatMoneyFen(fen = 0) {
  const amountFen = Math.round(Number(fen) || 0);
  return (amountFen / 100).toFixed(2);
}

function resolveActivityFundingPaymentFeeRate(event = {}) {
  const raw = pickStr(
    process.env.HUIFU_ACTIVITY_FUNDING_FEE_RATE,
    process.env.ACTIVITY_FUNDING_PAYMENT_FEE_RATE,
    event.activityFundingFeeRate
  );
  if (!raw) return 0.003;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.003;
  if (n >= 0 && n < 1) return n;
  if (n >= 1 && n < 100) return n / 100;
  return 0.003;
}

function resolveActivityFundingFeeBufferFen(event = {}) {
  const raw = pickStr(
    process.env.HUIFU_ACTIVITY_FUNDING_FEE_BUFFER_FEN,
    process.env.ACTIVITY_FUNDING_PAYMENT_BUFFER_FEN,
    event.activityFundingBufferFen
  );
  if (!raw) return 0;
  return clampInt(raw, 0, 0, 100000);
}

function estimateActivityFundingGrossFen({ targetFen = 0, feeRate = 0.006, bufferFen = 0 } = {}) {
  const target = clampInt(targetFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const rate = Number(feeRate);
  const buffer = clampInt(bufferFen, 0, 0, 100000);
  if (target <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return target + buffer;
  let gross = target;
  let guard = 0;
  while ((gross - Math.round(gross * rate)) < target) {
    gross += 1;
    guard += 1;
    if (guard > 100000) break;
  }
  return gross + buffer;
}

function buildActivityFundingPaymentPlan({ targetFen = 0, event = {} } = {}) {
  const safeTargetFen = clampInt(targetFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const feeRate = resolveActivityFundingPaymentFeeRate(event);
  const bufferFen = resolveActivityFundingFeeBufferFen(event);
  const orderAmountFen = estimateActivityFundingGrossFen({
    targetFen: safeTargetFen,
    feeRate,
    bufferFen,
  });
  return {
    targetFen: safeTargetFen,
    orderAmountFen,
    estimatedPaymentFeeFen: Math.max(0, orderAmountFen - safeTargetFen),
    estimatedFeeRate: feeRate,
    bufferFen,
  };
}

function yyyymmdd(d = new Date()) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function getFundingStatusText(status = '') {
  const map = {
    unpaid: '待支付',
    partial: '部分入池',
    pending: '待确认',
    partial_pending: '部分入池',
    paid: '已入池',
    refunded: '已退回',
  };
  return map[pickStr(status)] || '待支付';
}

function getFundingOrderStatusText(status = '') {
  const map = {
    created: '待拉起支付',
    request_sent: '待确认',
    processing: '待确认',
    paid: '已入池',
    refund_pending: '退款处理中',
    refunded: '已退回',
    failed: '支付失败',
    cancelled: '已取消',
  };
  return map[pickStr(status)] || '待处理';
}

function isFundingPendingStatus(status = '') {
  return ['request_sent', 'processing', 'refund_pending'].includes(pickStr(status));
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
  const code = getRespCode(resp);
  return code === '00000000' || code === '00000100';
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

function getFundingRefundableFen(order = {}) {
  const fallbackFen = Math.max(
    0,
    getFundingTradeAmountFen(order) - getFundingSplitSuccessFen(order) - getFundingSplitPendingFen(order) - getFundingRefundedFen(order)
  );
  return Math.max(0, toFenInt(order.unconfirmAmountFen, fallbackFen));
}

function getFundingPrizeCapacityFen(order = {}) {
  const targetFen = clampInt(order && order.amountFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const splitSuccessFen = getFundingSplitSuccessFen(order);
  const remainingConfirmableFen = toFenInt(
    order && order.unconfirmAmountFen,
    Math.max(0, getFundingTradeAmountFen(order) - splitSuccessFen - getFundingRefundedFen(order))
  );
  const capacityFen = Math.max(0, splitSuccessFen + remainingConfirmableFen);
  return targetFen > 0 ? Math.min(targetFen, capacityFen) : capacityFen;
}

function isDelayFundingOrder(order = {}) {
  return pickStr(order.fundingMode) === 'delay_split' || pickStr(order.delayAcctFlag).toUpperCase() === 'Y';
}

function getCampaignRemainingPrizeFen(campaign = {}) {
  const progress = campaign && campaign.progress && typeof campaign.progress === 'object'
    ? campaign.progress
    : {};
  return toFenInt(progress.remainingAmountFen, Number(campaign.totalAmountFen || 0));
}

function getFundingOrderRefMs(order = {}) {
  return toDateMs(order.requestedAt) || toDateMs(order.updatedAt) || toDateMs(order.createdAt);
}

function isFundingOrderExpired(order = {}, nowMs = Date.now()) {
  if (!isFundingPendingStatus(order.status)) return false;
  const refMs = getFundingOrderRefMs(order);
  return !!refMs && (nowMs - refMs) > FUNDING_PENDING_TTL_MS;
}

function getEffectiveFundingOrderStatus(order = {}, nowMs = Date.now()) {
  if (isFundingOrderExpired(order, nowMs)) return 'cancelled';
  return pickStr(order.status, 'created');
}

function buildFundingSummary({
  totalAmountFen = 0,
  paidAmountFen = 0,
  pendingAmountFen = 0,
  paidOrderCount = 0,
  pendingOrderCount = 0,
  failedOrderCount = 0,
  lastOrderId = '',
  lastOrderStatus = '',
  lastPaidAt = null,
  updatedAt = null,
} = {}) {
  const totalFen = clampInt(totalAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const paidFen = clampInt(paidAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const pendingFen = clampInt(pendingAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
  const remainingFen = Math.max(0, totalFen - paidFen);
  const payableFen = pendingFen > 0 ? 0 : remainingFen;

  let status = 'unpaid';
  if (paidFen >= totalFen && totalFen > 0) {
    status = 'paid';
  } else if (paidFen > 0 && pendingFen > 0) {
    status = 'partial_pending';
  } else if (pendingFen > 0) {
    status = 'pending';
  } else if (paidFen > 0) {
    status = 'partial';
  }

  return {
    totalAmountFen: totalFen,
    paidAmountFen: paidFen,
    pendingAmountFen: pendingFen,
    remainingAmountFen: remainingFen,
    payableAmountFen: payableFen,
    paidOrderCount: clampInt(paidOrderCount, 0, 0, 99999),
    pendingOrderCount: clampInt(pendingOrderCount, 0, 0, 99999),
    failedOrderCount: clampInt(failedOrderCount, 0, 0, 99999),
    lastOrderId: pickStr(lastOrderId),
    lastOrderStatus: pickStr(lastOrderStatus),
    lastPaidAt: lastPaidAt || null,
    updatedAt: updatedAt || new Date(),
    status,
    statusText: getFundingStatusText(status),
    totalAmountText: formatMoneyFen(totalFen),
    paidAmountText: formatMoneyFen(paidFen),
    pendingAmountText: formatMoneyFen(pendingFen),
    remainingAmountText: formatMoneyFen(remainingFen),
    payableAmountText: formatMoneyFen(payableFen),
  };
}

function getCampaignFunding(campaign = {}) {
  const funding = campaign && campaign.funding && typeof campaign.funding === 'object'
    ? campaign.funding
    : {};
  return buildFundingSummary({
    totalAmountFen: Number(campaign.totalAmountFen || funding.totalAmountFen || 0),
    paidAmountFen: Number(funding.paidAmountFen || 0),
    pendingAmountFen: Number(funding.pendingAmountFen || 0),
    paidOrderCount: Number(funding.paidOrderCount || 0),
    pendingOrderCount: Number(funding.pendingOrderCount || 0),
    failedOrderCount: Number(funding.failedOrderCount || 0),
    lastOrderId: funding.lastOrderId,
    lastOrderStatus: funding.lastOrderStatus,
    lastPaidAt: funding.lastPaidAt || null,
    updatedAt: funding.updatedAt || campaign.updatedAt || new Date(),
  });
}

function buildFundingSummaryFromOrders(campaign = {}, orders = []) {
  const nowMs = Date.now();
  let paidAmountFen = 0;
  let pendingAmountFen = 0;
  let refundedAmountFen = 0;
  let paidOrderCount = 0;
  let pendingOrderCount = 0;
  let failedOrderCount = 0;
  let lastOrderId = '';
  let lastOrderStatus = '';
  let lastOrderMs = 0;
  let lastPaidAt = null;
  let lastPaidMs = 0;

  for (const item of ensureArray(orders)) {
    const effectiveStatus = getEffectiveFundingOrderStatus(item, nowMs);
    const amountFen = clampInt(item && item.amountFen, 0, 0, Number.MAX_SAFE_INTEGER);
    const refMs = getFundingOrderRefMs(item);
    if (refMs >= lastOrderMs) {
      lastOrderMs = refMs;
      lastOrderId = pickStr(item && item._id, item && item.id);
      lastOrderStatus = effectiveStatus;
    }
    if (effectiveStatus === 'paid') {
      paidAmountFen += getFundingPrizeCapacityFen(item);
      paidOrderCount += 1;
      const paidMs = toDateMs(item && item.paidAt) || refMs;
      if (paidMs >= lastPaidMs) {
        lastPaidMs = paidMs;
        lastPaidAt = (item && item.paidAt) || (item && item.updatedAt) || (item && item.createdAt) || null;
      }
    } else if (effectiveStatus === 'refunded') {
      refundedAmountFen += amountFen;
    } else if (isFundingPendingStatus(effectiveStatus)) {
      pendingAmountFen += amountFen;
      pendingOrderCount += 1;
    } else if (['failed', 'cancelled'].includes(effectiveStatus)) {
      failedOrderCount += 1;
    }
  }

  return buildFundingSummary({
    totalAmountFen: Number(campaign.totalAmountFen || 0),
    paidAmountFen: Math.max(0, paidAmountFen - refundedAmountFen),
    pendingAmountFen,
    paidOrderCount,
    pendingOrderCount,
    failedOrderCount,
    lastOrderId,
    lastOrderStatus,
    lastPaidAt,
  });
}

function buildFundingOrderView(order = {}) {
  const effectiveStatus = getEffectiveFundingOrderStatus(order);
  return {
    ...order,
    id: pickStr(order._id, order.id),
    effectiveStatus,
    statusText: getFundingOrderStatusText(effectiveStatus),
    amountText: formatMoneyFen(order.amountFen || 0),
    createdAtText: formatDateTime(order.createdAt),
    requestedAtText: formatDateTime(order.requestedAt),
    paidAtText: formatDateTime(order.paidAt),
    updatedAtText: formatDateTime(order.updatedAt || order.createdAt),
  };
}

function toMoneyFen({ fenValue, yuanValue, fallback = 0 }) {
  if (fenValue != null && fenValue !== '') {
    const fen = Math.round(Number(fenValue) || 0);
    return fen >= 0 ? fen : fallback;
  }
  if (yuanValue != null && yuanValue !== '') {
    const fen = Math.round(Number(yuanValue) * 100);
    return Number.isFinite(fen) && fen >= 0 ? fen : fallback;
  }
  return fallback;
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

function getRandomHex(len = 12) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function pickRules(input = {}) {
  const source = Array.isArray(input.rules)
    ? input.rules
    : String(input.rulesText || input.rules || '')
      .split(/\n+/)
      .map(item => pickStr(item));
  return source.map(item => pickStr(item)).filter(Boolean).slice(0, 10);
}

function normalizeAmountMode(v = '') {
  const mode = pickStr(v).toLowerCase();
  if (mode === 'equal') return 'equal';
  if (mode === 'random' || mode === 'random_range' || mode === 'weighted_template') return 'random_range';
  return 'random_range';
}

function normalizeCoverTheme(v = '') {
  const theme = pickStr(v).toLowerCase();
  if (['cozy_gift', 'mint_garden', 'sunny_present'].includes(theme)) return theme;
  return 'cozy_gift';
}

function buildProgress(totalAmountFen = 0, winnerCount = 0) {
  return {
    drawCount: 0,
    participantCount: 0,
    uniqueUserCount: 0,
    winCount: 0,
    loseCount: 0,
    remainingAmountFen: Math.max(0, Math.round(Number(totalAmountFen) || 0)),
    remainingWinnerCount: Math.max(0, Math.round(Number(winnerCount) || 0)),
    revealCompleted: false,
    revealedAt: null,
  };
}

function buildAdminSnapshot(user = {}) {
  return {
    userId: pickStr(user._id, user.id, PLATFORM_ADMIN_USER_ID),
    openid: pickStr(user._openid, PLATFORM_ADMIN_OPENID),
    phone: pickStr(user.phone, user.mobileNo, PLATFORM_ADMIN_PHONE),
    nickname: pickStr(user.nickname, user.name, '平台管理员'),
  };
}

function isSystemAdminCall(event = {}) {
  const token = ACTIVITY_SYSTEM_TOKEN();
  return !!(
    event
    && event.systemAdmin === true
    && token
    && pickStr(event.systemToken) === token
  );
}

function getTemplateWeights(winnerCount = 0, templateId = '') {
  const count = clampInt(winnerCount, 0, 1, 5000);
  if (!count) return [];
  const key = pickStr(templateId).toLowerCase();
  if (count === 1) return [1];
  if (count === 2) return key === 'double_equal' ? [1, 1] : [3, 1];
  if (count === 3) return [4, 2, 1];
  if (count <= 5) {
    return [5, 4, 3, 2, 1].slice(0, count);
  }
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
  if (out[count - 1] > maxFen) {
    return allocateByWeights(totalFen, count, getTemplateWeights(count));
  }
  return out;
}

function buildPrizeAmountList(totalAmountFen = 0, winnerCount = 0, amountMode = 'equal', amountConfig = {}) {
  const count = clampInt(winnerCount, 0, 1, 5000);
  if (!count) return [];
  if (amountMode === 'weighted_template') {
    return allocateByWeights(totalAmountFen, count, getTemplateWeights(count, amountConfig.templateId));
  }
  if (amountMode === 'random_range') {
    return splitRandomRangeAmounts(totalAmountFen, count, amountConfig);
  }
  return splitEqualAmounts(totalAmountFen, count);
}

function computeEffectiveStatus(campaign = {}, nowMs = Date.now()) {
  const current = pickStr(campaign.status, 'draft');
  if (!campaign || !campaign._id) return current;
  if (['offline', 'cancelled', 'finished', 'finished_partial'].includes(current)) return current;
  if (current === 'draft') return 'draft';
  const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
  const drawAtMs = toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt);
  if (progress.revealCompleted === true || toDateMs(progress.revealedAt) || toDateMs(campaign.revealedAt)) {
    return Number(progress.winCount || 0) < Number(campaign.winnerCount || 0) ? 'finished_partial' : 'finished';
  }
  if (drawAtMs && nowMs >= drawAtMs) return 'open';
  return 'scheduled';
}

function getStatusText(status = '') {
  const map = {
    draft: '草稿',
    scheduled: '参与中',
    open: '开奖中',
    finished: '已结束',
    finished_partial: '部分结束',
    offline: '已下线',
    cancelled: '已作废',
  };
  return map[pickStr(status)] || '未知';
}

function buildCampaignView(campaign = {}) {
  const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
  const effectiveStatus = computeEffectiveStatus(campaign);
  const funding = getCampaignFunding(campaign);
  return {
    ...campaign,
    id: pickStr(campaign._id, campaign.id),
    effectiveStatus,
    statusText: getStatusText(effectiveStatus),
    funding,
    fundingStatusText: funding.statusText,
    fundedAmountText: funding.paidAmountText,
    fundingPendingAmountText: funding.pendingAmountText,
    fundingRemainingAmountText: funding.remainingAmountText,
    totalAmountText: formatMoneyFen(campaign.totalAmountFen || 0),
    remainingAmountText: formatMoneyFen(progress.remainingAmountFen || 0),
    drawAtText: formatDateTime(campaign.drawAt || campaign.endAt || campaign.openAt),
    openAtText: formatDateTime(campaign.openAt),
    endAtText: formatDateTime(campaign.endAt),
    publishedAtText: formatDateTime(campaign.publishedAt),
    finishedAtText: formatDateTime(campaign.finishedAt),
  };
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

async function getFundingOrderById(orderId = '') {
  const id = pickStr(orderId);
  if (!id) return null;
  try {
    const res = await db.collection(FUNDING_COLLECTION).doc(id).get();
    return (res && res.data) || null;
  } catch (err) {
    return null;
  }
}

async function listFundingOrdersByCampaign(campaignId = '', limit = 20) {
  const id = pickStr(campaignId);
  if (!id) return [];
  const size = clampInt(limit, 20, 1, 100);
  try {
    const res = await db.collection(FUNDING_COLLECTION)
      .where({ campaignId: id })
      .orderBy('createdAt', 'desc')
      .limit(size)
      .get();
    return (res && res.data) || [];
  } catch (err) {
    return [];
  }
}

async function listWalletTransactionsByOpenid(openid = '', limit = 20) {
  const id = pickStr(openid);
  if (!id) return [];
  const size = clampInt(limit, 20, 1, 100);
  try {
    const res = await db.collection(TRANSACTION_COLLECTION)
      .where({ _openid: id })
      .orderBy('createdAt', 'desc')
      .limit(size)
      .get();
    return (res && res.data) || [];
  } catch (err) {
    return [];
  }
}

async function getWalletByOpenid(openid = '') {
  const id = pickStr(openid);
  if (!id) return null;
  try {
    const direct = await db.collection(WALLET_COLLECTION).doc(id).get().catch(() => null);
    if (direct && direct.data) return direct.data;
    const res = await db.collection(WALLET_COLLECTION).where({ _openid: id }).limit(5).get().catch(() => null);
    const list = (res && res.data) || [];
    return list[0] || null;
  } catch (err) {
    return null;
  }
}

async function expireStaleFundingOrders(campaignId = '') {
  const id = pickStr(campaignId);
  if (!id) return;
  const list = await listFundingOrdersByCampaign(id, 50);
  const nowMs = Date.now();
  const expired = list.filter(item => isFundingOrderExpired(item, nowMs));
  if (!expired.length) return;
  await Promise.all(expired.map(item => (
    db.collection(FUNDING_COLLECTION).doc(item._id).update({
      data: {
        status: 'cancelled',
        lastErrorCode: pickStr(item.lastErrorCode, 'ORDER_EXPIRED'),
        lastErrorMsg: pickStr(item.lastErrorMsg, '支付超时，请重新发起'),
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }
    }).catch(() => null)
  )));
}

async function syncCampaignFunding(campaignId = '', { campaign = null, fundingOrders = null, persist = true } = {}) {
  const target = campaign || await getCampaignById(campaignId);
  if (!target || !pickStr(target._id)) {
    return {
      campaign: null,
      funding: buildFundingSummary({}),
      fundingOrders: [],
    };
  }
  const orders = Array.isArray(fundingOrders) ? fundingOrders : await listFundingOrdersByCampaign(target._id, 100);
  const funding = buildFundingSummaryFromOrders(target, orders);
  const nextCampaign = {
    ...target,
    funding,
  };
  if (persist) {
    await db.collection(CAMPAIGN_COLLECTION).doc(target._id).update({
      data: {
        funding,
        updatedAt: new Date(),
      }
    }).catch(() => null);
  }
  return {
    campaign: nextCampaign,
    funding,
    fundingOrders: orders,
  };
}

function buildFundingOrderDoc({ campaign = {}, operator = {}, amountFen = 0, event = {} } = {}) {
  const now = new Date();
  const reqDate = yyyymmdd(now);
  const orderId = `fund_${pickStr(campaign._id)}_${getRandomHex(10)}`;
  const reqSeqId = `AF${reqDate}${getRandomHex(20)}`;
  const paymentPlan = buildActivityFundingPaymentPlan({ targetFen: amountFen, event });
  return {
    _id: orderId,
    campaignId: pickStr(campaign._id),
    campaignTitle: pickStr(campaign.title, '活动奖金'),
    amountFen: paymentPlan.targetFen,
    amountYuanText: formatMoneyFen(paymentPlan.targetFen),
    reqDate,
    reqSeqId,
    orgReqDate: reqDate,
    orgReqSeqId: reqSeqId,
    orgHfSeqId: '',
    status: 'created',
    fundingMode: 'delay_split',
    delayAcctFlag: 'Y',
    adminOpenid: pickStr(operator._openid),
    adminUserId: pickStr(operator._id, operator.id),
    adminPhone: pickStr(operator.phone, operator.mobileNo),
    orderAmountFen: paymentPlan.orderAmountFen,
    orderAmountYuanText: formatMoneyFen(paymentPlan.orderAmountFen),
    estimatedPaymentFeeFen: paymentPlan.estimatedPaymentFeeFen,
    estimatedPaymentFeeYuanText: formatMoneyFen(paymentPlan.estimatedPaymentFeeFen),
    estimatedFeeRate: paymentPlan.estimatedFeeRate,
    confirmedAmountFen: 0,
    unconfirmAmountFen: 0,
    splitSuccessAmountFen: 0,
    splitPendingAmountFen: 0,
    refundStatus: '',
    refundReqDate: '',
    refundReqSeqId: '',
    refundHfSeqId: '',
    refundedAmountFen: 0,
    refundedAt: null,
    createdAt: now,
    updatedAt: now,
    requestedAt: null,
    paidAt: null,
    cancelledAt: null,
    lastErrorCode: '',
    lastErrorMsg: '',
    channelRespCode: '',
    channelRespDesc: '',
    channelSeqId: '',
    rawRespBrief: '',
  };
}

async function refundCampaignFunding({ campaignId = '', payoutLogId = '', fundingOrderId = '' } = {}) {
  let resolvedCampaignId = pickStr(campaignId);
  if (!resolvedCampaignId && fundingOrderId) {
    const fundingOrder = await getFundingOrderById(fundingOrderId);
    resolvedCampaignId = pickStr(fundingOrder && fundingOrder.campaignId);
  }
  if (!resolvedCampaignId && payoutLogId) {
    const payoutLog = await getDocById(PAYOUT_COLLECTION, payoutLogId);
    resolvedCampaignId = pickStr(payoutLog && payoutLog.campaignId);
  }
  if (!resolvedCampaignId) {
    return { ok: false, err: { code: 'MISSING_CAMPAIGN_ID', msg: '缺少 campaignId 或无法从日志定位活动' } };
  }

  const campaign = await getCampaignById(resolvedCampaignId);
  if (!campaign) {
    return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' } };
  }

  await expireStaleFundingOrders(resolvedCampaignId);
  let fundingOrders = await listFundingOrdersByCampaign(resolvedCampaignId, 100);
  const refreshRet = await refreshPendingFundingRefunds(resolvedCampaignId, fundingOrders);
  if (!refreshRet || refreshRet.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(refreshRet && refreshRet.err && refreshRet.err.code, 'REFUND_REFRESH_FAILED'),
        msg: pickStr(refreshRet && refreshRet.err && refreshRet.err.msg, '活动退款状态刷新失败'),
      }
    };
  }
  fundingOrders = refreshRet.fundingOrders || fundingOrders;
  const paidFundingOrders = fundingOrders.filter(item => ['paid', 'refund_pending', 'refunded'].includes(getEffectiveFundingOrderStatus(item)));

  let refundableOrderCount = 0;
  let refundedOrderCount = 0;
  let pendingOrderCount = 0;
  for (const fundingOrder of paidFundingOrders) {
    const refundableFen = getFundingRefundableFen(fundingOrder);
    if (refundableFen <= 0) continue;
    refundableOrderCount += 1;
    const refundRet = await processFundingRefund(fundingOrder);
    if (!refundRet || refundRet.ok !== true) {
      return {
        ok: false,
        err: {
          code: pickStr(refundRet && refundRet.err && refundRet.err.code, 'ACTIVITY_FUNDING_REFUND_FAILED'),
          msg: pickStr(refundRet && refundRet.err && refundRet.err.msg, '活动资金退款失败'),
        }
      };
    }
    if (pickStr(refundRet.status) === 'pending') {
      pendingOrderCount += 1;
    } else {
      refundedOrderCount += 1;
    }
  }

  const latestFundingOrders = await listFundingOrdersByCampaign(resolvedCampaignId, 100);
  const fundingRes = await syncCampaignFunding(resolvedCampaignId, { campaign, fundingOrders: latestFundingOrders });
  return {
    ok: true,
    campaignId: resolvedCampaignId,
    funding: fundingRes.funding,
    fundingOrders: latestFundingOrders,
    refundableOrderCount,
    refundedOrderCount,
    pendingOrderCount,
    status: pendingOrderCount > 0 ? 'pending' : 'success',
    msg: refundableOrderCount <= 0
      ? '当前没有可退回的活动资金'
      : (pendingOrderCount > 0 ? '活动资金退款已发起，正在处理中' : '活动资金已退回原支付账户'),
  };
}

async function writeAdminLog({
  action = '',
  operator = {},
  campaignId = '',
  payloadSnapshot = {},
  result = 'success',
  errorMsg = '',
}) {
  try {
    await db.collection(ADMIN_LOG_COLLECTION).add({
      data: {
        action: pickStr(action),
        campaignId: pickStr(campaignId),
        operatorOpenid: pickStr(operator && operator._openid),
        operatorUserId: pickStr(operator && (operator._id || operator.id)),
        payloadSnapshot: payloadSnapshot && typeof payloadSnapshot === 'object' ? payloadSnapshot : {},
        result: pickStr(result, 'success'),
        errorMsg: pickStr(errorMsg),
        createdAt: new Date(),
      }
    });
  } catch (err) {
    console.error('[activityAdmin] write log failed', err);
  }
}

function assertAdminUser(user = {}, openid = '') {
  const operatorOpenid = pickStr(openid, user && user._openid);
  if (operatorOpenid !== PLATFORM_ADMIN_OPENID) return false;
  const userId = pickStr(user && (user._id || user.id));
  const phone = pickStr(user && user.phone, user && user.mobileNo);
  return !userId || userId === PLATFORM_ADMIN_USER_ID || !phone || phone === PLATFORM_ADMIN_PHONE;
}

async function requireAdminContext(openid = '') {
  const user = await getUserByOpenid(openid);
  if (!user || !user._id || !assertAdminUser(user, openid)) {
    return { ok: false, err: { code: 'NO_PERMISSION', msg: '仅平台管理员可操作' } };
  }
  return { ok: true, user };
}

function buildCampaignPayload(event = {}, prev = {}) {
  const current = prev && typeof prev === 'object' ? prev : {};
  const now = new Date();
  const title = pickStr(event.title, current.title);
  const subtitle = pickStr(event.subtitle, current.subtitle);
  const description = pickStr(event.description, current.description);
  const totalAmountFen = toMoneyFen({
    fenValue: event.totalAmountFen,
    yuanValue: event.totalAmountYuan,
    fallback: Number(current.totalAmountFen || 0),
  });
  const winnerCount = clampInt(event.winnerCount, Number(current.winnerCount || 0), 1, 5000);
  const amountMode = normalizeAmountMode(pickStr(event.amountMode, current.amountMode, 'random_range'));
  const coverTheme = normalizeCoverTheme(pickStr(event.coverTheme, current.coverTheme, 'cozy_gift'));
  const drawAt = parseDateInput(event.drawAt || event.endAt) || current.drawAt || current.endAt || null;
  const openAt = now;
  const endAt = drawAt;
  const rules = pickRules({
    rules: event.rules,
    rulesText: event.rulesText || current.rulesText || '1. 每位注册用户仅可参与 1 次\n2. 开奖前点一下就算参与成功\n3. 到开奖时间后系统会统一开奖并自动发放奖金'
  });
  const rulesText = rules.join('\n');
  const amountConfig = {
    templateId: pickStr(
      event && event.amountConfig && event.amountConfig.templateId,
      event.templateId,
      current && current.amountConfig && current.amountConfig.templateId
    ),
    minFen: clampInt(
      event && event.amountConfig && event.amountConfig.minFen,
      clampInt(event.minFen, Number(current && current.amountConfig && current.amountConfig.minFen || 100), 1, totalAmountFen),
      1,
      Math.max(1, totalAmountFen)
    ),
    maxFen: clampInt(
      event && event.amountConfig && event.amountConfig.maxFen,
      clampInt(event.maxFen, Number(current && current.amountConfig && current.amountConfig.maxFen || totalAmountFen), 1, totalAmountFen),
      1,
      Math.max(1, totalAmountFen)
    ),
  };
  return {
    title,
    subtitle,
    description,
    totalAmountFen,
    winnerCount,
    amountMode,
    amountConfig,
    coverTheme,
    rules,
    rulesText,
    winnerNotice: pickStr(event.winnerNotice, current.winnerNotice, '开奖完成后，奖金会自动发到钱包余额'),
    maxDrawPerUser: 1,
    openAt,
    endAt,
    drawAt,
  };
}

function buildCampaignPrizePack(payload = {}) {
  const amountList = buildPrizeAmountList(
    payload.totalAmountFen,
    payload.winnerCount,
    payload.amountMode,
    payload.amountConfig
  );
  if (amountList.length !== Number(payload.winnerCount || 0)) {
    throw new Error('活动金额拆分失败');
  }
}

function validateCampaignPayload(payload = {}) {
  if (!pickStr(payload.title)) return '请填写活动标题';
  if (!(Number(payload.totalAmountFen || 0) >= 1)) return '总奖金不合法';
  if (!(Number(payload.winnerCount || 0) >= 1)) return '中奖人数不合法';
  if (!(Number(payload.totalAmountFen || 0) >= Number(payload.winnerCount || 0))) return '总奖金不能低于中奖人数（按分校验）';
  if (pickStr(payload.amountMode) === 'equal' && !canSplitEqualExactly(payload.totalAmountFen, payload.winnerCount)) {
    return `均分红包要求总奖金能被 ${payload.winnerCount} 人整分`;
  }
  if (!payload.drawAt || !toDateMs(payload.drawAt)) return '请填写开奖时间';
  if (!payload.openAt || !toDateMs(payload.openAt)) return '活动时间不合法';
  if (toDateMs(payload.drawAt) <= toDateMs(payload.openAt)) return '开奖时间必须晚于当前时间';
  if (payload.amountMode === 'random_range') {
    if (Number(payload.amountConfig.minFen || 0) < 1) return '随机金额下限不合法';
    if (Number(payload.amountConfig.maxFen || 0) < Number(payload.amountConfig.minFen || 0)) return '随机金额上限不能小于下限';
  }
  return '';
}

async function clearDocsByWhere(collectionName = '', where = {}, pageSize = 100) {
  const targetCollection = pickStr(collectionName);
  if (!targetCollection) return 0;
  let removedCount = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await db.collection(targetCollection).where(where || {}).limit(pageSize).get();
    const list = (res && res.data) || [];
    if (!list.length) break;
    await Promise.all(list.map(item => db.collection(targetCollection).doc(item._id).remove().catch(() => null)));
    removedCount += list.length;
    hasMore = list.length >= pageSize;
  }
  return removedCount;
}

async function listDocsByWhere(collectionName = '', where = {}, pageSize = 100) {
  const targetCollection = pickStr(collectionName);
  if (!targetCollection) return [];
  const items = [];
  let skip = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await db.collection(targetCollection).where(where || {}).skip(skip).limit(pageSize).get();
    const list = (res && res.data) || [];
    if (!list.length) break;
    items.push(...list);
    skip += list.length;
    hasMore = list.length >= pageSize;
  }
  return items;
}

async function removeCampaignCompletely(campaignId = '') {
  const id = pickStr(campaignId);
  if (!id) return;
  await Promise.all([
    clearDocsByWhere(DRAW_COLLECTION, { campaignId: id }),
    clearDocsByWhere(PAYOUT_COLLECTION, { campaignId: id }),
    clearDocsByWhere(FUNDING_COLLECTION, { campaignId: id }),
  ]);
  const pageSize = 100;
  let hasMore = true;
  while (hasMore) {
    const res = await db.collection(ADMIN_LOG_COLLECTION).where({ campaignId: id }).limit(pageSize).get();
    const list = (res && res.data) || [];
    if (!list.length) break;
    await Promise.all(list.map(item => db.collection(ADMIN_LOG_COLLECTION).doc(item._id).remove().catch(() => null)));
    hasMore = list.length >= pageSize;
  }
  await db.collection(CAMPAIGN_COLLECTION).doc(id).remove().catch(() => null);
}

async function softDeleteCampaign(campaignId = '') {
  const id = pickStr(campaignId);
  if (!id) return;
  await db.collection(CAMPAIGN_COLLECTION).doc(id).update({
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      status: 'cancelled',
      updatedAt: new Date(),
    }
  }).catch(() => null);
}

async function syncFundingRefundState(order = {}, { resp = {}, refundReqDate = '', refundReqSeqId = '', refundHfSeqId = '', refundAmountFen = 0, status = '' } = {}) {
  const orderId = pickStr(order && order._id);
  if (!orderId) return;
  const respCode = getRespCode(resp);
  const respDesc = getRespDesc(resp);
  const transStat = getTransStatus(resp);
  const refundFen = toFenInt(refundAmountFen, 0);
  const currentRefundedFen = getFundingRefundedFen(order);
  const nextRefundedFen = pickStr(status) === 'success'
    ? Math.max(currentRefundedFen, refundFen)
    : currentRefundedFen;
  const orderAmountFen = Math.max(getFundingTradeAmountFen(order), nextRefundedFen + getFundingSplitSuccessFen(order));
  const unconfirmAmountFen = yuanToFen(
    pickStr(resp.unconfirm_amt),
    Math.max(0, orderAmountFen - getFundingSplitSuccessFen(order) - nextRefundedFen)
  );

  await db.collection(FUNDING_COLLECTION).doc(orderId).update({
    data: {
      status: pickStr(status) === 'success' ? 'refunded' : (pickStr(status) === 'pending' ? 'refund_pending' : pickStr(order.status)),
      refundStatus: pickStr(status),
      refundReqDate: pickStr(refundReqDate, order.refundReqDate),
      refundReqSeqId: pickStr(refundReqSeqId, order.refundReqSeqId),
      refundHfSeqId: pickStr(refundHfSeqId, order.refundHfSeqId),
      refundedAmountFen: nextRefundedFen,
      refundedAt: pickStr(status) === 'success' ? new Date() : (order.refundedAt || null),
      unconfirmAmountFen,
      lastErrorCode: pickStr(respCode, order.lastErrorCode),
      lastErrorMsg: pickStr(respDesc, order.lastErrorMsg),
      updatedAt: new Date(),
    }
  }).catch(() => null);
}

async function processFundingRefund(order = {}) {
  const orderId = pickStr(order && order._id);
  if (!orderId) return { ok: false, err: { code: 'FUNDING_ORDER_NOT_FOUND', msg: '活动金额订单不存在' } };
  if (!isDelayFundingOrder(order)) {
    return { ok: false, err: { code: 'UNSUPPORTED_FUNDING_MODE', msg: '当前活动金额订单不支持自动退回' } };
  }
  const refundableFen = getFundingRefundableFen(order);
  if (refundableFen <= 0) {
    return { ok: true, status: 'success', refunded: false, refundAmountFen: 0 };
  }
  if (getFundingSplitPendingFen(order) > 0) {
    return { ok: false, err: { code: 'PAYOUT_PENDING', msg: '还有奖励正在发放中，暂时不能删除活动' } };
  }

  const currentRefundStatus = pickStr(order.refundStatus);
  if (currentRefundStatus === 'pending' && pickStr(order.refundReqDate) && pickStr(order.refundReqSeqId)) {
    const queryRes = await cloud.callFunction({
      name: 'huifuMiniappPay',
      data: {
        action: 'scanpay_refund_query',
        refundReqDate: pickStr(order.refundReqDate),
        refundReqSeqId: pickStr(order.refundReqSeqId),
        refundHfSeqId: pickStr(order.refundHfSeqId),
      }
    });
    const queryRet = (queryRes && queryRes.result) || queryRes || null;
    if (!queryRet || queryRet.ok !== true) {
      return {
        ok: false,
        err: {
          code: pickStr(queryRet && queryRet.err && queryRet.err.code, 'REFUND_QUERY_FAILED'),
          msg: pickStr(queryRet && queryRet.err && queryRet.err.msg, '退款状态查询失败')
        }
      };
    }
    const queryResp = queryRet.huifuResp || {};
    if (!isBizSuccess(queryResp)) {
      return { ok: false, err: { code: pickStr(getRespCode(queryResp), 'REFUND_QUERY_BIZ_FAILED'), msg: pickStr(getRespDesc(queryResp), '退款状态查询失败') } };
    }
    const transStat = getTransStatus(queryResp);
    if (transStat === 'S') {
      await syncFundingRefundState(order, {
        resp: queryResp,
        refundReqDate: pickStr(order.refundReqDate),
        refundReqSeqId: pickStr(order.refundReqSeqId),
        refundHfSeqId: pickStr(order.refundHfSeqId, pickStr(queryResp.hf_seq_id, queryResp.hfSeqId)),
        refundAmountFen: refundableFen,
        status: 'success',
      });
      return { ok: true, status: 'success', refunded: true, refundAmountFen: refundableFen };
    }
    if (transStat === 'P' || !transStat) {
      await syncFundingRefundState(order, {
        resp: queryResp,
        refundReqDate: pickStr(order.refundReqDate),
        refundReqSeqId: pickStr(order.refundReqSeqId),
        refundHfSeqId: pickStr(order.refundHfSeqId, pickStr(queryResp.hf_seq_id, queryResp.hfSeqId)),
        refundAmountFen: refundableFen,
        status: 'pending',
      });
      return { ok: true, status: 'pending', refunded: false, refundAmountFen: refundableFen };
    }
    return { ok: false, err: { code: pickStr(getRespCode(queryResp), 'REFUND_FAILED'), msg: pickStr(getRespDesc(queryResp), '退款失败') } };
  }

  const refundRes = await cloud.callFunction({
    name: 'huifuMiniappPay',
    data: {
      action: 'scanpay_refund',
      ordAmtYuan: Number((refundableFen / 100).toFixed(2)),
      orgReqDate: pickStr(order.orgReqDate, order.reqDate),
      orgReqSeqId: pickStr(order.orgReqSeqId, order.reqSeqId),
      orgHfSeqId: pickStr(order.orgHfSeqId, order.channelSeqId),
      refundDesc: '活动删除退款',
    }
  });
  const refundRet = (refundRes && refundRes.result) || refundRes || null;
  if (!refundRet || refundRet.ok !== true) {
    return {
      ok: false,
      err: {
        code: pickStr(refundRet && refundRet.err && refundRet.err.code, 'REFUND_FAILED'),
        msg: pickStr(refundRet && refundRet.err && refundRet.err.msg, '退款失败')
      }
    };
  }

  const refundResp = refundRet.huifuResp || {};
  if (!isBizSuccess(refundResp)) {
    return { ok: false, err: { code: pickStr(getRespCode(refundResp), 'REFUND_BIZ_FAILED'), msg: pickStr(getRespDesc(refundResp), '退款失败') } };
  }
  const refundReqDate = pickStr(refundRet.reqDate);
  const refundReqSeqId = pickStr(refundRet.reqSeqId);
  const refundHfSeqId = pickStr(refundResp.hf_seq_id, refundResp.hfSeqId);
  const transStat = getTransStatus(refundResp);
  if (transStat === 'S') {
    await syncFundingRefundState(order, {
      resp: refundResp,
      refundReqDate,
      refundReqSeqId,
      refundHfSeqId,
      refundAmountFen: refundableFen,
      status: 'success',
    });
    return { ok: true, status: 'success', refunded: true, refundAmountFen: refundableFen };
  }
  await syncFundingRefundState(order, {
    resp: refundResp,
    refundReqDate,
    refundReqSeqId,
    refundHfSeqId,
    refundAmountFen: refundableFen,
    status: 'pending',
  });
  return { ok: true, status: 'pending', refunded: false, refundAmountFen: refundableFen };
}

async function refreshPendingFundingRefunds(campaignId = '', fundingOrders = null) {
  const orders = Array.isArray(fundingOrders) ? fundingOrders : await listFundingOrdersByCampaign(campaignId, 100);
  const refundPendingOrders = orders.filter(item => (
    getEffectiveFundingOrderStatus(item) === 'refund_pending'
    || pickStr(item && item.refundStatus) === 'pending'
  ));
  if (!refundPendingOrders.length) {
    return { ok: true, fundingOrders: orders };
  }
  for (const order of refundPendingOrders) {
    const ret = await processFundingRefund(order);
    if (!ret || ret.ok !== true) {
      return {
        ok: false,
        err: {
          code: pickStr(ret && ret.err && ret.err.code, 'REFUND_REFRESH_FAILED'),
          msg: pickStr(ret && ret.err && ret.err.msg, '活动退款状态刷新失败')
        }
      };
    }
  }
  const latestOrders = await listFundingOrdersByCampaign(campaignId, 100);
  return { ok: true, fundingOrders: latestOrders };
}

async function maybeCount(collectionName = '', where = null) {
  try {
    let query = db.collection(collectionName);
    if (where) query = query.where(where);
    const res = await query.count();
    return Number(res && res.total || 0);
  } catch (err) {
    return 0;
  }
}

exports.main = async (event = {}) => {
  await Promise.all([
    ensureCollectionExists(CAMPAIGN_COLLECTION),
    ensureCollectionExists(DRAW_COLLECTION),
    ensureCollectionExists(PAYOUT_COLLECTION),
    ensureCollectionExists(FUNDING_COLLECTION),
    ensureCollectionExists(ADMIN_LOG_COLLECTION),
  ]);

  const { OPENID } = cloud.getWXContext();
  const action = pickStr(event.action, 'dashboard');
  const systemAdminRequested = !!(event && event.systemAdmin === true);
  const systemAdmin = isSystemAdminCall(event);
  const configuredSystemToken = ACTIVITY_SYSTEM_TOKEN();
  if (systemAdminRequested && !configuredSystemToken) {
    return {
      ok: false,
      err: {
        code: 'MISSING_SYSTEM_TOKEN',
        msg: 'activityAdmin 未配置 ACTIVITY_SYSTEM_TOKEN 或 SYSTEM_COMPENSATE_TOKEN，控制台测试不能走管理员直通'
      },
      buildTag: BUILD_TAG,
    };
  }
  if (systemAdminRequested && configuredSystemToken && !systemAdmin) {
    return {
      ok: false,
      err: {
        code: 'INVALID_SYSTEM_TOKEN',
        msg: 'systemToken 校验失败，请确认云函数环境变量和测试参数一致，并重新部署最新 activityAdmin'
      },
      buildTag: BUILD_TAG,
    };
  }
  const auth = systemAdmin
    ? {
        ok: true,
        user: buildAdminSnapshot({
          _openid: PLATFORM_ADMIN_OPENID,
          _id: PLATFORM_ADMIN_USER_ID,
          phone: PLATFORM_ADMIN_PHONE,
          nickname: '平台管理员',
        }),
      }
    : await requireAdminContext(OPENID);
  if (!auth.ok) return { ...auth, buildTag: BUILD_TAG };
  const operator = auth.user || {};

  console.log('[activityAdmin] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid: systemAdmin ? PLATFORM_ADMIN_OPENID : OPENID,
    systemAdmin,
  }));

  if (action === 'dashboard') {
    const campaignRes = await db.collection(CAMPAIGN_COLLECTION).orderBy('createdAt', 'desc').limit(100).get();
    const campaigns = ((campaignRes && campaignRes.data) || [])
      .filter(item => item && item.isDeleted !== true)
      .map(item => buildCampaignView(item));
    const summary = {
      totalCampaigns: campaigns.length,
      draftCount: campaigns.filter(item => item.effectiveStatus === 'draft').length,
      scheduledCount: campaigns.filter(item => item.effectiveStatus === 'scheduled').length,
      openCount: campaigns.filter(item => item.effectiveStatus === 'open').length,
      finishedCount: campaigns.filter(item => ['finished', 'finished_partial'].includes(item.effectiveStatus)).length,
      pendingPayoutCount: await maybeCount(PAYOUT_COLLECTION, { status: 'pending' }),
      failedPayoutCount: await maybeCount(PAYOUT_COLLECTION, { status: 'failed' }),
    };
    return { ok: true, summary, campaigns: campaigns.slice(0, 8), buildTag: BUILD_TAG };
  }

  if (action === 'list_campaigns') {
    const limit = clampInt(event.limit, 20, 1, 100);
    const res = await db.collection(CAMPAIGN_COLLECTION).orderBy('createdAt', 'desc').limit(limit).get();
    const list = ((res && res.data) || [])
      .filter(item => item && item.isDeleted !== true)
      .map(item => buildCampaignView(item));
    return { ok: true, items: list, buildTag: BUILD_TAG };
  }

  if (action === 'get_campaign_detail') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getCampaignById(campaignId);
    if (!campaign || campaign.isDeleted === true) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };

    await expireStaleFundingOrders(campaignId);
    const fundingRes = await syncCampaignFunding(campaignId, { campaign });
    const liveCampaign = fundingRes.campaign || campaign;

    const [winnerRes, payoutRes] = await Promise.all([
      db.collection(DRAW_COLLECTION).where({ campaignId, result: 'win' }).orderBy('drawAt', 'desc').limit(30).get(),
      db.collection(PAYOUT_COLLECTION).where({ campaignId }).orderBy('updatedAt', 'desc').limit(30).get(),
    ]);

    return {
      ok: true,
      campaign: buildCampaignView(liveCampaign),
      winners: (winnerRes && winnerRes.data) || [],
      payoutLogs: (payoutRes && payoutRes.data) || [],
      fundingOrders: ensureArray(fundingRes.fundingOrders).slice(0, 20).map(item => buildFundingOrderView(item)),
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'create_campaign') {
    const payload = buildCampaignPayload(event, {});
    const validationErr = validateCampaignPayload(payload);
    if (validationErr) {
      return { ok: false, err: { code: 'INVALID_CAMPAIGN', msg: validationErr }, buildTag: BUILD_TAG };
    }
    buildCampaignPrizePack(payload);

    const now = new Date();
    const data = {
      ...payload,
      status: 'draft',
      progress: buildProgress(payload.totalAmountFen, payload.winnerCount),
      funding: buildFundingSummary({ totalAmountFen: payload.totalAmountFen }),
      adminSnapshot: buildAdminSnapshot(operator),
      publishedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const addRes = await db.collection(CAMPAIGN_COLLECTION).add({ data });
    const campaignId = pickStr(addRes && addRes._id);
    await writeAdminLog({
      action,
      operator,
      campaignId,
      payloadSnapshot: {
        title: payload.title,
        totalAmountFen: payload.totalAmountFen,
        winnerCount: payload.winnerCount,
      },
    });
    return { ok: true, campaignId, buildTag: BUILD_TAG };
  }

  if (action === 'update_campaign') {
    const campaignId = pickStr(event.campaignId);
    const prev = await getCampaignById(campaignId);
    if (!prev) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
    if (!['draft', 'offline'].includes(pickStr(prev.status))) {
      return { ok: false, err: { code: 'CAMPAIGN_EDIT_LOCKED', msg: '仅草稿或下线活动可编辑' }, buildTag: BUILD_TAG };
    }
    if (Number(prev && prev.progress && prev.progress.drawCount || 0) > 0) {
      return { ok: false, err: { code: 'CAMPAIGN_HAS_DRAWS', msg: '活动已有抽奖记录，不能再编辑' }, buildTag: BUILD_TAG };
    }

    const payload = buildCampaignPayload(event, prev);
    const validationErr = validateCampaignPayload(payload);
    if (validationErr) {
      return { ok: false, err: { code: 'INVALID_CAMPAIGN', msg: validationErr }, buildTag: BUILD_TAG };
    }
    buildCampaignPrizePack(payload);
    const currentFunding = getCampaignFunding(prev);

    await db.collection(CAMPAIGN_COLLECTION).doc(campaignId).update({
      data: {
        ...payload,
        progress: buildProgress(payload.totalAmountFen, payload.winnerCount),
        funding: buildFundingSummary({
          totalAmountFen: payload.totalAmountFen,
          paidAmountFen: currentFunding.paidAmountFen,
          pendingAmountFen: currentFunding.pendingAmountFen,
          paidOrderCount: currentFunding.paidOrderCount,
          pendingOrderCount: currentFunding.pendingOrderCount,
          failedOrderCount: currentFunding.failedOrderCount,
          lastOrderId: currentFunding.lastOrderId,
          lastOrderStatus: currentFunding.lastOrderStatus,
          lastPaidAt: currentFunding.lastPaidAt,
        }),
        updatedAt: new Date(),
      }
    });
    await writeAdminLog({
      action,
      operator,
      campaignId,
      payloadSnapshot: {
        title: payload.title,
        totalAmountFen: payload.totalAmountFen,
        winnerCount: payload.winnerCount,
      },
    });
    return { ok: true, campaignId, buildTag: BUILD_TAG };
  }

  if (action === 'publish_campaign') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getCampaignById(campaignId);
    if (!campaign) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
    if (!['draft', 'offline'].includes(pickStr(campaign.status))) {
      return { ok: false, err: { code: 'CAMPAIGN_PUBLISH_LOCKED', msg: '仅草稿或下线活动可发布' }, buildTag: BUILD_TAG };
    }
    if (Number(campaign && campaign.progress && campaign.progress.drawCount || 0) > 0) {
      return { ok: false, err: { code: 'CAMPAIGN_HAS_DRAWS', msg: '活动已有抽奖记录，不能重新发布' }, buildTag: BUILD_TAG };
    }

    const payload = buildCampaignPayload(campaign, campaign);
    const validationErr = validateCampaignPayload(payload);
    if (validationErr) {
      return { ok: false, err: { code: 'INVALID_CAMPAIGN', msg: validationErr }, buildTag: BUILD_TAG };
    }

    await expireStaleFundingOrders(campaignId);
    const fundingRes = await syncCampaignFunding(campaignId, { campaign });
    const funding = fundingRes.funding || getCampaignFunding(campaign);
    if (Number(funding.pendingAmountFen || 0) > 0 && Number(funding.paidAmountFen || 0) < Number(payload.totalAmountFen || 0)) {
      return {
        ok: false,
        err: { code: 'CAMPAIGN_FUNDING_PENDING', msg: '活动金额还在确认中，请稍后刷新后再发布' },
        buildTag: BUILD_TAG,
      };
    }
    if (Number(funding.paidAmountFen || 0) < Number(payload.totalAmountFen || 0)) {
      const remainingFen = Math.max(0, Number(payload.totalAmountFen || 0) - Number(funding.paidAmountFen || 0));
      return {
        ok: false,
        err: {
          code: 'CAMPAIGN_NOT_FUNDED',
          msg: Number(funding.paidAmountFen || 0) > 0
            ? `活动金额已支付，但实际可发奖金还差 ${formatMoneyFen(remainingFen)}，通常是支付手续费占用了部分金额。请先补足活动金额，再发布活动`
            : '请先支付活动金额，再发布活动'
        },
        buildTag: BUILD_TAG,
      };
    }
    buildCampaignPrizePack(payload);
    const now = new Date();
    const nextStatus = toDateMs(payload.drawAt || payload.endAt || payload.openAt) > now.getTime() ? 'scheduled' : 'open';
    await db.collection(CAMPAIGN_COLLECTION).doc(campaignId).update({
      data: {
        status: nextStatus,
        publishedAt: now,
        progress: buildProgress(payload.totalAmountFen, payload.winnerCount),
        funding,
        updatedAt: now,
      }
    });
    await writeAdminLog({
      action,
      operator,
      campaignId,
      payloadSnapshot: {
        nextStatus,
      },
    });
    return { ok: true, campaignId, status: nextStatus, buildTag: BUILD_TAG };
  }

  if (action === 'prepare_funding_order') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getCampaignById(campaignId);
    if (!campaign) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };

    await expireStaleFundingOrders(campaignId);
    const fundingRes = await syncCampaignFunding(campaignId, { campaign });
    const liveCampaign = fundingRes.campaign || campaign;
    const funding = fundingRes.funding || getCampaignFunding(liveCampaign);
    if (Number(funding.pendingAmountFen || 0) > 0) {
      return {
        ok: false,
        err: { code: 'FUNDING_PENDING', msg: '已有一笔活动金额在确认中，请先完成或取消后再试' },
        buildTag: BUILD_TAG,
      };
    }
    if (Number(funding.remainingAmountFen || 0) <= 0) {
      return {
        ok: false,
        err: { code: 'CAMPAIGN_ALREADY_FUNDED', msg: '当前活动金额已经支付完成' },
        buildTag: BUILD_TAG,
      };
    }

    const orderDoc = buildFundingOrderDoc({
      campaign: liveCampaign,
      operator,
      amountFen: funding.remainingAmountFen,
      event,
    });
    const orderPayload = { ...orderDoc };
    delete orderPayload._id;
    await db.collection(FUNDING_COLLECTION).doc(orderDoc._id).set({
      data: orderPayload
    });
    await writeAdminLog({
      action,
      operator,
      campaignId,
      payloadSnapshot: {
        fundingOrderId: orderDoc._id,
        amountFen: orderDoc.amountFen,
      },
    });
    return {
      ok: true,
      campaignId,
      fundingOrderId: orderDoc._id,
      amountFen: orderDoc.amountFen,
      amountText: formatMoneyFen(orderDoc.amountFen),
      orderAmountFen: orderDoc.orderAmountFen,
      orderAmountText: formatMoneyFen(orderDoc.orderAmountFen),
      estimatedPaymentFeeFen: clampInt(orderDoc.estimatedPaymentFeeFen, 0, 0, Number.MAX_SAFE_INTEGER),
      estimatedPaymentFeeText: formatMoneyFen(orderDoc.estimatedPaymentFeeFen),
      reqDate: orderDoc.reqDate,
      reqSeqId: orderDoc.reqSeqId,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'confirm_funding_payment') {
    const fundingOrderId = pickStr(event.fundingOrderId);
    const orderDoc = await getFundingOrderById(fundingOrderId);
    if (!orderDoc) {
      return { ok: false, err: { code: 'FUNDING_ORDER_NOT_FOUND', msg: '活动金额订单不存在' }, buildTag: BUILD_TAG };
    }
    if (pickStr(orderDoc.adminOpenid) && pickStr(orderDoc.adminOpenid) !== pickStr(operator._openid)) {
      return { ok: false, err: { code: 'NO_PERMISSION', msg: '这笔活动金额订单不属于当前管理员' }, buildTag: BUILD_TAG };
    }
    if (pickStr(orderDoc.status) !== 'paid') {
      const fallbackAmountFen = clampInt(orderDoc.amountFen, 0, 0, Number.MAX_SAFE_INTEGER);
      const existingOrderAmountFen = clampInt(orderDoc.orderAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
      const existingConfirmedFen = clampInt(orderDoc.confirmedAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
      const existingUnconfirmFen = clampInt(orderDoc.unconfirmAmountFen, 0, 0, Number.MAX_SAFE_INTEGER);
      const fundingReady = existingConfirmedFen > 0 || existingUnconfirmFen > 0;
      const nextStatus = fundingReady ? 'paid' : 'processing';
      await db.collection(FUNDING_COLLECTION).doc(orderDoc._id).update({
        data: {
          status: nextStatus,
          paidAt: new Date(),
          updatedAt: new Date(),
          fundingMode: 'delay_split',
          delayAcctFlag: 'Y',
          orgReqDate: pickStr(orderDoc.orgReqDate, orderDoc.reqDate),
          orgReqSeqId: pickStr(orderDoc.orgReqSeqId, orderDoc.reqSeqId),
          orderAmountFen: existingOrderAmountFen > 0 ? existingOrderAmountFen : fallbackAmountFen,
          orderAmountYuanText: pickStr(orderDoc.orderAmountYuanText, orderDoc.amountYuanText, formatMoneyFen(orderDoc.amountFen || 0)),
          unconfirmAmountFen: fundingReady ? existingUnconfirmFen : 0,
          confirmedAmountFen: existingConfirmedFen,
          splitSuccessAmountFen: clampInt(orderDoc.splitSuccessAmountFen, 0, 0, Number.MAX_SAFE_INTEGER),
          splitPendingAmountFen: clampInt(orderDoc.splitPendingAmountFen, 0, 0, Number.MAX_SAFE_INTEGER),
          lastErrorCode: '',
          lastErrorMsg: '',
          confirmSource: pickStr(event.confirmSource, 'client'),
        }
      });
    }
    const fundingRes = await syncCampaignFunding(orderDoc.campaignId);
    await writeAdminLog({
      action,
      operator,
      campaignId: orderDoc.campaignId,
      payloadSnapshot: { fundingOrderId: orderDoc._id },
    });
    const latestOrder = ensureArray(fundingRes.fundingOrders).find(item => pickStr(item && item._id) === pickStr(orderDoc._id)) || {};
    const latestStatus = pickStr(latestOrder.status, orderDoc.status);
    const latestReady = clampInt(latestOrder.unconfirmAmountFen, 0, 0, Number.MAX_SAFE_INTEGER) > 0
      || clampInt(latestOrder.confirmedAmountFen, 0, 0, Number.MAX_SAFE_INTEGER) > 0;
    return {
      ok: true,
      campaignId: orderDoc.campaignId,
      fundingOrderId: orderDoc._id,
      funding: fundingRes.funding,
      status: latestStatus,
      msg: latestReady
        ? '活动金额已入池'
        : '支付已完成，等待支付回调确认入池',
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'cancel_funding_payment') {
    const fundingOrderId = pickStr(event.fundingOrderId);
    const orderDoc = await getFundingOrderById(fundingOrderId);
    if (!orderDoc) {
      return { ok: false, err: { code: 'FUNDING_ORDER_NOT_FOUND', msg: '活动金额订单不存在' }, buildTag: BUILD_TAG };
    }
    if (pickStr(orderDoc.adminOpenid) && pickStr(orderDoc.adminOpenid) !== pickStr(operator._openid)) {
      return { ok: false, err: { code: 'NO_PERMISSION', msg: '这笔活动金额订单不属于当前管理员' }, buildTag: BUILD_TAG };
    }
    if (pickStr(orderDoc.status) !== 'paid') {
      await db.collection(FUNDING_COLLECTION).doc(orderDoc._id).update({
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          updatedAt: new Date(),
          lastErrorCode: pickStr(event.errorCode, orderDoc.lastErrorCode, 'PAY_CANCELLED'),
          lastErrorMsg: pickStr(event.errorMsg, orderDoc.lastErrorMsg, '支付已取消'),
        }
      });
    }
    const fundingRes = await syncCampaignFunding(orderDoc.campaignId);
    await writeAdminLog({
      action,
      operator,
      campaignId: orderDoc.campaignId,
      payloadSnapshot: { fundingOrderId: orderDoc._id },
    });
    return {
      ok: true,
      campaignId: orderDoc.campaignId,
      fundingOrderId: orderDoc._id,
      funding: fundingRes.funding,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'offline_campaign') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getCampaignById(campaignId);
    if (!campaign) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
    await db.collection(CAMPAIGN_COLLECTION).doc(campaignId).update({
      data: {
        status: 'offline',
        updatedAt: new Date(),
      }
    });
    await writeAdminLog({ action, operator, campaignId });
    return { ok: true, campaignId, status: 'offline', buildTag: BUILD_TAG };
  }

  if (action === 'delete_campaign') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getCampaignById(campaignId);
    if (!campaign) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };

    await expireStaleFundingOrders(campaignId);
    let fundingOrders = await listFundingOrdersByCampaign(campaignId, 100);
    const refreshRet = await refreshPendingFundingRefunds(campaignId, fundingOrders);
    if (!refreshRet || refreshRet.ok !== true) {
      return {
        ok: false,
        err: {
          code: pickStr(refreshRet && refreshRet.err && refreshRet.err.code, 'REFUND_REFRESH_FAILED'),
          msg: pickStr(refreshRet && refreshRet.err && refreshRet.err.msg, '活动退款状态刷新失败'),
        },
        buildTag: BUILD_TAG,
      };
    }
    fundingOrders = refreshRet.fundingOrders || fundingOrders;
    const fundingRes = await syncCampaignFunding(campaignId, { campaign, fundingOrders });
    const funding = fundingRes.funding || getCampaignFunding(campaign);
    if (Number(funding.pendingAmountFen || 0) > 0) {
      return {
        ok: false,
        err: { code: 'CAMPAIGN_FUNDING_PENDING', msg: '活动金额还在确认中，暂时不能删除' },
        buildTag: BUILD_TAG,
      };
    }
    const allPayoutLogs = await listDocsByWhere(PAYOUT_COLLECTION, { campaignId }, 100);
    const activePayoutLogs = allPayoutLogs.filter(item => ['pending', 'processing'].includes(pickStr(item && item.status)));
    if (activePayoutLogs.length > 0) {
      return {
        ok: false,
        err: { code: 'CAMPAIGN_PAYOUT_PENDING', msg: '还有奖励正在发放中，请稍后再删' },
        buildTag: BUILD_TAG,
      };
    }
    const successPayoutLogs = allPayoutLogs.filter(item => pickStr(item && item.status) === 'success');
    const officialPayoutLogs = successPayoutLogs.filter(item => pickStr(item && item.payoutMode) === 'official_balance');
    if (officialPayoutLogs.length > 0) {
      return {
        ok: false,
        err: { code: 'CAMPAIGN_HAS_OFFICIAL_PAYOUT', msg: '活动已经有正式到账记录，当前不能直接删除' },
        buildTag: BUILD_TAG,
      };
    }
    const localWalletPayoutLogs = successPayoutLogs.filter(item => pickStr(item && item.payoutMode) === 'local_wallet');
    if (localWalletPayoutLogs.length > 0) {
      const token = COMPENSATE_SYSTEM_TOKEN();
      if (!token) {
        return {
          ok: false,
          err: { code: 'MISSING_SYSTEM_TOKEN', msg: '缺少 SYSTEM_COMPENSATE_TOKEN，暂时无法回退本地测试奖励' },
          buildTag: BUILD_TAG,
        };
      }
      for (const payoutLog of localWalletPayoutLogs) {
        const amountFen = Math.round(Number(payoutLog.amountFen || 0));
        if (!(amountFen > 0) || !pickStr(payoutLog.openid)) continue;
        const revertRes = await cloud.callFunction({
          name: 'walletWithdraw',
          data: {
            action: 'activity_revert',
            systemCompensate: true,
            compensateToken: token,
            targetOpenid: pickStr(payoutLog.openid),
            campaignId,
            drawRecordId: pickStr(payoutLog.drawRecordId),
            payoutLogId: pickStr(payoutLog._id),
            amount: Number((amountFen / 100).toFixed(2)),
            title: '活动奖励回退',
            summary: `测试活动删除，已回退本地奖励 ¥${formatMoneyFen(amountFen)}`,
            sourceBizKey: `activity_income:${campaignId}:${pickStr(payoutLog.drawRecordId)}`,
            revertBizKey: `activity_revert:${campaignId}:${pickStr(payoutLog.drawRecordId, payoutLog._id)}`,
          }
        });
        const ret = (revertRes && revertRes.result) || revertRes || null;
        if (!ret || ret.ok !== true) {
          return {
            ok: false,
            err: {
              code: pickStr(ret && ret.err && ret.err.code, 'ACTIVITY_REVERT_FAILED'),
              msg: pickStr(ret && ret.err && ret.err.msg, '本地测试奖励回退失败，活动未删除'),
            },
            buildTag: BUILD_TAG,
          };
        }
      }
    }
    const paidFundingOrders = fundingOrders.filter(item => ['paid', 'refund_pending', 'refunded'].includes(getEffectiveFundingOrderStatus(item)));
    for (const fundingOrder of paidFundingOrders) {
      const refundableFen = getFundingRefundableFen(fundingOrder);
      if (refundableFen <= 0) continue;
      const refundRet = await processFundingRefund(fundingOrder);
      if (!refundRet || refundRet.ok !== true) {
        return {
          ok: false,
          err: {
            code: pickStr(refundRet && refundRet.err && refundRet.err.code, 'ACTIVITY_FUNDING_REFUND_FAILED'),
            msg: pickStr(refundRet && refundRet.err && refundRet.err.msg, '活动剩余金额退回失败，活动未删除'),
          },
          buildTag: BUILD_TAG,
        };
      }
      if (pickStr(refundRet.status) === 'pending') {
        return {
          ok: false,
          err: { code: 'ACTIVITY_FUNDING_REFUND_PENDING', msg: '活动剩余金额正在退回中，请稍后再删一次' },
          buildTag: BUILD_TAG,
        };
      }
    }

    const shouldSoftDelete = successPayoutLogs.length > 0 || paidFundingOrders.length > 0;
    if (shouldSoftDelete) {
      await softDeleteCampaign(campaignId);
    } else {
      await removeCampaignCompletely(campaignId);
    }
    await writeAdminLog({
      action,
      operator,
      campaignId,
      payloadSnapshot: {
        softDeleted: shouldSoftDelete,
        successPayoutCount: successPayoutLogs.length,
        refundedFundingOrderCount: paidFundingOrders.length,
      },
    });
    return {
      ok: true,
      campaignId,
      deleted: true,
      softDeleted: shouldSoftDelete,
      refundedFundingOrderCount: paidFundingOrders.length,
      buildTag: BUILD_TAG
    };
  }

  if (action === 'finish_campaign') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getCampaignById(campaignId);
    if (!campaign) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
    const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
    const nextStatus = Number(progress.winCount || 0) < Number(campaign.winnerCount || 0)
      ? 'finished_partial'
      : 'finished';
    await db.collection(CAMPAIGN_COLLECTION).doc(campaignId).update({
      data: {
        status: nextStatus,
        finishedAt: new Date(),
        updatedAt: new Date(),
      }
    });
    await writeAdminLog({ action, operator, campaignId, payloadSnapshot: { status: nextStatus } });
    return { ok: true, campaignId, status: nextStatus, buildTag: BUILD_TAG };
  }

  if (action === 'list_draw_records' || action === 'list_winners') {
    const campaignId = pickStr(event.campaignId);
    const limit = clampInt(event.limit, 50, 1, 100);
    let query = db.collection(DRAW_COLLECTION);
    if (action === 'list_winners') {
      query = query.where({ campaignId, result: 'win' });
    } else {
      query = query.where({ campaignId });
    }
    const res = await query.orderBy('drawAt', 'desc').limit(limit).get();
    return { ok: true, items: (res && res.data) || [], buildTag: BUILD_TAG };
  }

  if (action === 'list_payout_logs') {
    const campaignId = pickStr(event.campaignId);
    const limit = clampInt(event.limit, 50, 1, 100);
    let query = db.collection(PAYOUT_COLLECTION);
    if (campaignId) query = query.where({ campaignId });
    const res = await query.orderBy('updatedAt', 'desc').limit(limit).get();
    return { ok: true, items: (res && res.data) || [], buildTag: BUILD_TAG };
  }

  if (action === 'inspect_user_wallet') {
    const targetOpenid = pickStr(event.targetOpenid, event.openid);
    if (!targetOpenid) {
      return { ok: false, err: { code: 'MISSING_OPENID', msg: '缺少用户 openid' }, buildTag: BUILD_TAG };
    }
    const targetUser = await getUserByOpenid(targetOpenid);
    if (!targetUser || !targetUser._id) {
      return { ok: false, err: { code: 'USER_NOT_FOUND', msg: '未找到目标用户' }, buildTag: BUILD_TAG };
    }
    const [walletDoc, txList] = await Promise.all([
      getWalletByOpenid(targetOpenid),
      listWalletTransactionsByOpenid(targetOpenid, clampInt(event.limit, 10, 1, 30)),
    ]);
    const localBalance = Number(walletDoc && walletDoc.balance || 0);
    let walletSummary = {
      availableBalance: null,
      availableBalanceText: '',
      localBalance,
      localBalanceText: Number.isFinite(localBalance)
        ? localBalance.toFixed(2)
        : '',
    };
    const token = COMPENSATE_SYSTEM_TOKEN();
    if (token) {
      const summaryRes = await cloud.callFunction({
        name: 'walletWithdraw',
        data: {
          action: 'wallet_summary',
          systemCompensate: true,
          compensateToken: token,
          targetOpenid,
        }
      }).catch(() => null);
      const summaryRet = (summaryRes && summaryRes.result) || summaryRes || null;
      if (summaryRet && summaryRet.ok === true && summaryRet.summary) {
        walletSummary = {
          availableBalance: summaryRet.summary.availableBalance,
          availableBalanceText: pickStr(summaryRet.summary.availableBalanceText),
          localBalance: summaryRet.summary.localBalance,
          localBalanceText: pickStr(summaryRet.summary.localBalanceText),
        };
      }
    }
    return {
      ok: true,
      user: {
        userId: pickStr(targetUser._id),
        openid: pickStr(targetUser._openid),
        name: pickStr(targetUser.name, targetUser.nickname),
        phone: pickStr(targetUser.phone),
        huifuId: pickStr(targetUser.huifu_id, targetUser.huifuId, targetUser.huifuUserId),
      },
      wallet: walletSummary,
      recentTransactions: ensureArray(txList).map(item => ({
        id: pickStr(item && item._id, item && item.id),
        type: pickStr(item && item.type),
        amount: Number(item && item.amount || 0),
        balanceDelta: Number(item && item.balanceDelta || 0),
        title: pickStr(item && item.title),
        summary: pickStr(item && item.summary),
        bizKey: pickStr(item && item.bizKey),
        createdAt: item && item.createdAt ? item.createdAt : null,
      })),
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'refund_campaign_funding') {
    const ret = await refundCampaignFunding({
      campaignId: pickStr(event.campaignId),
      payoutLogId: pickStr(event.payoutLogId),
      fundingOrderId: pickStr(event.fundingOrderId),
    });
    await writeAdminLog({
      action,
      operator,
      campaignId: pickStr(ret && ret.campaignId, event.campaignId),
      payloadSnapshot: {
        campaignId: pickStr(event.campaignId),
        payoutLogId: pickStr(event.payoutLogId),
        fundingOrderId: pickStr(event.fundingOrderId),
      },
      result: ret && ret.ok ? 'success' : 'failed',
      errorMsg: pickStr(ret && ret.err && ret.err.msg),
    });
    return { ...(ret || { ok: false, err: { msg: '活动资金退款失败' } }), buildTag: BUILD_TAG };
  }

  if (action === 'retry_payout') {
    const payoutLogId = pickStr(event.payoutLogId);
    if (!payoutLogId) {
      return { ok: false, err: { code: 'MISSING_PAYOUT_LOG_ID', msg: '缺少 payoutLogId' }, buildTag: BUILD_TAG };
    }
    const token = ACTIVITY_SYSTEM_TOKEN();
    if (!token) {
      return { ok: false, err: { code: 'MISSING_SYSTEM_TOKEN', msg: '未配置 ACTIVITY_SYSTEM_TOKEN/SYSTEM_COMPENSATE_TOKEN' }, buildTag: BUILD_TAG };
    }
    const res = await cloud.callFunction({
      name: 'activityPayout',
      data: {
        action: 'process_one',
        payoutLogId,
        operatorOpenid: pickStr(operator._openid),
        systemPayout: true,
        systemToken: token,
        forcePayoutMode: pickStr(event.forcePayoutMode),
      }
    });
    const ret = (res && res.result) || res || null;
    await writeAdminLog({
      action,
      operator,
      campaignId: pickStr(event.campaignId),
      payloadSnapshot: { payoutLogId, forcePayoutMode: pickStr(event.forcePayoutMode) },
      result: ret && ret.ok ? 'success' : 'failed',
      errorMsg: pickStr(ret && ret.err && ret.err.msg),
    });
    return { ...(ret || { ok: false, err: { msg: '重试派奖失败' } }), buildTag: BUILD_TAG };
  }

  return { ok: false, err: { code: 'UNSUPPORTED_ACTION', msg: `unsupported_action:${action}` }, buildTag: BUILD_TAG };
};
