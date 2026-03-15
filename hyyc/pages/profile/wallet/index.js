const { formatMoney, formatDateTime } = require('../../../utils/format');
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
const EXTERNAL_PAYMENT_TYPES = ['goods_expense', 'task_expense'];
const BALANCE_CHANGE_TYPES = ['goods_income', 'task_income', 'withdraw', 'withdraw_fee', 'withdraw_refund', 'refund'];

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
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
    balanceSecondaryTip: '消费记录会显示在明细里，但不会影响可提现余额',
    balanceAlertText: '',
    transactions: [],
    filterOptions: FILTER_OPTIONS,
    activeFilter: 'all',
    hasMore: false,
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
    if (reset) {
      this.setData(panelOnly ? {
        isPanelLoading: true,
        isLoadingMore: false,
        activeFilter,
        emptyText: this._emptyText(activeFilter),
        showCustomScrollbar: false,
      } : {
        isLoading: true,
        isPanelLoading: false,
        isLoadingMore: false,
        loadError: false,
        errorText: '',
        activeFilter,
        transactions: [],
        hasMore: false,
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

      const offset = reset ? 0 : Number(this.data.totalLoaded || 0);
      if (reset) {
        const [txRes, balanceProfile] = await Promise.all([
          this._fetchTransactions({ openid, filterKey: activeFilter, offset, limit: PAGE_SIZE }),
          reloadBalance ? this._loadBalanceProfile() : Promise.resolve(null)
        ]);
        if (reloadBalance && (!balanceProfile || !balanceProfile.ok)) {
          throw new Error(pickStr(balanceProfile && balanceProfile.err && balanceProfile.err.msg, '钱包加载失败，请重试'));
        }
        const nextTransactions = (txRes.data || []).map(doc => this._mapTransaction(doc));
        this.setData({
          ...(reloadBalance ? this._buildBalanceView(balanceProfile) : {}),
          transactions: nextTransactions,
          hasMore: nextTransactions.length === PAGE_SIZE,
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
      const txRes = await this._fetchTransactions({ openid, filterKey: activeFilter, offset, limit: PAGE_SIZE });
      const nextTransactions = (txRes.data || []).map(doc => this._mapTransaction(doc));
      const transactions = this.data.transactions.concat(nextTransactions);
      this.setData({
        transactions,
        hasMore: nextTransactions.length === PAGE_SIZE,
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
  async _fetchTransactions({ openid, filterKey = 'all', offset = 0, limit = PAGE_SIZE } = {}) {
    let query = db.collection(TRANSACTIONS_COLLECTION)
      .where(this._buildTransactionWhere(openid, filterKey))
      .orderBy('createdAt', 'desc')
      .limit(limit);
    if (offset > 0) query = query.skip(offset);
    return query.get();
  },
  _buildTransactionWhere(openid, filterKey) {
    const where = { _openid: openid };
    const typeList = this._filterTypes(filterKey);
    if (typeList && typeList.length) where.type = _.in(typeList);
    return where;
  },
  _filterTypes(filterKey) {
    if (filterKey === 'balance') return BALANCE_CHANGE_TYPES;
    if (filterKey === 'external') return EXTERNAL_PAYMENT_TYPES;
    return null;
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
        balanceSecondaryTip: '消费记录会显示在明细里，但不会影响可提现余额',
        balanceAlertText: '',
      };
    }
    return {
      balance: null,
      balanceText: '--',
      canWithdraw: false,
      balancePrimaryTip: '暂时无法查询余额',
      balanceSecondaryTip: '明细仍会正常展示',
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
    const balanceDelta = this._resolveBalanceDelta(doc, amount);
    const affectsBalance = this._resolveAffectsBalance(doc, balanceDelta);
    const timeValue = this._extractTime(doc.createdAt || doc.updatedAt);
    const isIncome = amount >= 0;

    return {
      ...doc,
      id: doc._id,
      typeText: this._typeLabel(doc.type),
      amountText: this._signedMoney(amount),
      isIncome,
      summaryText: pickStr(doc.summary, doc.title),
      timeText: timeValue ? formatDateTime(timeValue) : '',
      scopeText: affectsBalance ? '余额变动' : '消费记录',
      scopeClass: affectsBalance ? 'tx-scope-balance' : 'tx-scope-external',
      impactText: affectsBalance
        ? `本次${balanceDelta >= 0 ? '计入' : '扣减'}可提现余额 ${this._signedMoney(balanceDelta)}`
        : '仅记录本次消费，不影响可提现余额',
      channelText: affectsBalance ? '可提现余额变动' : '仅供查看',
    };
  },
  _resolveBalanceDelta(doc = {}, amount = 0) {
    const raw = Number(doc.balanceDelta);
    if (Number.isFinite(raw)) return raw;
    if (EXTERNAL_PAYMENT_TYPES.includes(pickStr(doc.type))) return 0;
    return amount;
  },
  _resolveAffectsBalance(doc = {}, balanceDelta = 0) {
    if (typeof doc.affectsBalance === 'boolean') return doc.affectsBalance;
    return Math.abs(Number(balanceDelta || 0)) > 0.0001;
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
  }
});
