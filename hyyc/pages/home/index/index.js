const { formatMoney, formatDateTime } = require('../../../utils/format');

// 使用云开发数据库 tasks 集合作为任务数据源
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';
const GOODS_COLLECTION = 'goods';

const GOODS_CATEGORY_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'digital', label: '电子数码' },
  { key: 'appliance', label: '家用电器' },
  { key: 'furniture', label: '家具家居' },
  { key: 'clothing', label: '服饰箱包' },
  { key: 'books', label: '图书文具' },
  { key: 'baby', label: '母婴玩具' },
  { key: 'sports', label: '运动户外' },
  { key: 'beauty', label: '美妆个护' },
  { key: 'other', label: '其他' }
];

const GOODS_CATEGORY_LABEL_MAP = GOODS_CATEGORY_OPTIONS.reduce((acc, it) => {
  acc[it.key] = it.label;
  return acc;
}, {});

const GOODS_CONDITION_LABEL_MAP = {
  new: '全新',
  '99': '99新',
  '95': '95新',
  '90': '9新',
  '80': '8新',
  '70': '7新及以下'
};

const GOODS_TRADE_LABEL_MAP = {
  face: '当面',
  mail: '邮寄'
};

Page({
  data: {
    // 顶部切换：task（任务列表） / goods（商品列表）
    activeTab: 'task',
    filter: 'all',
    list: [],
    goodsList: [],
    // 商品分类筛选：all 表示全部
    goodsCategory: 'all',
    goodsCategoryOptions: GOODS_CATEGORY_OPTIONS,
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
  // 切换顶部标签
  onTabTap(e){
    const v = e.currentTarget.dataset.v || 'task';
    if (v === this.data.activeTab) return;
    this.setData({ activeTab: v }, () => this.load());
  },
  changeFilter(e){ this.setData({ filter: e.currentTarget.dataset.k }, ()=> this.load()); },
  // 商品分类筛选
  changeGoodsCategory(e){
    const k = e.currentTarget.dataset.k || 'all';
    this.setData({ goodsCategory: k }, () => this.load());
  },
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
    if (this.data.activeTab === 'goods') {
      this.loadGoods();
      return;
    }
    this.loadTasks();
  },
  // 加载任务列表
  loadTasks(){
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
  // 加载商品列表
  loadGoods(){
    this.setData({ isLoading: true });
    const u = wx.getStorageSync('hyyc_user') || {};
    const community = (u.community || '').trim();

    const c = this.data.goodsCategory || 'all';
    // 说明：
    // 这里先按创建时间倒序拉一批（limit 50），再在本地做筛选，
    // 这样就不需要在云开发里额外手动建“复合索引”（多个字段组合的索引）。
    // 后续数据量上来后，再改成云端 where + orderBy + 分页即可。
    db.collection(GOODS_COLLECTION).orderBy('createdAt', 'desc').limit(50).get({
      success: (res) => {
        let raw = res.data || [];
        // 只看本小区
        if (community) {
          raw = raw.filter(doc => String(doc.community || '').trim() === community);
        }
        // 只展示“在售/已发布”的商品：兼容旧数据（没写 status 的也先当成可展示）
        raw = raw.filter(doc => !doc.status || doc.status === 'posted');
        // 分类筛选
        if (c && c !== 'all') {
          raw = raw.filter(doc => String(doc.category || '') === c);
        }

        const list = raw.map((doc) => {
          const categoryKey = doc.category || 'other';
          const conditionKey = doc.condition || '';
          const tradeKey = doc.tradeType || '';
          const images = Array.isArray(doc.images) ? doc.images : [];

          const subParts = [];
          if (doc.community) subParts.push(doc.community);
          if (doc.building) subParts.push(doc.building);

          return {
            ...doc,
            id: doc._id,
            categoryLabel: GOODS_CATEGORY_LABEL_MAP[categoryKey] || '其他',
            priceText: formatMoney(doc.price),
            originalPriceText: (doc.originalPrice != null && doc.originalPrice !== '')
              ? formatMoney(doc.originalPrice)
              : '',
            conditionLabel: GOODS_CONDITION_LABEL_MAP[conditionKey] || '',
            tradeTypeLabel: GOODS_TRADE_LABEL_MAP[tradeKey] || '',
            subText: subParts.join(' · '),
            images,
            imagesPreview: images.slice(0, 3)
          };
        });
        this.setData({ goodsList: list, isLoading: false });
      },
      fail: (err) => {
        console.error('加载商品列表失败', err);
        this.setData({ isLoading: false });
        wx.showToast({ title: '商品加载失败', icon: 'none' });
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
  // 预览商品图片
  previewGoodsImage(e){
    const id = e.currentTarget.dataset.id;
    const idx = Number(e.currentTarget.dataset.index || 0);
    if (!id) return;
    const list = this.data.goodsList || [];
    const g = list.find(x => x.id === id || x._id === id);
    if (!g || !g.images || !g.images.length) return;
    wx.previewImage({
      current: g.images[idx] || g.images[0],
      urls: g.images
    });
  },
  toDetail(e){
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/task/detail/index?id=' + id });
  }
});
