const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast } = require('../../../utils/ui');
const { startImageAudit } = require('../../../utils/imageAudit');
const access = require('../../../config/access');

const db = wx.cloud.database();
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

Page({
  data: {
    tab: 'all',
    list: [],
    isLoading: true,
    goodsChatEnabled: !!(access && access.features && access.features.goodsChat)
  },
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
    // 安全规则里我们用的是 doc._openid == auth.openid（这才是可信身份），
    // 所以“我的商品”列表也必须按 _openid 查询，否则可能被规则拒绝。
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
  setTab(e) {
    const k = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k) || 'all';
    this.setData({ tab: k }, () => this.load());
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
    const list = Array.isArray(this.data.list) ? this.data.list : [];
    const nextList = list.map((item) => ({
      ...item,
      goodsChatUnreadCount: Number(this._goodsUnreadMap[pickStr(item && item.id)]) || 0,
    }));
    this.setData({ list: nextList });
  },
  loadGoodsUnreadSummary(openid = '', userId = '') {
    const where = this._buildGoodsChatWhere(openid, userId);
    if (!where || !this.data.goodsChatEnabled) {
      this._applyGoodsUnreadMap({});
      return;
    }
    db.collection(MSG_COLLECTION)
      .where(where)
      .limit(1000)
      .get({
        success: (res) => {
          const docs = (res && res.data) || [];
          this._applyGoodsUnreadMap(this._buildGoodsUnreadMap(docs, pickStr(openid), pickStr(userId)));
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
  async load() {
    const u = wx.getStorageSync('hyyc_user') || {};
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
      // 关键：按 _openid 查询，才能稳定通过数据库安全规则
      const where = { _openid: openid };
      const tab = this.data.tab;
      if (tab && tab !== 'all') where.status = tab;

      const res = await db.collection(GOODS_COLLECTION)
        .where(where)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      const docs = (res && res.data) ? res.data : [];
      const list = docs.map((doc) => {
        const paymentLockActive = hasActivePaymentLock(doc);
        const st = statusText(doc.status, paymentLockActive);
        const needFixIdx = Array.isArray(doc.auditNeedFixIdx) ? doc.auditNeedFixIdx : [];
        const needFixText = (doc.status === 'need_fix' && needFixIdx.length)
          ? `请替换第 ${needFixIdx.map((i) => Number(i) + 1).join('、')} 张图片`
          : '';
        return {
          ...doc,
          id: doc._id,
          status: pickStr(doc.status),
          statusText: st.text,
          statusBadge: st.badge,
          priceText: formatMoney(doc.price),
          createdAtText: formatCreatedAt(doc.createdAt || doc._createTime),
          needFixText,
          auditError: pickStr(doc.auditError),
          paymentLockActive,
          goodsChatUnreadCount: Number((this._goodsUnreadMap || {})[pickStr(doc._id)]) || 0
        };
      });

      this.setData({ list, isLoading: false });
      this.loadGoodsUnreadSummary(openid, pickStr(u.id));
      this.openGoodsChatWatch(openid, pickStr(u.id));
    } catch (err) {
      console.error('加载我的商品失败', err);
      this.setData({ list: [], isLoading: false });
      this.clearGoodsChatWatch();
      toast('加载失败，请稍后重试');
    }
  },
  _applyLocalShelfChange(id = '', nextStatus = '') {
    const currentTab = pickStr(this.data.tab, 'all');
    const list = Array.isArray(this.data.list) ? this.data.list.slice() : [];
    const idx = list.findIndex((item) => item && (item.id === id || item._id === id));
    if (idx < 0) {
      this.setData({ isLoading: false });
      return;
    }

    if (currentTab === 'all') {
      const nextState = statusText(nextStatus);
      list[idx] = {
        ...list[idx],
        status: nextStatus,
        statusText: nextState.text,
        statusBadge: nextState.badge
      };
    } else {
      list.splice(idx, 1);
    }

    this.setData({
      list,
      isLoading: false
    });
  },
  onView(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/goods/detail/index?id=${id}` });
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
  onEdit(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/publish/goods/index?id=${id}` });
  },
  async onToggleShelf(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
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
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;

    const item = (this.data.list || []).find((x) => x && (x.id === id || x._id === id));
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
