const { formatMoney } = require('../../../utils/format');
const { confirm } = require('../../../utils/ui');
const { setGoodsFavorite, syncGoodsBrowseState } = require('../../../utils/userGoodsStore');
const access = require('../../../config/access');

const db = wx.cloud.database();
const GOODS_COLLECTION = 'goods';
const MSG_COLLECTION = 'messages';
const USER_COLLECTION = 'userInfo';
const GOODS_THUMB_STYLE = 'goods_thumb';
const TEMP_URL_BATCH_SIZE = 50;
// 支付/购买完成后，用于触发商品列表刷新（商品列表页会对该 token 做“仅刷新一次”的处理）
const GOODS_REFRESH_TOKEN_KEY = 'hyyc_goods_refresh_token';

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

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function clampStr(s = '', maxLen = 120) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}...`;
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
    isFavorite: false,
    canOwnerManage: false,
    ownerActionText: '',
    // 商品“聊一聊”入口开关
    goodsChatEnabled: !!(access && access.features && access.features.goodsChat),
    goodsChatUnreadCount: 0,
    // 当前用户是否为商品发布者
    isOwner: false,
    // 是否允许购买（非本人 + status=posted）
    canBuy: false,
    buyButtonText: '立即购买'
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
      const fnRes = await wx.cloud.callFunction({
        name: 'getUserPublicProfile',
        data: { openid }
      });
      const result = (fnRes && fnRes.result) || null;
      const profile = result && result.profile;
      if (result && result.ok && profile && pickStr(profile._openid) === pickStr(openid)) {
        return profile;
      }
    } catch (e) {
      console.warn('通过云函数获取卖家信息失败，尝试直接查询', e);
    }

    try {
      const res = await db.collection(USER_COLLECTION)
        .where({ _openid: openid })
        .limit(1)
        .get();
      const doc = (res && res.data && res.data[0]) ? res.data[0] : null;
      if (doc && pickStr(doc._openid) === pickStr(openid)) return doc;
      return null;
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
    let sellerAvatar = pickStr(doc.ownerAvatarFileID, doc.ownerAvatarUrl);
    let sellerName = pickStr(doc.ownerNickname, doc.ownerName, '匿名用户');
    if (seller) {
      sellerAvatar = seller.avatarFileID || seller.avatarUrl || '';
      // 兼容不同字段：前端实名页/账户页使用 nickname，微信用户信息常见字段是 nickName
      sellerName = seller.nickname || seller.nickName || seller.name || seller.realname || sellerName || '匿名用户';
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
      // 以 openid 为主（更可靠），兼容历史数据用 ownerId 辅助判断
      const isOwner = (openid && doc._openid && String(doc._openid) === String(openid))
        || (meId && doc.ownerId && String(doc.ownerId) === meId);
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
      const sellerAvatar = seller && (seller.avatarFileID || seller.avatarUrl);
      if (sellerAvatar && this._isCloudFileID(sellerAvatar)) {
        try {
          const avatarMap = await this._getTempFileURLMap([sellerAvatar], '');
          if (avatarMap[sellerAvatar]) {
            seller.avatarFileID = avatarMap[sellerAvatar];
            seller.avatarUrl = avatarMap[sellerAvatar];
          }
        } catch (e) {
          console.error('获取卖家头像失败', e);
        }
      }

      if ((!seller || !pickStr(seller.avatarFileID, seller.avatarUrl)) && doc.ownerAvatarFileID && this._isCloudFileID(doc.ownerAvatarFileID)) {
        try {
          const ownerAvatarMap = await this._getTempFileURLMap([doc.ownerAvatarFileID], '');
          if (ownerAvatarMap[doc.ownerAvatarFileID]) {
            doc.ownerAvatarFileID = ownerAvatarMap[doc.ownerAvatarFileID];
          }
        } catch (e) {
          console.error('获取商品快照头像失败', e);
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

      // 统一在详情页里计算“是否本人/是否可购买”，避免 WXML 里堆复杂判断
      const isOwner2 = (openid && doc._openid && String(doc._openid) === String(openid))
        || (meId && doc.ownerId && String(doc.ownerId) === meId);
      const st2 = pickStr(doc.status) || 'posted';
      const canOwnerManage = isOwner2 && (st2 === 'posted' || st2 === 'off_shelf');
      const ownerActionText = st2 === 'off_shelf' ? '重新上架' : '下架商品';
      const canBuy = !isOwner2 && st2 === 'posted';
      const buyButtonText = st2 === 'sold'
        ? '已售出'
        : (canBuy ? '立即购买' : (isOwner2 ? '我的商品' : '不可购买'));

      this.setData({
        goods,
        imagesPreview: goods.imagesPreview || [],
        isOwner: isOwner2,
        canOwnerManage,
        ownerActionText,
        canBuy,
        buyButtonText,
        isLoading: false
      });

      this.syncGoodsUserState(goods);
      if (isOwner2 && this.data.goodsChatEnabled) {
        this.loadGoodsChatUnread(goods);
        this.openGoodsChatBadgeWatch(goods);
      } else {
        this.clearGoodsChatBadgeWatch();
        this.setData({ goodsChatUnreadCount: 0 });
      }
    } catch (err) {
      console.error('加载商品详情失败', err);
      this.setData({ isLoading: false, goods: null, imagesPreview: [] });
      this.clearGoodsChatBadgeWatch();
      this.setData({ goodsChatUnreadCount: 0 });
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
    } finally {
      if (fromPullDown) wx.stopPullDownRefresh();
    }
  },
  _buildGoodsChatWhere(goods = {}) {
    const gid = pickStr(goods && (goods.id || goods._id));
    const sellerOpenid = pickStr(goods && goods._openid);
    const sellerId = pickStr(goods && goods.ownerId);
    if (!gid) return null;
    const where = {
      bizType: 'goods',
      gid,
    };
    if (sellerOpenid) {
      where.sellerOpenid = sellerOpenid;
    } else if (sellerId) {
      where.sellerId = sellerId;
    } else {
      return null;
    }
    return where;
  },
  _isGoodsSellerMessage(doc = {}, goods = {}) {
    const sellerOpenid = pickStr(goods && goods._openid);
    const sellerId = pickStr(goods && goods.ownerId);
    if (sellerOpenid) {
      return pickStr(doc && doc.fromOpenid) === sellerOpenid;
    }
    return !!(sellerId && pickStr(doc && doc.fromUserId) === sellerId);
  },
  _computeGoodsChatUnreadCount(docs = [], goods = {}) {
    return (Array.isArray(docs) ? docs : []).filter((doc) => {
      if (this._isGoodsSellerMessage(doc, goods)) return false;
      return doc && doc.readBySeller !== true;
    }).length;
  },
  _applyGoodsChatUnreadCount(unreadCount = 0, goods = {}) {
    const gid = pickStr(goods && (goods.id || goods._id), this.data.goods && this.data.goods.id);
    const currentGoodsId = pickStr(this.data.goods && this.data.goods.id);
    if (gid && currentGoodsId && gid !== currentGoodsId) return;
    this.setData({ goodsChatUnreadCount: Number(unreadCount) || 0 });
  },
  loadGoodsChatUnread(goods = {}) {
    const where = this._buildGoodsChatWhere(goods);
    if (!where) {
      this.setData({ goodsChatUnreadCount: 0 });
      return;
    }
    db.collection(MSG_COLLECTION)
      .where(where)
      .limit(500)
      .get({
        success: (res) => {
          const docs = (res && res.data) || [];
          this._applyGoodsChatUnreadCount(this._computeGoodsChatUnreadCount(docs, goods), goods);
        },
        fail: (err) => {
          console.error('加载商品咨询未读失败', err);
          this._applyGoodsChatUnreadCount(0, goods);
        }
      });
  },
  openGoodsChatBadgeWatch(goods = {}) {
    const where = this._buildGoodsChatWhere(goods);
    if (!where) {
      this.clearGoodsChatBadgeWatch();
      this.setData({ goodsChatUnreadCount: 0 });
      return;
    }
    this.clearGoodsChatBadgeWatch();
    this._goodsChatBadgeWatcher = db.collection(MSG_COLLECTION)
      .where(where)
      .watch({
        onChange: (snapshot) => {
          const docs = (snapshot && snapshot.docs) || [];
          this._applyGoodsChatUnreadCount(this._computeGoodsChatUnreadCount(docs, goods), goods);
        },
        onError: (err) => {
          console.error('商品详情咨询未读 watch error', err);
        }
      });
  },
  clearGoodsChatBadgeWatch() {
    if (this._goodsChatBadgeWatcher && this._goodsChatBadgeWatcher.close) {
      this._goodsChatBadgeWatcher.close();
    }
    this._goodsChatBadgeWatcher = null;
  },
  async syncGoodsUserState(goods) {
    if (!goods || !goods.id) return;
    try {
      const state = await syncGoodsBrowseState(goods);
      if ((this.data.goods && this.data.goods.id) === goods.id) {
        this.setData({ isFavorite: !!(state && state.isFavorite) });
      }
    } catch (err) {
      console.warn('同步商品收藏/浏览状态失败', err);
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
    this.toggleFavorite();
  },
  async toggleFavorite() {
    if (this._favoriteUpdating) return;
    const goods = this.data.goods || null;
    if (!goods || !goods.id) return;

    const nextState = !this.data.isFavorite;
    this._favoriteUpdating = true;
    this.setData({ isFavorite: nextState });

    try {
      await setGoodsFavorite(goods, nextState);
      wx.showToast({
        title: nextState ? '已收藏' : '已取消收藏',
        icon: 'none'
      });
    } catch (err) {
      console.error('切换收藏状态失败', err);
      this.setData({ isFavorite: !nextState });
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
    } finally {
      this._favoriteUpdating = false;
    }
  },
  onChatTap() {
    const goods = this.data.goods || null;
    if (!this.data.goodsChatEnabled) {
      wx.showToast({ title: '当前操作暂未开放', icon: 'none' });
      return;
    }
    if (!goods || !goods.id) {
      wx.showToast({ title: '商品信息缺失', icon: 'none' });
      return;
    }

    const url = this.data.isOwner
      ? `/pages/chat/goods-sessions/index?gid=${goods.id}&ownerId=${encodeURIComponent(pickStr(goods.ownerId))}&ownerOpenid=${encodeURIComponent(pickStr(goods._openid))}&title=${encodeURIComponent(pickStr(goods.title, goods.desc, '商品咨询'))}`
      : `/pages/chat/goods-room/index?gid=${goods.id}`;
    wx.navigateTo({ url });
  },
  async onOwnerActionTap() {
    const goods = this.data.goods || null;
    if (!goods || !goods.id || !this.data.isOwner) return;

    const currentStatus = pickStr(goods.status);
    if (currentStatus !== 'posted' && currentStatus !== 'off_shelf') return;

    const nextStatus = currentStatus === 'posted' ? 'off_shelf' : 'posted';
    const ok = await confirm(
      nextStatus === 'off_shelf'
        ? '下架后商品会从商品广场隐藏，但仍保留在“我的商品”里。'
        : '重新上架后，商品会重新出现在商品广场。',
      nextStatus === 'off_shelf' ? '下架商品' : '重新上架'
    );
    if (!ok) return;

    wx.showLoading({
      title: nextStatus === 'off_shelf' ? '下架中...' : '上架中...',
      mask: true
    });

    try {
      const openid = await this._ensureOpenid();
      if (!openid) throw new Error('获取用户身份失败，请重新登录');

      const updateData = {
        status: nextStatus,
        updatedAt: db.serverDate()
      };
      if (nextStatus === 'off_shelf') {
        updateData.offShelfAt = db.serverDate();
      } else {
        updateData.repostedAt = db.serverDate();
      }

      const res = await db.collection(GOODS_COLLECTION)
        .where({ _id: goods.id, _openid: openid, status: currentStatus })
        .update({ data: updateData });
      const updated = Number(res && res.stats && res.stats.updated) || 0;
      if (!updated) throw new Error('商品状态已变更，请刷新后重试');

      try {
        wx.setStorageSync(GOODS_REFRESH_TOKEN_KEY, Date.now());
      } catch (e) {
        // ignore
      }

      this.setData({
        'goods.status': nextStatus,
        canOwnerManage: true,
        ownerActionText: nextStatus === 'off_shelf' ? '重新上架' : '下架商品',
        canBuy: false,
        buyButtonText: '我的商品'
      });
      wx.showToast({
        title: nextStatus === 'off_shelf' ? '已下架' : '已重新上架',
        icon: 'none'
      });
    } catch (err) {
      console.error('商品上下架失败', err);
      wx.showToast({
        title: String(err && err.message ? err.message : '操作失败，请稍后重试'),
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },
  async onBuyTap() {
    if (this._buying) return;

    // 将“立即购买”接入为“汇付聚合正扫（小程序）支付”入口：
    // 1) 云函数调汇付下单拿 pay_info
    // 2) 小程序端 wx.requestPayment 拉起支付

    const goods = this.data.goods || null;
    if (!goods) return wx.showToast({ title: '商品信息缺失', icon: 'none' });
    if (!this.data.canBuy) {
      return wx.showToast({ title: this.data.buyButtonText || '当前不可购买', icon: 'none' });
    }

    // 防止购买自己的商品（双保险：即便 canBuy 计算错了也拦一下）
    const u = wx.getStorageSync('hyyc_user') || {};
    if (u && u.id && goods.ownerId && String(u.id) === String(goods.ownerId)) {
      return wx.showToast({ title: '不能购买自己发布的商品', icon: 'none' });
    }

    const amountYuan = Number(goods.price);
    if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
      return wx.showToast({ title: '商品价格不合法', icon: 'none' });
    }

    // 小程序 appid 用于 Huifu 的 wx_data.sub_appid
    let appid = '';
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
      appid = info && info.miniProgram ? (info.miniProgram.appId || '') : '';
    } catch (e) {
      // ignore
    }

    wx.showModal({
      title: '确认支付',
      content: `是否确认支付 ¥${formatMoney(amountYuan)} 购买该商品？`,
      confirmText: '支付',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;

        this._buying = true;
        wx.showLoading({ title: '生成 pay_info', mask: true });
        try {
          const r = await wx.cloud.callFunction({
            name: 'huifuMiniappPay',
            data: {
              action: 'jspay_goods',
              goodsId: goods.id || goods._id || '',
              subAppid: appid || undefined,
            }
          });

          const ret = r && r.result ? r.result : null;
          console.log('[huifuPay][goodsDetail] result=', ret);

          if (!ret || !ret.ok) {
            wx.hideLoading();
            const msg = (ret && ret.err)
              ? (typeof ret.err === 'string' ? ret.err : (ret.err.msg || '下单失败'))
              : '下单失败';
            wx.showToast({ title: msg, icon: 'none' });
            return;
          }

          wx.hideLoading();
          wx.showLoading({ title: '调起支付', mask: true });
          await wx.requestPayment({
            ...(ret.payParams || {}),
          });

          wx.hideLoading();
          wx.showLoading({ title: '更新商品状态', mask: true });

          // 支付完成后，把商品置为 sold（从而不再出现在商品列表）
          const purchaseRes = await wx.cloud.callFunction({
            name: 'goodsPurchase',
            data: {
              goodsId: goods.id || goods._id || '',
              buyerId: (u && u.id) ? String(u.id) : '',
              transAmtYuan: amountYuan,
              reqSeqId: (ret && ret.reqSeqId) ? String(ret.reqSeqId) : ''
            }
          });

          const pr = purchaseRes && purchaseRes.result ? purchaseRes.result : null;
          wx.hideLoading();

          if (!pr || !pr.ok) {
            const code = pr && pr.code ? String(pr.code) : '';
            if (code === 'ALREADY_SOLD') {
              wx.showModal({
                title: '商品已被购买',
                content: '该商品已被其他人购买，已无法再次购买。若你已完成付款，请联系管理员/客服处理。',
                showCancel: false,
                success: () => {
                  try { wx.setStorageSync(GOODS_REFRESH_TOKEN_KEY, Date.now()); } catch (e) { /* ignore */ }
                  wx.navigateBack({ delta: 1 });
                }
              });
              return;
            }

            wx.showModal({
              title: '支付已完成',
              content: '支付已完成，但商品状态更新失败。你可以稍后在商品列表下拉刷新；若仍显示可购买，请联系管理员处理。',
              showCancel: false,
              success: () => {
                try { wx.setStorageSync(GOODS_REFRESH_TOKEN_KEY, Date.now()); } catch (e) { /* ignore */ }
                wx.navigateBack({ delta: 1 });
              }
            });
            return;
          }

          // 本地也同步一下，避免用户还停留在详情页时显示“可购买”
          this.setData({
            'goods.status': 'sold',
            canBuy: false,
            buyButtonText: '已售出'
          });

          try { wx.setStorageSync(GOODS_REFRESH_TOKEN_KEY, Date.now()); } catch (e) { /* ignore */ }
          wx.showToast({ title: '购买成功，商品已下架', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack({ delta: 1 });
          }, 500);
        } catch (err) {
          console.error('汇付支付失败', err);
          wx.hideLoading();
          wx.showToast({ title: '支付取消/失败', icon: 'none' });
        } finally {
          this._buying = false;
          wx.hideLoading();
        }
      }
    });
  },
  onShow() {
    const goods = this.data.goods || null;
    if (this.data.isOwner && this.data.goodsChatEnabled && goods && goods.id) {
      this.loadGoodsChatUnread(goods);
      this.openGoodsChatBadgeWatch(goods);
    }
  },
  onHide() {
    this.clearGoodsChatBadgeWatch();
  },
  onUnload() {
    this.clearGoodsChatBadgeWatch();
  }
});
