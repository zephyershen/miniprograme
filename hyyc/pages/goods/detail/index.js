const { formatMoney } = require('../../../utils/format');

const db = wx.cloud.database();
const GOODS_COLLECTION = 'goods';
const USERS_COLLECTION = 'users';
const GOODS_THUMB_STYLE = 'goods_thumb';
const TEMP_URL_BATCH_SIZE = 50;

const GOODS_CATEGORY_OPTIONS = [
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
  '99': '几乎全新',
  '95': '95新',
  '90': '9成新',
  '80': '8成新',
  '70': '7成新及以下'
};

const GOODS_TRADE_LABEL_MAP = {
  face: '当面交易',
  mail: '邮寄'
};

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

// 格式化发布时间
function formatPublishTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
}

Page({
  data: {
    id: '',
    goods: null,
    imagesPreview: [],
    currentImage: 0,
    isLoading: true,
    isFavorite: false
  },
  onLoad(options) {
    const id = String((options && options.id) || '').trim();
    if (!id) {
      wx.showToast({ title: '缺少商品参数', icon: 'none' });
      this.setData({ isLoading: false, goods: null });
      return;
    }
    this.setData({ id }, () => this.loadGoodsDetail());
  },
  onPullDownRefresh() {
    this.loadGoodsDetail(true);
  },
  async _ensureOpenid() {
    // 数据库安全规则里用 auth.openid 判断“是不是本人”，这里需要拿到 openid 才能做“本人查询”。
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
  _isCloudFileID(v = '') {
    const s = String(v || '');
    return s.indexOf('cloud://') === 0;
  },
  async _getTempFileURLMap(fileIDs = [], style = '') {
    const raw = Array.isArray(fileIDs) ? fileIDs : [];
    const uniq = [];
    const seen = {};
    raw.forEach((id) => {
      const k = String(id || '');
      if (!k) return;
      if (seen[k]) return;
      seen[k] = true;
      uniq.push(k);
    });
    if (!uniq.length) return {};

    const map = {};
    for (let i = 0; i < uniq.length; i += TEMP_URL_BATCH_SIZE) {
      const res = await wx.cloud.getTempFileURL({
        fileList: uniq.slice(i, i + TEMP_URL_BATCH_SIZE).map((fileID) => ({
          fileID,
          maxAge: 60 * 30,
          ...(style ? { style } : {})
        }))
      });
      const list = (res && res.fileList) ? res.fileList : [];
      list.forEach((it) => {
        if (it && it.fileID && it.tempFileURL) map[it.fileID] = it.tempFileURL;
      });
    }
    return map;
  },
  // 获取卖家信息
  async _getSellerInfo(openid) {
    if (!openid) return null;
    try {
      const res = await db.collection(USERS_COLLECTION)
        .where({ _openid: openid })
        .limit(1)
        .get();
      return (res && res.data && res.data[0]) ? res.data[0] : null;
    } catch (e) {
      console.error('获取卖家信息失败', e);
      return null;
    }
  },
  _mapGoodsDoc(doc = {}, thumbMap = {}, seller = null) {
    const categoryKey = doc.category || 'other';
    const conditionKey = doc.condition || '';
    const tradeKey = doc.tradeType || '';

    const images = Array.isArray(doc.images) ? doc.images : [];
    const imagesPreview = images.map((fileID, idx) => {
      const isCloud = this._isCloudFileID(fileID);
      const url = isCloud ? (thumbMap[fileID] || '') : String(fileID || '');
      return { fileID, index: idx, thumbUrl: url };
    });

    const locParts = [];
    if (doc.community) locParts.push(doc.community);

    // 构建属性列表
    const attributes = [];
    if (doc.brand) {
      attributes.push({ key: 'brand', label: '品牌', value: doc.brand });
    }
    if (doc.model) {
      attributes.push({ key: 'model', label: '型号', value: doc.model });
    }
    if (doc.storage) {
      attributes.push({ key: 'storage', label: '存储', value: doc.storage });
    }
    if (doc.version) {
      attributes.push({ key: 'version', label: '版本', value: doc.version });
    }

    // 卖家信息
    let sellerAvatar = '';
    let sellerName = '匿名用户';
    if (seller) {
      sellerAvatar = seller.avatarUrl || '';
      // 兼容不同字段：前端实名页/账户页使用 nickname，微信用户信息常见字段是 nickName
      sellerName = seller.nickname || seller.nickName || seller.name || '匿名用户';
    }

    return {
      ...doc,
      id: doc._id,
      categoryLabel: GOODS_CATEGORY_LABEL_MAP[categoryKey] || '其他',
      conditionLabel: GOODS_CONDITION_LABEL_MAP[conditionKey] || '',
      tradeTypeLabel: GOODS_TRADE_LABEL_MAP[tradeKey] || '',
      priceText: formatMoney(doc.price),
      originalPriceText: (doc.originalPrice != null && doc.originalPrice !== '')
        ? formatMoney(doc.originalPrice)
        : '',
      locationText: locParts.join(' · ') || '未知位置',
      publishTimeText: formatPublishTime(doc.createdAt || doc._createTime),
      sellerAvatar,
      sellerName,
      attributes,
      images,
      imagesPreview
    };
  },
  async loadGoodsDetail(fromPullDown = false) {
    const id = this.data.id;
    if (!id) return;
    if (!fromPullDown) this.setData({ isLoading: true });

    try {
      const u = wx.getStorageSync('hyyc_user') || {};
      const community = String(u.community || '').trim();
      const openid = await this._ensureOpenid();

      // 重要：
      // 你的 goods 安全规则里 read 用了 doc._openid / doc.status / doc.community 这类条件。
      // 在云开发里，这里的 doc 更像“查询条件”，所以我们必须把条件写到 where 里，才能通过权限校验。
      // 1) 先按“本人”查：允许查看自己 pending/need_fix 的商品
      // 2) 再按“公开”查：只允许查看 posted 且同小区的商品
      let doc = null;
      if (openid) {
        try {
          const r1 = await db.collection(GOODS_COLLECTION)
            .where({ _id: id, _openid: openid })
            .limit(1)
            .get();
          doc = (r1 && r1.data && r1.data[0]) ? r1.data[0] : null;
        } catch (e) {
          console.warn('按本人查询商品失败', e);
        }
      }
      if (!doc && community) {
        const r2 = await db.collection(GOODS_COLLECTION)
          .where({ _id: id, status: 'posted', community })
          .limit(1)
          .get();
        doc = (r2 && r2.data && r2.data[0]) ? r2.data[0] : null;
      }
      if (!doc) throw new Error('goods not found');

      // 保护：审核中/需修改的商品，不允许“非本人”查看详情
      // （本人在“我的商品”里可以查看/修改）
      const meId = u && u.id ? String(u.id) : '';
      const isOwner = meId && doc.ownerId && String(doc.ownerId) === meId;
      const st = doc.status || '';
      if (st && st !== 'posted' && !isOwner) {
        this.setData({ isLoading: false, goods: null, imagesPreview: [] });
        wx.showModal({
          title: '暂不可查看',
          content: '该商品正在审核中或需要修改，请稍后再试。',
          showCancel: false,
          success: () => {
            wx.navigateBack({ delta: 1 });
          }
        });
        return;
      }

      // 获取卖家信息
      const seller = await this._getSellerInfo(doc._openid);

      // 获取卖家头像临时URL
      if (seller && seller.avatarUrl && this._isCloudFileID(seller.avatarUrl)) {
        try {
          const avatarMap = await this._getTempFileURLMap([seller.avatarUrl], '');
          if (avatarMap[seller.avatarUrl]) {
            seller.avatarUrl = avatarMap[seller.avatarUrl];
          }
        } catch (e) {
          console.error('获取卖家头像失败', e);
        }
      }

      // 生成商品图片缩略图URL
      const images = Array.isArray(doc.images) ? doc.images : [];
      const cloudIDs = images.filter((x) => this._isCloudFileID(x));
      let thumbMap = {};
      try {
        thumbMap = await this._getTempFileURLMap(cloudIDs, GOODS_THUMB_STYLE);
      } catch (e) {
        console.error('生成商品缩略图失败', e);
        thumbMap = {};
      }

      const goods = this._mapGoodsDoc(doc, thumbMap, seller);
      this.setData({
        goods,
        imagesPreview: goods.imagesPreview || [],
        isLoading: false
      });
    } catch (err) {
      console.error('加载商品详情失败', err);
      this.setData({ isLoading: false, goods: null, imagesPreview: [] });
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
    } finally {
      if (fromPullDown) wx.stopPullDownRefresh();
    }
  },
  async previewImage(e) {
    const idx = Number(e.currentTarget.dataset.index || 0);
    const goods = this.data.goods;
    if (!goods || !goods.images || !goods.images.length) return;

    wx.showLoading({ title: '加载图片...', mask: true });
    try {
      const rawUrls = Array.isArray(goods.images) ? goods.images : [];
      const cloudIDs = rawUrls.filter((x) => this._isCloudFileID(x));
      const cloudMap = await this._getTempFileURLMap(cloudIDs, '');

      const urls = rawUrls
        .map((u) => (this._isCloudFileID(u) ? (cloudMap[u] || '') : u))
        .filter(Boolean);

      if (!urls.length) throw new Error('empty url list');
      const safeIdx = Math.max(0, Math.min(idx, urls.length - 1));
      wx.hideLoading();
      wx.previewImage({
        current: urls[safeIdx] || urls[0],
        urls
      });
    } catch (err) {
      console.error('预览商品图片失败', err);
      wx.hideLoading();
      wx.showToast({ title: '图片加载失败', icon: 'none' });
    }
  },
  onSellerTap() {
    // 跳转卖家主页（后续功能）
    wx.showToast({ title: '查看卖家主页', icon: 'none' });
  },
  onFavoriteTap() {
    const isFavorite = !this.data.isFavorite;
    this.setData({ isFavorite });
    wx.showToast({
      title: isFavorite ? '已收藏' : '已取消收藏',
      icon: 'none'
    });
    // TODO: 实际收藏逻辑
  },
  onChatTap() {
    wx.showToast({ title: '下一阶段：商品聊天', icon: 'none' });
  },
  onBuyTap() {
    wx.showToast({ title: '下一阶段：拍下/支付', icon: 'none' });
  }
});
