const { required } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');
const { startImageAudit } = require('../../../utils/imageAudit');

// 使用云开发数据库 goods 集合存储商品
const db = wx.cloud.database();
const GOODS_COLLECTION = 'goods';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

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
    MAX_IMAGES: 9,
    // 编辑模式：从“我的商品”进入时会带上这个 id
    editGoodsId: '',
    // 需要用户替换的图片下标（用于红框提示）
    needFixIdxMap: {},
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
  async _ensureOpenid() {
    // 数据库安全规则里我们用 auth.openid 判断“是不是本人”，这里需要拿到 openid 才能做“本人写入/更新”。
    const u = wx.getStorageSync('hyyc_user') || {};
    let openid = pickStr(u._openid || u.openid || u.openId);
    if (openid) return openid;

    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = pickStr(res && res.result && res.result.openid);
      if (openid) {
        try {
          wx.setStorageSync('hyyc_user', { ...u, _openid: openid });
        } catch (e) {
          // ignore
        }
        return openid;
      }
    } catch (e) {
      // ignore
    }
    return '';
  },
  onLoad(options) {
    const id = (options && (options.id || options.editId)) || '';
    if (id) {
      this.setData({ editGoodsId: String(id) });
    }
  },
  onShow() {
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/welcome/index' });
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
    }, () => {
      // 编辑模式：回填商品数据（只加载一次）
      const editId = this.data.editGoodsId;
      if (editId && !this._editLoaded) {
        this._editLoaded = true;
        this.loadGoodsForEdit(editId);
      }
    });
  },
  async loadGoodsForEdit(id) {
    const gid = String(id || '').trim();
    if (!gid) return;

    const u = wx.getStorageSync('hyyc_user') || {};
    const userId = u.id || '';
    if (!userId) return;

    this.setData({ isLoading: true });
    try {
      // 重要：goods 的 read 规则里用到了 doc._openid（查询条件），
      // 所以这里不要用 doc(id).get()，而是按 {_id, _openid} 精确查询。
      const openid = await this._ensureOpenid();

      if (!openid) {
        toast('获取用户身份失败，请重新登录');
        this.setData({ isLoading: false });
        return;
      }

      const res = await db.collection(GOODS_COLLECTION)
        .where({ _id: gid, _openid: openid })
        .limit(1)
        .get();
      const doc = (res && res.data && res.data[0]) ? res.data[0] : null;
      if (!doc) {
        toast('商品不存在或无权限编辑');
        this.setData({ isLoading: false });
        return;
      }
      if (doc.ownerId && doc.ownerId !== userId) {
        toast('无权限编辑');
        this.setData({ isLoading: false });
        return;
      }

      // 楼栋回填：优先用商品自己的
      const buildings = this.data.buildingRange || [];
      const b = doc.building || '';
      const idx = b ? buildings.indexOf(b) : -1;

      const needFixIdx = Array.isArray(doc.auditNeedFixIdx) ? doc.auditNeedFixIdx : [];
      const needFixIdxMap = {};
      needFixIdx.forEach((i) => {
        const n = Number(i);
        if (Number.isFinite(n) && n >= 0) needFixIdxMap[n] = true;
      });

      this.setData({
        buildingIndex: idx >= 0 ? idx : (this.data.buildingIndex || 0),
        form: {
          title: doc.title || '',
          category: doc.category || '',
          price: (doc.price != null && doc.price !== '') ? String(doc.price) : '',
          originalPrice: (doc.originalPrice != null && doc.originalPrice !== '') ? String(doc.originalPrice) : '',
          condition: doc.condition || '',
          tradeType: doc.tradeType || '',
          desc: doc.desc || '',
          // 编辑时 images 里可能是云 fileID，也可能是 URL；都保留原样
          images: Array.isArray(doc.images) ? doc.images : [],
          building: b || (buildings[this.data.buildingIndex] || '')
        },
        needFixIdxMap,
        errors: {},
        isLoading: false
      });
    } catch (err) {
      console.error('加载待编辑商品失败', err);
      this.setData({ isLoading: false });
      toast('加载失败，请稍后重试');
    }
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
    // 防止重复点击导致重复写入（view 按钮没有 disabled 属性，需要在 JS 里兜底）
    if (this._submitting) return;
    this._submitting = true;

    try {
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
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    this.setData({ isLoading: true });

    try {
      const tempImages = f.images || [];
      const imagesSignature = JSON.stringify(tempImages || []);

      // 记录封面图宽高比（height/width），用于商品广场瀑布流更准确地预估卡片高度
      let coverRatio = null;
      const coverSrc = tempImages[0];
      // 封面可能是：
      // - 本地临时路径（wxfile:// 或者开发者工具里的临时路径）
      // - 云文件 fileID（cloud://...）
      // - http(s) 链接
      if (typeof coverSrc === 'string' && coverSrc) {
        try {
          let srcForInfo = coverSrc;
          // 云文件先转成临时 URL，否则 getImageInfo 可能拿不到宽高
          if (coverSrc.indexOf('cloud://') === 0) {
            try {
              const t = await wx.cloud.getTempFileURL({
                fileList: [{ fileID: coverSrc, maxAge: 60 * 60 }]
              });
              const first = t && t.fileList && t.fileList[0];
              if (first && first.tempFileURL) srcForInfo = first.tempFileURL;
            } catch (e) {
              // ignore
            }
          }
          const info = await new Promise((resolve, reject) => {
            wx.getImageInfo({
              src: srcForInfo,
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
      // 如果用户“重复点提交”但图片没变，复用上一次上传结果，避免重复占用存储空间
      let fileIDs = null;
      if (
        this._lastUpload &&
        this._lastUpload.signature === imagesSignature &&
        Array.isArray(this._lastUpload.fileIDs) &&
        this._lastUpload.fileIDs.length === tempImages.length
      ) {
        fileIDs = this._lastUpload.fileIDs;
      } else {
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
        fileIDs = await Promise.all(uploadTasks);
        this._lastUpload = { signature: imagesSignature, fileIDs };
      }

      // 写库：先保存为 pending（审核中），通过审核后再变成 posted（可见）
      const editId = String(this.data.editGoodsId || '').trim();
      let goodsId = editId;
      const openid = await this._ensureOpenid();
      if (!openid) {
        this.setData({ isLoading: false });
        toast('获取用户身份失败，请重新登录');
        return;
      }
      if (editId) {

        // 注意：安全规则里 update 往往会用到 doc._openid == auth.openid，
        // 这里用 {_id, _openid} 精确匹配，避免被判定为“不安全更新”而拒绝。
        const upRes = await db.collection(GOODS_COLLECTION).where({ _id: editId, _openid: openid }).update({
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
            // 去掉前后空格，避免 goods.community 和用户小区映射不一致
            community: String(u.community || '').trim(),
            building: f.building || '',
            ownerId: u.id || '',
            ownerOpenid: openid,
            ownerName: u.name || '',
            ownerNickname: u.nickname || '',
            ownerAvatarFileID: u.avatarFileID || '',
            status: 'pending',
            updatedAt: db.serverDate()
          }
        });
        const updated = Number(upRes && upRes.stats && upRes.stats.updated) || 0;
        if (!updated) {
          this.setData({ isLoading: false });
          toast('商品不存在或无权限编辑');
          return;
        }
      } else {
        const addRes = await db.collection(GOODS_COLLECTION).add({
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
            // 去掉前后空格，避免 goods.community 和用户小区映射不一致
            community: String(u.community || '').trim(),
            building: f.building || '',
            ownerId: u.id || '',
            ownerOpenid: openid,
            ownerName: u.name || '',
            ownerNickname: u.nickname || '',
            ownerAvatarFileID: u.avatarFileID || '',
            status: 'pending',
            createdAt: db.serverDate()
          }
        });
        goodsId = (addRes && addRes._id) ? String(addRes._id) : '';
        // 重要：新建成功后，把 id 留在页面里；
        // 这样就算后面“审核启动失败”，用户再点提交也会走 update，不会重复新增多条商品。
        if (goodsId) {
          this.setData({ editGoodsId: goodsId });
        }
      }

      // 启动图片审核（异步回调）
      try {
        await startImageAudit({ bizType: 'goods', bizId: goodsId, images: fileIDs });
      } catch (e) {
        console.error('启动商品图片审核失败', e);
        // 审核没启动成功也不要让商品上架
        try {
          const openid = await this._ensureOpenid();
          if (openid && goodsId) {
            await db.collection(GOODS_COLLECTION).where({ _id: goodsId, _openid: openid }).update({
              data: { status: 'need_fix', auditError: String(e && e.message ? e.message : '审核启动失败') }
            });
          }
        } catch (e2) {
          // ignore
        }
        this.setData({ isLoading: false });
        wx.showModal({
          title: '已保存，但审核启动失败',
          content: '商品已经保存到“我的商品”里了。请稍后在“我的商品”里点“重新审核”。',
          confirmText: '去我的商品',
          cancelText: '留在这里',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/profile/goods/index' });
            }
          }
        });
        return;
      }

      // 通知商品列表 tab：下次展示时刷新一次（避免商品列表每次切 tab 都重刷）
      try {
        wx.setStorageSync('hyyc_goods_refresh_token', Date.now());
      } catch (e) {
        // ignore
      }

      toast(editId ? '已重新提交审核' : '已提交审核');
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
    } finally {
      this._submitting = false;
    }
  }
});
