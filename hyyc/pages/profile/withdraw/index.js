const { toast, confirm } = require('../../../utils/ui');
const areaData = require('../../../data/huifuAreaCodes');

const WITHDRAW_MIN = 1;
const DEFAULT_CASH_TYPE = 'D1';
const DEFAULT_CASH_TYPE_LABEL = '次自然日到账';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function digitsOnly(v = '') {
  return String(v || '').replace(/\D+/g, '');
}

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
}

function buildCashTypeViewState({
  enabledCashTypes = [],
} = {}) {
  return {
    selectedCashType: DEFAULT_CASH_TYPE,
    selectedCashTypeLabel: DEFAULT_CASH_TYPE_LABEL,
    isSelectedCashTypeOpened: Array.isArray(enabledCashTypes) && enabledCashTypes.includes(DEFAULT_CASH_TYPE),
  };
}

function getProvinceNames() {
  return Object.keys(areaData || {});
}

function getCityNames(provinceName = '') {
  const province = areaData[provinceName] || {};
  const items = province && province.items ? province.items : {};
  return Object.keys(items);
}

function getAreaIdsByName(provinceName = '', cityName = '') {
  const province = areaData[provinceName] || {};
  const city = province && province.items ? province.items[cityName] : null;
  return {
    provId: pickStr(province && province.val),
    areaId: pickStr(city && city.val),
  };
}

function findAreaByIds(provId = '', areaId = '') {
  const provinceNames = getProvinceNames();
  for (let i = 0; i < provinceNames.length; i += 1) {
    const provinceName = provinceNames[i];
    const province = areaData[provinceName] || {};
    if (pickStr(province.val) !== pickStr(provId)) continue;
    const cityNames = getCityNames(provinceName);
    for (let j = 0; j < cityNames.length; j += 1) {
      const cityName = cityNames[j];
      const city = province.items && province.items[cityName];
      if (pickStr(city && city.val) === pickStr(areaId)) {
        return {
          provinceIndex: i,
          cityIndex: j,
          provinceName,
          cityName,
          cityNames,
        };
      }
    }
    return {
      provinceIndex: i,
      cityIndex: 0,
      provinceName,
      cityName: cityNames[0] || '',
      cityNames,
    };
  }
  return null;
}

Page({
  data: {
    isLoading: true,
    isSubmitting: false,
    isSyncingWithdraw: false,
    withdrawMin: WITHDRAW_MIN,
    availableBalance: 0,
    availableBalanceText: '0.00',
    localBalanceText: '0.00',
    huifuId: '',
    userName: '',
    userPhone: '',
    idNumberLast4: '',
    hasBoundCard: false,
    isCardFormExpanded: true,
    cardStatus: 'unbound',
    cardStatusText: '未绑定',
    boundCardNoMask: '',
    boundCardName: '',
    enabledCashTypes: [],
    selectedCashType: DEFAULT_CASH_TYPE,
    selectedCashTypeLabel: DEFAULT_CASH_TYPE_LABEL,
    isSelectedCashTypeOpened: false,
    activeWithdraw: null,
    provinceNames: [],
    cityNames: [],
    provinceIndex: 0,
    cityIndex: 0,
    form: {
      cardNo: '',
      amount: '',
      provId: '',
      areaId: '',
      provName: '',
      areaName: '',
    },
  },

  onLoad() {
    const provinceNames = getProvinceNames();
    const provinceName = provinceNames[0] || '';
    const cityNames = getCityNames(provinceName);
    const cityName = cityNames[0] || '';
    const ids = getAreaIdsByName(provinceName, cityName);
    this.setData({
      provinceNames,
      cityNames,
      form: {
        ...this.data.form,
        provName: provinceName,
        areaName: cityName,
        provId: ids.provId,
        areaId: ids.areaId,
      }
    });
  },

  onShow() {
    this._resetCardFormExpandOnNextProfile = true;
    this.loadProfile();
  },

  getSelectedCashType() {
    return DEFAULT_CASH_TYPE;
  },

  getSelectedCashTypeLabel() {
    return DEFAULT_CASH_TYPE_LABEL;
  },

  async loadProfile({ showLoading = true } = {}) {
    if (showLoading) this.setData({ isLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'walletWithdraw',
        data: { action: 'profile' }
      });
      const ret = res && res.result ? res.result : null;
      if (!ret || !ret.ok || !ret.profile) {
        this.setData({ isLoading: false });
        toast((ret && ret.err && ret.err.msg) || '加载提现信息失败');
        return;
      }

      const profile = ret.profile || {};
      const enabledCashTypes = Array.isArray(profile.enabledCashTypes) ? profile.enabledCashTypes : [];
      const cashTypeState = buildCashTypeViewState({
        enabledCashTypes,
      });
      const shouldResetCardFormExpand = !!this._resetCardFormExpandOnNextProfile;
      this._resetCardFormExpandOnNextProfile = false;

      const cardInfo = profile.cardInfo || {};
      const areaMatch = findAreaByIds(cardInfo.provId, cardInfo.areaId);
      const nextPatch = {
        isLoading: false,
        huifuId: pickStr(profile.huifuId),
        userName: pickStr(profile.realname),
        userPhone: pickStr(profile.phone),
        idNumberLast4: pickStr(profile.idNumberLast4),
        availableBalance: Number(profile.availableBalance || 0),
        availableBalanceText: formatMoney(profile.availableBalance || 0),
        localBalanceText: formatMoney(profile.localBalance || 0),
        hasBoundCard: !!profile.hasBoundCard,
        isCardFormExpanded: profile.hasBoundCard
          ? (shouldResetCardFormExpand ? false : !!this.data.isCardFormExpanded)
          : true,
        cardStatus: pickStr(profile.cardStatus, profile.hasBoundCard ? 'success' : 'unbound'),
        cardStatusText: pickStr(profile.cardStatusText, profile.hasBoundCard ? '已绑定' : '未绑定'),
        boundCardNoMask: pickStr(cardInfo.cardNoMask),
        boundCardName: pickStr(cardInfo.cardName),
        enabledCashTypes,
        selectedCashType: cashTypeState.selectedCashType,
        selectedCashTypeLabel: cashTypeState.selectedCashTypeLabel,
        isSelectedCashTypeOpened: cashTypeState.isSelectedCashTypeOpened,
        activeWithdraw: profile.activeWithdraw || null,
        form: {
          ...this.data.form,
          provId: pickStr(cardInfo.provId, this.data.form.provId),
          areaId: pickStr(cardInfo.areaId, this.data.form.areaId),
        }
      };

      if (areaMatch) {
        const ids = getAreaIdsByName(areaMatch.provinceName, areaMatch.cityName);
        nextPatch.provinceIndex = areaMatch.provinceIndex;
        nextPatch.cityIndex = areaMatch.cityIndex;
        nextPatch.cityNames = areaMatch.cityNames;
        nextPatch.form = {
          ...nextPatch.form,
          provName: areaMatch.provinceName,
          areaName: areaMatch.cityName,
          provId: ids.provId,
          areaId: ids.areaId,
        };
      }

      this.setData(nextPatch);
    } catch (err) {
      console.error('加载提现信息失败', err);
      this.setData({ isLoading: false });
      toast('加载提现信息失败，请稍后重试');
    }
  },

  async onSyncActiveWithdraw() {
    if (this.data.isSubmitting || this.data.isSyncingWithdraw || !this.data.activeWithdraw) return;
    this.setData({ isSyncingWithdraw: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'walletWithdraw',
        data: {
          action: 'sync_active_withdraw',
          reqDate: pickStr(this.data.activeWithdraw && this.data.activeWithdraw.reqDate),
          reqSeqId: pickStr(this.data.activeWithdraw && this.data.activeWithdraw.reqSeqId),
          hfSeqId: pickStr(this.data.activeWithdraw && this.data.activeWithdraw.hfSeqId),
        }
      });
      const ret = res && res.result ? res.result : null;
      if (!ret || !ret.ok) {
        toast((ret && ret.err && ret.err.msg) || '同步失败，请稍后重试');
        return;
      }
      await this.loadProfile({ showLoading: false });
      toast(pickStr(ret && ret.sync && ret.sync.userMsg, '提现状态已更新'));
    } catch (err) {
      console.error('同步提现状态失败', err);
      toast('同步失败，请稍后重试');
    } finally {
      this.setData({ isSyncingWithdraw: false });
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({ [`form.${key}`]: value });
  },

  onProvinceChange(e) {
    const provinceIndex = Number(e.detail.value || 0);
    const provinceName = this.data.provinceNames[provinceIndex] || '';
    const cityNames = getCityNames(provinceName);
    const cityName = cityNames[0] || '';
    const ids = getAreaIdsByName(provinceName, cityName);
    this.setData({
      provinceIndex,
      cityIndex: 0,
      cityNames,
      'form.provName': provinceName,
      'form.areaName': cityName,
      'form.provId': ids.provId,
      'form.areaId': ids.areaId,
    });
  },

  onCityChange(e) {
    const cityIndex = Number(e.detail.value || 0);
    const provinceName = this.data.provinceNames[this.data.provinceIndex] || '';
    const cityName = this.data.cityNames[cityIndex] || '';
    const ids = getAreaIdsByName(provinceName, cityName);
    this.setData({
      cityIndex,
      'form.provName': provinceName,
      'form.areaName': cityName,
      'form.provId': ids.provId,
      'form.areaId': ids.areaId,
    });
  },

  onFillAll() {
    this.setData({ 'form.amount': this.data.availableBalanceText });
  },

  onToggleCardForm() {
    if (!this.data.hasBoundCard) return;
    this.setData({ isCardFormExpanded: !this.data.isCardFormExpanded });
  },

  async submitWithdraw() {
    if (this.data.isSubmitting) return;
    if (!this.data.hasBoundCard) {
      toast('请先绑定提现银行卡');
      return;
    }
    if (this.data.activeWithdraw) {
      toast('当前已有一笔提现处理中，请稍后再试');
      return;
    }

    const amount = Number(this.data.form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('请输入正确的提现金额');
      return;
    }
    if (amount < WITHDRAW_MIN) {
      toast(`提现金额不能低于${WITHDRAW_MIN}元`);
      return;
    }
    if (amount > Number(this.data.availableBalance || 0)) {
      toast(`提现金额不能超过 ¥${this.data.availableBalanceText}`);
      return;
    }

    const confirmed = await confirm(`确认提现 ¥${formatMoney(amount)} 到 ${this.data.boundCardNoMask || '银行卡'}？`);
    if (!confirmed) return;

    this.setData({ isSubmitting: true, isLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'walletWithdraw',
        data: {
          action: 'submit',
          amount: formatMoney(amount),
          intoAcctDateType: this.getSelectedCashType(),
        }
      });
      const ret = res && res.result ? res.result : null;
      if (!ret || !ret.ok) {
        this.setData({ isSubmitting: false, isLoading: false });
        toast((ret && ret.err && ret.err.msg) || '提现申请失败');
        return;
      }
      toast(ret.msg || '提现申请已提交');
      this.setData({
        isSubmitting: false,
        'form.amount': '',
      });
      try {
        await this.loadProfile();
      } catch (refreshErr) {
        console.error('提现申请成功，但刷新状态失败', refreshErr);
        this.setData({ isLoading: false });
        toast('提现已提交，状态刷新失败，请点“立即同步提现状态”');
      }
    } catch (err) {
      console.error('提现申请失败', err);
      this.setData({ isSubmitting: false, isLoading: false });
      toast('提现申请失败，请稍后重试');
    }
  },

  async onBindCard() {
    if (this.data.isSubmitting) return;

    const f = this.data.form;
    const cardNo = digitsOnly(f.cardNo);
    if (!cardNo && !this.data.hasBoundCard) {
      toast('请输入银行卡号');
      return;
    }
    if (!/^\d{6}$/.test(pickStr(f.provId)) || !/^\d{6}$/.test(pickStr(f.areaId))) {
      toast('请选择银行卡开户地址');
      return;
    }

    this.setData({ isSubmitting: true, isLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'walletWithdraw',
        data: {
          action: 'bind_card',
          cardNo,
          provId: f.provId,
          areaId: f.areaId,
        }
      });
      const ret = res && res.result ? res.result : null;
      if (!ret || !ret.ok) {
        this.setData({ isSubmitting: false, isLoading: false });
        toast((ret && ret.err && ret.err.msg) || '绑定银行卡失败');
        return;
      }
      toast(ret.msg || '银行卡已保存');
      this.setData({
        isSubmitting: false,
        isCardFormExpanded: false,
        'form.cardNo': '',
      });
      await this.loadProfile();
      if ((pickStr(ret && ret.status) !== 'success') || !this.data.isSelectedCashTypeOpened) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        await this.loadProfile({ showLoading: false });
      }
    } catch (err) {
      console.error('绑定银行卡失败', err);
      this.setData({ isSubmitting: false, isLoading: false });
      toast('绑定银行卡失败，请稍后重试');
    }
  },

  async onSubmitWithdraw() {
    await this.submitWithdraw();
  },
});
