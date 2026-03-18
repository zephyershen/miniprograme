const { isCloudFileID, resolveAvatarURL, saveAvatarTempURL } = require('../../../utils/avatarCache');
const { getStoredUser } = require('../../../utils/userIdentity');

const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

function getMsgTs(msg = {}) {
  const raw = msg && msg.createTime;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object' && Number.isFinite(raw.$date)) return raw.$date;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

Page({
  data: {
    user: {},
    isLoading: false,
    messageCenterUnread: 0,
  },
  onShow(){
    const rawUser = getStoredUser();
    const avatarDisplayUrl = resolveAvatarURL(rawUser.avatarFileID, rawUser.avatarUrl);
    this.setData({
      user: {
        ...rawUser,
        avatarDisplayUrl,
      },
      isLoading: false,
    });
    this._hydrateAvatar(rawUser);
    this._loadMessageCenterSummary();
    this._openMessageCenterWatch(rawUser);
  },
  onHide() {
    this._clearMessageCenterWatch();
  },
  onUnload() {
    this._clearMessageCenterWatch();
  },
  async _loadMessageCenterSummary() {
    const me = getStoredUser();
    if (!me || !Object.keys(me).length) {
      this.setData({ messageCenterUnread: 0 });
      return;
    }
    try {
      const res = await wx.cloud.callFunction({ name: 'getMessageCenter' });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true) return;
      const totalUnread = Number(ret && ret.summary && ret.summary.totalUnread) || 0;
      this.setData({ messageCenterUnread: totalUnread });
    } catch (err) {
      console.warn('加载消息中心摘要失败', err);
    }
  },
  _computeWatchedUnreadCount(docs = [], currentUserId = '') {
    const meId = pickStr(currentUserId);
    if (!meId) return 0;
    return (Array.isArray(docs) ? docs : []).reduce((sum, doc) => {
      const fromUserId = pickStr(doc && doc.fromUserId);
      if (!fromUserId || fromUserId === meId) return sum;
      const isGoods = pickStr(doc && doc.bizType) === 'goods';
      if (isGoods) {
        const isSeller = pickStr(doc && doc.sellerId) === meId;
        return sum + ((isSeller ? doc.readBySeller !== true : doc.readByBuyer !== true) ? 1 : 0);
      }
      const isOwner = pickStr(doc && doc.ownerId) === meId;
      return sum + ((isOwner ? doc.readByOwner !== true : doc.readByPeer !== true) ? 1 : 0);
    }, 0);
  },
  _mergeWatchedMessageDocs() {
    const mergedMap = {};
    const buckets = this._messageWatchBuckets || {};
    Object.keys(buckets).forEach((key) => {
      const docs = Array.isArray(buckets[key]) ? buckets[key] : [];
      docs.forEach((doc) => {
        const id = pickStr(doc && doc._id, doc && doc.id);
        if (!id) return;
        const prev = mergedMap[id];
        if (!prev || getMsgTs(doc) >= getMsgTs(prev)) {
          mergedMap[id] = doc;
        }
      });
    });
    return Object.keys(mergedMap).map((id) => mergedMap[id]);
  },
  _applyWatchedMessageUnread() {
    const meId = pickStr(this._messageCenterUserId);
    if (!meId) return;
    const unread = this._computeWatchedUnreadCount(this._mergeWatchedMessageDocs(), meId);
    this.setData({ messageCenterUnread: unread });
  },
  _openMessageCenterWatch(rawUser = {}) {
    const userId = pickStr(rawUser && rawUser.id);
    if (!userId) {
      this._clearMessageCenterWatch();
      this.setData({ messageCenterUnread: 0 });
      return;
    }

    this._messageCenterUserId = userId;
    this._messageWatchBuckets = { owner: [], seller: [], peer: [] };
    this._clearMessageCenterWatch();

    const watchList = [
      { key: 'owner', where: { ownerId: userId } },
      { key: 'seller', where: { sellerId: userId } },
      { key: 'peer', where: { peerUserId: userId } },
    ];

    this._messageCenterWatchers = watchList.map((item) => db.collection(MSG_COLLECTION)
      .where(item.where)
      .watch({
        onChange: (snapshot) => {
          this._messageWatchBuckets[item.key] = (snapshot && snapshot.docs) || [];
          this._applyWatchedMessageUnread();
        },
        onError: (err) => {
          console.error(`我的页面消息监听失败(${item.key})`, err);
        }
      }));
  },
  _clearMessageCenterWatch() {
    const watchers = Array.isArray(this._messageCenterWatchers) ? this._messageCenterWatchers : [];
    watchers.forEach((watcher) => {
      if (watcher && watcher.close) watcher.close();
    });
    this._messageCenterWatchers = [];
  },
  async _hydrateAvatar(user = {}) {
    const avatarFileID = String(user && user.avatarFileID || '').trim();
    if (!avatarFileID || !isCloudFileID(avatarFileID)) return;
    if (resolveAvatarURL(avatarFileID)) return;

    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: [{ fileID: avatarFileID, maxAge: 60 * 30 }]
      });
      const file = res && res.fileList && res.fileList[0];
      const tempURL = file && file.tempFileURL ? file.tempFileURL : '';
      if (!tempURL) return;

      saveAvatarTempURL(avatarFileID, tempURL, 60 * 30);
      const currentUser = getStoredUser();
      if (String(currentUser.avatarFileID || '').trim() !== avatarFileID) return;
      this.setData({
        'user.avatarDisplayUrl': tempURL
      });
    } catch (err) {
      console.warn('加载我的头像失败', err);
    }
  },
  // 点击“账户信息”卡片，进入账户详情页
  gotoAccount(){
    wx.navigateTo({ url: '/pages/profile/account/index' });
  },
  gotoMyTasks(){ wx.navigateTo({ url: '/pages/profile/tasks/index' }); },
  gotoMyGoods(){ wx.navigateTo({ url: '/pages/profile/goods/index' }); },
  gotoFavorites(){ wx.navigateTo({ url: '/pages/profile/favorites/index' }); },
  gotoMessages(){ wx.navigateTo({ url: '/pages/profile/messages/index' }); },
  gotoWallet(){ wx.navigateTo({ url: '/pages/profile/wallet/index' }); },

  // 退出登录：清掉本地缓存的用户信息，并回到欢迎页
  logout(){
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录或注册才能继续使用完整功能。',
      confirmText: '退出',
      confirmColor: '#EF4444',
      success: (res)=>{
        if (!res.confirm) return;
        try {
          wx.removeStorageSync('hyyc_user');
        } catch (e) {
          console.error('清除本地用户信息失败', e);
        }
        // 清空页面栈，直接回到欢迎页（带 Lottie 动画）
        wx.reLaunch({ url: '/pages/welcome/index' });
      }
    });
  },
});
