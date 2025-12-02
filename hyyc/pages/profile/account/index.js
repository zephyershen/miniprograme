const { toast } = require('../../../utils/ui');
const { isPhone } = require('../../../utils/validators');
const db = wx.cloud.database();
const USER_COLLECTION = 'userInfo';

Page({
  data: {
    isLoading: true,
    form: {
      nickname: '',
      name: '',
      idNumber: '',
      phone: '',
      community: '',
      building: '',
      floor: '',
      door: ''
    },
    // 楼栋/门牌滚动选择使用（与实名认证页保持一致）
    buildingRange: [],
    buildingIndex: 0,
    doorRange: [[], []], // [floors, rooms]
    doorIndex: [0, 0],
    MAX_FLOOR: 33
  },

  onLoad() {
    // 初始化楼栋（1-23栋）与门号（1-MAX_FLOOR 楼 × 01-04 户）
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);
    const floors = Array.from({ length: this.data.MAX_FLOOR }, (_, i) => `${i + 1}楼`);
    const rooms = ['01户', '02户', '03户', '04户'];
    this.setData({ buildingRange: buildings, doorRange: [floors, rooms] });
  },

  onShow() {
    // 从本地缓存里取用户信息，填充表单
    const u = wx.getStorageSync('hyyc_user') || {};

    // 计算楼栋、门牌滚动选择的默认下标
    const buildings = this.data.buildingRange || [];
    let buildingIndex = 0;
    if (u.building) {
      const idx = buildings.indexOf(u.building);
      if (idx >= 0) buildingIndex = idx;
    }

    const floorNum = Number(u.floor || (u.door ? String(u.door).slice(0, -2) : 1)) || 1;
    const roomNo = Number(u.door ? String(u.door).slice(-2) : 1) || 1;
    const floorIdx = Math.max(0, Math.min(this.data.MAX_FLOOR - 1, floorNum - 1));
    const roomIdx = Math.max(0, Math.min(3, roomNo - 1)); // 01-04 户

    this.setData({
      form: {
        nickname: u.nickname || '',
        name: u.name || '',
        idNumber: u.idNumber || '',
        phone: u.phone || '',
        community: u.community || '',
        building: u.building || '',
        floor: u.floor || String(floorNum),
        door: u.door || (floorNum + roomNo.toString().padStart(2, '0'))
      },
      buildingIndex,
      doorIndex: [floorIdx, roomIdx],
      isLoading: false
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({ [`form.${key}`]: value });
  },

  // 楼栋滚动选择
  onBuildingChange(e) {
    const idx = Number(e.detail.value || 0);
    const val = this.data.buildingRange[idx];
    this.setData({
      buildingIndex: idx,
      'form.building': val
    });
  },

  // 门牌（楼层 + 户号）滚动选择
  onDoorChange(e) {
    const value = e.detail.value || [0, 0];
    const fi = Number(value[0] || 0);
    const ui = Number(value[1] || 0);
    const floorNum = fi + 1;
    const roomNo = (ui + 1).toString().padStart(2, '0');
    const door = `${floorNum}${roomNo}`;
    this.setData({
      doorIndex: [fi, ui],
      'form.floor': `${floorNum}`,
      'form.door': door
    });
  },

  async onSave() {
    const f = this.data.form;

    // 只校验可能修改的字段：手机号、楼栋、门牌
    if (f.phone) {
      const phoneErr = isPhone(f.phone);
      if (phoneErr) {
        toast(phoneErr);
        return;
      }
    }

    if (!f.idNumber) {
      toast('缺少身份证信息，无法保存');
      return;
    }

    this.setData({ isLoading: true });

    try {
      // 根据身份证号找到这条用户记录（数据库里 idNumber 已经是唯一的）
      const queryRes = await db.collection(USER_COLLECTION)
        .where({ idNumber: f.idNumber })
        .limit(1)
        .get();

      const list = (queryRes && queryRes.data) || [];
      if (!list.length) {
        toast('未找到用户记录，请稍后重试');
        this.setData({ isLoading: false });
        return;
      }

      const docId = list[0]._id;

	      // 只更新允许修改的字段；
	      // 后端只保存 door 字段（701 这种整体门牌），不再拆出单独的户号字段
      await db.collection(USER_COLLECTION).doc(docId).update({
        data: {
          nickname: f.nickname,
          phone: f.phone,
          building: f.building,
          floor: f.floor,
          door: f.door
        }
      });

      // 同步更新本地缓存，保证“首页/我的”等页面看到的是最新数据
      const cached = wx.getStorageSync('hyyc_user') || {};
	      wx.setStorageSync('hyyc_user', {
	        ...cached,
	        nickname: f.nickname,
	        phone: f.phone,
	        building: f.building,
	        floor: f.floor,
	        // 本地缓存中也只保留 door，一个字段就能还原楼层+户号
	        door: f.door
	      });

      toast('已保存');
    } catch (err) {
      console.error('更新账户信息失败', err);
      toast('保存失败，请稍后重试');
    } finally {
      this.setData({ isLoading: false });
    }
  }
});
