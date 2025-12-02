const { required } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');

// 使用云开发数据库 tasks 集合存储任务
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';

Page({
  data: {
    form: {
      title: '',
      desc: '',
      amount: '',
      // 截止时间拆成日期 + 时间，方便选择；deadline 用于组合后的完整字符串
      deadline: '',
      deadlineDate: '',
      deadlineTime: '',
      address: '',
      images: [],
      building: '',
      floor: '',
      door: '',
      // 任务地点类型：''（不区分）|'inside'（小区内）|'outside'（小区外）
      locationType: ''
    },
    errors: {},
    buildingRange: [],
    buildingIndex: 0,
    // 门牌多列选择：楼层、户号（与实名/账户信息页保持一致）
    doorRange: [[], []],
    doorIndex: [0, 0],
    MAX_FLOOR: 33,
    isLoading: false
  },
  onShow(){
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/auth/realname/index' });
      return;
    }
    // 初始化楼栋列表 & 楼层/户号列表
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);
    const floors = Array.from({ length: this.data.MAX_FLOOR }, (_, i) => `${i + 1}楼`);
    const rooms = ['01户', '02户', '03户', '04户'];

    // 默认楼栋索引：优先用用户当前楼栋
    let idx = 0;
    if (u && u.building) {
      const found = buildings.indexOf(u.building);
      if (found >= 0) idx = found;
    }

    // 根据实名信息预填门牌：楼层 + 户号
    const floorNum = Number(u && (u.floor || (u.door ? String(u.door).slice(0, -2) : 1))) || 1;
    const roomNoRaw = Number(u && (u.door ? String(u.door).slice(-2) : 1)) || 1;
    const floorIdx = Math.max(0, Math.min(this.data.MAX_FLOOR - 1, floorNum - 1));
    const roomIdx = Math.max(0, Math.min(3, roomNoRaw - 1));
    const roomNo = roomNoRaw.toString().padStart(2, '0'); // 01/02/03/04
    const door = `${floorNum}${roomNo}`; // 701, 1203 等

    const buildingText = buildings[idx] || '';
    // 任务地址：沿用注册时的形式「3栋1单元」
	    const roomLabel = String(roomNoRaw);
	    const addr = buildingText ? `${buildingText} ${roomLabel}单元` : '';

    this.setData({
      buildingRange: buildings,
      doorRange: [floors, rooms],
      buildingIndex: idx,
      doorIndex: [floorIdx, roomIdx],
      'form.building': buildingText,
      'form.floor': String(floorNum),
      'form.door': door,
      'form.address': addr
    });
  },
  onInput(e){ const k=e.currentTarget.dataset.k; this.setData({ [`form.${k}`]: e.detail.value }); },
  // 选择截止日期
  onDeadlineDate(e){
    const date = e.detail.value || '';
    const time = this.data.form.deadlineTime || '';
    const dl = (date && time) ? `${date} ${time}` : '';
    this.setData({
      'form.deadlineDate': date,
      'form.deadline': dl
    });
  },
  // 选择截止时间（几点钟）
  onDeadlineTime(e){
    const time = e.detail.value || '';
    const date = this.data.form.deadlineDate || '';
    const dl = (date && time) ? `${date} ${time}` : '';
    this.setData({
      'form.deadlineTime': time,
      'form.deadline': dl
    });
  },
  chooseImg(){
    wx.chooseImage({ count:3, success: ({tempFilePaths}) => {
      this.setData({ 'form.images': (this.data.form.images||[]).concat(tempFilePaths) });
    }});
  },
  reset(){
    // 清空标题/说明/佣金/日期/图片，但保留从实名信息里带过来的地址和楼栋提示
    this.setData({
      form: {
        ...this.data.form,
        title: '',
        desc: '',
        amount: '',
        deadline: '',
        deadlineDate: '',
        deadlineTime: '',
        images: [],
        locationType: ''
      },
      errors: {}
    });
  },
  // 选择任务地点（小区内/小区外/不区分）
  onLocationTap(e){
    const v = e.currentTarget.dataset.v || '';
    this.setData({ 'form.locationType': v });
  },
  // 预览当前表单中已选择的图片（本地临时路径或云 fileID 都支持）
  previewFormImage(e){
    const idx = Number(e.currentTarget.dataset.index || 0);
    const images = this.data.form.images || [];
    if (!images.length) return;
    wx.previewImage({
      current: images[idx] || images[0],
      urls: images
    });
  },
  // 删除当前选中的图片
  removeFormImage(e){
    const idx = Number(e.currentTarget.dataset.index || 0);
    const images = (this.data.form.images || []).slice();
    if (!images.length) return;
    if (idx < 0 || idx >= images.length) return;
    images.splice(idx, 1);
    this.setData({ 'form.images': images });
  },
  async submit(){
    const f = this.data.form;
    const errors = {};
    errors.title = required(f.title, '请填写标题');
    errors.amount = required(f.amount, '请填写佣金');
    errors.building = required(f.building, '请选择发布楼栋');
    errors.door = required(f.door, '请选择门牌号');
    Object.keys(errors).forEach(k => { if (!errors[k]) delete errors[k]; });
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }

    const u = wx.getStorageSync('hyyc_user') || {};
    if (!u || !u.realname) {
      toast('请先完成实名信息');
      wx.navigateTo({ url: '/pages/auth/realname/index' });
      return;
    }

    this.setData({ isLoading: true });

    try {
      const tempImages = f.images || [];
      // 1. 上传图片到云存储，得到 fileID 列表
      const uploadTasks = tempImages.map((path, idx) => {
        // 已经是云文件（fileID）的直接复用
        if (typeof path === 'string' && path.indexOf('cloud://') === 0) {
          return Promise.resolve(path);
        }
        return wx.cloud.uploadFile({
          cloudPath: `tasks/${u.id || 'anonymous'}/${Date.now()}_${idx}.jpg`,
          filePath: path
        }).then(res => res.fileID);
      });
      const fileIDs = await Promise.all(uploadTasks);

      // 2. 解析截止时间字符串为时间戳（毫秒）
      let deadlineTs = null;
      if (f.deadline) {
        // 为兼容 iOS，这里把 "YYYY-MM-DD HH:mm" 替换成 "YYYY/MM/DD HH:mm"
        const safeStr = f.deadline.replace(/-/g, '/');
        const d = new Date(safeStr);
        deadlineTs = d.getTime();
      }

      // 3. 写入 tasks 集合
      await db.collection(TASK_COLLECTION).add({
        data: {
          title: f.title,
          desc: f.desc,
          amount: Number(f.amount),
          deadline: deadlineTs,
          community: u.community || '',
          building: f.building,
          // 只在任务集合里保存楼栋和门牌号（door），不再拆出单独的户号字段
          door: f.door,
          address: f.address,
          // 任务地点类型：小区内/小区外；未选择则为空字符串
          locationType: f.locationType || '',
          images: fileIDs,
          ownerId: u.id || '',
          ownerName: u.name || '',
          ownerNickname: u.nickname || '',
          status: 'posted',
          createdAt: db.serverDate()
        }
      });

      toast('已发布');
      this.setData({ isLoading: false });
      wx.switchTab({ url: '/pages/home/index/index' });
    } catch (err) {
      console.error('发布任务失败', err);
      this.setData({ isLoading: false });
      toast('发布失败，请稍后重试');
    }
  },
  onBuilding(e){
    const idx = Number(e.detail.value||0);
    const val = this.data.buildingRange[idx];
    // 更新发布楼栋，同时根据当前户号重新拼接地址
	    const roomIdx = (this.data.doorIndex && this.data.doorIndex[1]) || 0;
	    const roomNoRaw = roomIdx + 1; // 1-4
	    const roomLabel = String(roomNoRaw);
	    const addr = val ? `${val} ${roomLabel}单元` : '';
    this.setData({
      buildingIndex: idx,
      'form.building': val,
      'form.address': addr
    });
  },
  // 门牌（楼层 + 户号）选择
  onDoorChange(e){
    const value = e.detail.value || [0, 0];
    const fi = Number(value[0] || 0);
    const ui = Number(value[1] || 0);
    const floorNum = fi + 1;
    const roomNoRaw = ui + 1; // 1-4
    const roomNo = roomNoRaw.toString().padStart(2,'0');
    const door = `${floorNum}${roomNo}`;

    const building = this.data.form.building || this.data.buildingRange[this.data.buildingIndex] || '';
    const addr = building ? `${building} ${roomNoRaw}单元` : '';

    this.setData({
      doorIndex: [fi, ui],
      'form.floor': String(floorNum),
      'form.door': door,
      'form.address': addr
    });
  }
});
