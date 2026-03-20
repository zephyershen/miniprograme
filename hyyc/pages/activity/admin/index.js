const { formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');
const { getStoredUser } = require('../../../utils/userIdentity');
const { fenToYuanInput, formatFenLabel, yuanInputToFen } = require('../../../utils/activityMoney');
const { getPayoutStatusText } = require('../../../utils/activityStatus');
const {
  COVER_THEME_OPTIONS,
  getThemeMeta,
} = require('../../../utils/activityTheme');

const AMOUNT_MODE_OPTIONS = [
  { value: 'random_range', label: '随机红包' },
  { value: 'equal', label: '均分红包' },
];

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function pad2(v) {
  return String(v).padStart(2, '0');
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && Number.isFinite(v.$date)) return Number(v.$date);
  const ts = Date.parse(v);
  return Number.isFinite(ts) ? ts : 0;
}

function toDateInput(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toTimeInput(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function normalizeAmountMode(v = '') {
  return pickStr(v).toLowerCase() === 'equal' ? 'equal' : 'random_range';
}

function getAmountModeLabel(v = '') {
  return normalizeAmountMode(v) === 'equal' ? '均分红包' : '随机红包';
}

function canSplitEqualExactly(totalAmountFen = 0, winnerCount = 0) {
  const totalFen = Math.max(0, Math.round(Number(totalAmountFen) || 0));
  const count = Math.max(0, Math.round(Number(winnerCount) || 0));
  return count > 0 && totalFen >= count && totalFen % count === 0;
}

function buildFormMeta(form = {}) {
  const totalAmountFen = Math.max(0, yuanInputToFen(pickStr(form.totalAmountYuan)));
  const winnerCount = Math.max(0, Math.round(Number(form.winnerCount) || 0));
  const amountMode = normalizeAmountMode(form.amountMode);
  const amountModeLabel = getAmountModeLabel(amountMode);
  const totalLabel = formatFenLabel(totalAmountFen);
  let previewText = `总奖金 ${totalLabel}，${winnerCount || 0} 人中奖。用户在开奖前点击“参与抽奖”即可入场，到时间后系统会从已参与用户中统一开奖。`;
  let amountModeHint = '填写总奖金和中奖人数后，会自动显示当前奖金分配方式。';
  let equalModeInvalid = false;

  if (totalAmountFen > 0 && winnerCount > 0) {
    if (amountMode === 'equal') {
      if (canSplitEqualExactly(totalAmountFen, winnerCount)) {
        const perWinnerFen = Math.floor(totalAmountFen / winnerCount);
        previewText = `总奖金 ${totalLabel} 将按均分方式开奖，预计 ${winnerCount} 位中奖用户每人固定拿 ${formatFenLabel(perWinnerFen)}。`;
        amountModeHint = `每位中奖用户固定拿 ${formatFenLabel(perWinnerFen)}。如果到开奖时参与人数不足，没发出的等额份数会保留在活动金额里。`;
      } else {
        equalModeInvalid = true;
        previewText = `当前总奖金 ${totalLabel} 不能被 ${winnerCount} 人整分，暂时不能使用均分红包。`;
        amountModeHint = `均分红包要求总奖金能被 ${winnerCount} 人整分，请改成随机红包或调整总金额。`;
      }
    } else {
      previewText = `总奖金 ${totalLabel} 将按随机红包方式开奖，系统会把这笔奖金随机拆成 ${winnerCount} 份后再发给中奖用户。`;
      amountModeHint = `随机红包会把 ${totalLabel} 完全随机拆成 ${winnerCount} 份，每位中奖用户拿到的金额可能不同。`;
    }
  }

  return {
    amountModeLabel,
    previewText,
    amountModeHint,
    equalModeInvalid,
  };
}

const INITIAL_FORM = buildDefaultForm();
const INITIAL_FORM_META = buildFormMeta(INITIAL_FORM);

function buildDefaultForm() {
  const now = Date.now();
  const drawAt = now + 60 * 60 * 1000;
  return {
    title: '',
    subtitle: '开奖时会从已参与用户中自动抽出中奖人',
    description: '',
    totalAmountYuan: '200.00',
    winnerCount: '2',
    amountMode: 'random_range',
    coverTheme: 'cozy_gift',
    winnerNotice: '开奖完成后，奖金会自动发到钱包余额',
    rulesText: '1. 每位注册用户仅可参与 1 次\n2. 开奖前点一下就算参与成功\n3. 到开奖时间后系统会统一开奖并自动发放奖金',
    drawAtDate: toDateInput(drawAt),
    drawAtTime: toTimeInput(drawAt),
  };
}

function buildFormFromCampaign(campaign = {}) {
  const drawAt = toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt) || (Date.now() + 60 * 60 * 1000);
  return {
    title: pickStr(campaign.title),
    subtitle: pickStr(campaign.subtitle),
    description: pickStr(campaign.description),
    totalAmountYuan: fenToYuanInput(campaign.totalAmountFen || 0),
    winnerCount: String(Number(campaign.winnerCount || 0) || ''),
    amountMode: normalizeAmountMode(campaign.amountMode),
    coverTheme: pickStr(campaign.coverTheme, 'cozy_gift'),
    winnerNotice: pickStr(campaign.winnerNotice, '开奖完成后，奖金会自动发到钱包余额'),
    rulesText: pickStr(campaign.rulesText),
    drawAtDate: toDateInput(drawAt),
    drawAtTime: toTimeInput(drawAt),
  };
}

function buildPayload(form = {}) {
  const amountMode = normalizeAmountMode(form.amountMode);
  const totalAmountFen = yuanInputToFen(form.totalAmountYuan);
  return {
    title: pickStr(form.title),
    subtitle: pickStr(form.subtitle),
    description: pickStr(form.description),
    totalAmountYuan: pickStr(form.totalAmountYuan),
    totalAmountFen,
    winnerCount: Number(form.winnerCount || 0),
    amountMode,
    amountConfig: amountMode === 'random_range'
      ? {
        templateId: '',
        minFen: 1,
        maxFen: Math.max(1, totalAmountFen),
      }
      : {},
    coverTheme: pickStr(form.coverTheme, 'cozy_gift'),
    winnerNotice: pickStr(form.winnerNotice, '开奖完成后，奖金会自动发到钱包余额'),
    rulesText: pickStr(form.rulesText),
    drawAt: `${pickStr(form.drawAtDate)} ${pickStr(form.drawAtTime)}`,
  };
}

function getFundingStatusText(status = '') {
  const map = {
    unpaid: '待支付',
    partial: '部分入池',
    pending: '待确认',
    partial_pending: '部分入池',
    paid: '已入池',
  };
  return map[pickStr(status)] || '待支付';
}

function getFundingStatusClass(status = '') {
  const map = {
    paid: 'funding-badge-paid',
    partial: 'funding-badge-partial',
    partial_pending: 'funding-badge-partial',
    pending: 'funding-badge-pending',
  };
  return map[pickStr(status)] || 'funding-badge-default';
}

function decorateFundingOrder(item = {}) {
  const status = pickStr(item.effectiveStatus, item.status);
  const amountFen = Math.max(0, Number(item.amountFen || 0));
  const orderAmountFen = Math.max(0, Number(item.orderAmountFen || item.amountFen || 0));
  const estimatedFeeFen = Math.max(0, Number(item.estimatedPaymentFeeFen || 0));
  const paymentFeeFen = Math.max(0, Number(item.paymentFeeFen || 0));
  const refundableFen = Math.max(0, Number(item.unconfirmAmountFen || 0));
  return {
    ...item,
    id: pickStr(item._id, item.id),
    amountLabel: formatFenLabel(item.amountFen || 0),
    orderAmountLabel: formatFenLabel(orderAmountFen),
    estimatedFeeLabel: formatFenLabel(estimatedFeeFen),
    paymentFeeLabel: formatFenLabel(paymentFeeFen),
    refundableAmountFen: refundableFen,
    refundableAmountLabel: formatFenLabel(refundableFen),
    hasFeeDetail: orderAmountFen > amountFen || estimatedFeeFen > 0 || paymentFeeFen > 0,
    statusLabel: pickStr(item.statusText, getFundingStatusText(status)),
    updatedAtLabel: formatDateTime(toDateMs(item.updatedAt || item.createdAt)),
    paidAtLabel: formatDateTime(toDateMs(item.paidAt || item.updatedAt || item.createdAt)),
  };
}

function decorateCampaignCard(item = {}) {
  const progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
  const participantCount = Number(progress.participantCount || progress.drawCount || 0);
  const pendingPayoutCount = 0;
  const funding = item.funding && typeof item.funding === 'object' ? item.funding : {};
  const fundingStatus = pickStr(funding.status, 'unpaid');
  return {
    ...item,
    id: pickStr(item.id, item._id),
    theme: getThemeMeta(item.coverTheme),
    themeClass: `theme-${pickStr(item.coverTheme, 'cozy_gift')}`,
    totalAmountLabel: formatFenLabel(item.totalAmountFen || 0),
    amountModeLabel: getAmountModeLabel(item.amountMode),
    drawAtLabel: pickStr(item.drawAtText, item.endAtText, item.openAtText),
    drawCountLabel: String(participantCount),
    participantCountLabel: String(participantCount),
    remainingWinnerLabel: String(Math.max(0, Number(progress.remainingWinnerCount != null ? progress.remainingWinnerCount : item.winnerCount || 0))),
    remainingAmountLabel: formatFenLabel(progress.remainingAmountFen != null ? progress.remainingAmountFen : item.totalAmountFen || 0),
    fundingStatusLabel: getFundingStatusText(fundingStatus),
    fundingStatusClass: getFundingStatusClass(fundingStatus),
    fundedAmountLabel: formatFenLabel(funding.paidAmountFen || 0),
    fundingPendingLabel: formatFenLabel(funding.pendingAmountFen || 0),
    fundingRemainingLabel: formatFenLabel(funding.remainingAmountFen != null ? funding.remainingAmountFen : item.totalAmountFen || 0),
    canPayFunding: ['draft', 'offline'].includes(pickStr(item.status)) && participantCount <= 0 && Number(funding.remainingAmountFen || item.totalAmountFen || 0) > 0,
    editable: ['draft', 'offline'].includes(pickStr(item.status)) && participantCount <= 0,
    drawLocked: participantCount > 0,
    pendingPayoutCount,
  };
}

function decorateWinner(item = {}) {
  return {
    ...item,
    id: pickStr(item._id, item.id),
    nicknameText: pickStr(item.userSnapshot && item.userSnapshot.nickname, '住户'),
    amountLabel: formatFenLabel(item.amountFen || 0),
    drawAtLabel: pickStr(item.drawAtText, formatDateTime(toDateMs(item.drawAt))),
    resultLabel: pickStr(item.result) === 'win' ? '已中奖' : '未中奖',
  };
}

function maskPhone(phone = '') {
  const text = pickStr(phone);
  if (!/^1\d{10}$/.test(text)) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function maskOpenid(openid = '') {
  const text = pickStr(openid);
  if (text.length <= 12) return text;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function getPayoutAdvice(item = {}) {
  const errorText = pickStr(item.lastErrorMsg).toLowerCase();
  if (errorText.includes('可确认金额不足') || errorText.includes('手续费')) {
    return '这笔更像是活动入池金额不足，先补活动金额再点“重试”。';
  }
  if (['pending', 'processing'].includes(pickStr(item.status))) {
    return '这笔还在处理中，先点“查余额”确认用户是否到账，再决定是否重试。';
  }
  if (pickStr(item.status) === 'failed') {
    return '这笔已失败，建议先点“查余额”，确认未到账后再“重试”或“发到余额”。';
  }
  return '';
}

function buildAnomalySummary(selectedCampaign = null, fundingOrders = [], payoutLogs = []) {
  const campaign = selectedCampaign && typeof selectedCampaign === 'object' ? selectedCampaign : {};
  const funding = campaign && campaign.funding && typeof campaign.funding === 'object' ? campaign.funding : {};
  const fundingGapFen = Math.max(0, Number(funding.remainingAmountFen || 0));
  const failedPayoutCount = (Array.isArray(payoutLogs) ? payoutLogs : []).filter(item => pickStr(item.status) === 'failed').length;
  const pendingPayoutCount = (Array.isArray(payoutLogs) ? payoutLogs : []).filter(item => ['pending', 'processing'].includes(pickStr(item.status))).length;
  const shortagePayoutCount = (Array.isArray(payoutLogs) ? payoutLogs : []).filter(item => item && item.needsFundingTopUp).length;
  const refundableFundingFen = (Array.isArray(fundingOrders) ? fundingOrders : []).reduce((sum, item) => sum + Math.max(0, Number(item && item.refundableAmountFen || 0)), 0);
  const refundPendingCount = (Array.isArray(fundingOrders) ? fundingOrders : []).filter(item => pickStr(item && item.effectiveStatus) === 'refund_pending').length;
  const lines = [];

  if (fundingGapFen > 0) {
    lines.push(`当前活动还差 ${formatFenLabel(fundingGapFen)} 可发奖金，先补活动金额再继续派奖。`);
  }
  if (shortagePayoutCount > 0) {
    lines.push(`有 ${shortagePayoutCount} 笔派奖因为可确认金额不足失败，通常是活动入池金额没有把支付手续费算进去。`);
  }
  if (failedPayoutCount > 0 && shortagePayoutCount === 0) {
    lines.push(`有 ${failedPayoutCount} 笔派奖异常，建议先查余额确认是否到账，再决定重试还是发到余额。`);
  }
  if (pendingPayoutCount > 0) {
    lines.push(`有 ${pendingPayoutCount} 笔派奖还在处理中，先不要重复补发。`);
  }
  if (refundPendingCount > 0) {
    lines.push(`有 ${refundPendingCount} 笔活动资金退款处理中，等汇付回调完成后再继续删活动或再次退款。`);
  }
  if (!lines.length && refundableFundingFen > 0) {
    lines.push(`当前活动还有 ${formatFenLabel(refundableFundingFen)} 未派出资金，可直接点“退回活动资金”。`);
  }

  return {
    hasIssues: lines.length > 0,
    lines,
    failedPayoutCount,
    pendingPayoutCount,
    shortagePayoutCount,
    refundPendingCount,
    refundableFundingFen,
    refundableFundingLabel: formatFenLabel(refundableFundingFen),
    fundingGapFen,
    fundingGapLabel: formatFenLabel(fundingGapFen),
  };
}

function buildWalletInspectionView(ret = {}, extra = {}) {
  const user = ret && ret.user && typeof ret.user === 'object' ? ret.user : {};
  const wallet = ret && ret.wallet && typeof ret.wallet === 'object' ? ret.wallet : {};
  const recentTransactions = (Array.isArray(ret && ret.recentTransactions) ? ret.recentTransactions : []).map(item => ({
    ...item,
    id: pickStr(item && item.id, item && item._id),
    createdAtLabel: formatDateTime(toDateMs(item && item.createdAt)),
    balanceDeltaLabel: `${Number(item && item.balanceDelta || 0) >= 0 ? '+' : ''}${(Number(item && item.balanceDelta || 0) || 0).toFixed(2)}`,
  }));
  const hasActivityIncome = recentTransactions.some(item => pickStr(item.type) === 'activity_income');
  const availableBalance = Number(wallet.availableBalance || 0);
  const localBalance = Number(wallet.localBalance || 0);
  let statusText = '已拉取当前用户余额和最近流水，请结合派奖日志判断是否需要重试。';
  if (hasActivityIncome) {
    statusText = '最近流水里已经出现活动入账记录，先不要重复补发。';
  } else if (availableBalance <= 0 && localBalance <= 0 && recentTransactions.length === 0) {
    statusText = '当前未发现到账迹象：汇付余额为 0，本地余额为 0，最近也没有活动入账流水。';
  } else if (availableBalance > 0 || localBalance > 0) {
    statusText = '用户当前已有余额，请先人工核对这是不是本次活动奖励，再决定是否重试或退款。';
  }
  return {
    payoutLogId: pickStr(extra.payoutLogId),
    amountLabel: pickStr(extra.amountLabel),
    targetName: pickStr(extra.name, user.name, '住户'),
    targetPhone: maskPhone(pickStr(user.phone)),
    targetOpenid: pickStr(user.openid),
    targetOpenidText: maskOpenid(pickStr(user.openid)),
    huifuId: pickStr(user.huifuId),
    availableBalanceText: `¥${pickStr(wallet.availableBalanceText, '0.00')}`,
    localBalanceText: `¥${pickStr(wallet.localBalanceText, '0.00')}`,
    hasActivityIncome,
    statusText,
    recentTransactions,
  };
}

function decoratePayout(item = {}, winnerMap = {}) {
  const winner = winnerMap && typeof winnerMap === 'object' ? (winnerMap[pickStr(item.drawRecordId)] || null) : null;
  const needsFundingTopUp = pickStr(item.lastErrorMsg).includes('可确认金额不足') || pickStr(item.lastErrorMsg).includes('手续费');
  return {
    ...item,
    id: pickStr(item._id, item.id),
    nicknameText: pickStr(item.nickname, item.userName, winner && winner.nicknameText, '住户'),
    openidText: maskOpenid(pickStr(item.openid, winner && winner.openid)),
    amountLabel: formatFenLabel(item.amountFen || 0),
    statusLabel: getPayoutStatusText(item.status),
    updatedAtLabel: formatDateTime(toDateMs(item.updatedAt || item.createdAt)),
    canRetry: pickStr(item.status) !== 'success',
    retryLabel: Number(item.retryCount || 0) > 0 ? `已重试 ${item.retryCount} 次` : '未重试',
    needsFundingTopUp,
    adviceText: getPayoutAdvice({ ...item, needsFundingTopUp }),
  };
}

Page({
  data: {
    isAdmin: false,
    isLoading: true,
    isSubmitting: false,
    loadError: false,
    errorText: '',
    summary: null,
    campaignList: [],
    selectedCampaignId: '',
    selectedCampaign: null,
    winners: [],
    payoutLogs: [],
    fundingOrders: [],
    anomalySummary: null,
    walletInspection: null,
    isInspectingWallet: false,
    inspectingPayoutLogId: '',
    form: INITIAL_FORM,
    formPreviewText: INITIAL_FORM_META.previewText,
    amountModeHint: INITIAL_FORM_META.amountModeHint,
    equalModeInvalid: INITIAL_FORM_META.equalModeInvalid,
    pickerIndex: {
      amountMode: 0,
      coverTheme: 0,
    },
    amountModeOptions: AMOUNT_MODE_OPTIONS,
    coverThemeOptions: COVER_THEME_OPTIONS,
  },
  onShow() {
    const user = getStoredUser();
    const isAdmin = !!(user && user.isPlatformAdmin);
    this.setData({ isAdmin });
    if (!isAdmin) {
      toast('仅平台管理员可进入');
      setTimeout(() => {
        wx.switchTab({ url: '/pages/profile/index/index' });
      }, 300);
      return;
    }
    this.loadDashboard();
  },
  async _callActivityAdmin(action, payload = {}) {
    const res = await wx.cloud.callFunction({
      name: 'activityAdmin',
      data: {
        action,
        ...payload,
      }
    });
    return (res && res.result) || res || null;
  },
  async _callActivityReveal(action, payload = {}) {
    const res = await wx.cloud.callFunction({
      name: 'activityReveal',
      data: {
        action,
        ...payload,
      }
    });
    return (res && res.result) || res || null;
  },
  _syncPickerIndex(form = {}) {
    const buildIndex = (list, value, fallback = 0) => {
      const idx = (Array.isArray(list) ? list : []).findIndex(item => pickStr(item && item.value) === pickStr(value));
      return idx >= 0 ? idx : fallback;
    };
    this.setData({
      pickerIndex: {
        amountMode: buildIndex(this.data.amountModeOptions, normalizeAmountMode(form.amountMode), 0),
        coverTheme: buildIndex(this.data.coverThemeOptions, form.coverTheme, 0),
      }
    });
  },
  _setForm(form = {}) {
    const nextForm = {
      ...buildDefaultForm(),
      ...(form || {}),
      amountMode: normalizeAmountMode(form.amountMode),
    };
    const meta = buildFormMeta(nextForm);
    this.setData({
      form: nextForm,
      formPreviewText: meta.previewText,
      amountModeHint: meta.amountModeHint,
      equalModeInvalid: meta.equalModeInvalid,
    }, () => this._syncPickerIndex(nextForm));
  },
  _getPayloadValidationError(payload = {}) {
    if (!pickStr(payload.title)) return '请填写活动标题';
    if (!(Number(payload.totalAmountFen || 0) >= 1)) return '总奖金不合法';
    if (!(Number(payload.winnerCount || 0) >= 1)) return '中奖人数不合法';
    if (!(Number(payload.totalAmountFen || 0) >= Number(payload.winnerCount || 0))) return '总奖金不能低于中奖人数（按分校验）';
    if (pickStr(payload.amountMode) === 'equal' && !canSplitEqualExactly(payload.totalAmountFen, payload.winnerCount)) {
      return `均分红包要求总奖金能被 ${payload.winnerCount} 人整分`;
    }
    if (!pickStr(payload.drawAt)) return '请填写开奖时间';
    return '';
  },
  async _ensureDueReveal() {
    try {
      await this._callActivityReveal('ensure_due_campaigns', { limit: 8 });
    } catch (err) {
      console.error('活动统一开奖刷新失败', err);
    }
  },
  async loadDashboard({ selectCampaignId = '', keepSelection = false } = {}) {
    this.setData({
      isLoading: true,
      loadError: false,
      errorText: '',
    });
    try {
      await this._ensureDueReveal();
      const [dashboardRes, listRes] = await Promise.all([
        this._callActivityAdmin('dashboard'),
        this._callActivityAdmin('list_campaigns', { limit: 30 }),
      ]);
      if (!dashboardRes || dashboardRes.ok !== true) {
        throw new Error(pickStr(dashboardRes && dashboardRes.err && dashboardRes.err.msg, '活动总览加载失败'));
      }
      if (!listRes || listRes.ok !== true) {
        throw new Error(pickStr(listRes && listRes.err && listRes.err.msg, '活动列表加载失败'));
      }
      const campaignList = (Array.isArray(listRes.items) ? listRes.items : []).map(item => decorateCampaignCard(item));
      const nextSelectedId = pickStr(selectCampaignId)
        || (keepSelection ? pickStr(this.data.selectedCampaignId) : '')
        || pickStr(campaignList[0] && campaignList[0].id);

      this.setData({
        isLoading: false,
        summary: dashboardRes.summary || null,
        campaignList,
      });

      if (nextSelectedId) {
        await this.loadCampaignDetail(nextSelectedId, { syncForm: !keepSelection });
      } else {
        this.setData({
          selectedCampaignId: '',
          selectedCampaign: null,
          winners: [],
          payoutLogs: [],
          fundingOrders: [],
          anomalySummary: null,
          walletInspection: null,
        });
      }
    } catch (err) {
      console.error('活动管理页加载失败', err);
      this.setData({
        isLoading: false,
        loadError: true,
        errorText: pickStr(err && err.message, '活动管理页加载失败'),
      });
    }
  },
  async loadCampaignDetail(campaignId = '', { syncForm = false } = {}) {
    const id = pickStr(campaignId);
    if (!id) return;
    try {
      await this._ensureDueReveal();
      const ret = await this._callActivityAdmin('get_campaign_detail', { campaignId: id });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '活动详情加载失败'));
      }
      const selectedCampaign = decorateCampaignCard(ret.campaign || {});
      const winners = (Array.isArray(ret.winners) ? ret.winners : []).map(item => decorateWinner(item));
      const winnerMap = winners.reduce((out, item) => {
        const key = pickStr(item && item.id, item && item._id);
        if (key) out[key] = item;
        return out;
      }, {});
      const payoutLogs = (Array.isArray(ret.payoutLogs) ? ret.payoutLogs : []).map(item => decoratePayout(item, winnerMap));
      const fundingOrders = (Array.isArray(ret.fundingOrders) ? ret.fundingOrders : []).map(item => decorateFundingOrder(item));
      const currentInspection = this.data.walletInspection || null;
      const keepInspection = currentInspection && payoutLogs.some(item => pickStr(item.id) === pickStr(currentInspection.payoutLogId))
        ? currentInspection
        : null;
      this.setData({
        selectedCampaignId: id,
        selectedCampaign,
        winners,
        payoutLogs,
        fundingOrders,
        anomalySummary: buildAnomalySummary(selectedCampaign, fundingOrders, payoutLogs),
        walletInspection: keepInspection,
      });
      if (syncForm) this._setForm(buildFormFromCampaign(ret.campaign || {}));
    } catch (err) {
      toast(pickStr(err && err.message, '活动详情加载失败'));
    }
  },
  onNewCampaign() {
    this.setData({
      selectedCampaignId: '',
      selectedCampaign: null,
      winners: [],
      payoutLogs: [],
      fundingOrders: [],
      anomalySummary: null,
      walletInspection: null,
    });
    this._setForm(buildDefaultForm());
  },
  onSelectCampaign(e) {
    const campaignId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!campaignId) return;
    this.loadCampaignDetail(campaignId, { syncForm: true });
  },
  onFieldInput(e) {
    const field = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field);
    if (!field) return;
    const form = {
      ...(this.data.form || {}),
      [field]: e && e.detail ? e.detail.value : '',
    };
    this._setForm(form);
  },
  onPickerChange(e) {
    const field = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field);
    const listName = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.list);
    const list = Array.isArray(this.data[listName]) ? this.data[listName] : [];
    const idx = Number(e && e.detail && e.detail.value || 0);
    const option = list[idx] || list[0] || {};
    const form = {
      ...(this.data.form || {}),
      [field]: pickStr(option.value),
    };
    this._setForm(form);
  },
  async _saveCampaign({ publishAfter = false } = {}) {
    const form = this.data.form || {};
    const payload = buildPayload(form);
    const payloadError = this._getPayloadValidationError(payload);
    if (payloadError) {
      toast(payloadError);
      return;
    }
    const selected = this.data.selectedCampaign || {};
    const selectedId = pickStr(this.data.selectedCampaignId);
    const canUpdateCurrent = selectedId && !!selected.editable;
    const action = canUpdateCurrent ? 'update_campaign' : 'create_campaign';

    this.setData({ isSubmitting: true });
    try {
      const saveRet = await this._callActivityAdmin(action, {
        ...payload,
        campaignId: canUpdateCurrent ? selectedId : '',
      });
      if (!saveRet || saveRet.ok !== true) {
        throw new Error(pickStr(saveRet && saveRet.err && saveRet.err.msg, '保存活动失败'));
      }
      const campaignId = pickStr(saveRet.campaignId, selectedId);
      if (publishAfter) {
        const publishRet = await this._callActivityAdmin('publish_campaign', { campaignId });
        if (!publishRet || publishRet.ok !== true) {
          throw new Error(pickStr(publishRet && publishRet.err && publishRet.err.msg, '发布活动失败'));
        }
      }
      await this.loadDashboard({ selectCampaignId: campaignId });
      toast(publishAfter ? '活动已发布' : '草稿已保存');
    } catch (err) {
      toast(pickStr(err && err.message, '保存活动失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  onSaveDraft() {
    if (this.data.isSubmitting) return;
    this._saveCampaign({ publishAfter: false });
  },
  async _upsertCampaignOnly() {
    const form = this.data.form || {};
    const payload = buildPayload(form);
    const payloadError = this._getPayloadValidationError(payload);
    if (payloadError) {
      throw new Error(payloadError);
    }
    const selected = this.data.selectedCampaign || {};
    const selectedId = pickStr(this.data.selectedCampaignId);
    const canUpdateCurrent = selectedId && !!selected.editable;
    const action = canUpdateCurrent ? 'update_campaign' : 'create_campaign';
    const ret = await this._callActivityAdmin(action, {
      ...payload,
      campaignId: canUpdateCurrent ? selectedId : '',
    });
    if (!ret || ret.ok !== true) {
      throw new Error(pickStr(ret && ret.err && ret.err.msg, '保存活动失败'));
    }
    return pickStr(ret.campaignId, selectedId);
  },
  async onPayFunding() {
    if (this.data.isSubmitting) return;
    const selectedCampaign = this.data.selectedCampaign || null;
    if (selectedCampaign && Number(((selectedCampaign.funding && selectedCampaign.funding.remainingAmountFen) || 0)) <= 0) {
      toast('当前活动金额已经支付完成');
      return;
    }
    this.setData({ isSubmitting: true });
    let campaignId = '';
    let fundingOrderId = '';
    let paymentCompleted = false;
    try {
      campaignId = await this._upsertCampaignOnly();
      const orderRet = await this._callActivityAdmin('prepare_funding_order', { campaignId });
      if (!orderRet || orderRet.ok !== true) {
        throw new Error(pickStr(orderRet && orderRet.err && orderRet.err.msg, '生成活动金额订单失败'));
      }
      fundingOrderId = pickStr(orderRet.fundingOrderId);
      let subAppid = '';
      try {
        const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
        subAppid = info && info.miniProgram ? pickStr(info.miniProgram.appId) : '';
      } catch (err) {
        // ignore
      }
      const payRes = await wx.cloud.callFunction({
        name: 'huifuMiniappPay',
        data: {
          action: 'jspay_activity_funding',
          fundingOrderId,
          subAppid: subAppid || undefined,
        }
      });
      const payRet = (payRes && payRes.result) || payRes || null;
      if (!payRet || payRet.ok !== true) {
        throw new Error(pickStr(payRet && (typeof payRet.err === 'string' ? payRet.err : (payRet.err && payRet.err.msg)), '拉起支付失败'));
      }

      await wx.requestPayment({
        ...(payRet.payParams || {}),
      });
      paymentCompleted = true;

      const confirmRet = await this._callActivityAdmin('confirm_funding_payment', {
        campaignId,
        fundingOrderId,
        confirmSource: 'client',
      });
      if (!confirmRet || confirmRet.ok !== true) {
        throw new Error(pickStr(confirmRet && confirmRet.err && confirmRet.err.msg, '支付已完成，请刷新后查看入池状态'));
      }

      await this.loadDashboard({ selectCampaignId: campaignId });
      toast(pickStr(confirmRet && confirmRet.msg, '活动金额已入池'));
    } catch (err) {
      const errMsg = pickStr(err && err.errMsg, err && err.message, '活动金额支付失败');
      const isCancel = errMsg.indexOf('cancel') > -1 || errMsg.indexOf('取消') > -1;
      if (fundingOrderId && !paymentCompleted) {
        try {
          await this._callActivityAdmin('cancel_funding_payment', {
            campaignId,
            fundingOrderId,
            errorCode: isCancel ? 'PAY_CANCELLED' : 'PAY_FAILED',
            errorMsg: isCancel ? '支付已取消' : errMsg,
          });
        } catch (cancelErr) {
          console.error('取消活动金额订单失败', cancelErr);
        }
      }
      if (campaignId) {
        await this.loadDashboard({ selectCampaignId: campaignId });
      }
      toast(paymentCompleted ? '支付已完成，请刷新查看是否已入池' : (isCancel ? '支付已取消' : errMsg));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onPublishCampaign() {
    if (this.data.isSubmitting) return;
    const ok = await confirm('确认按当前表单内容保存并发布活动吗？', '发布活动');
    if (!ok) return;
    this._saveCampaign({ publishAfter: true });
  },
  async onOfflineCampaign() {
    const campaignId = pickStr(this.data.selectedCampaignId);
    if (!campaignId || this.data.isSubmitting) return;
    const ok = await confirm('确认下线当前活动吗？下线后普通用户将无法继续参与。', '下线活动');
    if (!ok) return;
    this.setData({ isSubmitting: true });
    try {
      const ret = await this._callActivityAdmin('offline_campaign', { campaignId });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '下线活动失败'));
      }
      await this.loadDashboard({ selectCampaignId: campaignId });
      toast('活动已下线');
    } catch (err) {
      toast(pickStr(err && err.message, '下线活动失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onFinishCampaign() {
    const campaignId = pickStr(this.data.selectedCampaignId);
    if (!campaignId || this.data.isSubmitting) return;
    const ok = await confirm('确认强制结束当前活动吗？这会把活动状态改为已结束。', '结束活动');
    if (!ok) return;
    this.setData({ isSubmitting: true });
    try {
      const ret = await this._callActivityAdmin('finish_campaign', { campaignId });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '结束活动失败'));
      }
      await this.loadDashboard({ selectCampaignId: campaignId });
      toast('活动已结束');
    } catch (err) {
      toast(pickStr(err && err.message, '结束活动失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onDeleteCampaign() {
    const campaignId = pickStr(this.data.selectedCampaignId);
    if (!campaignId || this.data.isSubmitting) return;
    const ok = await confirm('确认删除当前活动吗？本地测试奖励会先自动回退，再删除活动。', '删除活动');
    if (!ok) return;
    this.setData({ isSubmitting: true });
    try {
      const ret = await this._callActivityAdmin('delete_campaign', { campaignId });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '删除活动失败'));
      }
      await this.loadDashboard();
      toast('活动已删除');
    } catch (err) {
      toast(pickStr(err && err.message, '删除活动失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onRefundCampaignFunding() {
    const campaignId = pickStr(this.data.selectedCampaignId);
    if (!campaignId || this.data.isSubmitting) return;
    const ok = await confirm('确认把当前活动里还没派出去的资金退回原支付账户吗？如果汇付已受理，会显示退款处理中。', '退回活动资金');
    if (!ok) return;
    this.setData({ isSubmitting: true });
    try {
      const ret = await this._callActivityAdmin('refund_campaign_funding', { campaignId });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '活动资金退款失败'));
      }
      await this.loadCampaignDetail(campaignId, { syncForm: false });
      toast(pickStr(ret && ret.msg, '活动资金已退回'));
    } catch (err) {
      toast(pickStr(err && err.message, '活动资金退款失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onRetryPayout(e) {
    const payoutLogId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    const campaignId = pickStr(this.data.selectedCampaignId);
    if (!payoutLogId || !campaignId || this.data.isSubmitting) return;
    this.setData({ isSubmitting: true });
    try {
      const ret = await this._callActivityAdmin('retry_payout', {
        payoutLogId,
        campaignId,
      });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '重试派奖失败'));
      }
      await this.loadCampaignDetail(campaignId, { syncForm: false });
      toast('已发起重试');
    } catch (err) {
      toast(pickStr(err && err.message, '重试派奖失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onRetryPayoutToWallet(e) {
    const payoutLogId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    const campaignId = pickStr(this.data.selectedCampaignId);
    if (!payoutLogId || this.data.isSubmitting) return;
    const ok = await confirm('确认把这笔失败奖励直接发到用户钱包余额吗？这会跳过汇付通道，只写入小程序钱包账本。', '发到余额');
    if (!ok) return;
    this.setData({ isSubmitting: true });
    try {
      const ret = await this._callActivityAdmin('retry_payout', {
        payoutLogId,
        campaignId,
        forcePayoutMode: 'local_wallet',
      });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '发到余额失败'));
      }
      if (campaignId) {
        await this.loadCampaignDetail(campaignId, { syncForm: false });
      }
      toast('奖励已发到用户余额');
    } catch (err) {
      toast(pickStr(err && err.message, '发到余额失败'));
    } finally {
      this.setData({ isSubmitting: false });
    }
  },
  async onInspectPayoutWallet(e) {
    const payoutLogId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    const targetOpenid = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.openid);
    const targetName = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name);
    const amountLabel = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.amount);
    if (!payoutLogId || !targetOpenid || this.data.isInspectingWallet) return;
    this.setData({ isInspectingWallet: true, inspectingPayoutLogId: payoutLogId });
    try {
      const ret = await this._callActivityAdmin('inspect_user_wallet', {
        targetOpenid,
        limit: 8,
      });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '查询用户余额失败'));
      }
      this.setData({
        walletInspection: buildWalletInspectionView(ret, {
          payoutLogId,
          name: targetName,
          amountLabel,
        }),
      });
      toast('已更新用户余额和流水');
    } catch (err) {
      toast(pickStr(err && err.message, '查询用户余额失败'));
    } finally {
      this.setData({ isInspectingWallet: false, inspectingPayoutLogId: '' });
    }
  },
  onClearWalletInspection() {
    this.setData({ walletInspection: null });
  },
  onRefresh() {
    if (this.data.isLoading) return;
    this.loadDashboard({ keepSelection: true });
  },
});
