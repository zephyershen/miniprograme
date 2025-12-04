// 使用云开发数据库 messages 集合做聊天记录
const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const TASK_COLLECTION = 'tasks';

Page({
  data: {
    tid: '',          // 任务 ID
    ownerId: '',      // 任务发布人 ID
    peerUserId: '',   // 和发布人单聊的“另一方”用户 ID
    msgs: [],
    text: '',
    toView: '',
    isLoading: true,
    me: null // 当前登录用户（从本地缓存读取）
  },

  onLoad(q) {
    const tid = (q && q.tid) || '';
    if (!tid) {
      wx.showToast({ title: '缺少任务信息', icon: 'none' });
      return;
    }

    // 从本地缓存里读取当前用户（在欢迎页登录时已写入）
    const me = wx.getStorageSync('hyyc_user') || null;
    if (!me || !me.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/auth/welcome/index' });
      return;
    }

    // 如果从其他入口（例如未来的列表页）带了 peerUserId，就直接使用
    const peerFromQuery = (q && q.peerUserId) || '';

    this.setData({ tid, me, isLoading: true });

    // 先根据任务 ID 查询任务详情，拿到发布人 ownerId，再决定 peerUserId
    this._initRoomWithTask(tid, me, peerFromQuery);
  },

  onUnload() {
    // 页面销毁时关闭监听，防止内存泄露
    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }
    this._watcher = null;
  },

  // 根据任务信息初始化当前聊天“房间”（谁和谁在聊）
  _initRoomWithTask(tid, me, peerFromQuery) {
    const self = this;
    db.collection(TASK_COLLECTION).doc(tid).get({
      success(res) {
        const task = (res && res.data) || {};
        const ownerId = task.ownerId || '';

        if (!ownerId) {
          console.error('任务缺少 ownerId 字段，无法建立单聊房间', task);
          wx.showToast({ title: '任务数据异常', icon: 'none' });
          self.setData({ isLoading: false });
          return;
        }

        const meId = me.id || '';
        let peerUserId = '';

        if (peerFromQuery) {
          // 如果入口已经明确指定 peerUserId（例如业主从列表点进来）
          peerUserId = peerFromQuery;
        } else if (meId === ownerId) {
          // 当前版本暂不支持“业主直接从任务详情页打开所有住户单聊”，需要带上 peerUserId
          wx.showToast({ title: '请从指定住户入口进入聊天', icon: 'none' });
          self.setData({ isLoading: false });
          return;
        } else {
          // 普通用户：和任务发布人一对一单聊
          peerUserId = meId;
        }

        self.setData({ ownerId, peerUserId });

        // 进入聊天页时，根据当前身份标记已读：
        // - 如果是任务发布者（owner），标记 readByOwner = true
        // - 如果是住户（peerUserId），标记 readByPeer = true
        if (meId === ownerId) {
          wx.cloud.callFunction({
            name: 'markMessagesReadByOwner',
            data: { tid, ownerId, peerUserId }
          }).catch(err => {
            console.error('调用 markMessagesReadByOwner 失败', err);
          });
        } else if (meId === peerUserId) {
          wx.cloud.callFunction({
            name: 'markMessagesReadByPeer',
            data: { tid, ownerId, peerUserId }
          }).catch(err => {
            console.error('调用 markMessagesReadByPeer 失败', err);
          });
        }

        // 先拉一次历史消息，再开启实时监听
        self.loadHistory({ tid, ownerId, peerUserId }, me);
        self.openWatch({ tid, ownerId, peerUserId });
      },
      fail(err) {
        console.error('加载任务信息失败，无法建立聊天房间', err);
        wx.showToast({ title: '任务不存在或已被删除', icon: 'none' });
        self.setData({ isLoading: false });
      }
    });
  },

  // 一次性加载当前任务 + 用户组合的历史消息
  loadHistory(room, me) {
    const { tid, ownerId, peerUserId } = room || {};
    if (!tid || !ownerId || !peerUserId) {
      this.setData({ isLoading: false });
      return;
    }

    const self = this;
    db.collection(MSG_COLLECTION)
      .where({ tid, ownerId, peerUserId })
      .orderBy('createTime', 'asc')
      .limit(100)
      .get({
        success(res) {
          const docs = (res && res.data) || [];
          const msgs = self._decorateMsgs(docs, me);
          const last = msgs[msgs.length - 1];
          self.setData({
            msgs,
            isLoading: false,
            toView: last ? 'm' + last.id : ''
          });
        },
        fail(err) {
          console.error('loadHistory error', err);
          self.setData({ isLoading: false, msgs: [] });
          wx.showToast({ title: '加载聊天失败', icon: 'none' });
        }
      });
  },

  // 开启实时监听：messages 集合里当前房间（tid + ownerId + peerUserId）的所有变更
  openWatch(room) {
    const { tid, ownerId, peerUserId } = room || {};
    if (!tid || !ownerId || !peerUserId) {
      return;
    }

    const self = this;
    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }
    this._watcher = db.collection(MSG_COLLECTION)
      .where({ tid, ownerId, peerUserId })
      .orderBy('createTime', 'asc')
      .watch({
        onChange(snapshot) {
          const docs = (snapshot && snapshot.docs) || [];
          const msgs = self._decorateMsgs(docs, self.data.me);
          const last = msgs[msgs.length - 1];
          self.setData({
            msgs,
            toView: last ? 'm' + last.id : self.data.toView
          });

          // 实时监听到新消息时，根据当前身份再次标记为“已读”：
          // - 如果当前是业主：标记 readByOwner = true
          // - 如果当前是住户：标记 readByPeer = true
          const me = self.data.me || {};
          const meId = me.id || '';
          if (!meId) return;
          if (meId === ownerId) {
            wx.cloud.callFunction({
              name: 'markMessagesReadByOwner',
              data: { tid, ownerId, peerUserId }
            }).catch(err => {
              console.error('watch 调用 markMessagesReadByOwner 失败', err);
            });
          } else if (meId === peerUserId) {
            wx.cloud.callFunction({
              name: 'markMessagesReadByPeer',
              data: { tid, ownerId, peerUserId }
            }).catch(err => {
              console.error('watch 调用 markMessagesReadByPeer 失败', err);
            });
          }
        },
        onError(err) {
          console.error('chat watch error', err);
        }
      });
  },

  // 把云数据库里的原始记录，转换成页面需要的字段
  _decorateMsgs(docs, me) {
    const userId = (me && me.id) || '';
    return (docs || []).map(doc => {
      const id = doc._id || doc.id;
      const fromUserId = doc.fromUserId || '';
      return {
        id: id,
        text: doc.text || '',
        type: doc.type || 'text',
        imageUrl: doc.imageUrl || '',
        mine: userId && fromUserId === userId
      };
    });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  // 发送文本消息：写入云数据库 messages 集合
  send() {
    const text = (this.data.text || '').trim();
    if (!text) return;

    const me = this.data.me || {};
    const userId = me.id || '';
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const tid = this.data.tid;
    if (!tid) {
      wx.showToast({ title: '缺少任务信息', icon: 'none' });
      return;
    }

    const ownerId = this.data.ownerId || '';
    const peerUserId = this.data.peerUserId || '';
    if (!ownerId || !peerUserId) {
      wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
      return;
    }

    this.setData({ text: '' });

    const isOwnerSender = userId === ownerId;
    const isPeerSender = userId === peerUserId;

    db.collection(MSG_COLLECTION)
      .add({
        data: {
          tid,
          ownerId,
          peerUserId,
          fromUserId: userId,
          fromNickname: me.nickname || me.name || '',
          type: 'text',
          text,
          createTime: db.serverDate(),
          // 任务发布者自己发出的消息视为已读，住户发给发布者的消息默认未读
          readByOwner: isOwnerSender ? true : false,
          // 住户自己发出的消息视为已读，业主发给住户的消息默认未读
          readByPeer: isPeerSender ? true : false
        }
      })
      .catch(err => {
        console.error('send message error', err);
        wx.showToast({ title: '发送失败', icon: 'none' });
      });
  },

  // 选择并发送图片消息：先上传到云存储，再写入 messages 集合
  chooseImage() {
    const me = this.data.me || {};
    const userId = me.id || '';
    if (!userId) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const tid = this.data.tid;
    if (!tid) {
      wx.showToast({ title: '缺少任务信息', icon: 'none' });
      return;
    }

    const ownerId = this.data.ownerId || '';
    const peerUserId = this.data.peerUserId || '';
    if (!ownerId || !peerUserId) {
      wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
      return;
    }

        const self = this;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        const paths = res.tempFilePaths || [];
        if (!paths.length) return;
        const filePath = paths[0];
        const cloudPath = 'chat-images/' + (userId || 'anonymous') + '/' + Date.now() + '.jpg';

        wx.cloud.uploadFile({
          cloudPath,
          filePath,
          success(upRes) {
            const fileID = upRes.fileID || '';
            if (!fileID) return;
            const isOwnerSender = userId === ownerId;
            const isPeerSender = userId === peerUserId;
            db.collection(MSG_COLLECTION)
              .add({
                data: {
                  tid,
                  ownerId,
                  peerUserId,
                  fromUserId: userId,
                  fromNickname: me.nickname || me.name || '',
                  type: 'image',
                  imageUrl: fileID,
                  createTime: db.serverDate(),
                  readByOwner: isOwnerSender ? true : false,
                  readByPeer: isPeerSender ? true : false
                }
              })
              .catch(err => {
                console.error('send image message error', err);
                wx.showToast({ title: '发送图片失败', icon: 'none' });
              });
          },
          fail(err) {
            console.error('upload image error', err);
            wx.showToast({ title: '上传失败', icon: 'none' });
          }
        });
      }
    });
  }
});
