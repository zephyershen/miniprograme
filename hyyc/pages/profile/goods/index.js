const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast } = require('../../../utils/ui');
const { startImageAudit } = require('../../../utils/imageAudit');

const db = wx.cloud.database();
const GOODS_COLLECTION = 'goods';

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function formatCreatedAt(v) {
  if (!v) return '';
  if (typeof v.getTime === 'function') return formatDateTime(v.getTime());
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return formatDateTime(t);
  return '';
}

function statusText(s) {
  const st = pickStr(s);
  if (st === 'pending') return { text: '审核中', badge: 'badge-outline' };
  if (st === 'need_fix') return { text: '需修改', badge: 'badge-outline' };
  if (st === 'posted') return { text: '已上架', badge: 'badge-primary' };
  if (st === 'sold') return { text: '已售出', badge: 'badge-outline' };
  return { text: '未知', badge: 'badge-outline' };
}

Page({
  data: {
    tab: 'all',
    list: [],
    isLoading: true
  },
  onShow() {
    this.load();
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
        const st = statusText(doc.status);
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
          auditError: pickStr(doc.auditError)
        };
      });

      this.setData({ list, isLoading: false });
    } catch (err) {
      console.error('加载我的商品失败', err);
      this.setData({ list: [], isLoading: false });
      toast('加载失败，请稍后重试');
    }
  },
  onView(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/goods/detail/index?id=${id}` });
  },
  onEdit(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/publish/goods/index?id=${id}` });
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
