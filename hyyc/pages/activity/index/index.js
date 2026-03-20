const { toast } = require('../../../utils/ui');
const { getStoredUser } = require('../../../utils/userIdentity');
const { formatFenLabel } = require('../../../utils/activityMoney');
const { getPayoutStatusText } = require('../../../utils/activityStatus');
const { getThemeMeta } = require('../../../utils/activityTheme');

const HOME_CACHE_TTL_MS = 10 * 1000;
const HISTORY_CACHE_TTL_MS = 60 * 1000;
const REVEAL_ENSURE_INTERVAL_MS = 5 * 1000;
const OPEN_REFRESH_INTERVAL_MS = 3 * 1000;
const WINNER_FEED_PREVIEW_COUNT = 2;
const WINNER_SHEET_LIMIT = 100;

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && Number.isFinite(v.$date)) return Number(v.$date);
  const raw = pickStr(v);
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (matched && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const year = Number(matched[1]);
    const month = Number(matched[2]) - 1;
    const day = Number(matched[3]);
    const hour = Number(matched[4] || 0);
    const minute = Number(matched[5] || 0);
    const second = Number(matched[6] || 0);
    return Date.UTC(year, month, day, hour - 8, minute, second);
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function formatCountdown(ms = 0) {
  const safe = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(safe / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildStageCopy(campaign = {}) {
  const winnerCount = Math.max(0, Number(campaign.winnerCount || 0));

  if (winnerCount <= 1) {
    return {
      title: '开奖时会抽出 1 位业主',
      footer: '开奖前点一下就算参与成功',
    };
  }

  return {
    title: `开奖时会抽出 ${winnerCount} 位业主`,
    footer: '开奖前点一下就算参与成功',
  };
}

function decorateRecord(doc = {}) {
  if (!doc || !doc.id && !doc._id) return null;
  const amountFen = Number(doc.amountFen || 0);
  const result = pickStr(doc.result);
  return {
    ...doc,
    id: pickStr(doc.id, doc._id),
    resultBadge: result === 'pending' ? '已参与' : (result === 'win' ? '中奖了' : '未中奖'),
    resultClass: result === 'pending' ? 'result-pending' : (result === 'win' ? 'result-win' : 'result-lose'),
    amountLabel: result === 'pending' ? '等待开奖' : (result === 'win' ? formatFenLabel(amountFen) : '谢谢参与'),
    payoutStatusLabel: result === 'win' ? getPayoutStatusText(doc.payoutStatus) : '',
    displayTimeText: pickStr(doc.drawAtText, doc.joinAtText),
  };
}

function decorateWinner(item = {}) {
  return {
    ...item,
    id: pickStr(item.id, item._id),
    nicknameText: pickStr(item.nickname, '住户'),
    buildingText: pickStr(item.building, '本小区住户'),
    amountLabel: item.amountText ? `¥${item.amountText}` : formatFenLabel(item.amountFen || 0),
    drawAtLabel: pickStr(item.drawAtText),
  };
}

function sliceWinnerPreview(list = []) {
  return (Array.isArray(list) ? list : []).slice(0, WINNER_FEED_PREVIEW_COUNT);
}

function buildWinnerPreviewLabel(list = [], preview = []) {
  const total = Array.isArray(list) ? list.length : 0;
  const shown = Array.isArray(preview) ? preview.length : 0;
  if (!total) return '';
  return total > shown ? '查看全部' : `最近 ${total} 条`;
}

function decorateHistory(item = {}) {
  const theme = getThemeMeta(item.coverTheme);
  const progress = item.progress && typeof item.progress === 'object' ? item.progress : {};
  return {
    ...item,
    id: pickStr(item.id, item._id),
    theme,
    themeClass: `theme-${theme.value}`,
    totalAmountLabel: formatFenLabel(item.totalAmountFen || 0),
    drawAtLabel: pickStr(item.drawAtText, item.endAtText, item.openAtText),
    statusLabel: pickStr(item.statusText),
    participantCountText: String(Math.max(0, Number(progress.participantCount || progress.drawCount || 0))),
    remainingWinnerText: String(Math.max(0, Number(progress.remainingWinnerCount != null ? progress.remainingWinnerCount : item.winnerCount || 0))),
  };
}

function decorateCampaign(campaign = {}) {
  if (!campaign || !campaign._id && !campaign.id) return null;
  const theme = getThemeMeta(campaign.coverTheme);
  const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
  const remainingWinnerCount = Math.max(0, Number(progress.remainingWinnerCount != null ? progress.remainingWinnerCount : campaign.winnerCount || 0));
  const remainingAmountFen = Math.max(0, Number(progress.remainingAmountFen != null ? progress.remainingAmountFen : campaign.totalAmountFen || 0));
  const participantCount = Math.max(0, Number(progress.participantCount || progress.drawCount || 0));
  const stageCopy = buildStageCopy(campaign);

  return {
    ...campaign,
    id: pickStr(campaign.id, campaign._id),
    theme,
    themeClass: `theme-${theme.value}`,
    titleDisplay: pickStr(campaign.title, '社区活动'),
    subtitleDisplay: pickStr(campaign.subtitle, theme.heroSubtitle),
    descriptionDisplay: pickStr(campaign.description, '开奖前点一下就算参与成功，到时间后系统会统一开奖。'),
    totalAmountLabel: formatFenLabel(campaign.totalAmountFen || 0),
    remainingAmountLabel: formatFenLabel(remainingAmountFen),
    winnerCountLabel: String(Number(campaign.winnerCount || 0)),
    remainingWinnerLabel: String(remainingWinnerCount),
    participantCountLabel: String(participantCount),
    stageBadge: pickStr(campaign.statusText, '统一开奖'),
    stageTitle: stageCopy.title,
    stageFooter: stageCopy.footer,
  };
}

function buildActionState(campaign = null, myRecord = null, nowMs = Date.now()) {
  if (!campaign) {
    return {
      text: '等待活动发布',
      disabled: true,
      countdownText: '',
      hint: '管理员发布后，这里会出现最新活动',
    };
  }

  const drawAtMs = toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt);
  const status = pickStr(campaign.effectiveStatus, campaign.status);

  if (myRecord && myRecord.id) {
    if (myRecord.result === 'pending') {
      const countdownMs = Math.max(0, drawAtMs - nowMs);
      return {
        text: '已参与',
        disabled: true,
        countdownText: status === 'scheduled' ? formatCountdown(countdownMs) : '',
        hint: status === 'scheduled'
          ? `开奖时间 ${pickStr(campaign.drawAtText)}`
          : '系统正在统一开奖，请稍后查看结果',
      };
    }
    return {
      text: myRecord.result === 'win' ? '已中奖' : '已参与',
      disabled: true,
      countdownText: '',
      hint: pickStr(myRecord.resultTextResolved, myRecord.result === 'win' ? `已获得 ${myRecord.amountLabel}` : '本场已参与完成'),
    };
  }

  if (status === 'scheduled') {
    const countdownMs = Math.max(0, drawAtMs - nowMs);
    return {
      text: '参与抽奖',
      disabled: false,
      countdownText: formatCountdown(countdownMs),
      hint: '开奖前点一下就算参与成功，到时间后系统会统一开奖',
    };
  }
  if (status === 'open') {
    return {
      text: '开奖中',
      disabled: true,
      countdownText: '',
      hint: '系统正在统一开奖，请稍后刷新查看结果',
    };
  }
  if (status === 'finished' || status === 'finished_partial') {
    return {
      text: '活动已结束',
      disabled: true,
      countdownText: '',
      hint: '可以看看下方历史活动记录',
    };
  }
  if (status === 'offline') {
    return {
      text: '活动已下线',
      disabled: true,
      countdownText: '',
      hint: '管理员暂时下线了本场活动',
    };
  }
  return {
    text: '暂不可参与',
    disabled: true,
    countdownText: '',
    hint: '请稍后刷新页面',
  };
}

function shouldKeepClock(campaign = null, myRecord = null) {
  if (!campaign) return false;
  const status = pickStr(campaign.effectiveStatus, campaign.status);
  if (status === 'scheduled') return true;
  return status === 'open' && (!myRecord || !pickStr(myRecord.result) || pickStr(myRecord.result) === 'pending');
}

function getClockInterval(campaign = null) {
  const status = pickStr(campaign && (campaign.effectiveStatus || campaign.status));
  return status === 'open' ? OPEN_REFRESH_INTERVAL_MS : 1000;
}

Page({
  data: {
    needsLogin: false,
    isPlatformAdmin: false,
    isLoading: true,
    loadError: false,
    errorText: '',
    campaign: null,
    myRecord: null,
    winnerFeed: [],
    winnerFeedPreview: [],
    winnerPreviewLabel: '',
    historyCampaigns: [],
    showWinnerSheet: false,
    winnerSheetLoading: false,
    winnerSheetItems: [],
    actionText: '等待活动发布',
    actionHint: '',
    countdownText: '',
    actionDisabled: true,
    actionLoading: false,
  },
  onShow() {
    const user = getStoredUser();
    this.setData({
      needsLogin: !user || !user.realname,
      isPlatformAdmin: !!(user && user.isPlatformAdmin),
    });
    if (!user || !user.realname) {
      this._clearClock();
      this.setData({
        isLoading: false,
        loadError: false,
        campaign: null,
        myRecord: null,
        winnerFeed: [],
        winnerFeedPreview: [],
        winnerPreviewLabel: '',
        showWinnerSheet: false,
        winnerSheetLoading: false,
        winnerSheetItems: [],
        historyCampaigns: [],
      });
      this._winnerSheetCampaignId = '';
      return;
    }
    this._syncClockState(this.data.campaign, this.data.myRecord);
    const nowMs = Date.now();
    const shouldUseCache = !!(
      this.data.campaign
      && this._homeLoadedAt
      && (nowMs - this._homeLoadedAt) < HOME_CACHE_TTL_MS
    );
    if (shouldUseCache) {
      this._refreshActionState(true);
      this._maybeEnsureRevealOnDue(nowMs);
      this._maybeRefreshOpenState(nowMs);
      return;
    }
    this.loadPage({
      silent: !!this.data.campaign,
      includeHistory: !this._historyLoadedAt || (nowMs - this._historyLoadedAt) >= HISTORY_CACHE_TTL_MS,
    });
  },
  onHide() {
    this._clearClock();
  },
  onUnload() {
    this._clearClock();
  },
  onPullDownRefresh() {
    this.loadPage({ silent: true }).finally(() => wx.stopPullDownRefresh());
  },
  _startClock(intervalMs = 1000) {
    const safeInterval = Math.max(1000, Number(intervalMs) || 1000);
    if (this._clockTimer && this._clockIntervalMs === safeInterval) return;
    this._clearClock();
    this._clockIntervalMs = safeInterval;
    this._clockTimer = setInterval(() => this._refreshActionState(), safeInterval);
  },
  _clearClock() {
    if (this._clockTimer) clearInterval(this._clockTimer);
    this._clockTimer = null;
    this._clockIntervalMs = 0;
  },
  _syncClockState(campaign = null, myRecord = null) {
    if (!shouldKeepClock(campaign, myRecord)) {
      this._clearClock();
      return;
    }
    this._startClock(getClockInterval(campaign));
  },
  _refreshActionState(force = false) {
    const nowMs = Date.now();
    const actionState = buildActionState(this.data.campaign, this.data.myRecord, nowMs);
    const patch = {};
    if (force || actionState.text !== this.data.actionText) patch.actionText = actionState.text;
    if (force || actionState.hint !== this.data.actionHint) patch.actionHint = actionState.hint;
    if (force || actionState.countdownText !== this.data.countdownText) patch.countdownText = actionState.countdownText;
    if (force || actionState.disabled !== this.data.actionDisabled) patch.actionDisabled = actionState.disabled;
    if (Object.keys(patch).length) this.setData(patch);
    this._maybeEnsureRevealOnDue(nowMs);
    this._maybeRefreshOpenState(nowMs);
  },
  async _callActivityUser(action, payload = {}) {
    const res = await wx.cloud.callFunction({
      name: 'activityUser',
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
  async _ensureRevealDue(limit = 8) {
    try {
      await this._callActivityReveal('ensure_due_campaigns', { limit });
    } catch (err) {
      console.error('统一开奖检查失败', err);
    }
  },
  _maybeEnsureRevealOnDue(nowMs = Date.now()) {
    const campaign = this.data.campaign;
    if (!campaign) return;
    const myRecord = this.data.myRecord || null;
    const status = pickStr(campaign.effectiveStatus, campaign.status);
    if (status !== 'scheduled') return;
    if (myRecord && pickStr(myRecord.result) && pickStr(myRecord.result) !== 'pending') return;
    const drawAtMs = toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt);
    if (!drawAtMs || drawAtMs > nowMs) return;
    if (this._ensureRevealLock) return;
    if (this._lastEnsureRevealAt && (nowMs - this._lastEnsureRevealAt) < REVEAL_ENSURE_INTERVAL_MS) return;
    this._lastEnsureRevealAt = nowMs;
    this._ensureRevealLock = true;
    this._ensureRevealDue(8)
      .then(() => this.loadPage({ silent: true, includeHistory: false }))
      .finally(() => {
        this._ensureRevealLock = false;
      });
  },
  _maybeRefreshOpenState(nowMs = Date.now()) {
    const campaign = this.data.campaign;
    if (!campaign) return;
    const status = pickStr(campaign.effectiveStatus, campaign.status);
    const myRecord = this.data.myRecord || null;
    if (status !== 'open') return;
    if (myRecord && pickStr(myRecord.result) && pickStr(myRecord.result) !== 'pending') return;
    if (this._openRefreshLock) return;
    if (this._lastOpenRefreshAt && (nowMs - this._lastOpenRefreshAt) < OPEN_REFRESH_INTERVAL_MS) return;
    this._lastOpenRefreshAt = nowMs;
    this._openRefreshLock = true;
    this.loadPage({ silent: true, includeHistory: false })
      .finally(() => {
        this._openRefreshLock = false;
      });
  },
  async loadPage({ silent = false, includeHistory = true } = {}) {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._doLoadPage({ silent, includeHistory })
      .finally(() => {
        this._loadPromise = null;
      });
    return this._loadPromise;
  },
  async _doLoadPage({ silent = false, includeHistory = true } = {}) {
    if (!silent) {
      this.setData({
        isLoading: true,
        loadError: false,
        errorText: '',
      });
    }

    try {
      await this._ensureRevealDue(8);
      const homeRes = await this._callActivityUser('get_activity_home', {
        historyLimit: includeHistory ? 12 : 0,
      });

      if (!homeRes || homeRes.ok !== true) {
        throw new Error(pickStr(homeRes && homeRes.err && homeRes.err.msg, '活动加载失败'));
      }

      const campaign = decorateCampaign(homeRes.campaign);
      const myRecord = decorateRecord(homeRes.myRecord);
      const winnerFeed = (Array.isArray(homeRes.winnerFeed) ? homeRes.winnerFeed : []).map(item => decorateWinner(item));
      const winnerFeedPreview = sliceWinnerPreview(winnerFeed);
      const historyCampaigns = (Array.isArray(homeRes.historyItems) ? homeRes.historyItems : [])
        .filter(item => pickStr(item._id, item.id) !== pickStr(campaign && campaign.id))
        .map(item => decorateHistory(item));
      const patch = {
        isLoading: false,
        loadError: false,
        errorText: '',
        campaign,
        myRecord,
        winnerFeed,
        winnerFeedPreview,
        winnerPreviewLabel: buildWinnerPreviewLabel(winnerFeed, winnerFeedPreview),
        showWinnerSheet: false,
        winnerSheetLoading: false,
        winnerSheetItems: [],
      };
      if (includeHistory) patch.historyCampaigns = historyCampaigns;

      this.setData(patch, () => {
        const nowMs = Date.now();
        this._homeLoadedAt = nowMs;
        if (includeHistory) this._historyLoadedAt = nowMs;
        this._winnerSheetCampaignId = '';
        this._syncClockState(campaign, myRecord);
        this._refreshActionState(true);
      });
    } catch (err) {
      console.error('活动页加载失败', err);
      if (silent && this.data.campaign) {
        return;
      }
      this.setData({
        isLoading: false,
        loadError: true,
        errorText: pickStr(err && err.message, '活动加载失败，请稍后重试'),
      });
      this._clearClock();
    }
  },
  async onHistoryTap(e) {
    const campaignId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!campaignId) return;
    try {
      wx.showLoading({ title: '加载中', mask: true });
      await this._callActivityReveal('ensure_campaign', { campaignId }).catch(() => null);
      const ret = await this._callActivityUser('get_campaign_detail', { campaignId });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '活动详情加载失败'));
      }
      const winnerFeed = (Array.isArray(ret.winnerFeed) ? ret.winnerFeed : []).map(item => decorateWinner(item));
      const winnerFeedPreview = sliceWinnerPreview(winnerFeed);
      this.setData({
        campaign: decorateCampaign(ret.campaign),
        myRecord: decorateRecord(ret.myRecord),
        winnerFeed,
        winnerFeedPreview,
        winnerPreviewLabel: buildWinnerPreviewLabel(winnerFeed, winnerFeedPreview),
        showWinnerSheet: false,
        winnerSheetLoading: false,
        winnerSheetItems: [],
      }, () => {
        this._winnerSheetCampaignId = '';
        this._homeLoadedAt = Date.now();
        this._syncClockState(this.data.campaign, this.data.myRecord);
        this._refreshActionState(true);
      });
    } catch (err) {
      toast(pickStr(err && err.message, '活动详情加载失败'));
    } finally {
      wx.hideLoading();
    }
  },
  async onJoinTap() {
    if (this.data.actionLoading || this.data.actionDisabled) return;
    const campaignId = pickStr(this.data.campaign && this.data.campaign.id);
    if (!campaignId) return;

    this.setData({ actionLoading: true });
    try {
      const ret = await this._callActivityUser('join_campaign', {
        campaignId,
        requestId: `join_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '参与失败，请稍后重试'));
      }
      const campaign = decorateCampaign(ret.campaign);
      const myRecord = decorateRecord(ret.myRecord);
      const winnerFeed = (Array.isArray(ret.winnerFeed) ? ret.winnerFeed : []).map(item => decorateWinner(item));
      const winnerFeedPreview = sliceWinnerPreview(winnerFeed);
      this.setData({
        campaign,
        myRecord,
        winnerFeed,
        winnerFeedPreview,
        winnerPreviewLabel: buildWinnerPreviewLabel(winnerFeed, winnerFeedPreview),
        showWinnerSheet: false,
        winnerSheetLoading: false,
        winnerSheetItems: [],
      }, () => {
        this._winnerSheetCampaignId = '';
        this._homeLoadedAt = Date.now();
        this._syncClockState(campaign, myRecord);
        this._refreshActionState(true);
      });
      toast(ret.already ? '你已经参与过这场活动了' : '已参与，等待开奖');
    } catch (err) {
      toast(pickStr(err && err.message, '参与失败，请稍后重试'));
    } finally {
      this.setData({ actionLoading: false });
    }
  },
  onRetryLoad() {
    if (this.data.isLoading) return;
    this.loadPage();
  },
  async onOpenWinnerSheet() {
    const campaignId = pickStr(this.data.campaign && this.data.campaign.id);
    if (!campaignId || !this.data.winnerFeedPreview.length) return;
    this.setData({
      showWinnerSheet: true,
      winnerSheetLoading: this.data.winnerFeed.length === 0,
      winnerSheetItems: this.data.winnerFeed.length ? this.data.winnerFeed : [],
    });
    if (this.data.winnerFeed.length >= WINNER_SHEET_LIMIT || (this._winnerSheetCampaignId === campaignId && this.data.winnerSheetItems.length)) {
      return;
    }
    this.setData({ winnerSheetLoading: true });
    try {
      const ret = await this._callActivityUser('get_campaign_winners', {
        campaignId,
        limit: WINNER_SHEET_LIMIT,
      });
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.err && ret.err.msg, '开奖结果加载失败'));
      }
      const list = (Array.isArray(ret.items) ? ret.items : []).map(item => decorateWinner(item));
      const winnerFeedPreview = sliceWinnerPreview(list);
      this._winnerSheetCampaignId = campaignId;
      this.setData({
        winnerFeed: list,
        winnerFeedPreview,
        winnerPreviewLabel: buildWinnerPreviewLabel(list, winnerFeedPreview),
        winnerSheetItems: list,
      });
    } catch (err) {
      toast(pickStr(err && err.message, '开奖结果加载失败'));
    } finally {
      this.setData({ winnerSheetLoading: false });
    }
  },
  onCloseWinnerSheet() {
    if (!this.data.showWinnerSheet) return;
    this.setData({ showWinnerSheet: false });
  },
  noop() {},
  gotoWelcome() {
    wx.navigateTo({ url: '/pages/welcome/index' });
  },
  gotoAdmin() {
    wx.navigateTo({ url: '/pages/activity/admin/index' });
  },
});
