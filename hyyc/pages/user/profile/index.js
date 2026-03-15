function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function isCloudFileID(v = '') {
  return String(v || '').indexOf('cloud://') === 0;
}

Page({
  data: {
    tid: '',
    targetRole: '',
    profile: null,
    isLoading: true,
    requesting: false,
    requestText: '',
    showRequestButton: false,
  },

  onLoad(options) {
    const tid = pickStr(options && options.tid);
    const targetRole = pickStr(options && options.targetRole).toLowerCase();
    if (!tid || (targetRole !== 'owner' && targetRole !== 'worker')) {
      wx.showToast({ title: '参数缺失', icon: 'none' });
      this.setData({ isLoading: false });
      return;
    }
    this.setData({ tid, targetRole }, () => this.loadProfile());
  },

  async loadProfile() {
    const { tid, targetRole } = this.data;
    if (!tid || !targetRole) return;

    this.setData({ isLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskContactFlow',
        data: {
          action: 'get_profile',
          taskId: tid,
          targetRole,
        }
      });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true || !ret.profile) {
        throw new Error((ret && ret.msg) || '加载资料失败');
      }

      const profile = { ...(ret.profile || {}) };
      const avatarSource = pickStr(profile.avatarFileID, profile.avatarUrl);
      if (avatarSource && isCloudFileID(avatarSource)) {
        try {
          const tempRes = await wx.cloud.getTempFileURL({
            fileList: [{ fileID: avatarSource, maxAge: 60 * 30 }]
          });
          const file = tempRes && tempRes.fileList && tempRes.fileList[0];
          if (file && file.tempFileURL) {
            profile.avatarUrl = file.tempFileURL;
          }
        } catch (err) {
          console.error('加载头像失败', err);
        }
      } else {
        profile.avatarUrl = avatarSource;
      }

      let requestText = '';
      let showRequestButton = false;
      if (profile.phoneVisible) {
        requestText = '对方已同意展示完整手机号，可直接联系。';
      } else if (profile.phoneRequestStatus === 'pending') {
        requestText = '已发起查看申请，等待对方在聊天中同意。';
      } else if (profile.canRequestPhone) {
        requestText = '手机号默认脱敏显示，发起申请后需要对方在聊天中同意。';
        showRequestButton = true;
      } else {
        requestText = '当前暂不能申请查看完整手机号。';
      }

      this.setData({
        profile,
        requestText,
        showRequestButton,
        requesting: false,
        isLoading: false,
      });
    } catch (err) {
      console.error('加载用户资料失败', err);
      this.setData({ isLoading: false, profile: null, requestText: '', requesting: false });
      wx.showToast({ title: String(err && err.message ? err.message : '加载失败'), icon: 'none' });
    }
  },

  async onRequestPhone() {
    if (this.data.requesting || !this.data.showRequestButton) return;
    this.setData({ requesting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskContactFlow',
        data: {
          action: 'request_phone',
          taskId: this.data.tid,
          targetRole: this.data.targetRole,
        }
      });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true) {
        throw new Error((ret && ret.msg) || '申请失败');
      }
      wx.showToast({ title: ret.already ? '已发起过' : '已发起', icon: 'success' });
      this.loadProfile();
    } catch (err) {
      console.error('申请查看手机号失败', err);
      this.setData({ requesting: false });
      wx.showToast({ title: String(err && err.message ? err.message : '申请失败'), icon: 'none' });
    }
  }
});
