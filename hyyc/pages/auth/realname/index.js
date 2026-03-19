const { required, isPhone } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');
const { exchangePhoneNumber } = require('../_shared/api');
const { distanceMeters } = require('../_shared/geo');
const communityCfg = require('../_shared/community');
const { setStoredUser } = require('../../../utils/userIdentity');

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function shouldBypassLocationFenceForLocalDev() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    const envVersion = info && info.miniProgram ? info.miniProgram.envVersion : '';
    if (envVersion !== 'develop') return false;

    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    const platform = pickStr(sys && sys.platform).toLowerCase();
    return platform === 'devtools';
  } catch (err) {
    return false;
  }
}

function chooseSingleImage() {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      // 这里不让微信自动压缩，统一走 compressImage（可控且更稳）
      sizeType: ['original'],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: reject
    });
  });
}

function compressImage(src, quality = 60) {
  return new Promise((resolve) => {
    wx.compressImage({
      src,
      quality,
      success(res) {
        resolve((res && res.tempFilePath) || src);
      },
      fail(err) {
        console.warn('compressImage 失败，使用原图继续', err);
        resolve(src);
      }
    });
  });
}

async function safeDeleteCloudFile(fileID) {
  const fid = pickStr(fileID);
  if (!fid) return;
  try {
    await wx.cloud.deleteFile({ fileList: [fid] });
  } catch (err) {
    console.warn('deleteFile 失败', err);
  }
}

function buildIdCardCloudPath(side = 'front') {
  const rand = Math.random().toString(16).slice(2, 8);
  return `idcard/${Date.now()}_${rand}_${side}.jpg`;
}

Page({
  data: {
    // 默认不填充示例数据，避免审核误判“强制登录/强制授权”
    form: {
      nickname: '',
      phone: '',
      inviteCode: '',
      // 小区由 picker 选择（只展示合作小区列表）
      community: '',
      building: '',
      floor: '',
      door: '',
      // 身份证有效期（用户手动选择）
      certValidityType: 'fixed', // fixed | long
      certBeginDate: '',
      certEndDate: ''
    },
    communityIndex: 0,
    communityLabels: [],
    errors: {},
    buildingRange: [],
    // 对应 “11栋”（下标从 0 开始）
    buildingIndex: 0,
    doorRange: [[], []], // [floors, rooms]
    // 对应 “7 楼 01 户” -> 第 7 层（索引 6）、第 1 户（索引 0）
    doorIndex: [0, 0],
    MAX_FLOOR: 33,
    phoneVerified: false,
    // 业务 loading 状态（接口请求时用）
    isLoading: false,
    // 协议勾选：默认未同意
    agreeChecked: false,
    // 已存在用户提示弹层
    showUserExist: false,
    // 点击“获取”时用来聚焦昵称输入框，触发键盘上方的“微信昵称”选择
    nicknameFocus: false,

    // 身份证正面（人像面）
    idCardFrontFileID: '',
    idCardFrontPreview: '',
    // 身份证反面（国徽面）
    idCardBackFileID: '',
    idCardBackPreview: '',
    idCardUploading: false,
    preserveIdCardFiles: false,

    // 定位校验：用于验证用户是否在配置的小区范围内
    hasLocated: false,
    inCommunity: false,
    locationStatus: 'warn', // '' | 'ok' | 'warn'
    locationText: '未定位，请点击“获取定位”',

    // 用户头像（临时路径 + 云存储 fileID）
    avatarUrl: '',
    avatarFileID: ''
  },

  _getSelectedCommunity() {
    const labels = this.data.communityLabels || [];
    const idx = Number(this.data.communityIndex || 0);
    const name = labels[idx] || '';
    return (communityCfg && communityCfg.getByName) ? (communityCfg.getByName(name) || null) : null;
  },

  // 用户选择微信头像
  async onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (!avatarUrl) return;

    // 先显示临时路径作为预览
    this.setData({ avatarUrl });

    // 上传到云存储
    try {
      const rand = Math.random().toString(16).slice(2, 8);
      const cloudPath = `avatar/${Date.now()}_${rand}.jpg`;
      const res = await wx.cloud.uploadFile({
        cloudPath,
        filePath: avatarUrl
      });
      if (res && res.fileID) {
        // 删除旧头像（如果有）
        if (this.data.avatarFileID) {
          safeDeleteCloudFile(this.data.avatarFileID);
        }
        this.setData({ avatarFileID: res.fileID });
      }
    } catch (err) {
      console.warn('上传头像失败', err);
      toast('头像上传失败，请重试');
    }
  },

  // 用户点击“获取”后，聚焦昵称输入框；用户可从键盘上方一键选择微信昵称
  onGetWechatProfile() {
    // 新版规则：微信不会再把真实昵称直接返回给 getUserProfile，
    // 推荐用 input 的 type="nickname" 让用户从键盘上方一键选择微信昵称。
    this.setData({ nicknameFocus: true }, () => {
      // 立刻再置回 false，方便用户下次还能再次点击“获取”触发聚焦
      setTimeout(() => this.setData({ nicknameFocus: false }), 200);
    });
    toast('请在键盘上方选择微信昵称');
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    const patch = { [`form.${key}`]: value };
    // 用户手动改了手机号后，就不再算“一键获取过”
    if (key === 'phone') patch.phoneVerified = false;
    this.setData(patch);
    this._clearError(key);
  },

  _clearError(key) {
    const curErrors = this.data.errors || {};
    if (!curErrors[key]) return;
    const nextErrors = { ...curErrors };
    delete nextErrors[key];
    this.setData({ errors: nextErrors });
  },

  onLoad() {
    // 初始化楼栋（1-23栋）与门号（1-MAX_FLOOR 楼 × 01-04 户）
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);
    const floors = Array.from({ length: this.data.MAX_FLOOR }, (_, i) => `${i + 1}楼`);
    const rooms = ['01户', '02户', '03户', '04户'];
    const list = (communityCfg && communityCfg.list) ? communityCfg.list : [];
    const labels = list.map((c) => (c && c.name) || '').filter(Boolean);
    const defaultIdx = 0;
    // 欢迎页弹窗里选中的小区：预填到“所属小区”
    let prefillCommunity = '';
    try {
      prefillCommunity = pickStr(wx.getStorageSync('hyyc_prefill_community') || '');
    } catch (e) {
      prefillCommunity = '';
    }
    const prefillIdx = prefillCommunity ? labels.indexOf(prefillCommunity) : -1;
    const idx = prefillIdx >= 0 ? prefillIdx : defaultIdx;
    const name = labels[idx] || '';
    this.setData({
      buildingRange: buildings,
      doorRange: [floors, rooms],
      communityLabels: labels,
      communityIndex: idx,
      'form.community': name
    });

    // 用完就清掉，避免下次进入仍然沿用旧值
    if (prefillCommunity) {
      try {
        wx.removeStorageSync('hyyc_prefill_community');
      } catch (e) {
        // ignore
      }
    }
  },

  onCommunityChange(e) {
    const idx = Number(e.detail.value || 0);
    const name = (this.data.communityLabels || [])[idx] || '';
    this.setData({
      communityIndex: idx,
      'form.community': name,
      // 切换小区后需要重新定位校验
      hasLocated: false,
      inCommunity: false,
      locationStatus: 'warn',
      locationText: '未定位，请点击“获取定位”'
    });
  },

  onBuilding(e) {
    const idx = Number(e.detail.value || 0);
    const val = this.data.buildingRange[idx];
    this.setData({ buildingIndex: idx, 'form.building': val });
  },

  onDoorChange(e) {
    const [fi, ui] = e.detail.value || [0, 0];
    const floorNum = fi + 1; // 1-based
    const roomNo = (ui + 1).toString().padStart(2, '0');
    const door = `${floorNum}${roomNo}`; // 701,702...
    this.setData({
      doorIndex: [fi, ui],
      'form.floor': `${floorNum}`,
      'form.door': door
    });
  },

  onCertValidityLongChange(e) {
    const isLong = !!(e && e.detail && e.detail.value);
    const nextType = isLong ? 'long' : 'fixed';
    const patch = { 'form.certValidityType': nextType };
    if (isLong) patch['form.certEndDate'] = '';
    this.setData(patch);
    this._clearError('certValidityType');
    this._clearError('certBeginDate');
    this._clearError('certEndDate');
  },

  onCertBeginDate(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData({ 'form.certBeginDate': value });
    this._clearError('certBeginDate');
  },

  onCertEndDate(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData({ 'form.certEndDate': value });
    this._clearError('certEndDate');
  },

  async onGetPhoneNumber(e) {
    try {
      // 兼容不支持可选链的环境：安全地从事件对象取 detail
      const detail = (e && e.detail) || {};
      console.log('phone event detail ===>', detail); // 方便真机调试查看 errMsg 和 code
      const code = detail.code;
      const errMsg = detail.errMsg || '';
      if (!code) {
        // 没有拿到 code，根据不同情况给出更清晰的提示
        if (errMsg.indexOf('user deny') !== -1) {
          toast('您取消了手机号授权');
        } else if (errMsg.indexOf('no permission') !== -1) {
          toast('当前小程序未开通获取手机号能力，请联系管理员在微信后台开通');
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
      console.log(err);
      toast('获取手机号异常');
      this.setData({ isLoading: false });
    }
  },

  // 获取当前位置并进行小区围栏校验（GCJ-02 坐标）
  async getLocation() {
    if (this.data.isLoading || this.data.idCardUploading) return;

    this.setData({
      isLoading: true,
      hasLocated: true,
      locationText: '定位中...',
      locationStatus: ''
    });

    // 只在开发者工具本地模拟器里跳过围栏校验，手机预览/体验版/正式版都要真实定位。
    if (shouldBypassLocationFenceForLocalDev()) {
      const c0 = this._getSelectedCommunity();
      const name = (c0 && c0.name) || '小区';
      this.setData({
        isLoading: false,
        inCommunity: true,
        locationText: `已在${name}范围内`,
        locationStatus: 'ok'
      });
      return;
    }

    try {
      const res = await new Promise((resolve, reject) => {
        wx.getLocation({
          type: 'gcj02',
          // 尽量拿到更准的结果（部分机型/权限下会忽略）
          isHighAccuracy: true,
          highAccuracyExpireTime: 4000,
          success: resolve,
          fail: reject
        });
      });

      const lat = Number(res && res.latitude);
      const lng = Number(res && res.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('invalid latitude/longitude');
      }

      const communityObj = this._getSelectedCommunity() || {};
      const c = (communityObj && communityObj.center) || {};
      const cLat = Number(c.lat);
      const cLng = Number(c.lng);
      const radius = Number(communityObj && communityObj.radiusMeters);

      // 围栏参数缺失：为了“特定人群鉴权”与社区安全，直接拦截（避免配置漏填导致任何人都能注册）
      if (!Number.isFinite(cLat) || !Number.isFinite(cLng) || !Number.isFinite(radius) || radius <= 0) {
        this.setData({
          inCommunity: false,
          locationText: '定位围栏未配置，请联系管理员后再注册',
          locationStatus: 'warn'
        });
        return;
      }

      const dist = distanceMeters(lat, lng, cLat, cLng);
      const meters = Math.round(dist);
      const ok = Number.isFinite(dist) && dist <= radius;

      const name = (communityObj && communityObj.name) || '小区';
      const distText = Number.isFinite(meters) ? `（约${meters}m）` : '';
      const text = ok ? `已在${name}范围内${distText}` : `不在${name}范围内${distText}`;

      this.setData({
        inCommunity: ok,
        locationText: text,
        locationStatus: ok ? 'ok' : 'warn'
      });
    } catch (err) {
      console.warn('getLocation 失败', err);

      const errMsg = (err && err.errMsg) || '';
      const denied =
        errMsg.indexOf('auth deny') !== -1 ||
        errMsg.indexOf('authorize') !== -1 ||
        errMsg.indexOf('permission denied') !== -1;

      this.setData({
        inCommunity: false,
        locationText: denied ? '定位权限未开启，请在设置中允许定位' : '定位失败，请重试',
        locationStatus: 'warn'
      });

      if (denied) {
        wx.showModal({
          title: '需要定位权限',
          content: '用于验证您是否在本小区范围内。请在设置中开启定位权限后重试。',
          confirmText: '去设置',
          cancelText: '取消',
          success: (r) => {
            if (r && r.confirm) wx.openSetting({});
          }
        });
      } else {
        toast('获取定位失败，请稍后再试');
      }
    } finally {
      this.setData({ isLoading: false });
    }
  },

  toggleAgree() {
    this.setData({ agreeChecked: !this.data.agreeChecked });
  },

  openLegalDoc(e) {
    const type = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || '';
    if (!type) return;
    wx.navigateTo({ url: '/pages/auth/legal/doc/index?type=' + encodeURIComponent(type) });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index/index' }) });
  },

  async chooseIdCardImage(side = 'front') {
    if (this.data.isLoading || this.data.idCardUploading) return;
    try {
      const res = await chooseSingleImage();
      const paths = (res && res.tempFilePaths) || [];
      const rawPath = paths[0];
      if (!rawPath) return;

      // 如果之前上传过，先尽力删除（避免云端残留）
      const fileKey = side === 'back' ? 'idCardBackFileID' : 'idCardFrontFileID';
      const previewKey = side === 'back' ? 'idCardBackPreview' : 'idCardFrontPreview';
      const errorKey = side === 'back' ? 'idCardBack' : 'idCardFront';
      const oldFileID = this.data[fileKey];
      if (oldFileID) safeDeleteCloudFile(oldFileID);

      const compressedPath = await compressImage(rawPath, 60);

      // 页面缩略图使用压缩后的图片，保证“看到的”和“上传的”一致
      this.setData({
        [previewKey]: compressedPath,
        [fileKey]: ''
      });

      // 清掉这项的错误提示
      const curErrors = this.data.errors || {};
      if (curErrors[errorKey]) {
        const nextErrors = { ...curErrors };
        delete nextErrors[errorKey];
        this.setData({ errors: nextErrors });
      }
    } catch (err) {
      // 用户取消选择也会进 fail，这里不打扰用户
      console.warn('chooseIdCardImage 失败', err);
    }
  },

  chooseIdCardFront() {
    return this.chooseIdCardImage('front');
  },

  chooseIdCardBack() {
    return this.chooseIdCardImage('back');
  },

  previewIdCardFront() {
    const src = this.data.idCardFrontPreview;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  previewIdCardBack() {
    const src = this.data.idCardBackPreview;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  async removeIdCardFront() {
    const oldFileID = this.data.idCardFrontFileID;
    this.setData({ idCardFrontPreview: '', idCardFrontFileID: '' });
    if (oldFileID) await safeDeleteCloudFile(oldFileID);
  },

  async removeIdCardBack() {
    const oldFileID = this.data.idCardBackFileID;
    this.setData({ idCardBackPreview: '', idCardBackFileID: '' });
    if (oldFileID) await safeDeleteCloudFile(oldFileID);
  },

  async submit() {
    if (this.data.isLoading || this.data.idCardUploading) return;

    const f = this.data.form;
    const errors = {};

    // 必须上传身份证正面照片（人像面）
    errors.idCardFront = required(this.data.idCardFrontPreview, '请上传身份证正面照片');
    errors.idCardBack = required(this.data.idCardBackPreview, '请上传身份证反面照片');

    // 手机号输入框已禁用，只允许走「获取手机号」授权
    errors.phone = this.data.phoneVerified ? isPhone(f.phone) : '请点击右侧“获取”授权手机号';

    // 小区名称必须包含配置中的小区名，用于过滤非本小区业主
    errors.community = required(f.community, '请选择小区');
    const pickedCommunity = this._getSelectedCommunity();
    if (!errors.community && !pickedCommunity) {
      // 非法/被篡改的值（正常不会出现）
      errors.community = '小区信息异常，请重新选择';
    }

    errors.building = required(f.building, '请选择楼栋');
    errors.door = required(f.door, '请选择门号');
    // 身份证有效期：必须选择起始日期；非长期还要选择结束日期
    const isLong = f.certValidityType === 'long';
    errors.certBeginDate = required(f.certBeginDate, '请选择证件有效期开始日期');
    if (!isLong) {
      errors.certEndDate = required(f.certEndDate, '请选择证件有效期结束日期');
      if (!errors.certBeginDate && !errors.certEndDate && f.certEndDate < f.certBeginDate) {
        errors.certEndDate = '结束日期不能早于开始日期';
      }
    }

    Object.keys(errors).forEach((k) => {
      if (!errors[k]) delete errors[k];
    });
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }

    if (!this.data.agreeChecked) {
      toast('请先阅读并同意用户协议和隐私政策');
      return;
    }

    // 必须在小区范围内完成定位校验（避免非本小区人员注册）
    if (!this.data.hasLocated) {
      toast('请先点击“获取定位”验证在小区范围内');
      return;
    }
    if (!this.data.inCommunity) {
      toast(this.data.locationText || '不在小区范围内，请到小区内重新定位');
      return;
    }

    this.setData({ isLoading: true, idCardUploading: true });

    let uploadedFrontFileID = '';
    let uploadedBackFileID = '';
    try {
      // 1) 上传身份证照片到云存储（只在点“继续”时上传，避免云端残留）
      const frontRes = await wx.cloud.uploadFile({
        cloudPath: buildIdCardCloudPath('front'),
        filePath: this.data.idCardFrontPreview
      });
      uploadedFrontFileID = (frontRes && frontRes.fileID) || '';

      const backRes = await wx.cloud.uploadFile({
        cloudPath: buildIdCardCloudPath('back'),
        filePath: this.data.idCardBackPreview
      });
      uploadedBackFileID = (backRes && backRes.fileID) || '';

      if (!uploadedFrontFileID || !uploadedBackFileID) {
        toast('上传失败，请重试');
        return;
      }
      this.setData({
        idCardFrontFileID: uploadedFrontFileID,
        idCardBackFileID: uploadedBackFileID
      });

      // 2) 调云函数：fileID -> 临时链接 -> 腾讯核验 -> 通过才注册（云端会删除照片）
      let regResult;
      try {
        const fnRes = await wx.cloud.callFunction({
          name: 'registerUserByIdCard',
          data: {
            idCardFrontFileID: uploadedFrontFileID,
            idCardBackFileID: uploadedBackFileID,
            avatarFileID: this.data.avatarFileID,
            form: f,
            agree: this.data.agreeChecked
          }
        });
        regResult = fnRes && fnRes.result;
      } catch (err) {
        console.error('调用 registerUserByIdCard 失败', err);
        toast('身份校验失败，请稍后重试');
        // 云函数调用失败：前端兜底删图，避免云端残留
        await safeDeleteCloudFile(uploadedFrontFileID);
        await safeDeleteCloudFile(uploadedBackFileID);
        this.setData({ idCardFrontFileID: '', idCardBackFileID: '' });
        return;
      }

      // 同一微信已注册 / 同一身份证已注册：弹出提示，不写入本地缓存
      if (regResult && (regResult.code === 'ID_EXISTS' || regResult.code === 'OPENID_EXISTS')) {
        this.setData({ showUserExist: true });
        return;
      }

      if (!regResult || regResult.ok !== true) {
        const code = regResult && regResult.code;
        const msg = (regResult && regResult.msg) || '身份校验失败，请重新上传身份证照片';

        // 核验失败：清空照片（不展示识别结果）
        if (code === 'VERIFY_FAIL' || code === 'API_FAIL' || code === 'TEMP_URL_FAIL') {
          this.setData({
            idCardFrontPreview: '',
            idCardFrontFileID: '',
            idCardBackPreview: '',
            idCardBackFileID: ''
          });
        }

        toast(msg);
        return;
      }

      const user = regResult.user || {};

      // 本地缓存一份，兼容后续页面读取
      try {
        setStoredUser(user);
      } catch (e) {
        console.error('缓存实名用户信息失败', e);
      }
      this.setData({ preserveIdCardFiles: true });

      toast('实名完成');
      wx.switchTab({ url: '/pages/home/index/index' });
    } catch (err) {
      console.error('实名提交失败', err);
      toast('身份校验失败，请稍后重试');
      if (uploadedFrontFileID) await safeDeleteCloudFile(uploadedFrontFileID);
      if (uploadedBackFileID) await safeDeleteCloudFile(uploadedBackFileID);
      this.setData({ idCardFrontFileID: '', idCardBackFileID: '' });
    } finally {
      this.setData({ isLoading: false, idCardUploading: false });
    }
  },

  onUserExistConfirm() {
    // 关闭错误弹层并回到欢迎页，让用户直接登录
    this.setData({ showUserExist: false });
    wx.redirectTo({ url: '/pages/welcome/index' });
  },

  onUnload() {
    // 兜底删除：如果页面退出时仍然有 fileID，尽力删一次，避免云端残留
    if (this.data.preserveIdCardFiles) return;
    const front = this.data.idCardFrontFileID;
    const back = this.data.idCardBackFileID;
    if (front) safeDeleteCloudFile(front);
    if (back) safeDeleteCloudFile(back);
  }
});
