const { formatMoney, formatDate, formatDateTime } = require('../../../utils/format');
const { toast } = require('../../../utils/ui');

const db = wx.cloud.database();
const _ = db.command;
const TRANSACTIONS_COLLECTION = 'wallet_transactions';
const WITHDRAW_MIN = 1;
const PAGE_SIZE = 20;
const EXTRA_BOTTOM_BUFFER_PX = 38;
const FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'balance', label: '余额变动' },
  { key: 'external', label: '消费记录' },
];
const DATE_FILTER_OPTIONS = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'seven', label: '近7天' },
  { key: 'thirty', label: '近30天' },
  { key: 'custom', label: '自定义' },
];
const EXTERNAL_PAYMENT_TYPES = ['goods_expense', 'task_expense'];
const BALANCE_CHANGE_TYPES = ['goods_income', 'task_income', 'withdraw', 'withdraw_fee', 'withdraw_refund', 'refund'];

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function startOfDay(date = new Date()) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function parseDateValue(dateText = '') {
  const safe = pickStr(dateText);
  if (!safe) return null;
  const parsed = new Date(`${safe}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatRangeLabel(startDate = '', endDate = '') {
  const start = pickStr(startDate);
  const end = pickStr(endDate);
  if (!start || !end) return '自定义';
  if (start === end) return start.slice(5).replace('-', '/');
  return `${start.slice(5).replace('-', '/')} - ${end.slice(5).replace('-', '/')}`;
}

function todayDateText() {
  return formatDate(Date.now());
}

function normalizeTransactionSummary(type = '', summary = '') {
  const raw = pickStr(summary);
  if (!raw) return '';
  let normalized = raw
    .replace(/[，,]\s*不扣汇付余额/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (pickStr(type) !== 'withdraw') return normalized;

  return normalized
    .replace(/到账方式\s*D1/gi, '预计次日到账')
    .replace(/到账方式\s*DM/gi, '预计当天到账')
    .replace(/到账方式\s*T1/gi, '预计次工作日到账')
    .replace(/[，,]\s*预计预计/g, '，预计')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

Page({
  data: {
    isLoading: true,
    isPanelLoading: false,
    isLoadingMore: false,
    loadError: false,
    errorText: '',
    showCustomScrollbar: false,
    scrollThumbHeight: 0,
    scrollThumbTop: 0,
    bottomSpacerPx: EXTRA_BOTTOM_BUFFER_PX,
    balance: null,
    balanceText: '--',
    canWithdraw: false,
    withdrawMin: WITHDRAW_MIN,
    balancePrimaryTip: '最低提现 1 元',
    balanceSecondaryTip: '',
    balanceAlertText: '',
    transactions: [],
    filterOptions: FILTER_OPTIONS,
    dateFilterOptions: DATE_FILTER_OPTIONS,
    activeFilter: 'all',
    activeDateFilter: 'all',
    activeDateLabel: '全部时间',
    dateRangeStart: '',
    dateRangeEnd: '',
    showDateFilterSheet: false,
    pendingDateFilter: 'all',
    pendingStartDate: '',
    pendingEndDate: '',
    maxFilterDate: todayDateText(),
    hasMore: false,
    nextCursor: null,
    pageSize: PAGE_SIZE,
    totalLoaded: 0,
    emptyText: '暂无收支记录'
  },
  onLoad() {
    this._updateBottomSpacer();
  },
  onShow() {
    this._updateBottomSpacer();
    this.loadWallet({ reset: true });
  },
  onReachBottom() {
    this.onLoadMore();
  },
  async loadWallet({ reset = false, filterKey = '', panelOnly = false, reloadBalance = reset && !panelOnly } = {}) {
    const u = wx.getStorageSync('hyyc_user') || {};
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    const previousFilter = this.data.activeFilter || 'all';
    const activeFilter = filterKey || this.data.activeFilter || 'all';
    const activeDateState = this._activeDateState();
    if (reset) {
      this.setData(panelOnly ? {
        isPanelLoading: true,
        isLoadingMore: false,
        activeFilter,
        emptyText: this._emptyText(activeFilter),
        showCustomScrollbar: false,
        nextCursor: null,
      } : {
        isLoading: true,
        isPanelLoading: false,
        isLoadingMore: false,
        loadError: false,
        errorText: '',
        activeFilter,
        transactions: [],
        hasMore: false,
        nextCursor: null,
        totalLoaded: 0,
        emptyText: this._emptyText(activeFilter),
        showCustomScrollbar: false,
      });
    } else {
      this.setData({
        isLoadingMore: true,
      });
    }

    try {
      const openid = await this._ensureOpenid();
      if (!openid) {
        toast('获取用户身份失败');
        this.setData({
          isLoading: false,
          isPanelLoading: false,
          isLoadingMore: false,
          loadError: !!reset && !panelOnly,
          errorText: reset && !panelOnly ? '获取用户信息失败，请重试' : '',
          activeFilter: panelOnly ? previousFilter : activeFilter,
        });
        return;
      }

      if (reset) {
        const [txRes, balanceProfile] = await Promise.all([
          this._fetchTransactions({
            openid,
            filterKey: activeFilter,
            limit: PAGE_SIZE,
            dateState: activeDateState,
          }),
          reloadBalance ? this._loadBalanceProfile() : Promise.resolve(null)
        ]);
        if (reloadBalance && (!balanceProfile || !balanceProfile.ok)) {
          throw new Error(pickStr(balanceProfile && balanceProfile.err && balanceProfile.err.msg, '钱包加载失败，请重试'));
        }
        const nextTransactions = (txRes.items || []).map(doc => this._mapTransaction(doc));
        this.setData({
          ...(reloadBalance ? this._buildBalanceView(balanceProfile) : {}),
          transactions: nextTransactions,
          hasMore: !!txRes.hasMore,
          nextCursor: txRes.nextCursor || null,
          totalLoaded: nextTransactions.length,
          emptyText: this._emptyText(activeFilter),
          isLoading: false,
          isPanelLoading: false,
          isLoadingMore: false,
          loadError: false,
          errorText: '',
        }, () => this._measureScrollArea());
        return;
      }
      const txRes = await this._fetchTransactions({
        openid,
        filterKey: activeFilter,
        cursor: this.data.nextCursor,
        limit: PAGE_SIZE,
        dateState: activeDateState,
      });
      const nextTransactions = (txRes.items || []).map(doc => this._mapTransaction(doc));
      const transactions = this.data.transactions.concat(nextTransactions);
      this.setData({
        transactions,
        hasMore: !!txRes.hasMore,
        nextCursor: txRes.nextCursor || null,
        totalLoaded: transactions.length,
        emptyText: this._emptyText(activeFilter),
        isLoading: false,
        isPanelLoading: false,
        isLoadingMore: false,
      }, () => this._measureScrollArea());
    } catch (err) {
      console.error('加载钱包失败', err);
      const errorText = this._safeWalletErrorMsg(err && err.message ? err.message : err);
      if (reset && panelOnly) {
        this.setData({
          isPanelLoading: false,
          isLoadingMore: false,
          activeFilter: previousFilter,
        }, () => this._measureScrollArea());
        toast(errorText);
        return;
      }
      this.setData({
        isLoading: false,
        isPanelLoading: false,
        isLoadingMore: false,
        loadError: !!reset,
        errorText: reset ? errorText : '',
        showCustomScrollbar: false,
      });
      if (!reset) toast('加载失败，请稍后重试');
    }
  },
  async _loadBalanceProfile(retryCount = 1) {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'walletWithdraw',
          data: { action: 'wallet_summary' }
        });
        const ret = res && res.result ? res.result : null;
        if (ret && ret.ok && ret.summary) return { ok: true, profile: ret.summary };
        const msg = this._safeBalanceErrorMsg(ret && ret.err && ret.err.msg);
        if (attempt < retryCount && this._isRetryableWalletError(ret && ret.err && ret.err.msg)) continue;
        return {
          ok: false,
          err: { msg }
        };
      } catch (err) {
        const msg = this._safeBalanceErrorMsg(err && err.message);
        if (attempt < retryCount && this._isRetryableWalletError(err && err.message)) continue;
        return {
          ok: false,
          err: { msg }
        };
      }
    }
    return { ok: false, err: { msg: '钱包加载失败，请重试' } };
  },
  async _fetchTransactions({ openid, filterKey = 'all', cursor = null, limit = PAGE_SIZE, dateState = null } = {}) {
    const where = this._buildTransactionWhere(openid, filterKey, dateState, cursor);
    let query = db.collection(TRANSACTIONS_COLLECTION);
    if (where) query = query.where(where);
    const result = await query
      .orderBy('createdAt', 'desc')
      .limit(Math.max(1, Number(limit) || PAGE_SIZE) + 1)
      .get();
    const rows = (result && result.data) || [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.length ? items[items.length - 1] : null;
    return {
      items,
      hasMore,
      nextCursor: hasMore && last
        ? { createdAt: last.createdAt || last.updatedAt || null }
        : null,
    };
  },
  _buildTransactionWhere(openid, filterKey, dateState = null, cursor = null) {
    const andParts = [{ _openid: openid }];
    const typeList = this._filterTypes(filterKey);
    if (typeList && typeList.length) andParts.push({ type: _.in(typeList) });

    const range = this._resolveDateRange(dateState || this._activeDateState());
    if (range.startAt) andParts.push({ createdAt: _.gte(range.startAt) });
    if (range.endAt) andParts.push({ createdAt: _.lt(range.endAt) });

    const cursorWhere = this._buildCursorWhere(cursor);
    if (cursorWhere) andParts.push(cursorWhere);

    return andParts.length === 1 ? andParts[0] : _.and(andParts);
  },
  _filterTypes(filterKey) {
    if (filterKey === 'balance') return BALANCE_CHANGE_TYPES;
    if (filterKey === 'external') return EXTERNAL_PAYMENT_TYPES;
    return null;
  },
  _buildCursorWhere(cursor = null) {
    if (!cursor || !cursor.createdAt) return null;
    return { createdAt: _.lt(cursor.createdAt) };
  },
  _activeDateState() {
    return {
      key: pickStr(this.data.activeDateFilter, 'all'),
      startDate: pickStr(this.data.dateRangeStart),
      endDate: pickStr(this.data.dateRangeEnd),
    };
  },
  _resolveDateRange(dateState = {}) {
    const key = pickStr(dateState && dateState.key, 'all');
    const today = startOfDay();
    if (key === 'today') {
      return { startAt: today, endAt: addDays(today, 1) };
    }
    if (key === 'seven') {
      return { startAt: addDays(today, -6), endAt: addDays(today, 1) };
    }
    if (key === 'thirty') {
      return { startAt: addDays(today, -29), endAt: addDays(today, 1) };
    }
    if (key === 'custom') {
      const startAt = parseDateValue(dateState && dateState.startDate);
      const endAtBase = parseDateValue(dateState && dateState.endDate);
      return {
        startAt,
        endAt: endAtBase ? addDays(endAtBase, 1) : null,
      };
    }
    return { startAt: null, endAt: null };
  },
  _normalizeDateFilter({ key = 'all', startDate = '', endDate = '' } = {}) {
    const nextKey = pickStr(key, 'all');
    if (nextKey === 'today') {
      const today = todayDateText();
      return { key: nextKey, startDate: today, endDate: today, label: '今天' };
    }
    if (nextKey === 'seven') {
      const endDateText = todayDateText();
      const startDateText = formatDate(addDays(startOfDay(), -6).getTime());
      return { key: nextKey, startDate: startDateText, endDate: endDateText, label: '近7天' };
    }
    if (nextKey === 'thirty') {
      const endDateText = todayDateText();
      const startDateText = formatDate(addDays(startOfDay(), -29).getTime());
      return { key: nextKey, startDate: startDateText, endDate: endDateText, label: '近30天' };
    }
    if (nextKey === 'custom') {
      const today = todayDateText();
      const safeStart = pickStr(startDate, today);
      const safeEnd = pickStr(endDate, safeStart);
      return {
        key: nextKey,
        startDate: safeStart,
        endDate: safeEnd,
        label: formatRangeLabel(safeStart, safeEnd),
      };
    }
    return { key: 'all', startDate: '', endDate: '', label: '全部时间' };
  },
  _buildBalanceView(profileResult) {
    if (profileResult && profileResult.ok && profileResult.profile) {
      const profile = profileResult.profile || {};
      const balance = Number(profile.availableBalance || 0);
      return {
        balance,
        balanceText: pickStr(profile.availableBalanceText, formatMoney(balance)),
        canWithdraw: balance >= WITHDRAW_MIN,
        balancePrimaryTip: '最低提现 1 元',
        balanceSecondaryTip: '',
        balanceAlertText: '',
      };
    }
    return {
      balance: null,
      balanceText: '--',
      canWithdraw: false,
      balancePrimaryTip: '暂时无法查询余额',
      balanceSecondaryTip: '',
      balanceAlertText: pickStr(profileResult && profileResult.err && profileResult.err.msg),
    };
  },
  _safeBalanceErrorMsg(rawMsg = '') {
    const msg = pickStr(rawMsg).toLowerCase();
    if (!msg) return '余额加载较慢，请稍后再试';
    if (msg.includes('timed out') || msg.includes('time_limit_exceeded') || msg.includes('timeout')) {
      return '余额加载较慢，请稍后再试';
    }
    return '暂时无法查询余额';
  },
  _safeWalletErrorMsg(rawMsg = '') {
    const msg = pickStr(rawMsg).toLowerCase();
    if (!msg) return '钱包加载失败，请重试';
    if (msg.includes('timed out') || msg.includes('time_limit_exceeded') || msg.includes('timeout')) {
      return '钱包加载较慢，请重试';
    }
    return '钱包加载失败，请重试';
  },
  _isRetryableWalletError(rawMsg = '') {
    const msg = pickStr(rawMsg).toLowerCase();
    return msg.includes('timed out') || msg.includes('time_limit_exceeded') || msg.includes('timeout');
  },
  _measureScrollArea() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.tx-scroll-wrap').boundingClientRect();
      query.select('.tx-scroll-inner').boundingClientRect();
      query.exec((res) => {
        const wrapRect = res && res[0] ? res[0] : null;
        const innerRect = res && res[1] ? res[1] : null;
        const viewportHeight = Number(wrapRect && wrapRect.height || 0);
        const contentHeight = Number(innerRect && innerRect.height || 0);
        this._scrollViewportHeight = viewportHeight;
        this._scrollContentHeight = contentHeight;
        this._setScrollThumb({ viewportHeight, contentHeight, scrollTop: 0 });
      });
    });
  },
  _updateBottomSpacer() {
    const bottomSpacerPx = this._resolveBottomSpacerPx();
    if (Number(bottomSpacerPx || 0) === Number(this.data.bottomSpacerPx || 0)) return;
    this.setData({ bottomSpacerPx });
  },
  _resolveBottomSpacerPx() {
    try {
      const info = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const safeAreaInsets = info && info.safeAreaInsets ? info.safeAreaInsets : null;
      if (safeAreaInsets && Number.isFinite(Number(safeAreaInsets.bottom))) {
        return EXTRA_BOTTOM_BUFFER_PX + Math.max(Number(safeAreaInsets.bottom || 0), 0);
      }

      const safeArea = info && info.safeArea ? info.safeArea : null;
      const screenHeight = Number(info && info.screenHeight || 0);
      const windowHeight = Number(info && info.windowHeight || 0);
      const safeBottom = Number(safeArea && safeArea.bottom || 0);
      const insetByScreen = screenHeight > 0 && safeBottom > 0 ? screenHeight - safeBottom : 0;
      const insetByWindow = windowHeight > 0 && safeBottom > 0 ? windowHeight - safeBottom : 0;
      const safeInset = Math.max(insetByScreen, insetByWindow, 0);
      return EXTRA_BOTTOM_BUFFER_PX + safeInset;
    } catch (err) {
      return EXTRA_BOTTOM_BUFFER_PX;
    }
  },
  _setScrollThumb({ viewportHeight = 0, contentHeight = 0, scrollTop = 0 } = {}) {
    const visibleHeight = Number(viewportHeight || 0);
    const fullHeight = Number(contentHeight || 0);
    if (!visibleHeight || !fullHeight || fullHeight <= visibleHeight + 1) {
      this.setData({
        showCustomScrollbar: false,
        scrollThumbHeight: 0,
        scrollThumbTop: 0,
      });
      return;
    }

    const thumbHeight = Math.max((visibleHeight * visibleHeight) / fullHeight, 36);
    const maxScrollTop = Math.max(fullHeight - visibleHeight, 1);
    const maxThumbTop = Math.max(visibleHeight - thumbHeight, 0);
    const thumbTop = Math.min((Number(scrollTop || 0) / maxScrollTop) * maxThumbTop, maxThumbTop);

    this.setData({
      showCustomScrollbar: true,
      scrollThumbHeight: thumbHeight,
      scrollThumbTop: thumbTop,
    });
  },
  _mapTransaction(doc = {}) {
    const amount = Number(doc.amount || 0);
    const timeValue = this._extractTime(doc.createdAt || doc.updatedAt);
    const isIncome = amount >= 0;

    return {
      ...doc,
      id: doc._id,
      typeText: this._typeLabel(doc.type),
      amountText: this._signedMoney(amount),
      isIncome,
      summaryText: normalizeTransactionSummary(doc.type, pickStr(doc.summary, doc.title)),
      timeText: timeValue ? formatDateTime(timeValue) : '',
    };
  },
  _extractTime(raw) {
    if (!raw) return 0;
    if (typeof raw.getTime === 'function') return raw.getTime();
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  },
  _signedMoney(amount) {
    const n = Number(amount || 0);
    return `${n >= 0 ? '+' : ''}${formatMoney(n)}`;
  },
  _emptyText(filterKey) {
    if (filterKey === 'balance') return '暂无余额变动记录';
    if (filterKey === 'external') return '暂无消费记录';
    return '暂无收支记录';
  },
  _typeLabel(type) {
    const map = {
      task_income: '任务收入',
      task_expense: '任务付款',
      goods_income: '商品售出',
      goods_expense: '商品购买',
      withdraw: '提现',
      withdraw_fee: '提现手续费',
      withdraw_refund: '提现退回',
      refund: '退款'
    };
    return map[type] || '其他';
  },
  onFilterTap(e) {
    if (this.data.isLoading || this.data.isPanelLoading) return;
    const key = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key, 'all');
    if (!key || key === this.data.activeFilter) return;
    this.loadWallet({ reset: true, filterKey: key, panelOnly: true, reloadBalance: false });
  },
  onLoadMore() {
    if (this.data.isLoading || this.data.isPanelLoading || this.data.isLoadingMore || !this.data.hasMore) return;
    this.loadWallet({ reset: false, filterKey: this.data.activeFilter });
  },
  onTxScroll(e) {
    const detail = e && e.detail ? e.detail : {};
    this._setScrollThumb({
      viewportHeight: Number(this._scrollViewportHeight || 0),
      contentHeight: Number(this._scrollContentHeight || 0),
      scrollTop: Number(detail.scrollTop || 0),
    });
  },
  onRetryLoad() {
    if (this.data.isLoading) return;
    this.loadWallet({ reset: true, filterKey: this.data.activeFilter });
  },
  onDateFilterTap() {
    if (this.data.isLoading || this.data.isPanelLoading) return;
    const pendingState = this._normalizeDateFilter({
      key: this.data.activeDateFilter,
      startDate: this.data.dateRangeStart,
      endDate: this.data.dateRangeEnd,
    });
    this.setData({
      showDateFilterSheet: true,
      pendingDateFilter: pendingState.key,
      pendingStartDate: pendingState.startDate,
      pendingEndDate: pendingState.endDate,
    });
  },
  onCloseDateFilter() {
    this.setData({ showDateFilterSheet: false });
  },
  onDatePresetTap(e) {
    const key = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key, 'all');
    const next = this._normalizeDateFilter({
      key,
      startDate: this.data.pendingStartDate,
      endDate: this.data.pendingEndDate,
    });
    this.setData({
      pendingDateFilter: next.key,
      pendingStartDate: next.startDate,
      pendingEndDate: next.endDate,
    });
  },
  onPendingStartDateChange(e) {
    const value = pickStr(e && e.detail && e.detail.value);
    const endDate = pickStr(this.data.pendingEndDate);
    this.setData({
      pendingDateFilter: 'custom',
      pendingStartDate: value,
      pendingEndDate: endDate && endDate < value ? value : endDate,
    });
  },
  onPendingEndDateChange(e) {
    const value = pickStr(e && e.detail && e.detail.value);
    const startDate = pickStr(this.data.pendingStartDate);
    this.setData({
      pendingDateFilter: 'custom',
      pendingStartDate: startDate && startDate > value ? value : startDate,
      pendingEndDate: value,
    });
  },
  onResetDateFilter() {
    const next = this._normalizeDateFilter({ key: 'all' });
    this.setData({
      activeDateFilter: next.key,
      activeDateLabel: next.label,
      dateRangeStart: next.startDate,
      dateRangeEnd: next.endDate,
      showDateFilterSheet: false,
      pendingDateFilter: next.key,
      pendingStartDate: next.startDate,
      pendingEndDate: next.endDate,
    }, () => {
      this.loadWallet({ reset: true, filterKey: this.data.activeFilter, panelOnly: true, reloadBalance: false });
    });
  },
  onApplyDateFilter() {
    const next = this._normalizeDateFilter({
      key: this.data.pendingDateFilter,
      startDate: this.data.pendingStartDate,
      endDate: this.data.pendingEndDate,
    });
    if (next.key === 'custom' && next.startDate > next.endDate) {
      toast('结束日期不能早于开始日期');
      return;
    }
    this.setData({
      activeDateFilter: next.key,
      activeDateLabel: next.label,
      dateRangeStart: next.startDate,
      dateRangeEnd: next.endDate,
      showDateFilterSheet: false,
    }, () => {
      this.loadWallet({ reset: true, filterKey: this.data.activeFilter, panelOnly: true, reloadBalance: false });
    });
  },
  async _ensureOpenid() {
    const u = wx.getStorageSync('hyyc_user') || {};
    let openid = String(u._openid || u.openid || u.openId || '').trim();
    if (openid) return openid;
    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = String(res && res.result && res.result.openid || '').trim();
      if (openid) {
        wx.setStorageSync('hyyc_user', { ...u, _openid: openid });
      }
    } catch (e) { /* ignore */ }
    return openid;
  },
  onWithdraw() {
    wx.navigateTo({ url: '/pages/profile/withdraw/index' });
  },
  noop() {}
});
