const { required, isPhone } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');
const { exchangePhoneNumber } = require('../_shared/api');
const communityCfg = require('../_shared/community');
const { getStoredUser, setStoredUser } = require('../../../utils/userIdentity');

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

Page({
  data: {
    form: {
      nickname: '',
      phone: '',
      community: '',
    },
    communityLabels: [],
    communityIndex: 0,
    phoneVerified: false,
    agreeChecked: false,
    isLoading: false,
    errors: {},
    nicknameFocus: false,
    avatarUrl: '',
    avatarFileID: '',
  },

  onLoad() {
    const list = (communityCfg && communityCfg.list) ? communityCfg.list : [];
    const labels = list.map((item) => (item && item.name) || '').filter(Boolean);
    const storedUser = getStoredUser();
    let prefillCommunity = '';
    try {
      prefillCommunity = pickStr(wx.getStorageSync('hyyc_prefill_community') || '');
    } catch (err) {
      prefillCommunity = '';
    }
    const resolvedCommunity = pickStr(prefillCommunity, storedUser.community, labels[0]);
    const idx = Math.max(0, labels.indexOf(resolvedCommunity));
    const community = labels[idx] || resolvedCommunity;

    this.setData({
      communityLabels: labels,
      communityIndex: idx >= 0 ? idx : 0,
      'form.community': community,
      'form.nickname': pickStr(storedUser.nickname),
      'form.phone': pickStr(storedUser.phone),
      phoneVerified: !!pickStr(storedUser.phone),
      avatarUrl: pickStr(storedUser.avatarUrl, storedUser.avatarFileID),
      avatarFileID: pickStr(storedUser.avatarFileID),
    });

    if (prefillCommunity) {
      try {
        wx.removeStorageSync('hyyc_prefill_community');
      } catch (err) {
        // ignore
      }
    }
  },

  _clearError(key) {
    const errors = this.data.errors || {};
    if (!errors[key]) return;
    const next = { ...errors };
    delete next[key];
    this.setData({ errors: next });
  },

  onInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const value = e && e.detail ? e.detail.value : '';
    const patch = { [`form.${key}`]: value };
    if (key === 'phone') patch.phoneVerified = false;
    this.setData(patch);
    this._clearError(key);
  },

  onCommunityChange(e) {
    const idx = Number(e && e.detail ? e.detail.value : 0) || 0;
    const community = (this.data.communityLabels || [])[idx] || '';
    this.setData({
      communityIndex: idx,
      'form.community': community
    });
    this._clearError('community');
  },

  toggleAgree() {
    this.setData({ agreeChecked: !this.data.agreeChecked });
  },

  openLegalDoc(e) {
    const type = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || '';
    if (!type) return;
    wx.navigateTo({ url: '/pages/auth/legal/doc/index?type=' + encodeURIComponent(type) });
  },

  onGetWechatProfile() {
    this.setData({ nicknameFocus: true }, () => {
      setTimeout(() => this.setData({ nicknameFocus: false }), 200);
    });
    toast('请在键盘上方选择微信昵称');
  },

  async onChooseAvatar(e) {
    const avatarUrl = e && e.detail ? e.detail.avatarUrl : '';
    if (!avatarUrl) return;
    this.setData({ avatarUrl });
    try {
      const rand = Math.random().toString(16).slice(2, 8);
      const cloudPath = `avatar/${Date.now()}_${rand}.jpg`;
      const res = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl });
      if (res && res.fileID) {
        this.setData({ avatarFileID: res.fileID });
      }
    } catch (err) {
      console.warn('上传头像失败', err);
      toast('头像上传失败，请重试');
    }
  },

  async onGetPhoneNumber(e) {
    try {
      const detail = (e && e.detail) || {};
      const code = detail.code;
      const errMsg = detail.errMsg || '';
      if (!code) {
        if (errMsg.indexOf('user deny') !== -1) {
          toast('您取消了手机号授权');
        } else if (errMsg.indexOf('no permission') !== -1) {
          toast('当前小程序未开通获取手机号能力，请联系管理员开通');
        } else if (errMsg) {
          toast('获取手机号失败：' + errMsg);
        } else {
          toast('获取手机号失败，请稍后再试');
        }
        return;
      }
      this.setData({ isLoading: true });
      const r = await exchangePhoneNumber(code);
      this.setData({ isLoading: false });
      if (r.ok) {
        this.setData({ 'form.phone': r.phoneNumber, phoneVerified: true });
        toast('已获取手机号');
      } else {
        toast(r.msg || '获取手机号失败');
      }
    } catch (err) {
      console.error('获取手机号异常', err);
      this.setData({ isLoading: false });
      toast('获取手机号异常');
    }
  },

  async submit() {
    if (this.data.isLoading) return;

    const form = this.data.form || {};
    const errors = {};
    errors.phone = this.data.phoneVerified ? isPhone(form.phone) : '请点击右侧“获取”授权手机号';
    errors.community = required(form.community, '请选择小区');

    Object.keys(errors).forEach((key) => {
      if (!errors[key]) delete errors[key];
    });
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }
    if (!this.data.agreeChecked) {
      toast('请先阅读并同意用户协议和隐私政策');
      return;
    }

    this.setData({ isLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'registerLiteUser',
        data: {
          form,
          avatarFileID: this.data.avatarFileID,
          agree: this.data.agreeChecked,
        }
      });
      const result = (res && res.result) || {};
      if (!result || result.ok !== true) {
        toast((result && result.msg) || '基础注册失败，请稍后重试');
        return;
      }

      const user = result.user || {};
      setStoredUser(user);

      if (result.alreadyRealname) {
        toast('已登录');
        wx.switchTab({ url: '/pages/home/index/index' });
        return;
      }

      toast('基础注册完成');
      wx.switchTab({ url: '/pages/profile/index/index' });
    } catch (err) {
      console.error('基础注册失败', err);
      toast('基础注册失败，请稍后重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },

  goRealnameDirect() {
    try {
      wx.setStorageSync('hyyc_prefill_community', pickStr(this.data.form && this.data.form.community));
    } catch (err) {
      // ignore
    }
    wx.navigateTo({ url: '/pages/auth/realname/index' });
  },
});
