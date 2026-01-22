const { required, isPhone } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');
const { exchangePhoneNumber } = require('../../../utils/api');
const community = require('../../../config/community');

function pickStr(v) {
  return String(v == null ? '' : v).trim();
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

function buildIdCardCloudPath() {
  const rand = Math.random().toString(16).slice(2, 8);
  return `idcard/${Date.now()}_${rand}_front.jpg`;
}

Page({
  data: {
    // 默认填充测试数据，方便开发联调；正式上线前请改回空值
    form: {
      nickname: '',
      phone: '',
      inviteCode: '',
      community: community.name,
      building: '11栋',
      floor: '7',
      door: '701'
    },
    errors: {},
    buildingRange: [],
    // 对应 “11栋”（下标从 0 开始）
    buildingIndex: 10,
    doorRange: [[], []], // [floors, rooms]
    // 对应 “7 楼 01 户” -> 第 7 层（索引 6）、第 1 户（索引 0）
    doorIndex: [6, 0],
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
    idCardUploading: false
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
  },

  onLoad() {
    // 初始化楼栋（1-23栋）与门号（1-MAX_FLOOR 楼 × 01-04 户）
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);
    const floors = Array.from({ length: this.data.MAX_FLOOR }, (_, i) => `${i + 1}楼`);
    const rooms = ['01户', '02户', '03户', '04户'];
    this.setData({ buildingRange: buildings, doorRange: [floors, rooms] });
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

  async chooseIdCardFront() {
    if (this.data.isLoading || this.data.idCardUploading) return;
    try {
      const res = await chooseSingleImage();
      const paths = (res && res.tempFilePaths) || [];
      const rawPath = paths[0];
      if (!rawPath) return;

      // 如果之前上传过，先尽力删除（避免云端残留）
      const oldFileID = this.data.idCardFrontFileID;
      if (oldFileID) safeDeleteCloudFile(oldFileID);

      const compressedPath = await compressImage(rawPath, 60);

      // 页面缩略图使用压缩后的图片，保证“看到的”和“上传的”一致
      this.setData({
        idCardFrontPreview: compressedPath,
        idCardFrontFileID: ''
      });

      // 清掉这项的错误提示
      const curErrors = this.data.errors || {};
      if (curErrors.idCardFront) {
        const nextErrors = { ...curErrors };
        delete nextErrors.idCardFront;
        this.setData({ errors: nextErrors });
      }
    } catch (err) {
      // 用户取消选择也会进 fail，这里不打扰用户
      console.warn('chooseIdCardFront 失败', err);
    }
  },

  previewIdCardFront() {
    const src = this.data.idCardFrontPreview;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  async removeIdCardFront() {
    const oldFileID = this.data.idCardFrontFileID;
    this.setData({ idCardFrontPreview: '', idCardFrontFileID: '' });
    if (oldFileID) await safeDeleteCloudFile(oldFileID);
  },

  async submit() {
    if (this.data.isLoading || this.data.idCardUploading) return;

    const f = this.data.form;
    const errors = {};

    // 必须上传身份证正面照片（人像面）
    errors.idCardFront = required(this.data.idCardFrontPreview, '请上传身份证正面照片');

    // 手机号输入框已禁用，只允许走「获取手机号」授权
    errors.phone = this.data.phoneVerified ? isPhone(f.phone) : '请点击右侧“获取”授权手机号';

    // 小区名称必须包含配置中的小区名，用于过滤非本小区业主
    errors.community = required(f.community, '请输入小区');
    const communityInput = pickStr(f.community);
    if (!errors.community && communityInput.indexOf(community.name) === -1) {
      // 这里不要把正确小区名称直接提示给用户，只给一个模糊错误信息
      errors.community = '小区名称不正确，请联系物业确认后再填写';
    }

    errors.building = required(f.building, '请选择楼栋');
    errors.door = required(f.door, '请选择门号');

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

    this.setData({ isLoading: true, idCardUploading: true });

    let uploadedFileID = '';
    try {
      // 1) 上传身份证照片到云存储（只在点“继续”时上传，避免云端残留）
      const upRes = await wx.cloud.uploadFile({
        cloudPath: buildIdCardCloudPath(),
        filePath: this.data.idCardFrontPreview
      });
      uploadedFileID = (upRes && upRes.fileID) || '';
      if (!uploadedFileID) {
        toast('上传失败，请重试');
        return;
      }
      this.setData({ idCardFrontFileID: uploadedFileID });

      // 2) 调云函数：fileID -> 临时链接 -> 腾讯核验 -> 通过才注册（云端会删除照片）
      let regResult;
      try {
        const fnRes = await wx.cloud.callFunction({
          name: 'registerUserByIdCard',
          data: {
            idCardFrontFileID: uploadedFileID,
            form: f,
            agree: this.data.agreeChecked
          }
        });
        regResult = fnRes && fnRes.result;
      } catch (err) {
        console.error('调用 registerUserByIdCard 失败', err);
        toast('身份校验失败，请稍后重试');
        // 云函数调用失败：前端兜底删图，避免云端残留
        await safeDeleteCloudFile(uploadedFileID);
        this.setData({ idCardFrontFileID: '' });
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
          this.setData({ idCardFrontPreview: '', idCardFrontFileID: '' });
        }

        toast(msg);
        return;
      }

      const user = regResult.user || {};

      // 本地缓存一份，兼容后续页面读取
      try {
        wx.setStorageSync('hyyc_user', user);
      } catch (e) {
        console.error('缓存实名用户信息失败', e);
      }

      toast('实名完成');
      wx.switchTab({ url: '/pages/home/index/index' });
    } catch (err) {
      console.error('实名提交失败', err);
      toast('身份校验失败，请稍后重试');
      if (uploadedFileID) await safeDeleteCloudFile(uploadedFileID);
      this.setData({ idCardFrontFileID: '' });
    } finally {
      this.setData({ isLoading: false, idCardUploading: false });
    }
  },

  onUserExistConfirm() {
    // 关闭错误弹层并回到欢迎页，让用户直接登录
    this.setData({ showUserExist: false });
    wx.redirectTo({ url: '/pages/auth/welcome/index' });
  },

  onUnload() {
    // 兜底删除：如果页面退出时仍然有 fileID，尽力删一次，避免云端残留
    const fid = this.data.idCardFrontFileID;
    if (fid) safeDeleteCloudFile(fid);
  }
});

