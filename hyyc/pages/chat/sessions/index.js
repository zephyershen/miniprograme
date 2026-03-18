const { formatDateTime } = require('../../../utils/format');
const { getStoredUser } = require('../../../utils/userIdentity');

// 使用云开发数据库 messages 集合作为聊天数据源
const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const SESSION_MESSAGE_FIELDS = {
  peerUserId: true,
  fromUserId: true,
  fromNickname: true,
  type: true,
  text: true,
  readByOwner: true,
  createTime: true,
};

function buildTaskSessionPreview(doc = {}) {
  const type = String(doc && doc.type || 'text').trim();
  if (type === 'image') return '[图片]';
  if (type === 'task_cancel_request') return '申请取消任务';
  if (type === 'task_release_request') return '申请释放任务';
  if (type === 'contact_request') return '申请查看手机号';
  return String(doc && doc.text || '').trim();
}

function buildSessionListSignature(list = []) {
  return (Array.isArray(list) ? list : []).map((item) => (
    [
      item && item.peerUserId,
      item && item.peerName,
      item && item.lastType,
      item && item.lastText,
      item && item.lastTs,
      item && item.unreadCount,
    ].join('::')
  )).join('||');
}

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

    const me = getStoredUser();
    if (!me || !me.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/welcome/index' });
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
      .field(SESSION_MESSAGE_FIELDS)
      .orderBy('createTime', 'desc')
      .limit(500)
      .get({
        success: (res) => {
          const docs = (res && res.data) || [];
          this._applySessionList(this.buildSessionListFromDocs(docs, ownerId), false);
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

      // 获取消息的时间戳（用于比较哪条是最新的）
      let ts = 0;
      if (doc.createTime instanceof Date) {
        ts = doc.createTime.getTime();
      } else if (typeof doc.createTime === 'number') {
        ts = doc.createTime;
      } else if (doc.createTime && doc.createTime.$date) {
        // 云数据库服务器时间格式
        ts = doc.createTime.$date;
      }
      const lastTimeText = ts ? formatDateTime(ts) : '';

      const lastText = buildTaskSessionPreview(doc);

      // 如果消息是住户发送的，记录住户昵称
      const isPeerSent = doc.fromUserId === peerUserId;
      const peerNameFromDoc = isPeerSent && doc.fromNickname ? doc.fromNickname : '';

      if (!map[peerUserId]) {
        // 首次遇到该住户，初始化会话
        map[peerUserId] = {
          peerUserId,
          peerName: peerNameFromDoc || '住户',
          lastType: doc.type || 'text',
          lastText,
          lastTimeText,
          lastTs: ts, // 记录时间戳，用于后续比较
          unreadCount: 0
        };
      } else {
        // 已有该住户的会话，更新最新消息（比较时间戳）
        if (ts > map[peerUserId].lastTs) {
          map[peerUserId].lastType = doc.type || 'text';
          map[peerUserId].lastText = lastText;
          map[peerUserId].lastTimeText = lastTimeText;
          map[peerUserId].lastTs = ts;
        }
        // 如果还没有住户昵称，尝试从住户发送的消息中获取
        if (map[peerUserId].peerName === '住户' && peerNameFromDoc) {
          map[peerUserId].peerName = peerNameFromDoc;
        }
      }

      // 统计未读：来自住户，且 readByOwner !== true
      if (doc.fromUserId && doc.fromUserId !== ownerId && doc.readByOwner !== true) {
        map[peerUserId].unreadCount += 1;
      }
    });

    // 转为数组并按最新消息时间降序排序
    return Object.keys(map)
      .map(k => map[k])
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  },
  _applySessionList(list = [], isLoading = false) {
    const nextSignature = buildSessionListSignature(list);
    if (this._sessionListSignature === nextSignature && this.data.isLoading === !!isLoading) {
      return;
    }
    this._sessionListSignature = nextSignature;
    this.setData({ list, isLoading: !!isLoading });
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
      .field(SESSION_MESSAGE_FIELDS)
      .orderBy('createTime', 'desc')
      .watch({
        onChange(snapshot) {
          const docs = (snapshot && snapshot.docs) || [];
          self._applySessionList(self.buildSessionListFromDocs(docs, ownerId), false);
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
