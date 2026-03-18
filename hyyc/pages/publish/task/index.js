const { required } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');

// 使用云开发数据库 tasks 集合存储任务
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';
const MIN_TASK_AMOUNT_YUAN = 0.5;

function isMoneyWithMaxTwoDecimals(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return false;
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-8;
}

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
    // 截止日期 / 时间选择器的默认定位值（不直接写入表单，只用来让选择器初始停在“现在”）
    defaultDeadlineDate: '',
    defaultDeadlineTime: '',
    errors: {},
    buildingRange: [],
    buildingIndex: 0,
    // 门牌多列选择：楼层、户号（与实名/账户信息页保持一致）
    doorRange: [[], []],
    doorIndex: [0, 0],
    MAX_FLOOR: 33,
    isLoading: false,
    // 如果为编辑模式，则这里保存正在编辑的任务 ID；空字符串表示新建
    editTaskId: ''
  },
  onShow(){
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/welcome/index' });
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

    // 计算当前日期和时间，用来作为日期/时间选择器的初始定位值
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const todayStr = `${y}-${m}-${day}`;
    let timeStr = `${hh}:${mm}`;
    // 为了兼容 time 选择器的 start / end 限制，把默认时间限制在 06:00~23:00 之间
    const startTime = '06:00';
    const endTime = '23:00';
    if (timeStr < startTime) timeStr = startTime;
    if (timeStr > endTime) timeStr = endTime;

    // 先根据实名信息初始化基础表单：
    // - 不再在这里清空标题/说明/佣金等，避免用户填写一半去选图片后内容被重置。
    // - 如果后面检测到是编辑模式，会再用旧任务数据覆盖这些字段。
    // - 已经选过的图片（form.images）默认保留。
    const prevForm = this.data.form || {};
    const baseForm = {
      ...prevForm,
      // 已经输入过的内容全部保留，只在缺省时用实名信息补充地址相关字段
      building: prevForm.building || buildingText,
      floor: prevForm.floor || String(floorNum),
      door: prevForm.door || door,
      address: prevForm.address || addr,
      // 保证 images 始终是数组
      images: Array.isArray(prevForm.images) ? prevForm.images : []
    };

    this.setData({
      buildingRange: buildings,
      doorRange: [floors, rooms],
      buildingIndex: idx,
      doorIndex: [floorIdx, roomIdx],
      form: baseForm,
      defaultDeadlineDate: todayStr,
      defaultDeadlineTime: timeStr
    });

    // 检查是否有「编辑任务」的暂存 ID
    const editId = wx.getStorageSync('hyyc_edit_task_id') || '';
    if (editId) {
      // 优先从本地缓存的任务对象里直接回填，避免再次请求云端
      const cachedTask = wx.getStorageSync('hyyc_edit_task_data') || null;
      wx.setNavigationBarTitle({ title: '编辑任务' });
      this.setData({ editTaskId: editId });
      if (cachedTask) {
        this.fillFormFromTask(cachedTask, editId);
      } else {
        // 兜底：如果本地没有任务对象，再从云端拉一次
        this.loadTaskForEdit(editId);
      }
      // 用一次就清掉，避免下次进来误用
      wx.removeStorageSync('hyyc_edit_task_id');
      wx.removeStorageSync('hyyc_edit_task_data');
    } else {
      // 新建模式：发布任务
      wx.setNavigationBarTitle({ title: '发布任务' });
      this.setData({ editTaskId: '' });
    }
  },
  // 根据一条任务记录（本地或云端）回填表单
  fillFormFromTask(task={}, id){
    const t = task || {};
    // 把时间戳还原成日期和时间字符串
    let deadlineDate = '';
    let deadlineTime = '';
    let deadlineStr = '';
    if (t.deadline) {
      const d = new Date(t.deadline);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      deadlineDate = `${y}-${m}-${day}`;
      deadlineTime = `${hh}:${mm}`;
      deadlineStr = `${deadlineDate} ${deadlineTime}`;
    }

    this.setData({
      editTaskId: id || this.data.editTaskId,
      form: {
        ...this.data.form,
        title: t.title || '',
        desc: t.desc || '',
        amount: (t.amount != null ? String(t.amount) : ''),
        deadline: deadlineStr,
        deadlineDate,
        deadlineTime,
        // 地址和楼栋：优先用任务里保存的，其次用默认值
        address: t.address || this.data.form.address,
        images: t.images || [],
        building: t.building || this.data.form.building,
        floor: t.floor || this.data.form.floor,
        door: t.door || this.data.form.door,
        // 任务地点类型：未设置时为空字符串
        locationType: t.locationType || ''
      },
      isLoading: false
    });
  },
  // 加载任务数据用于编辑，把云端的任务信息填回表单
  loadTaskForEdit(id){
    if (!id) return;
    this.setData({ isLoading: true });
    db.collection(TASK_COLLECTION).doc(id).get({
      success: (res) => {
        const t = res.data || {};
        this.fillFormFromTask(t, id);
      },
      fail: (err) => {
        console.error('加载任务用于编辑失败', err);
        this.setData({ isLoading: false, editTaskId: '' });
        toast('任务不存在或已被删除');
      }
    });
  },
  onInput(e){ const k=e.currentTarget.dataset.k; this.setData({ [`form.${k}`]: e.detail.value }); },
  // 选择截止日期
  onDeadlineDate(e){
    const date = e.detail.value || '';
    const time = this.data.form.deadlineTime || '';
    // 组合规则：
    // - 只有日期：默认当天 00:00
    // - 只有时间：默认使用今天的日期（defaultDeadlineDate）
    // - 日期 + 时间：按用户选择组合
    let dl = '';
    if (date && time) {
      dl = `${date} ${time}`;
    } else if (date && !time) {
      dl = `${date} 00:00`;
    } else if (!date && time) {
      const today = this.data.defaultDeadlineDate || '';
      if (today && time) dl = `${today} ${time}`;
    }
    this.setData({
      'form.deadlineDate': date,
      'form.deadline': dl
    });
  },
  // 选择截止时间（几点钟）
  onDeadlineTime(e){
    const time = e.detail.value || '';
    // 如果还没选日期，但用户先选了时间，则默认日期为今天
    let date = this.data.form.deadlineDate || '';
    let dl = '';
    if (time) {
      if (!date) {
        date = this.data.defaultDeadlineDate || '';
      }
      if (date) {
        dl = `${date} ${time}`;
      }
    }
    this.setData({
      'form.deadlineDate': date,
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
    let amountErr = required(f.amount, '请填写佣金');
    if (!amountErr) {
      const amountYuan = Number(f.amount);
      if (!isMoneyWithMaxTwoDecimals(amountYuan)) {
        amountErr = '佣金最多支持两位小数';
      } else if (amountYuan < MIN_TASK_AMOUNT_YUAN) {
        amountErr = `佣金不能低于 ${MIN_TASK_AMOUNT_YUAN} 元`;
      }
    }
    errors.amount = amountErr;
    errors.building = required(f.building, '请选择发布楼栋');
    errors.door = required(f.door, '请选择门牌号');
    Object.keys(errors).forEach(k => { if (!errors[k]) delete errors[k]; });
    if (Object.keys(errors).length) {
      this.setData({ errors });
      return;
    }

    // 截止时间相关校验：
    // - 如果只选了「今天的日期」，但没选时间：提示必须选具体时间；
    // - 如果选了截止时间，但时间不晚于当前时间：提示必须选择将来的时间。
    const deadlineDate = f.deadlineDate || '';
    const deadlineTime = f.deadlineTime || '';
    const todayStr = this.data.defaultDeadlineDate || '';

    // 1）选了今天的日期但没选时间：不允许提交
    if (deadlineDate && !deadlineTime && todayStr && deadlineDate === todayStr) {
      toast('今天的截止时间请选具体几点几分');
      return;
    }

    // 2）解析成时间戳并校验必须晚于当前时间。
    //    完全不选截止时间时（日期和时间都为空）：
    //    - 默认从“现在”起 7 天内有效。
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * ONE_DAY;
    const nowTs = Date.now();
    let deadlineTs = null;

    if (!deadlineDate && !deadlineTime && !f.deadline) {
      // 用户完全没有选截止日期/时间：默认一周后过期
      deadlineTs = nowTs + ONE_WEEK;
    } else if (deadlineDate || deadlineTime || f.deadline) {
      // 兜底：根据日期/时间字段重新拼出完整字符串，避免依赖 onDeadlineDate/onDeadlineTime 一定被触发
      let dlStr = f.deadline || '';
      if (!dlStr) {
        let datePart = deadlineDate;
        let timePart = deadlineTime;
        if (!datePart && timePart && todayStr) {
          // 只选了时间：默认日期为今天
          datePart = todayStr;
        }
        if (datePart && timePart) {
          dlStr = `${datePart} ${timePart}`;
        } else if (datePart && !timePart) {
          // 选了未来某天但没选时间：默认当天 00:00
          dlStr = `${datePart} 00:00`;
        }
      }

      if (dlStr) {
        const safeStr = dlStr.replace(/-/g, '/');
        const d = new Date(safeStr);
        deadlineTs = d.getTime();

        if (!deadlineTs || Number.isNaN(deadlineTs)) {
          toast('截止时间格式不正确，请重新选择');
          return;
        }

        if (deadlineTs <= nowTs) {
          toast('截止时间必须晚于当前时间');
          return;
        }
      }
    }

    const u = wx.getStorageSync('hyyc_user') || {};
    if (!u || !u.realname) {
      toast('请先完成实名信息');
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    const editId = this.data.editTaskId;
    const amountYuan = Number(f.amount);

    // 新建任务：先确认“需要先付款”
    if (!editId) {
      if (!isMoneyWithMaxTwoDecimals(amountYuan)) {
        toast('佣金不合法');
        return;
      }
      if (amountYuan < MIN_TASK_AMOUNT_YUAN) {
        toast(`佣金不能低于 ${MIN_TASK_AMOUNT_YUAN} 元`);
        return;
      }

      const okPay = await new Promise((resolve) => {
        wx.showModal({
          title: '发布任务需先付款',
          content: `发布任务需要先支付 ¥${amountYuan.toFixed(2)}。\n任务完成后：96% 给接单人，平台收 4%。\n是否继续？`,
          confirmText: '去支付',
          cancelText: '取消',
          success: (res) => resolve(!!(res && res.confirm)),
          fail: () => resolve(false)
        });
      });
      if (!okPay) return;
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

      if (editId) {
        // 编辑已有任务：只更新可修改的字段
        await db.collection(TASK_COLLECTION).doc(editId).update({
          data: {
            title: f.title,
            desc: f.desc,
            amount: Number(f.amount),
            deadline: deadlineTs,
            building: f.building,
            door: f.door,
            address: f.address,
            // 任务地点类型：小区内/小区外；未选择则为空字符串
            locationType: f.locationType || '',
            images: fileIDs
          }
        });
        toast('已更新');
      } else {
        // 新建任务：走“先创建(pay_pending) -> 下单拿 pay_info -> 拉起支付 -> 支付后改为 posted”

        // 取小程序 appid（用于 Huifu 的 wx_data.sub_appid）
        let appid = '';
        try {
          const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
          appid = info && info.miniProgram ? (info.miniProgram.appId || '') : '';
        } catch (e) {
          // ignore
        }

        wx.showLoading({ title: '创建任务', mask: true });
        const createRes = await wx.cloud.callFunction({
          name: 'taskCreate',
          data: {
            title: f.title,
            desc: f.desc,
            amount: amountYuan,
            deadline: deadlineTs,
            building: f.building,
            door: f.door,
            address: f.address,
            locationType: f.locationType || '',
            images: fileIDs
          }
        });
        const cr = createRes && createRes.result ? createRes.result : null;
        if (!cr || !cr.ok || !cr.taskId) {
          wx.hideLoading();
          this.setData({ isLoading: false });
          toast((cr && cr.msg) || '创建任务失败');
          return;
        }
        const taskId = cr.taskId;

        wx.showLoading({ title: '生成 pay_info', mask: true });
        const payRes = await wx.cloud.callFunction({
          name: 'huifuMiniappPay',
          data: {
            action: 'delay_jspay_task',
            taskId,
            subAppid: appid || undefined,
          }
        });
        const pr = payRes && payRes.result ? payRes.result : null;
        if (!pr || !pr.ok) {
          wx.hideLoading();
          this.setData({ isLoading: false });
          const msg = (pr && pr.err)
            ? (typeof pr.err === 'string' ? pr.err : (pr.err.msg || '下单失败'))
            : '下单失败';
          toast(msg);
          return;
        }

        wx.showLoading({ title: '调起支付', mask: true });
        await wx.requestPayment({ ...(pr.payParams || {}) });

        wx.showLoading({ title: '发布任务', mask: true });
        const payOkRes = await wx.cloud.callFunction({
          name: 'taskPaySuccess',
          data: { taskId }
        });
        const por = payOkRes && payOkRes.result ? payOkRes.result : null;
        wx.hideLoading();
        if (!por || !por.ok) {
          toast('支付成功，但发布状态更新失败（可稍后在“我的任务”查看）');
        } else {
          toast('已发布');
        }
      }

      // 发布 / 更新成功后：
      // 1. 把表单重置成“空白状态”（但保留楼栋和门牌等提示），方便下一次发布；
      // 2. 再切回任务广场。
      this.setData({ isLoading: false, editTaskId: '' });
      this.reset();
      // 保存或新建成功后，统一回到任务广场
      wx.switchTab({ url: '/pages/home/index/index' });
    } catch (err) {
      console.error('发布任务失败', err);
      wx.hideLoading();
      this.setData({ isLoading: false });
      const msg = (err && err.errMsg && String(err.errMsg).indexOf('cancel') > -1) ? '支付已取消' : '发布失败，请稍后重试';
      toast(msg);
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
