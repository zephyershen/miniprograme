// 使用云开发数据库 messages 集合做聊天记录
const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const TASK_COLLECTION = 'tasks';
const USER_COLLECTION = 'userInfo';

Page({
  data: {
    tid: '',          // 任务 ID
    ownerId: '',      // 任务发布人 ID
    peerUserId: '',   // 和发布人单聊的"另一方"用户 ID
    msgs: [],
    text: '',
    scrollTop: 0,     // 用 scrollTop 代替 scroll-into-view，避免初始滚动动画
    scrollWithAnimation: false, // 控制滚动动画，避免初始加载时的抖动
    isLoading: true,
    contentReady: false, // 内容准备好后才显示，防止看到滚动过程
    me: null, // 当前登录用户（从本地缓存读取）
    peerDisplayName: '', // 对方显示名称（昵称或脱敏姓名）
    keyboardHeight: 0 // 键盘高度
  },

  // 用于防抖的滚动定时器
  _scrollTimer: null,
  // 标记用户是否正在手动滚动
  _userScrolling: false,

  // 姓名脱敏处理：2个字显示"姓*"，3个字及以上显示"姓*尾"
  _maskName(name) {
    if (!name) return '';
    const len = name.length;
    if (len <= 1) return name;
    if (len === 2) {
      return name[0] + '*';
    }
    // 3个字及以上：保留首尾，中间全用*
    const first = name[0];
    const last = name[len - 1];
    const middleStars = '*'.repeat(len - 2);
    return first + middleStars + last;
  },

  // 获取对方显示名称：优先昵称，否则脱敏姓名
  _getPeerDisplayName(user) {
    if (!user) return '对方';
    if (user.nickname && user.nickname.trim()) {
      return user.nickname.trim();
    }
    if (user.name && user.name.trim()) {
      return this._maskName(user.name.trim());
    }
    return '对方';
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
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    // 如果从其他入口（例如未来的列表页）带了 peerUserId，就直接使用
    const peerFromQuery = (q && q.peerUserId) || '';

    this.setData({ tid, me, isLoading: true });

    // 监听键盘高度变化
    const self = this;
    wx.onKeyboardHeightChange(function(res) {
      self.setData({ keyboardHeight: res.height || 0 });
      // 键盘弹出时滚动到底部
      if (res.height > 0) {
        setTimeout(function() {
          self._scrollToBottom();
        }, 100);
      }
    });

    // 先根据任务 ID 查询任务详情，拿到发布人 ownerId，再决定 peerUserId
    this._initRoomWithTask(tid, me, peerFromQuery);
  },

  onUnload() {
    // 页面销毁时关闭监听，防止内存泄露
    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }
    this._watcher = null;
    // 清理滚动定时器
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
    // 取消键盘监听
    wx.offKeyboardHeightChange();
  },

  // 监听用户滚动，设置防抖标记
  onScroll() {
    const self = this;
    this._userScrolling = true;
    // 清除之前的定时器
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
    }
    // 用户停止滚动 1.5 秒后，重置标记，允许自动滚动
    this._scrollTimer = setTimeout(function() {
      self._userScrolling = false;
    }, 1500);
  },

  // 安全地滚动到底部（不打断用户操作）
  _scrollToBottom() {
    if (this._userScrolling) {
      // 用户正在滚动，不强制跳转
      return;
    }
    // 设置一个很大的值，让 scroll-view 滚动到底部
    this.setData({
      scrollTop: 999999,
      scrollWithAnimation: true
    });
  },

  // 加载对方用户信息（显示头部昵称/脱敏姓名）
  _loadPeerUserInfo(targetUserId) {
    if (!targetUserId) {
      this.setData({ peerDisplayName: '对方' });
      return;
    }
    const self = this;
    // 用户的 id 实际上是数据库记录的 _id，用 doc() 直接查询
    db.collection(USER_COLLECTION)
      .doc(targetUserId)
      .get({
        success(res) {
          const user = (res && res.data) || null;
          const displayName = self._getPeerDisplayName(user);
          self.setData({ peerDisplayName: displayName });
        },
        fail(err) {
          console.error('加载对方用户信息失败', err);
          self.setData({ peerDisplayName: '对方' });
        }
      });
  },

  // 根据任务信息初始化当前聊天"房间"（谁和谁在聊）
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

        // 确定对方显示名称
        // 如果当前用户是住户，对方是业主：直接从 task 中获取 ownerNickname/ownerName
        // 如果当前用户是业主，对方是住户：需要从 userInfo 查询
        if (meId !== ownerId) {
          // 当前是住户，对方是业主，直接用 task 中的数据
          const ownerInfo = {
            nickname: task.ownerNickname || '',
            name: task.ownerName || ''
          };
          const displayName = self._getPeerDisplayName(ownerInfo);
          self.setData({ peerDisplayName: displayName });
        } else {
          // 当前是业主，对方是住户，需要查询
          self._loadPeerUserInfo(peerUserId);
        }

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

        // 直接开启实时监听，由监听的首帧数据负责渲染历史记录
        self.openWatch({ tid, ownerId, peerUserId });
      },
      fail(err) {
        console.error('加载任务信息失败，无法建立聊天房间', err);
        wx.showToast({ title: '任务不存在或已被删除', icon: 'none' });
        self.setData({ isLoading: false });
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
          const oldMsgsLen = self.data.msgs.length;
          const msgs = self._decorateMsgs(docs, self.data.me);
          const last = msgs[msgs.length - 1];

          // 是否为首次加载（用于控制 loading 和首屏展示）
          const firstLoad = !self.data.contentReady;

          // 基础更新：消息列表 + 关闭 loading + 标记内容已就绪
          const nextData = {
            msgs,
            isLoading: false,
            contentReady: true
          };

          // 首次进入时，直接把滚动位置设置到底部，且不做动画，
          // 保证用户一进来就看到最新消息，而不是从顶部滚动下来
          if (firstLoad && last && !self._userScrolling) {
            nextData.scrollTop = 999999;
            nextData.scrollWithAnimation = false;
          }

          self.setData(nextData);

          // 非首次加载时，如果有新消息，再用带动画的滚动到底部
          if (!firstLoad && msgs.length > oldMsgsLen && last) {
            self._scrollToBottom();
          }

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

  // 底部“+”按钮：弹出操作菜单，选择拍照或从相册选择
  openMediaActions() {
    const self = this;
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success(res) {
        const idx = res.tapIndex;
        if (idx === 0) {
          // 只使用相机
          self.chooseImage('camera');
        } else if (idx === 1) {
          // 只使用相册
          self.chooseImage('album');
        }
      }
    });
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
  // sourceType 可选：'camera' | 'album' | 其他/不传：相册 + 相机
  chooseImage(sourceType) {
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

    // 根据来源类型决定调用参数
    let sourceTypes = ['album', 'camera'];
    if (sourceType === 'camera') {
      sourceTypes = ['camera'];
    } else if (sourceType === 'album') {
      sourceTypes = ['album'];
    }

    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: sourceTypes,
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
