const { toast } = require('../../../utils/ui');

const db = wx.cloud.database();
const USER_COLLECTION = 'userInfo';

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
    userDocId: '',
    form: {
      nickname: '',
      building: '',
      floor: '',
      door: ''
    },
    buildingRange: [],
    buildingIndex: 0,
    doorRange: [[], []],
    doorIndex: [0, 0],
    MAX_FLOOR: 33
  },

  onLoad() {
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);
    const floors = Array.from({ length: this.data.MAX_FLOOR }, (_, i) => `${i + 1}楼`);
    const rooms = ['01户', '02户', '03户', '04户'];
    this.setData({ buildingRange: buildings, doorRange: [floors, rooms] });
  },

  async onShow() {
    this.setData({ isLoading: true });
    let u = wx.getStorageSync('hyyc_user') || {};
    const openid = await this._ensureOpenid();
    if (openid) {
      try {
        const queryRes = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
        const list = (queryRes && queryRes.data) || [];
        if (list.length) {
          const doc = list[0];
          u = { ...doc, id: doc._id || doc.id };
          wx.setStorageSync('hyyc_user', u);
        }
      } catch (err) {
        console.warn('读取最新账户信息失败，继续使用缓存', err);
      }
    }

    const buildings = this.data.buildingRange || [];
    let buildingIndex = 0;
    if (u.building) {
      const idx = buildings.indexOf(u.building);
      if (idx >= 0) buildingIndex = idx;
    }

    const floorNum = Number(u.floor || (u.door ? String(u.door).slice(0, -2) : 1)) || 1;
    const roomNo = Number(u.door ? String(u.door).slice(-2) : 1) || 1;
    const floorIdx = Math.max(0, Math.min(this.data.MAX_FLOOR - 1, floorNum - 1));
    const roomIdx = Math.max(0, Math.min(3, roomNo - 1));

    this.setData({
      form: {
        nickname: u.nickname || '',
        building: u.building || '',
        floor: u.floor || String(floorNum),
        door: u.door || (floorNum + roomNo.toString().padStart(2, '0'))
      },
      userDocId: pickStr(u.id, u._id),
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

  onBuildingChange(e) {
    const idx = Number(e.detail.value || 0);
    const val = this.data.buildingRange[idx];
    this.setData({
      buildingIndex: idx,
      'form.building': val
    });
  },

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

    this.setData({ isLoading: true });

    try {
      const docId = await this._resolveUserDocId();
      if (!docId) {
        toast('未找到用户记录，请稍后重试');
        return;
      }

      await db.collection(USER_COLLECTION).doc(docId).update({
        data: {
          nickname: f.nickname,
          building: f.building,
          floor: f.floor,
          door: f.door
        }
      });

      const cached = wx.getStorageSync('hyyc_user') || {};
      wx.setStorageSync('hyyc_user', {
        ...cached,
        id: docId,
        nickname: f.nickname,
        building: f.building,
        floor: f.floor,
        door: f.door
      });

      toast('已保存');
    } catch (err) {
      console.error('更新账户信息失败', err);
      toast('保存失败，请稍后重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async _ensureOpenid() {
    const u = wx.getStorageSync('hyyc_user') || {};
    let openid = pickStr(u._openid, u.openid, u.openId);
    if (openid) return openid;
    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = pickStr(res && res.result && res.result.openid);
      if (openid) wx.setStorageSync('hyyc_user', { ...u, _openid: openid });
    } catch (e) {
      openid = '';
    }
    return openid;
  },

  async _resolveUserDocId() {
    const cached = wx.getStorageSync('hyyc_user') || {};
    const cachedDocId = pickStr(this.data.userDocId, cached.id, cached._id);
    if (cachedDocId) return cachedDocId;

    const openid = await this._ensureOpenid();
    if (!openid) return '';

    const queryRes = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
    const list = (queryRes && queryRes.data) || [];
    if (!list.length) return '';

    const doc = list[0];
    const docId = pickStr(doc._id, doc.id);
    const nextUser = { ...cached, ...doc, id: docId };
    this.setData({ userDocId: docId });
    wx.setStorageSync('hyyc_user', nextUser);
    return docId;
  }
});
