const { required } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');

// 使用云开发数据库 goods 集合存储商品
const db = wx.cloud.database();
const GOODS_COLLECTION = 'goods';

Page({
  data: {
    form: {
      title: '',
      category: '',
      price: '',
      originalPrice: '',
      condition: '',
      // 交易方式：''（都可以）|'face'（当面）|'mail'（邮寄）
      tradeType: '',
      desc: '',
      images: [],
      // 可选：方便同楼栋筛选
      building: ''
    },
    errors: {},
    isLoading: false,
    MAX_IMAGES: 6,
    categoryOptions: [
      { key: 'digital', label: '电子数码' },
      { key: 'appliance', label: '家用电器' },
      { key: 'furniture', label: '家具家居' },
      { key: 'clothing', label: '服饰箱包' },
      { key: 'books', label: '图书文具' },
      { key: 'baby', label: '母婴玩具' },
      { key: 'sports', label: '运动户外' },
      { key: 'beauty', label: '美妆个护' },
      { key: 'other', label: '其他' }
    ],
    conditionOptions: [
      { key: 'new', label: '全新' },
      { key: '99', label: '99新' },
      { key: '95', label: '95新' },
      { key: '90', label: '9新' },
      { key: '80', label: '8新' },
      { key: '70', label: '7新及以下' }
    ],
    buildingRange: [],
    buildingIndex: 0
  },
  onShow() {
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/auth/realname/index' });
      return;
    }

    // 楼栋列表：1-23栋（沿用发布任务/实名信息的范围）
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);

    // 默认楼栋：优先用用户实名信息里的楼栋
    let idx = 0;
    if (u && u.building) {
      const found = buildings.indexOf(u.building);
      if (found >= 0) idx = found;
    }

    // 不要把用户填到一半的内容冲掉：只补默认楼栋
    const prevForm = this.data.form || {};
    this.setData({
      buildingRange: buildings,
      buildingIndex: idx,
      form: {
        ...prevForm,
        building: prevForm.building || buildings[idx] || ''
      }
    });
  },
  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [`form.${k}`]: e.detail.value });
  },
  onCategoryTap(e) {
    const v = e.currentTarget.dataset.v || '';
    this.setData({
      'form.category': v,
      'errors.category': ''
    });
  },
  onConditionTap(e) {
    const v = e.currentTarget.dataset.v || '';
    this.setData({ 'form.condition': v });
  },
  onTradeTap(e) {
    const v = e.currentTarget.dataset.v || '';
    this.setData({ 'form.tradeType': v });
  },
  onBuilding(e) {
    const idx = Number(e.detail.value || 0);
    const val = this.data.buildingRange[idx] || '';
    this.setData({
      buildingIndex: idx,
      'form.building': val
    });
  },
  chooseImg() {
    const images = this.data.form.images || [];
    const max = this.data.MAX_IMAGES || 6;
    if (images.length >= max) {
      toast(`最多只能上传${max}张图片`);
      return;
    }
    wx.chooseImage({
      count: max - images.length,
      success: ({ tempFilePaths }) => {
        this.setData({ 'form.images': images.concat(tempFilePaths || []) });
      }
    });
  },
  // 预览当前表单中已选择的图片（本地临时路径或云 fileID 都支持）
  previewFormImage(e) {
    const idx = Number(e.currentTarget.dataset.index || 0);
    const images = this.data.form.images || [];
    if (!images.length) return;
    wx.previewImage({
      current: images[idx] || images[0],
      urls: images
    });
  },
  // 删除当前选中的图片
  removeFormImage(e) {
    const idx = Number(e.currentTarget.dataset.index || 0);
    const images = (this.data.form.images || []).slice();
    if (!images.length) return;
    if (idx < 0 || idx >= images.length) return;
    images.splice(idx, 1);
    this.setData({ 'form.images': images });
  },
  reset() {
    // 清空主要内容，但保留默认楼栋（减少重复操作）
    this.setData({
      form: {
        ...this.data.form,
        title: '',
        category: '',
        price: '',
        originalPrice: '',
        condition: '',
        tradeType: '',
        desc: '',
        images: []
      },
      errors: {}
    });
  },
  async submit() {
    const f = this.data.form || {};
    const errors = {};

    errors.images = (f.images && f.images.length) ? '' : '请至少上传 1 张图片';
    errors.title = required(f.title, '请填写标题');
    errors.category = required(f.category, '请选择分类');

    // 价格：必填且要大于 0
    let priceErr = required(f.price, '请填写价格');
    if (!priceErr) {
      const n = Number(f.price);
      if (!Number.isFinite(n) || n <= 0) priceErr = '价格要大于 0';
    }
    errors.price = priceErr;

    // 原价：可选，但填了就要是正常数字
    if (String(f.originalPrice || '').trim()) {
      const op = Number(f.originalPrice);
      if (!Number.isFinite(op) || op <= 0) {
        errors.originalPrice = '原价格式不正确';
      }
    }

    Object.keys(errors).forEach((k) => {
      if (!errors[k]) delete errors[k];
    });
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
      // 记录封面图宽高比（height/width），用于商品广场瀑布流更准确地预估卡片高度
      let coverRatio = null;
      const coverSrc = tempImages[0];
      if (typeof coverSrc === 'string' && coverSrc && coverSrc.indexOf('cloud://') !== 0) {
        try {
          const info = await new Promise((resolve, reject) => {
            wx.getImageInfo({
              src: coverSrc,
              success: resolve,
              fail: reject
            });
          });
          const w = Number(info.width || 0);
          const h = Number(info.height || 0);
          if (w > 0 && h > 0) {
            coverRatio = h / w;
          }
        } catch (e) {
          // ignore
        }
      }
      const uploadTasks = tempImages.map((path, idx) => {
        if (typeof path === 'string' && path.indexOf('cloud://') === 0) {
          return Promise.resolve(path);
        }
        return wx.cloud
          .uploadFile({
            cloudPath: `goods/${u.id || 'anonymous'}/${Date.now()}_${idx}.jpg`,
            filePath: path
          })
          .then((res) => res.fileID);
      });
      const fileIDs = await Promise.all(uploadTasks);

      await db.collection(GOODS_COLLECTION).add({
        data: {
          title: f.title,
          desc: f.desc,
          price: Number(f.price),
          originalPrice: String(f.originalPrice || '').trim() ? Number(f.originalPrice) : null,
          category: f.category,
          condition: f.condition || '',
          tradeType: f.tradeType || '',
          images: fileIDs,
          coverRatio,
          community: u.community || '',
          building: f.building || '',
          ownerId: u.id || '',
          ownerName: u.name || '',
          ownerNickname: u.nickname || '',
          status: 'posted',
          createdAt: db.serverDate()
        }
      });

      // 通知商品列表 tab：下次展示时刷新一次（避免商品列表每次切 tab 都重刷）
      try {
        wx.setStorageSync('hyyc_goods_refresh_token', Date.now());
      } catch (e) {
        // ignore
      }

      toast('已发布');
      this.setData({ isLoading: false });
      this.reset();

      // 先回到「选择发布类型」页（后续有商品广场时再改这里）
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.switchTab({ url: '/pages/publish/index/index' });
        }
      });
    } catch (err) {
      console.error('发布商品失败', err);
      this.setData({ isLoading: false });
      toast('发布失败，请稍后重试');
    }
  }
});
