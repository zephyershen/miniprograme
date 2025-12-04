const { formatDateTime } = require('../../../utils/format');

// 使用云开发数据库 messages 集合作为聊天数据源
const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';

Page({
  data: {
    tid: '',
    list: [],
    isLoading: true
  },

  onLoad(q) {
    const tid = (q && q.tid) || '';
    if (!tid) {
      wx.showToast({ title: '缺少任务信息', icon: 'none' });
      return;
    }

    const me = wx.getStorageSync('hyyc_user') || {};
    if (!me || !me.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/auth/welcome/index' });
      return;
    }

    this._me = me;
    this.setData({ tid, isLoading: true });
    this.loadSessions();
    this.openSessionsWatch();
  },

  onShow() {
    // 从单聊页返回时刷新会话列表及未读角标，并确保实时监听已挂载
    if (!this.data.tid) return;
    if (!this._me || !this._me.id) return;
    this.loadSessions();
    this.openSessionsWatch();
  },

  onHide() {
    this.clearSessionsWatch();
  },

  onUnload() {
    this.clearSessionsWatch();
  },

  // 加载当前任务下，作为发布者时所有「单聊会话」列表
  loadSessions() {
    const tid = this.data.tid;
    const me = this._me || {};
    const ownerId = me.id || '';
    if (!tid || !ownerId) {
      this.setData({ isLoading: false, list: [] });
      return;
    }

    this.setData({ isLoading: true });

    db.collection(MSG_COLLECTION)
      .where({ tid, ownerId })
      .orderBy('createTime', 'desc')
      .limit(500)
      .get({
        success: (res) => {
          const docs = (res && res.data) || [];
          const list = this.buildSessionListFromDocs(docs, ownerId);
          this.setData({ list, isLoading: false });
        },
        fail: (err) => {
          console.error('加载聊天会话失败', err);
          this.setData({ isLoading: false, list: [] });
          wx.showToast({ title: '加载聊天会话失败', icon: 'none' });
        }
      });
  },

  // 进入具体某个住户的单聊界面
  toChat(e) {
    const peerUserId = e.currentTarget.dataset.peer || '';
    if (!peerUserId) return;
    const tid = this.data.tid;
    wx.navigateTo({
      url: `/pages/chat/room/index?tid=${tid}&peerUserId=${peerUserId}`
    });
  },

  // 把一批 messages 记录聚合成会话列表
  buildSessionListFromDocs(docs = [], ownerId) {
    const map = {};
    (docs || []).forEach(doc => {
      const peerUserId = doc.peerUserId || '';
      if (!peerUserId) return;

      const ts = doc.createTime instanceof Date
        ? doc.createTime.getTime()
        : doc.createTime;
      const lastTimeText = ts ? formatDateTime(ts) : '';

      let peerName = '住户';
      if (doc.fromUserId === peerUserId && doc.fromNickname) {
        peerName = doc.fromNickname;
      }

      const isText = doc.type === 'text';
      const lastText = isText
        ? (doc.text || '')
        : '[图片]';

      if (!map[peerUserId]) {
        map[peerUserId] = {
          peerUserId,
          peerName,
          lastType: doc.type || 'text',
          lastText,
          lastTimeText,
          unreadCount: 0
        };
      }

      // 统计未读：来自住户，且 readByOwner !== true
      if (doc.fromUserId && doc.fromUserId !== ownerId && doc.readByOwner !== true) {
        map[peerUserId].unreadCount += 1;
      }
    });

    return Object.keys(map).map(k => map[k]);
  },

  // 会话列表的实时监听：保证业主停留在本页时，列表和未读角标实时刷新
  openSessionsWatch() {
    const tid = this.data.tid;
    const me = this._me || {};
    const ownerId = me.id || '';
    if (!tid || !ownerId) return;

    this.clearSessionsWatch();

    const self = this;
    this._sessionsWatcher = db.collection(MSG_COLLECTION)
      .where({ tid, ownerId })
      .orderBy('createTime', 'desc')
      .watch({
        onChange(snapshot) {
          const docs = (snapshot && snapshot.docs) || [];
          const list = self.buildSessionListFromDocs(docs, ownerId);
          self.setData({ list, isLoading: false });
        },
        onError(err) {
          console.error('聊天会话列表 watch error', err);
        }
      });
  },

  clearSessionsWatch() {
    if (this._sessionsWatcher && this._sessionsWatcher.close) {
      this._sessionsWatcher.close();
    }
    this._sessionsWatcher = null;
  }
});
