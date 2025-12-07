const { formatMoney, formatDateTime } = require('../../../utils/format');

// 使用云开发数据库 tasks 集合作为任务数据源
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';

Page({
  data: {
    filter: 'all',
    list: [],
    isLoading: true,
    // 任务地点筛选：all（全部）、inside（小区内）、outside（小区外）
    locationFilter: 'all',
    locationFilterIndex: 0,
    locationFilterLabels: ['全部', '小区内', '小区外']
  },
  onShow(){
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      // 未实名用户，先进入带 Lottie 动画的欢迎页（再由后续逻辑决定去登录/注册）
      wx.navigateTo({ url: '/pages/auth/welcome/index' });
      return;
    }
    this.load();
  },
  changeFilter(e){ this.setData({ filter: e.currentTarget.dataset.k }, ()=> this.load()); },
  // 任务地点下拉筛选
  onLocationFilterChange(e){
    const idx = Number(e.detail.value || 0);
    const map = ['all', 'inside', 'outside'];
    this.setData({
      locationFilterIndex: idx,
      locationFilter: map[idx] || 'all'
    }, () => this.load());
  },
  load(){
    this.setData({ isLoading: true });
    const u = wx.getStorageSync('hyyc_user') || {};
    const userBuilding = (u.building || '').trim();
    const community = (u.community || '').trim();

    // 只拉取当前小区的任务，按创建时间倒序
    let query = db.collection(TASK_COLLECTION);
    if (community) {
      query = query.where({ community });
    }
    query = query.orderBy('createdAt', 'desc');

    query.get({
      success: (res) => {
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const ONE_WEEK = 7 * ONE_DAY;
        // 任务广场只展示「任务生效中」的任务：
        // - 有截止时间：必须晚于当前时间；
        // - 没有设置截止时间：默认从创建时间起 7 天内有效，超过则视为过期。
        let list = (res.data || [])
          .filter(doc => {
            const rawDeadline = doc.deadline;
            const createdAt = doc.createdAt;
            const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : null;
            const effectiveDeadline = rawDeadline != null
              ? rawDeadline
              : (createdTs ? (createdTs + ONE_WEEK) : null);
            // 没有任何时间信息的旧数据：默认始终视为生效中
            if (effectiveDeadline == null) return true;
            return effectiveDeadline > now;
          })
          .map(doc => {
            const rawDeadline = doc.deadline;
            const createdAt = doc.createdAt;
            const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : null;
            const effectiveDeadline = rawDeadline != null
              ? rawDeadline
              : (createdTs ? (createdTs + ONE_WEEK) : null);
            return {
              ...doc,
              id: doc._id, // 用文档 _id 作为前端使用的 id
              amountText: formatMoney(doc.amount),
              // 截止时间：优先使用用户设置的；未设置则显示“默认 7 天内有效”
              deadlineText: effectiveDeadline ? formatDateTime(effectiveDeadline) : '默认 7 天内有效',
              // 任务说明展开/收起用到的字段：默认收起
              descExpanded: false
            };
          });

        // 本地过滤 / 排序逻辑保留
        if (this.data.filter === 'new') {
          list = list.sort((a, b) => (b.deadline || 0) - (a.deadline || 0));
        } else if (this.data.filter === 'building') {
          if (!userBuilding) {
            wx.showModal({
              title: '提示',
              content: '请先在实名里填写楼栋，便于筛选本楼栋任务',
              success: (res2) => {
                if (res2.confirm) {
                  wx.navigateTo({ url: '/pages/auth/realname/index' });
                }
              }
            });
          } else {
            list = list.filter(t => {
              const b = (t.building || this.parseBuilding(t.address) || '').trim();
              return b && b === userBuilding;
            });
          }
        }

        // 根据任务地点做二次过滤：
        // - all：不过滤
        // - inside：只保留 locationType === 'inside'
        // - outside：只保留 locationType === 'outside'
        const lf = this.data.locationFilter || 'all';
        if (lf === 'inside') {
          list = list.filter(t => t.locationType === 'inside');
        } else if (lf === 'outside') {
          list = list.filter(t => t.locationType === 'outside');
        }

        this.setData({ list, isLoading: false });
      },
      fail: (err) => {
        console.error('加载任务列表失败', err);
        this.setData({ isLoading: false });
        wx.showToast({ title: '任务加载失败', icon: 'none' });
      }
    });
  },
  // 切换某条任务的说明展开/收起
  toggleDesc(e){
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const list = this.data.list || [];
    const idx = list.findIndex(t => t.id === id || t._id === id);
    if (idx < 0) return;
    const key = `list[${idx}].descExpanded`;
    this.setData({ [key]: !list[idx].descExpanded });
  },
  parseBuilding(addr=''){
    const m = String(addr).match(/([0-9]+|[一二三四五六七八九十]+)栋/);
    return m ? (m[1] + '栋') : '';
  },
  goPublish(){ wx.switchTab({ url: '/pages/task/publish/index' }); },
  toDetail(e){
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/task/detail/index?id=' + id });
  }
});
