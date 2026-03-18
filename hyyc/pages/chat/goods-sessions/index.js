const { formatDateTime } = require('../../../utils/format');
const { getStoredUser, patchStoredUser } = require('../../../utils/userIdentity');

const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const GOODS_COLLECTION = 'goods';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function safeEncode(v = '') {
  return encodeURIComponent(pickStr(v));
}

function safeDecode(v = '') {
  const raw = pickStr(v);
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
}

Page({
  data: {
    gid: '',
    goodsTitle: '',
    ownerIdFromQuery: '',
    ownerOpenidFromQuery: '',
    goodsTitleFromQuery: '',
    sellerIdForQuery: '',
    sellerOpenidForQuery: '',
    list: [],
    isLoading: true,
  },

  _buildSessionWhere() {
    const gid = pickStr(this.data.gid);
    const sellerOpenid = pickStr(this.data.sellerOpenidForQuery, this.data.ownerOpenidFromQuery);
    const sellerId = pickStr(this.data.sellerIdForQuery, this.data.ownerIdFromQuery, this._me && this._me.id);
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

  async _ensureOpenid() {
    const me = getStoredUser();
    let openid = pickStr(me._openid, me.openid, me.openId);
    if (openid) return openid;
    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = pickStr(res && res.result && res.result.openid);
      if (openid) {
        try {
          patchStoredUser({ _openid: openid });
        } catch (err) {
          // ignore
        }
      }
    } catch (err) {
      // ignore
    }
    return openid;
  },

  async _loadOwnedGoods(gid = '') {
    const goodsId = pickStr(gid);
    if (!goodsId) return null;
    const openid = await this._ensureOpenid();
    if (!openid) return null;

    const res = await db.collection(GOODS_COLLECTION)
      .where({ _id: goodsId, _openid: openid })
      .limit(1)
      .get();
    return (res && res.data && res.data[0]) || null;
  },

  onLoad(query) {
    const gid = pickStr(query && (query.gid || query.id));
    if (!gid) {
      wx.showToast({ title: '缺少商品信息', icon: 'none' });
      return;
    }

    const me = getStoredUser();
    if (!me || !me.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    this._me = me;
    this.setData({
      gid,
      ownerIdFromQuery: pickStr(query && query.ownerId),
      ownerOpenidFromQuery: safeDecode(query && query.ownerOpenid),
      goodsTitleFromQuery: safeDecode(query && query.title),
      isLoading: true,
    });
    this.initPage();
  },

  onShow() {
    if (!this.data.gid || !this._me || !this._me.id || !this.data.goodsTitle) return;
    this.loadSessions();
    this.openSessionsWatch();
  },

  onHide() {
    this.clearSessionsWatch();
  },

  onUnload() {
    this.clearSessionsWatch();
  },

  async initPage() {
    try {
      const meId = pickStr(this._me && this._me.id);
      const ownerIdFromQuery = pickStr(this.data.ownerIdFromQuery);
      const ownerOpenidFromQuery = pickStr(this.data.ownerOpenidFromQuery);
      const titleFromQuery = pickStr(this.data.goodsTitleFromQuery);
      let goods = null;
      let meOpenid = '';

      try {
        meOpenid = await this._ensureOpenid();
      } catch (err) {
        console.warn('获取当前用户 openid 失败，继续尝试其他发布者校验方式', err);
      }

      try {
        goods = await this._loadOwnedGoods(this.data.gid);
      } catch (err) {
        console.warn('查询发布者商品记录失败，尝试使用详情页身份兜底', err);
      }

      const ownerId = pickStr(goods && goods.ownerId, ownerIdFromQuery);
      const ownerOpenid = pickStr(goods && goods._openid, ownerOpenidFromQuery);
      const isOwnerById = !!(ownerId && ownerId === meId);
      const isOwnerByOpenid = !!(ownerOpenid && meOpenid && ownerOpenid === meOpenid);
      if (!isOwnerById && !isOwnerByOpenid) {
        throw new Error('只有发布者可以查看咨询会话');
      }
      const goodsTitle = pickStr(goods && goods.title, goods && goods.desc, titleFromQuery, '商品咨询');
      this.setData({
        goodsTitle,
        sellerIdForQuery: ownerId,
        sellerOpenidForQuery: ownerOpenid,
      });
      wx.setNavigationBarTitle({ title: '咨询会话' });
      this.loadSessions();
      this.openSessionsWatch();
    } catch (err) {
      console.error('初始化商品咨询会话失败', err);
      this.setData({ isLoading: false, list: [] });
      wx.showToast({
        title: pickStr(err && err.message, '加载会话失败'),
        icon: 'none',
      });
    }
  },

  loadSessions() {
    const where = this._buildSessionWhere();
    const currentUserId = pickStr(this._me && this._me.id);
    if (!where || !currentUserId) {
      this.setData({ isLoading: false, list: [] });
      return;
    }

    this.setData({ isLoading: true });
    db.collection(MSG_COLLECTION)
      .where(where)
      .limit(500)
      .get({
        success: (res) => {
          const docs = (res && res.data) || [];
          this.setData({
            list: this.buildSessionListFromDocs(docs, currentUserId),
            isLoading: false,
          });
        },
        fail: (err) => {
          console.error('加载商品咨询会话失败', err);
          this.setData({ isLoading: false, list: [] });
          wx.showToast({ title: '加载会话失败', icon: 'none' });
        },
      });
  },

  buildSessionListFromDocs(docs = [], sellerId = '') {
    const map = {};

    (docs || []).forEach((doc) => {
      const peerUserId = pickStr(doc && doc.peerUserId);
      if (!peerUserId) return;

      let ts = 0;
      if (doc.createTime instanceof Date) {
        ts = doc.createTime.getTime();
      } else if (typeof doc.createTime === 'number') {
        ts = doc.createTime;
      } else if (doc.createTime && doc.createTime.$date) {
        ts = doc.createTime.$date;
      }

      const isText = pickStr(doc && doc.type, 'text') === 'text';
      const lastText = isText ? pickStr(doc && doc.text) : '[图片]';
      const peerName = pickStr(
        doc && doc.peerNickname,
        pickStr(doc && doc.fromUserId) === peerUserId ? doc && doc.fromNickname : '',
        '买家'
      );
      const peerOpenid = pickStr(
        doc && doc.peerOpenid,
        pickStr(doc && doc.fromUserId) === peerUserId ? doc && doc.fromOpenid : ''
      );

      if (!map[peerUserId]) {
        map[peerUserId] = {
          peerUserId,
          peerName,
          peerOpenid,
          lastText,
          lastTs: ts,
          lastTimeText: ts ? formatDateTime(ts) : '',
          unreadCount: 0,
        };
      } else if (ts > map[peerUserId].lastTs) {
        map[peerUserId] = {
          ...map[peerUserId],
          peerName: peerName || map[peerUserId].peerName,
          peerOpenid: peerOpenid || map[peerUserId].peerOpenid,
          lastText,
          lastTs: ts,
          lastTimeText: ts ? formatDateTime(ts) : '',
        };
      } else {
        if (!pickStr(map[peerUserId].peerName) && peerName) {
          map[peerUserId].peerName = peerName;
        }
        if (!pickStr(map[peerUserId].peerOpenid) && peerOpenid) {
          map[peerUserId].peerOpenid = peerOpenid;
        }
      }

      if (pickStr(doc && doc.fromUserId) && pickStr(doc && doc.fromUserId) !== sellerId && doc.readBySeller !== true) {
        map[peerUserId].unreadCount += 1;
      }
    });

    return Object.keys(map)
      .map((key) => map[key])
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  },

  toChat(e) {
    const peerUserId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.peer);
    const peerOpenid = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.peerOpenid);
    const peerName = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.peerName);
    const gid = pickStr(this.data.gid);
    if (!gid || !peerUserId) return;

    wx.navigateTo({
      url: `/pages/chat/goods-room/index?gid=${gid}&peerUserId=${peerUserId}&peerOpenid=${safeEncode(peerOpenid)}&peerName=${safeEncode(peerName)}`,
    });
  },

  openSessionsWatch() {
    const where = this._buildSessionWhere();
    const currentUserId = pickStr(this._me && this._me.id);
    if (!where || !currentUserId) return;

    this.clearSessionsWatch();
    this._sessionsWatcher = db.collection(MSG_COLLECTION)
      .where(where)
      .watch({
        onChange: (snapshot) => {
          const docs = (snapshot && snapshot.docs) || [];
          this.setData({
            list: this.buildSessionListFromDocs(docs, currentUserId),
            isLoading: false,
          });
        },
        onError: (err) => {
          console.error('商品咨询会话 watch error', err);
        },
      });
  },

  clearSessionsWatch() {
    if (this._sessionsWatcher && this._sessionsWatcher.close) {
      this._sessionsWatcher.close();
    }
    this._sessionsWatcher = null;
  },
});
