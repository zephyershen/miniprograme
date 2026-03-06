const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast } = require('../../../utils/ui');

const db = wx.cloud.database();
const WALLET_COLLECTION = 'wallets';
const TRANSACTIONS_COLLECTION = 'wallet_transactions';
const WITHDRAW_MIN = 50;

Page({
  data: {
    isLoading: true,
    balance: 0,
    balanceText: '0.00',
    canWithdraw: false,
    withdrawMin: WITHDRAW_MIN,
    transactions: []
  },
  onShow() {
    this.loadWallet();
  },
  async loadWallet() {
    const u = wx.getStorageSync('hyyc_user') || {};
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    this.setData({ isLoading: true });

    try {
      const openid = await this._ensureOpenid();
      if (!openid) {
        toast('获取用户身份失败');
        this.setData({ isLoading: false });
        return;
      }

      const walletRes = await db.collection(WALLET_COLLECTION)
        .where({ _openid: openid })
        .limit(1)
        .get();

      const wallet = (walletRes.data && walletRes.data[0]) || {};
      const balance = Number(wallet.balance || 0);

      const txRes = await db.collection(TRANSACTIONS_COLLECTION)
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const transactions = (txRes.data || []).map(doc => ({
        ...doc,
        id: doc._id,
        amountText: (doc.amount >= 0 ? '+' : '') + formatMoney(doc.amount),
        isIncome: doc.amount >= 0,
        timeText: doc.createdAt ? formatDateTime(
          typeof doc.createdAt.getTime === 'function' ? doc.createdAt.getTime() : doc.createdAt
        ) : '',
        typeText: this._typeLabel(doc.type)
      }));

      this.setData({
        balance,
        balanceText: formatMoney(balance),
        canWithdraw: balance >= WITHDRAW_MIN,
        transactions,
        isLoading: false
      });
    } catch (err) {
      console.error('加载钱包失败', err);
      this.setData({ isLoading: false });
      toast('加载失败，请稍后重试');
    }
  },
  _typeLabel(type) {
    const map = {
      task_income: '任务收入',
      goods_income: '商品售出',
      withdraw: '提现',
      refund: '退款'
    };
    return map[type] || '其他';
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
    if (!this.data.canWithdraw) {
      toast(`余额满${WITHDRAW_MIN}元才能提现`);
      return;
    }
    wx.showModal({
      title: '申请提现',
      content: `当前余额 ¥${this.data.balanceText}，确认提交提现申请？提现将在 1-3 个工作日内到账。`,
      confirmText: '确认提现',
      confirmColor: '#B95E49',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ isLoading: true });
        try {
          await wx.cloud.callFunction({
            name: 'walletWithdraw',
            data: { amount: this.data.balance }
          });
          toast('提现申请已提交');
          this.loadWallet();
        } catch (err) {
          console.error('提现失败', err);
          this.setData({ isLoading: false });
          toast('提现失败，请稍后重试');
        }
      }
    });
  }
});
