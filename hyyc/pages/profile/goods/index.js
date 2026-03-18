const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast } = require('../../../utils/ui');
const { startImageAudit } = require('../../../utils/imageAudit');
const access = require('../../../config/access');
const { getStoredUser, patchStoredUser } = require('../../../utils/userIdentity');

const db = wx.cloud.database();
const _ = db.command;
const GOODS_COLLECTION = 'goods';
const MSG_COLLECTION = 'messages';
const GOODS_REFRESH_TOKEN_KEY = 'hyyc_goods_refresh_token';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function formatCreatedAt(v) {
  if (!v) return '';
  if (typeof v.getTime === 'function') return formatDateTime(v.getTime());
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return formatDateTime(t);
  return '';
}

function toDateMs(v) {
  if (!v) return 0;
  if (typeof v.getTime === 'function') return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && Number.isFinite(v.$date)) return v.$date;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function hasActivePaymentLock(doc = {}) {
  const lock = doc && doc.paymentLock && typeof doc.paymentLock === 'object'
    ? doc.paymentLock
    : {};
  const status = pickStr(lock.status).toLowerCase();
  if (!pickStr(lock.reqSeqId)) return false;
  if (['paid', 'released', 'failed', 'expired'].includes(status)) return false;
  return toDateMs(lock.expiresAt) > Date.now();
}

function statusText(s, paymentLockActive = false) {
  const st = pickStr(s);
  if (paymentLockActive && st === 'posted') return { text: '支付中', badge: 'badge-outline' };
  if (st === 'pending') return { text: '审核中', badge: 'badge-outline' };
  if (st === 'need_fix') return { text: '需修改', badge: 'badge-outline' };
  if (st === 'posted') return { text: '已上架', badge: 'badge-primary' };
  if (st === 'off_shelf') return { text: '已下架', badge: 'badge-outline' };
  if (st === 'sold') return { text: '已售出', badge: 'badge-outline' };
  return { text: '未知', badge: 'badge-outline' };
}

function sortByTimeDesc(list = [], fields = []) {
  const keys = Array.isArray(fields) ? fields : [];
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const aTs = keys.reduce((acc, key) => acc || toDateMs(a && a[key]), 0);
    const bTs = keys.reduce((acc, key) => acc || toDateMs(b && b[key]), 0);
    return bTs - aTs;
  });
}

function isFunctionNotFoundError(err = {}) {
  const text = pickStr(
    err && err.errMsg,
    err && err.message,
    err
  );
  return text.includes('FunctionName parameter could not be found')
    || text.includes('FUNCTION_NOT_FOUND')
    || text.includes('-501000');
}

function normalizePublishedTab(tab = '') {
  const value = pickStr(tab, 'all');
  if (['all', 'posted', 'off_shelf', 'sold'].includes(value)) return value;
  return 'all';
}

Page({
  data: {
    viewMode: 'published',
    tab: 'all',
    list: [],
    isLoading: true,
    goodsChatEnabled: !!(access && access.features && access.features.goodsChat)
  },
  _publishedRecords: [],
  _purchasedRecords: [],
  onShow() {
    this.load();
  },
  onHide() {
    this.clearGoodsChatWatch();
  },
  onUnload() {
    this.clearGoodsChatWatch();
  },
  onPullDownRefresh() {
    Promise.resolve(this.load()).finally(() => {
      wx.stopPullDownRefresh();
    });
  },
  async _ensureOpenid() {
    const u = getStoredUser();
    let openid = pickStr(u._openid || u.openid || u.openId);
    if (openid) return openid;

    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = pickStr(res && res.result && res.result.openid);
      if (openid) {
        try {
          patchStoredUser({ _openid: openid });
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
  setViewMode(e) {
    const mode = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode, 'published');
    if (mode === this.data.viewMode) return;
    this.setData({ viewMode: mode }, () => this.syncList());
  },
  setTab(e) {
    if (this.data.viewMode !== 'published') return;
    const k = normalizePublishedTab(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k);
    this.setData({ tab: k }, () => this.syncList());
  },
  syncList() {
    const viewMode = pickStr(this.data.viewMode, 'published');
    let source = viewMode === 'purchased'
      ? (Array.isArray(this._purchasedRecords) ? this._purchasedRecords : [])
      : (Array.isArray(this._publishedRecords) ? this._publishedRecords : []);

    if (viewMode === 'published') {
      const tab = normalizePublishedTab(this.data.tab);
      if (tab && tab !== 'all') {
        source = source.filter((item) => pickStr(item && item.status) === tab);
      }
    }

    this.setData({
      list: source.map((item) => ({
        id: pickStr(item && item.id),
        title: pickStr(item && item.title),
        status: pickStr(item && item.status),
        statusText: pickStr(item && item.statusText),
        statusBadge: pickStr(item && item.statusBadge),
        priceText: pickStr(item && item.priceText),
        createdAtText: pickStr(item && item.createdAtText),
        sellerText: pickStr(item && item.sellerText),
        needFixText: pickStr(item && item.needFixText),
        auditError: pickStr(item && item.auditError),
        paymentLockActive: !!(item && item.paymentLockActive),
        goodsChatUnreadCount: Number(item && item.goodsChatUnreadCount) || 0,
        ownerId: pickStr(item && item.ownerId),
        _openid: pickStr(item && item._openid),
        isPurchased: !!(item && item.isPurchased),
      }))
    });
  },
  _buildGoodsChatWhere(openid = '', userId = '') {
    const sellerOpenid = pickStr(openid);
    const sellerId = pickStr(userId);
    const where = { bizType: 'goods' };
    if (sellerOpenid) {
      where.sellerOpenid = sellerOpenid;
      return where;
    }
    if (sellerId) {
      where.sellerId = sellerId;
      return where;
    }
    return null;
  },
  _isSellerMessage(doc = {}, sellerOpenid = '', sellerId = '') {
    if (sellerOpenid) {
      return pickStr(doc && doc.fromOpenid) === sellerOpenid;
    }
    return !!(sellerId && pickStr(doc && doc.fromUserId) === sellerId);
  },
  _buildGoodsUnreadMap(docs = [], sellerOpenid = '', sellerId = '') {
    const unreadMap = {};
    (Array.isArray(docs) ? docs : []).forEach((doc) => {
      const gid = pickStr(doc && doc.gid, doc && doc.goodsId);
      if (!gid) return;
      if (this._isSellerMessage(doc, sellerOpenid, sellerId)) return;
      if (doc && doc.readBySeller === true) return;
      unreadMap[gid] = (Number(unreadMap[gid]) || 0) + 1;
    });
    return unreadMap;
  },
  _applyGoodsUnreadMap(unreadMap = {}) {
    this._goodsUnreadMap = unreadMap && typeof unreadMap === 'object' ? unreadMap : {};
    let changed = false;
    this._publishedRecords = (Array.isArray(this._publishedRecords) ? this._publishedRecords : []).map((item) => {
      const nextUnread = Number(this._goodsUnreadMap[pickStr(item && item.id)]) || 0;
      if (Number(item && item.goodsChatUnreadCount) !== nextUnread) {
        changed = true;
      }
      return {
        ...item,
        goodsChatUnreadCount: nextUnread,
      };
    });
    if (!changed) return;
    if (this.data.viewMode === 'published') this.syncList();
  },
  loadGoodsUnreadSummary(openid = '', userId = '') {
    const where = this._buildGoodsChatWhere(openid, userId);
    if (!where || !this.data.goodsChatEnabled) {
      this._applyGoodsUnreadMap({});
      return;
    }
    const sellerOpenid = pickStr(openid);
    const sellerId = pickStr(userId);
    const unreadWhere = {
      ...where,
      readBySeller: _.neq(true),
    };
    if (sellerOpenid) {
      unreadWhere.fromOpenid = _.neq(sellerOpenid);
    } else if (sellerId) {
      unreadWhere.fromUserId = _.neq(sellerId);
    }
    db.collection(MSG_COLLECTION)
      .where(unreadWhere)
      .limit(500)
      .get({
        success: (res) => {
          const docs = (res && res.data) || [];
          this._applyGoodsUnreadMap(this._buildGoodsUnreadMap(docs, sellerOpenid, sellerId));
        },
        fail: (err) => {
          console.error('加载商品咨询未读汇总失败', err);
          this._applyGoodsUnreadMap({});
        }
      });
  },
  openGoodsChatWatch(openid = '', userId = '') {
    const where = this._buildGoodsChatWhere(openid, userId);
    if (!where || !this.data.goodsChatEnabled) {
      this.clearGoodsChatWatch();
      this._applyGoodsUnreadMap({});
      return;
    }
    this.clearGoodsChatWatch();
    this._goodsChatWatcher = db.collection(MSG_COLLECTION)
      .where(where)
      .watch({
        onChange: (snapshot) => {
          const docs = (snapshot && snapshot.docs) || [];
          this._applyGoodsUnreadMap(this._buildGoodsUnreadMap(docs, pickStr(openid), pickStr(userId)));
        },
        onError: (err) => {
          console.error('我的商品咨询未读 watch error', err);
        }
      });
  },
  clearGoodsChatWatch() {
    if (this._goodsChatWatcher && this._goodsChatWatcher.close) {
      this._goodsChatWatcher.close();
    }
    this._goodsChatWatcher = null;
  },
  _mapPublishedGoods(doc = {}) {
    const paymentLockActive = hasActivePaymentLock(doc);
    const st = statusText(doc.status, paymentLockActive);
    const needFixIdx = Array.isArray(doc.auditNeedFixIdx) ? doc.auditNeedFixIdx : [];
    const needFixText = (doc.status === 'need_fix' && needFixIdx.length)
      ? `请替换第 ${needFixIdx.map((i) => Number(i) + 1).join('、')} 张图片`
      : '';
    return {
      id: pickStr(doc._id, doc.id),
      title: pickStr(doc.title, doc.desc, '未命名商品'),
      status: pickStr(doc.status),
      statusText: st.text,
      statusBadge: st.badge,
      priceText: formatMoney(doc.price),
      createdAtText: formatCreatedAt(doc.createdAt || doc._createTime),
      needFixText,
      auditError: pickStr(doc.auditError),
      paymentLockActive,
      goodsChatUnreadCount: Number((this._goodsUnreadMap || {})[pickStr(doc._id, doc.id)]) || 0,
      ownerId: pickStr(doc.ownerId),
      _openid: pickStr(doc._openid),
      images: Array.isArray(doc.images) ? doc.images.slice() : [],
      isPurchased: false,
    };
  },
  _mapPurchasedGoods(doc = {}) {
    const sellerParts = [];
    const sellerName = pickStr(doc.ownerNickname, doc.ownerName);
    if (sellerName) sellerParts.push(sellerName);
    if (doc.community) sellerParts.push(doc.community);
    if (doc.building) sellerParts.push(doc.building);

    return {
      id: pickStr(doc._id, doc.id),
      title: pickStr(doc.title, doc.desc, '未命名商品'),
      status: 'sold',
      statusText: '已买到',
      statusBadge: 'badge-primary',
      priceText: formatMoney(doc.price),
      createdAtText: formatCreatedAt(doc.soldAt || doc.updatedAt || doc.createdAt || doc._createTime),
      sellerText: sellerParts.join(' · '),
      paymentLockActive: false,
      goodsChatUnreadCount: 0,
      isPurchased: true
    };
  },
  async _loadMyGoodsViaCloudFunction() {
    const res = await wx.cloud.callFunction({
      name: 'getGoodsProfile',
      data: {
        action: 'list_my_goods',
        limit: 100,
        compact: true
      }
    });
    const result = (res && res.result) || {};
    if (!result.ok) {
      throw new Error(pickStr(result.message, result.code, '加载商品失败'));
    }
    return {
      published: Array.isArray(result.published) ? result.published : [],
      purchased: Array.isArray(result.purchased) ? result.purchased : []
    };
  },
  async _loadMyGoodsDirect(openid = '') {
    const publishedPromise = db.collection(GOODS_COLLECTION)
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const purchasedPromise = db.collection(GOODS_COLLECTION)
      .where({ buyerOpenid: openid, status: 'sold' })
      .orderBy('soldAt', 'desc')
      .limit(100)
      .get()
      .catch((err) => {
        console.warn('直接查询我买到的商品失败', err);
        return { data: [] };
      });

    const [publishedRes, purchasedRes] = await Promise.all([publishedPromise, purchasedPromise]);
    return {
      published: sortByTimeDesc(
        ((publishedRes && publishedRes.data) || []).filter((doc) => !doc.sellerDeletedAt),
        ['createdAt', 'updatedAt', '_createTime']
      ),
      purchased: sortByTimeDesc(
        ((purchasedRes && purchasedRes.data) || []).filter((doc) => !doc.buyerDeletedAt),
        ['soldAt', 'updatedAt', 'createdAt', '_createTime']
      )
    };
  },
  async _loadMyGoodsData(openid = '') {
    try {
      return await this._loadMyGoodsViaCloudFunction();
    } catch (err) {
      if (!isFunctionNotFoundError(err)) {
        console.warn('云函数加载我的商品失败，回退直接查询', err);
      }
      return this._loadMyGoodsDirect(openid);
    }
  },
  async load() {
    const u = getStoredUser();
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }
    const openid = await this._ensureOpenid();
    if (!openid) {
      toast('获取用户身份失败，请重新登录');
      this.setData({ list: [], isLoading: false });
      return;
    }

    this.setData({ isLoading: true });

    try {
      const goodsData = await this._loadMyGoodsData(openid);
      const tab = normalizePublishedTab(this.data.tab);
      this._publishedRecords = (Array.isArray(goodsData.published) ? goodsData.published : []).map((doc) => this._mapPublishedGoods(doc));
      this._purchasedRecords = (Array.isArray(goodsData.purchased) ? goodsData.purchased : []).map((doc) => this._mapPurchasedGoods(doc));

      this.setData({
        tab,
        isLoading: false
      }, () => this.syncList());

      this.clearGoodsChatWatch();
      this.loadGoodsUnreadSummary(openid, pickStr(u.id));
    } catch (err) {
      console.error('加载我的商品失败', err);
      this._publishedRecords = [];
      this._purchasedRecords = [];
      this.setData({ list: [], isLoading: false });
      this.clearGoodsChatWatch();
      toast('加载失败，请稍后重试');
    }
  },
  _applyLocalShelfChange(id = '', nextStatus = '') {
    const publishedList = Array.isArray(this._publishedRecords) ? this._publishedRecords.slice() : [];
    const idx = publishedList.findIndex((item) => item && item.id === id);
    if (idx < 0) {
      this.setData({ isLoading: false });
      return;
    }

    const nextState = statusText(nextStatus);
    publishedList[idx] = {
      ...publishedList[idx],
      status: nextStatus,
      statusText: nextState.text,
      statusBadge: nextState.badge,
      paymentLockActive: false
    };

      this.setData({
      isLoading: false
    }, () => {
      this._publishedRecords = publishedList;
      this.syncList();
    });
  },
  onView(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/goods/detail/index?id=${id}` });
  },
  async _deletePublishedRecordDirect(item = {}) {
    const goodsId = pickStr(item.id, item._id);
    const openid = await this._ensureOpenid();
    if (!goodsId || !openid) {
      throw new Error('获取用户身份失败，请重新登录');
    }

    const updateData = {
      sellerDeletedAt: db.serverDate(),
      updatedAt: db.serverDate()
    };
    if (pickStr(item.status) === 'posted') {
      updateData.status = 'off_shelf';
      updateData.offShelfAt = db.serverDate();
    }

    const res = await db.collection(GOODS_COLLECTION)
      .where({ _id: goodsId, _openid: openid })
      .update({ data: updateData });
    const updated = Number(res && res.stats && res.stats.updated) || 0;
    if (!updated) {
      throw new Error('删除失败，请刷新后重试');
    }
  },
  async onDeleteRecord(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;

    const sourceList = this.data.viewMode === 'purchased'
      ? (this._purchasedRecords || [])
      : (this._publishedRecords || []);
    const item = sourceList.find((entry) => entry && pickStr(entry.id) === id);
    if (!item) return;

    const isPurchased = !!item.isPurchased;
    const confirmText = isPurchased
      ? '这只会从“我买到的”里移除，不会影响卖家记录。'
      : (pickStr(item.status) === 'posted'
        ? '删除后会从“我的商品”里移除；如果商品仍在上架中，会自动先下架。'
        : '删除后会从“我的商品”里移除，不会影响买家记录。');
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: isPurchased ? '删除购买记录' : '删除商品记录',
        content: confirmText,
        confirmText: '删除',
        confirmColor: '#D65A31',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
    if (!ok) return;

    this.setData({ isLoading: true });
    try {
      const role = isPurchased ? 'purchased' : 'published';
      try {
        const res = await wx.cloud.callFunction({
          name: 'getGoodsProfile',
          data: {
            action: 'delete_my_goods_record',
            goodsId: id,
            role
          }
        });
        const result = (res && res.result) || {};
        if (!result.ok) {
          throw new Error(pickStr(result.message, result.code, '删除失败'));
        }
      } catch (err) {
        if (isFunctionNotFoundError(err) && !isPurchased) {
          await this._deletePublishedRecordDirect(item);
        } else {
          throw err;
        }
      }

      toast('已删除');
      await this.load();
    } catch (err) {
      console.error('删除商品记录失败', err);
      this.setData({ isLoading: false });
      toast(pickStr(err && err.message, '删除失败，请稍后重试'));
    }
  },
  onConsultSessions(e) {
    if (!this.data.goodsChatEnabled) return;
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = pickStr(dataset.id);
    if (!id) return;
    const ownerId = pickStr(dataset.ownerId);
    const ownerOpenid = pickStr(dataset.ownerOpenid);
    const title = pickStr(dataset.title);
    wx.navigateTo({
      url: `/pages/chat/goods-sessions/index?gid=${id}&ownerId=${encodeURIComponent(ownerId)}&ownerOpenid=${encodeURIComponent(ownerOpenid)}&title=${encodeURIComponent(title)}`
    });
  },
  onContactSeller(e) {
    if (!this.data.goodsChatEnabled) return;
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({
      url: `/pages/chat/goods-room/index?gid=${id}`
    });
  },
  onEdit(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    wx.navigateTo({ url: `/pages/publish/goods/index?id=${id}` });
  },
  async onToggleShelf(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    const status = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.status);
    const paymentLockActive = !!(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.paymentLockActive);
    if (!id || (status !== 'posted' && status !== 'off_shelf')) return;
    if (paymentLockActive) {
      toast('当前有买家正在支付，暂时不能上下架');
      return;
    }

    const nextStatus = status === 'posted' ? 'off_shelf' : 'posted';
    const modalTitle = nextStatus === 'off_shelf' ? '下架商品' : '重新上架';
    const modalContent = nextStatus === 'off_shelf'
      ? '下架后商品会从商品广场隐藏，但仍保留在“我的商品”里。'
      : '重新上架后，商品会重新出现在商品广场。';

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: modalTitle,
        content: modalContent,
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;

    this.setData({ isLoading: true });
    try {
      const openid = await this._ensureOpenid();
      if (!openid) {
        toast('获取用户身份失败，请重新登录');
        this.setData({ isLoading: false });
        return;
      }

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
        .where({ _id: id, _openid: openid, status })
        .update({ data: updateData });
      const updated = Number(res && res.stats && res.stats.updated) || 0;
      if (!updated) {
        toast('商品状态已变更，请刷新后重试');
        this.setData({ isLoading: false });
        return;
      }

      try {
        wx.setStorageSync(GOODS_REFRESH_TOKEN_KEY, Date.now());
      } catch (e) {
        // ignore
      }

      toast(nextStatus === 'off_shelf' ? '已下架' : '已重新上架');
      this._applyLocalShelfChange(id, nextStatus);
    } catch (err) {
      console.error('商品上下架失败', err);
      this.setData({ isLoading: false });
      toast('操作失败，请稍后重试');
    }
  },
  async onRetryAudit(e) {
    const id = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;

    const item = (this._publishedRecords || []).find((x) => x && x.id === id);
    if (!item || !Array.isArray(item.images) || !item.images.length) {
      toast('找不到图片');
      return;
    }

    this.setData({ isLoading: true });
    try {
      await startImageAudit({ bizType: 'goods', bizId: id, images: item.images });
      toast('已重新提交审核');
      this.load();
    } catch (err) {
      console.error('重新审核失败', err);
      this.setData({ isLoading: false });
      toast('重新审核失败，请稍后重试');
    }
  }
});
