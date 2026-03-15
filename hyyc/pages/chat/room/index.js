const { resolveAvatarURL, saveAvatarTempURLMap } = require('../../../utils/avatarCache');

// 使用云开发数据库 messages 集合做聊天记录
const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const TASK_COLLECTION = 'tasks';
const TEMP_URL_BATCH_SIZE = 20;
const REFUND_SYNC_INTERVAL_MS = 3000;

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function isRefundAlreadyHandledMsg(msg = '') {
  const text = pickStr(msg);
  return text.includes('申请退款金额大于可退款余额');
}

function resolveTaskCancelState(task = {}) {
  const t = task && typeof task === 'object' ? task : {};
  const pay = t.pay && typeof t.pay === 'object' ? t.pay : {};
  const cancelRequest = t.cancelRequest && typeof t.cancelRequest === 'object' ? t.cancelRequest : {};
  const refund = (pay.refund && typeof pay.refund === 'object')
    ? pay.refund
    : ((cancelRequest.refund && typeof cancelRequest.refund === 'object') ? cancelRequest.refund : {});
  const rawTaskStatus = pickStr(t.status);
  const rawPayStatus = pickStr(pay.status);
  let effectiveCancelStatus = pickStr(cancelRequest.status);
  const hasApprovalMarker = !!(
    cancelRequest.approvedAt
    || pickStr(cancelRequest.approvedByUserId, cancelRequest.approvedByOpenid, cancelRequest.approvedByName)
  );
  const refundStatus = pickStr(refund.status);
  const hasRefundRequest = !!pickStr(refund.reqSeqId, refund.reqDate);

  if (effectiveCancelStatus === 'pending' && hasApprovalMarker) {
    if (rawPayStatus === 'refunded' || refundStatus === 'success') {
      effectiveCancelStatus = 'approved';
    } else if (rawPayStatus === 'refund_pending' || refundStatus === 'processing' || refundStatus === 'requested' || hasRefundRequest) {
      effectiveCancelStatus = 'refund_pending';
    }
  }

  let effectiveTaskStatus = rawTaskStatus;
  let effectivePayStatus = rawPayStatus;
  if (effectiveCancelStatus === 'approved') {
    effectiveTaskStatus = 'cancelled';
    effectivePayStatus = effectivePayStatus || 'refunded';
  } else if (effectiveCancelStatus === 'refund_pending') {
    effectiveTaskStatus = 'cancelled';
    if (effectivePayStatus !== 'refunded') effectivePayStatus = 'refund_pending';
  }

  return {
    cancelRequest,
    effectiveCancelStatus,
    effectivePayStatus,
    effectiveTaskStatus,
  };
}

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
    meProfile: null,
    peerProfile: null,
    peerRole: '',
    keyboardHeight: 0, // 键盘高度
    taskInfo: null,
    canRequestTaskCancel: false,
    hasPendingTaskCancel: false,
    canApproveTaskCancel: false,
    pendingTaskCancelRequestId: '',
    approveTaskCancelSubmitting: false,
    localResolvedTaskCancelRequestId: '',
    canApproveContactRequest: false,
    pendingContactRequestId: '',
    approveContactRequestSubmitting: false,
    localResolvedContactRequestId: ''
  },

  // 用于防抖的滚动定时器
  _scrollTimer: null,
  // 标记用户是否正在手动滚动
  _userScrolling: false,
  // 防止重复触发“同意取消”
  _approvingTaskCancel: false,
  _approvingContactRequest: false,
  _refundSyncing: false,

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

  _isCloudFileID(v = '') {
    return String(v || '').indexOf('cloud://') === 0;
  },

  async _getTempFileURLMap(fileIDs = []) {
    const raw = Array.isArray(fileIDs) ? fileIDs : [];
    const uniq = [];
    const seen = {};
    raw.forEach((id) => {
      const fileID = String(id || '');
      if (!fileID || !this._isCloudFileID(fileID) || seen[fileID]) return;
      seen[fileID] = true;
      uniq.push(fileID);
    });
    if (!uniq.length) return {};

    const map = {};
    for (let i = 0; i < uniq.length; i += TEMP_URL_BATCH_SIZE) {
      const res = await wx.cloud.getTempFileURL({
        fileList: uniq.slice(i, i + TEMP_URL_BATCH_SIZE).map((fileID) => ({
          fileID,
          maxAge: 60 * 30,
        }))
      });
      const list = (res && res.fileList) || [];
      list.forEach((item) => {
        if (item && item.fileID && item.tempFileURL) {
          map[item.fileID] = item.tempFileURL;
        }
      });
    }
    saveAvatarTempURLMap(map, 60 * 30);
    return map;
  },

  async _fetchPublicProfile(openid = '') {
    const targetOpenid = pickStr(openid);
    if (!targetOpenid) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserPublicProfile',
        data: { openid: targetOpenid }
      });
      const result = (res && res.result) || {};
      return result && result.ok ? (result.profile || null) : null;
    } catch (err) {
      console.warn('获取公开资料失败', err);
      return null;
    }
  },

  _buildTaskParticipantSnapshot(task = {}, role = '', me = {}) {
    const isOwner = role === 'owner';
    const fallbackName = isOwner ? '发布者' : '接单人';
    const cached = me && typeof me === 'object' ? me : {};
    const fromTask = {
      role,
      userId: isOwner ? pickStr(task.ownerId) : pickStr(task.workerId),
      openid: isOwner ? pickStr(task._openid) : pickStr(task.workerOpenid, task.worker_openid),
      nickname: isOwner ? pickStr(task.ownerNickname) : pickStr(task.workerNickname),
      name: isOwner ? pickStr(task.ownerName) : pickStr(task.workerName),
      avatarFileID: isOwner
        ? pickStr(task.ownerAvatarFileID, task.ownerAvatarUrl)
        : pickStr(task.workerAvatarFileID, task.workerAvatarUrl),
    };

    if (pickStr(cached.id) && pickStr(cached.id) === fromTask.userId) {
      fromTask.nickname = pickStr(cached.nickname, fromTask.nickname);
      fromTask.name = pickStr(cached.name, fromTask.name);
      fromTask.avatarFileID = pickStr(cached.avatarFileID, cached.avatarUrl, fromTask.avatarFileID);
      fromTask.openid = pickStr(cached._openid, cached.openid, cached.openId, fromTask.openid);
    }

    fromTask.avatarUrl = resolveAvatarURL(fromTask.avatarFileID, cached.avatarUrl);
    fromTask.displayName = this._getPeerDisplayName(fromTask) || fallbackName;
    return fromTask;
  },

  async _hydrateParticipantAvatarFast(meBase = {}, peerBase = {}) {
    const meAvatarFileID = pickStr(meBase.avatarFileID);
    const peerAvatarFileID = pickStr(peerBase.avatarFileID);
    const fileIDs = [];

    if (meAvatarFileID && this._isCloudFileID(meAvatarFileID) && !pickStr(meBase.avatarUrl)) {
      fileIDs.push(meAvatarFileID);
    }
    if (peerAvatarFileID && this._isCloudFileID(peerAvatarFileID) && !pickStr(peerBase.avatarUrl)) {
      fileIDs.push(peerAvatarFileID);
    }
    if (!fileIDs.length) return;

    try {
      const avatarMap = await this._getTempFileURLMap(fileIDs);
      const patch = {};
      if (meAvatarFileID && avatarMap[meAvatarFileID]) {
        patch['meProfile.avatarUrl'] = avatarMap[meAvatarFileID];
      }
      if (peerAvatarFileID && avatarMap[peerAvatarFileID]) {
        patch['peerProfile.avatarUrl'] = avatarMap[peerAvatarFileID];
      }
      if (Object.keys(patch).length) {
        this.setData(patch);
      }
    } catch (err) {
      console.warn('快速加载聊天头像失败', err);
    }
  },

  async _hydrateParticipantProfile(baseProfile = {}) {
    const base = baseProfile && typeof baseProfile === 'object' ? { ...baseProfile } : {};
    const publicProfile = await this._fetchPublicProfile(base.openid);
    const merged = {
      ...base,
      ...(publicProfile || {}),
    };
    const displayName = this._getPeerDisplayName(merged) || pickStr(base.displayName, '对方');
    const avatarSource = pickStr(merged.avatarFileID, merged.avatarUrl, base.avatarFileID, base.avatarUrl);
    let avatarUrl = resolveAvatarURL(avatarSource, merged.avatarUrl, base.avatarUrl);
    if (!avatarUrl && avatarSource && this._isCloudFileID(avatarSource)) {
      try {
        const avatarMap = await this._getTempFileURLMap([avatarSource]);
        avatarUrl = pickStr(avatarMap[avatarSource], avatarSource);
      } catch (err) {
        console.warn('加载聊天头像失败', err);
      }
    }
    return {
      ...merged,
      displayName,
      avatarUrl: avatarUrl && !this._isCloudFileID(avatarUrl) ? avatarUrl : '',
    };
  },

  _initParticipants(task = {}) {
    const me = this.data.me || {};
    const meId = pickStr(me.id);
    const ownerId = pickStr(task.ownerId);
    const peerRole = meId && meId === ownerId ? 'worker' : 'owner';
    const meRole = peerRole === 'worker' ? 'owner' : 'worker';
    const meBase = this._buildTaskParticipantSnapshot(task, meRole, me);
    const peerBase = this._buildTaskParticipantSnapshot(task, peerRole, {});

    this.setData({
      peerRole,
      meProfile: meBase,
      peerProfile: peerBase,
      peerDisplayName: pickStr(peerBase.displayName, '对方'),
    });
    this._hydrateParticipantAvatarFast(meBase, peerBase);

    Promise.all([
      this._hydrateParticipantProfile(meBase),
      this._hydrateParticipantProfile(peerBase),
    ]).then(([meProfile, peerProfile]) => {
      this.setData({
        meProfile,
        peerProfile,
        peerDisplayName: pickStr(peerProfile && peerProfile.displayName, peerBase.displayName, '对方'),
      });
    }).catch((err) => {
      console.warn('初始化聊天参与方资料失败', err);
    });
  },

  _syncTaskState(task) {
    const t = task && typeof task === 'object' ? task : {};
    const me = this.data.me || {};
    const meId = pickStr(me.id);
    const ownerId = pickStr(t.ownerId);
    const workerId = pickStr(t.workerId);
    const resolvedCancelState = resolveTaskCancelState(t);
    const statusRaw = pickStr(resolvedCancelState.effectiveTaskStatus);
    const payStatus = pickStr(resolvedCancelState.effectivePayStatus);
    const cancelRequest = resolvedCancelState.cancelRequest;
    const requestId = pickStr(cancelRequest.requestId);
    const cancelStatus = pickStr(resolvedCancelState.effectiveCancelStatus);
    const contactRequest = t.contactRequest && typeof t.contactRequest === 'object' ? t.contactRequest : {};
    const contactRequestId = pickStr(contactRequest.requestId);
    const rawContactStatus = pickStr(contactRequest.status);
    const localResolvedTaskCancelRequestId = pickStr(this.data.localResolvedTaskCancelRequestId);
    const localResolvedContactRequestId = pickStr(this.data.localResolvedContactRequestId);
    const locallyResolved = !!(requestId && requestId === localResolvedTaskCancelRequestId);
    const locallyResolvedContact = !!(contactRequestId && contactRequestId === localResolvedContactRequestId);
    const effectiveCancelStatus = locallyResolved && cancelStatus === 'pending' ? 'approved' : cancelStatus;
    const effectiveContactStatus = locallyResolvedContact && rawContactStatus === 'pending' ? 'approved' : rawContactStatus;
    const syncedResolved = locallyResolved && effectiveCancelStatus !== 'pending';
    const syncedResolvedContact = locallyResolvedContact && effectiveContactStatus !== 'pending';
    const nextCancelRequest = {
      ...cancelRequest,
      ...(effectiveCancelStatus ? { status: effectiveCancelStatus } : {}),
    };
    const nextContactRequest = {
      ...contactRequest,
      ...(effectiveContactStatus ? { status: effectiveContactStatus } : {}),
    };
    const canRequestTaskCancel = meId
      && meId === ownerId
      && (statusRaw === 'accepted' || statusRaw === 'submitted')
      && !!workerId
      && effectiveCancelStatus !== 'pending';
    const canApproveTaskCancel = meId
      && meId === workerId
      && (statusRaw === 'accepted' || statusRaw === 'submitted')
      && effectiveCancelStatus === 'pending'
      && !!requestId;
    const canApproveContactRequest = meId
      && effectiveContactStatus === 'pending'
      && !!contactRequestId
      && ((meId === ownerId && pickStr(contactRequest.targetRole) === 'owner')
        || (meId === workerId && pickStr(contactRequest.targetRole) === 'worker'));

    this.setData({
      taskInfo: {
        id: pickStr(t._id, this.data.tid),
        title: pickStr(t.title, t.desc, '任务'),
        amount: roundMoney(t.amount),
        statusRaw: statusRaw,
        payStatus,
        ownerId,
        workerId,
        cancelRequest: nextCancelRequest,
        contactRequest: nextContactRequest,
      },
      canRequestTaskCancel,
      hasPendingTaskCancel: effectiveCancelStatus === 'pending',
      canApproveTaskCancel,
      pendingTaskCancelRequestId: requestId,
      localResolvedTaskCancelRequestId: syncedResolved ? '' : localResolvedTaskCancelRequestId,
      approveTaskCancelSubmitting: syncedResolved ? false : this.data.approveTaskCancelSubmitting,
      canApproveContactRequest,
      pendingContactRequestId: contactRequestId,
      localResolvedContactRequestId: syncedResolvedContact ? '' : localResolvedContactRequestId,
      approveContactRequestSubmitting: syncedResolvedContact ? false : this.data.approveContactRequestSubmitting,
    });

    if (payStatus === 'refund_pending') {
      this._maybeSyncPendingRefund(t);
    } else {
      this._clearRefundSyncTimer();
    }
  },

  _openTaskWatch(tid = '') {
    const taskId = pickStr(tid, this.data.tid);
    if (!taskId) return;
    if (this._taskWatcher && this._taskWatcher.close) {
      this._taskWatcher.close();
    }
    this._taskWatcher = db.collection(TASK_COLLECTION).doc(taskId).watch({
      onChange: (snapshot) => {
        const docs = (snapshot && snapshot.docs) || [];
        const task = docs[0] || null;
        if (!task) return;
        this._syncTaskState(task);
      },
      onError: (err) => {
        console.error('chat task watch error', err);
      }
    });
  },

  _clearRefundSyncTimer() {
    if (this._refundSyncTimer) {
      clearInterval(this._refundSyncTimer);
      this._refundSyncTimer = null;
    }
  },

  _runRefundSync(taskId = '') {
    const currentTaskId = pickStr(taskId, this.data.tid);
    if (!currentTaskId || this._refundSyncing) return;
    const taskInfo = this.data.taskInfo && typeof this.data.taskInfo === 'object' ? this.data.taskInfo : {};
    if (pickStr(taskInfo.payStatus) !== 'refund_pending') {
      this._clearRefundSyncTimer();
      return;
    }

    this._refundSyncing = true;
    wx.cloud.callFunction({
      name: 'taskCancelFlow',
      data: {
        action: 'sync_refund_status',
        taskId: currentTaskId,
      }
    }).then((res) => {
      const ret = (res && res.result) || {};
      if (ret && ret.ok && (ret.already || (ret.refund && pickStr(ret.refund.status) === 'success'))) {
        this._reloadTaskState();
        this._clearRefundSyncTimer();
      }
      if (ret && ret.ok === false && pickStr(ret.code) === 'MISSING_REFUND_META') {
        this._clearRefundSyncTimer();
      }
    }).catch((err) => {
      console.warn('聊天页同步退款状态失败', err);
    }).finally(() => {
      this._refundSyncing = false;
    });
  },

  _maybeSyncPendingRefund(task = {}) {
    const resolved = resolveTaskCancelState(task);
    if (pickStr(resolved.effectivePayStatus) !== 'refund_pending') return;
    const taskId = pickStr(task._id, this.data.tid);
    if (!taskId) return;
    if (!this._refundSyncTimer) {
      this._refundSyncTimer = setInterval(() => {
        this._runRefundSync(taskId);
      }, REFUND_SYNC_INTERVAL_MS);
    }
    this._runRefundSync(taskId);
  },

  _applyLocalTaskCancelResolved(requestId) {
    const normalizedRequestId = pickStr(requestId);
    if (!normalizedRequestId) return;
    const nextMsgs = (this.data.msgs || []).map((item) => {
      const taskCancel = item && item.taskCancel && typeof item.taskCancel === 'object' ? item.taskCancel : null;
      if (!taskCancel || pickStr(taskCancel.requestId) !== normalizedRequestId) return item;
      return {
        ...item,
        taskCancel: { ...taskCancel, status: 'approved' },
        taskCancelStatusText: '任务已取消',
        taskCancelStatusClass: 'task-cancel-card-status task-cancel-card-status-success',
      };
    });
    const currentTaskInfo = this.data.taskInfo && typeof this.data.taskInfo === 'object'
      ? this.data.taskInfo
      : null;
    const nextTaskInfo = currentTaskInfo ? {
      ...currentTaskInfo,
      statusRaw: 'cancelled',
      cancelRequest: {
        ...((currentTaskInfo.cancelRequest && typeof currentTaskInfo.cancelRequest === 'object')
          ? currentTaskInfo.cancelRequest
          : {}),
        requestId: normalizedRequestId,
        status: 'approved',
      }
    } : currentTaskInfo;

    this.setData({
      msgs: nextMsgs,
      taskInfo: nextTaskInfo,
      hasPendingTaskCancel: false,
      canApproveTaskCancel: false,
      approveTaskCancelSubmitting: false,
      localResolvedTaskCancelRequestId: normalizedRequestId,
    });
  },

  _applyLocalContactRequestResolved(requestId) {
    const normalizedRequestId = pickStr(requestId);
    if (!normalizedRequestId) return;
    const nextMsgs = (this.data.msgs || []).map((item) => {
      const contactRequest = item && item.contactRequest && typeof item.contactRequest === 'object' ? item.contactRequest : null;
      if (!contactRequest || pickStr(contactRequest.requestId) !== normalizedRequestId) return item;
      return {
        ...item,
        contactRequest: { ...contactRequest, status: 'approved' },
        contactRequestStatusText: '已同意查看',
        contactRequestStatusClass: 'task-cancel-card-status task-cancel-card-status-success',
      };
    });

    const currentTaskInfo = this.data.taskInfo && typeof this.data.taskInfo === 'object'
      ? this.data.taskInfo
      : null;
    const nextTaskInfo = currentTaskInfo ? {
      ...currentTaskInfo,
      contactRequest: {
        ...((currentTaskInfo.contactRequest && typeof currentTaskInfo.contactRequest === 'object')
          ? currentTaskInfo.contactRequest
          : {}),
        requestId: normalizedRequestId,
        status: 'approved',
      }
    } : currentTaskInfo;

    this.setData({
      msgs: nextMsgs,
      taskInfo: nextTaskInfo,
      canApproveContactRequest: false,
      approveContactRequestSubmitting: false,
      localResolvedContactRequestId: normalizedRequestId,
    });
  },

  _fetchTaskState() {
    const tid = this.data.tid || '';
    if (!tid) return Promise.reject(new Error('missing_tid'));
    return new Promise((resolve, reject) => {
      db.collection(TASK_COLLECTION).doc(tid).get({
        success: (res) => resolve((res && res.data) || {}),
        fail: reject,
      });
    });
  },

  _reloadTaskState() {
    this._fetchTaskState()
      .then((task) => {
        this._syncTaskState(task || {});
      })
      .catch((err) => {
        console.error('刷新任务状态失败', err);
      });
  },

  openPeerProfile() {
    const tid = pickStr(this.data.tid);
    const peerRole = pickStr(this.data.peerRole);
    if (!tid || !peerRole) {
      wx.showToast({ title: '对方资料暂不可用', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/user/profile/index?tid=${tid}&targetRole=${peerRole}`
    });
  },

  onBubbleAvatarTap() {
    this.openPeerProfile();
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
    if (this._taskWatcher && this._taskWatcher.close) {
      this._taskWatcher.close();
    }
    this._taskWatcher = null;
    this._clearRefundSyncTimer();
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

  // 根据任务信息初始化当前聊天"房间"（谁和谁在聊）
  _initRoomWithTask(tid, me, peerFromQuery) {
    const self = this;
    db.collection(TASK_COLLECTION).doc(tid).get({
      success(res) {
        const task = (res && res.data) || {};
        const ownerId = task.ownerId || '';
        const workerId = pickStr(task.workerId);

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
          if (!workerId) {
            wx.showToast({ title: '还没有接单人', icon: 'none' });
            self.setData({ isLoading: false });
            return;
          }
          peerUserId = workerId;
        } else {
          // 普通用户：和任务发布人一对一单聊
          peerUserId = meId;
        }

        self.setData({ ownerId, peerUserId });
        self._syncTaskState(task);
        self._initParticipants(task);
        self._openTaskWatch(tid);

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

          if (docs.some(doc => {
            const type = pickStr(doc && doc.type);
            return type === 'task_cancel_request' || type === 'contact_request';
          })) {
            self._reloadTaskState();
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
    const localResolvedTaskCancelRequestId = pickStr(this.data.localResolvedTaskCancelRequestId);
    const localResolvedContactRequestId = pickStr(this.data.localResolvedContactRequestId);
    const meProfile = this.data.meProfile && typeof this.data.meProfile === 'object' ? this.data.meProfile : {};
    const peerProfile = this.data.peerProfile && typeof this.data.peerProfile === 'object' ? this.data.peerProfile : {};
    const taskInfo = this.data.taskInfo && typeof this.data.taskInfo === 'object' ? this.data.taskInfo : {};
    const taskInfoCancel = taskInfo.cancelRequest && typeof taskInfo.cancelRequest === 'object' ? taskInfo.cancelRequest : {};
    const taskInfoCancelRequestId = pickStr(taskInfoCancel.requestId);
    const taskInfoCancelStatus = pickStr(taskInfoCancel.status);
    return (docs || []).map(doc => {
      const id = doc._id || doc.id;
      const fromUserId = doc.fromUserId || '';
      const mine = !!(userId && fromUserId === userId);
      const taskCancel = doc.taskCancel && typeof doc.taskCancel === 'object' ? doc.taskCancel : null;
      const contactRequest = doc.contactRequest && typeof doc.contactRequest === 'object' ? doc.contactRequest : null;
      const rawCancelStatus = pickStr(taskCancel && taskCancel.status);
      const cancelStatus = localResolvedTaskCancelRequestId
        && pickStr(taskCancel && taskCancel.requestId) === localResolvedTaskCancelRequestId
        && rawCancelStatus === 'pending'
        ? 'approved'
        : rawCancelStatus;
      const effectiveTaskCancelStatus = taskInfoCancelRequestId
        && taskInfoCancelRequestId === pickStr(taskCancel && taskCancel.requestId)
        && taskInfoCancelStatus
        ? taskInfoCancelStatus
        : cancelStatus;
      const rawContactStatus = pickStr(contactRequest && contactRequest.status);
      const contactStatus = localResolvedContactRequestId
        && pickStr(contactRequest && contactRequest.requestId) === localResolvedContactRequestId
        && rawContactStatus === 'pending'
        ? 'approved'
        : rawContactStatus;
      let taskCancelStatusText = '';
      let taskCancelStatusClass = 'task-cancel-card-status';
      if (effectiveTaskCancelStatus === 'approved') {
        taskCancelStatusText = '任务已取消';
        taskCancelStatusClass = 'task-cancel-card-status task-cancel-card-status-success';
      } else if (effectiveTaskCancelStatus === 'refund_pending') {
        taskCancelStatusText = '已同意取消，退款处理中';
        taskCancelStatusClass = 'task-cancel-card-status task-cancel-card-status-success';
      } else if (effectiveTaskCancelStatus === 'rejected') {
        taskCancelStatusText = '已拒绝';
      } else {
        taskCancelStatusText = '等待接单人同意';
      }
      let contactRequestStatusText = '';
      let contactRequestStatusClass = 'task-cancel-card-status';
      if (contactStatus === 'approved') {
        contactRequestStatusText = '已同意查看';
        contactRequestStatusClass = 'task-cancel-card-status task-cancel-card-status-success';
      } else if (contactStatus === 'rejected') {
        contactRequestStatusText = '已拒绝';
      } else {
        contactRequestStatusText = '等待对方同意';
      }
      const avatarUrl = mine ? pickStr(meProfile.avatarUrl) : pickStr(peerProfile.avatarUrl);
      return {
        id: id,
        text: doc.text || '',
        type: doc.type || 'text',
        imageUrl: doc.imageUrl || '',
        mine,
        avatarUrl,
        avatarClickable: !mine,
        taskCancel,
        taskCancelText: taskCancel ? '卖家申请取消任务。' : '',
        taskCancelStatusText,
        taskCancelStatusClass,
        taskCancelActionable: !!(
          taskCancel
          && effectiveTaskCancelStatus === 'pending'
          && userId
          && pickStr(taskCancel.approverUserId) === userId
        ),
        contactRequest,
        contactRequestText: contactRequest ? '申请查看对方手机号。' : '',
        contactRequestStatusText,
        contactRequestStatusClass,
        contactRequestActionable: !!(
          contactRequest
          && contactStatus === 'pending'
          && userId
          && pickStr(contactRequest.approverUserId) === userId
        ),
      };
    });
  },

  async requestTaskCancel() {
    if (!this.data.canRequestTaskCancel) {
      wx.showToast({ title: '当前任务暂不能发起取消', icon: 'none' });
      return;
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '发起取消申请',
        content: '发起后，需要接单人同意，系统才会执行原路退款。是否继续？',
        confirmText: '发起申请',
        cancelText: '再想想',
        success: (res) => resolve(!!(res && res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!ok) return;

    wx.showLoading({ title: '发起中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskCancelFlow',
        data: {
          action: 'request',
          taskId: this.data.tid,
        }
      });
      const ret = (res && res.result) || {};
      wx.hideLoading();
      if (!ret || ret.ok !== true) {
        wx.showToast({ title: (ret && ret.msg) || '发起失败', icon: 'none' });
        return;
      }
      this._reloadTaskState();
      wx.showToast({ title: '已发起', icon: 'success' });
    } catch (err) {
      console.error('发起取消申请失败', err);
      wx.hideLoading();
      wx.showToast({ title: '发起失败', icon: 'none' });
    }
  },

  async approveTaskCancel(e) {
    if (this._approvingTaskCancel) return;
    const requestId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId);
    if (!requestId) {
      wx.showToast({ title: '缺少申请信息', icon: 'none' });
      return;
    }
    this._approvingTaskCancel = true;
    this.setData({ approveTaskCancelSubmitting: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskCancelFlow',
        data: {
          action: 'approve',
          taskId: this.data.tid,
          requestId,
        }
      });
      const ret = (res && res.result) || {};
      wx.hideLoading();
      if (!ret || ret.ok !== true) {
        if (isRefundAlreadyHandledMsg(ret && ret.msg)) {
          this._applyLocalTaskCancelResolved(requestId);
          wx.showToast({ title: '任务已取消', icon: 'success' });
          return;
        }
        this.setData({ approveTaskCancelSubmitting: false });
        wx.showToast({ title: (ret && ret.msg) || '处理失败', icon: 'none' });
        return;
      }
      this._applyLocalTaskCancelResolved(requestId);
      this._reloadTaskState();
      wx.showToast({ title: '任务已取消', icon: 'success' });
    } catch (err) {
      console.error('同意取消失败', err);
      wx.hideLoading();
      const errMsg = String(err && err.errMsg ? err.errMsg : (err && err.message ? err.message : err || ''));
      const maybeTimedOut = errMsg.indexOf('timed out') > -1 || errMsg.indexOf('-504003') > -1;
      if (isRefundAlreadyHandledMsg(errMsg)) {
        this._applyLocalTaskCancelResolved(requestId);
        wx.showToast({ title: '任务已取消', icon: 'success' });
        return;
      }
      if (maybeTimedOut) {
        try {
          const latestTask = await this._fetchTaskState();
          this._syncTaskState(latestTask || {});
          const pay = latestTask && latestTask.pay && typeof latestTask.pay === 'object' ? latestTask.pay : {};
          const cancelRequest = latestTask && latestTask.cancelRequest && typeof latestTask.cancelRequest === 'object'
            ? latestTask.cancelRequest
            : {};
          const payStatus = pickStr(pay.status);
          const cancelStatus = pickStr(cancelRequest.status);
          const matchedRequest = pickStr(cancelRequest.requestId) === requestId;
          if (pickStr(latestTask && latestTask.status) === 'cancelled' && matchedRequest && (payStatus === 'refunded' || payStatus === 'refund_pending' || cancelStatus === 'approved' || cancelStatus === 'refund_pending')) {
            this._applyLocalTaskCancelResolved(requestId);
            wx.showToast({ title: '任务已取消', icon: 'success' });
            return;
          }
        } catch (reloadErr) {}
      }
      this.setData({ approveTaskCancelSubmitting: false });
      wx.showToast({ title: maybeTimedOut ? '请求超时，请刷新查看结果' : '处理失败', icon: 'none' });
    } finally {
      this._approvingTaskCancel = false;
    }
  },

  async approveContactRequest(e) {
    if (this._approvingContactRequest) return;
    const requestId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId);
    if (!requestId) {
      wx.showToast({ title: '缺少申请信息', icon: 'none' });
      return;
    }

    this._approvingContactRequest = true;
    this.setData({ approveContactRequestSubmitting: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskContactFlow',
        data: {
          action: 'approve_phone',
          taskId: this.data.tid,
          requestId,
        }
      });
      const ret = (res && res.result) || {};
      wx.hideLoading();
      if (!ret || ret.ok !== true) {
        this.setData({ approveContactRequestSubmitting: false });
        wx.showToast({ title: (ret && ret.msg) || '处理失败', icon: 'none' });
        return;
      }

      this._applyLocalContactRequestResolved(requestId);
      this._reloadTaskState();
      wx.showToast({ title: '已同意查看', icon: 'success' });
    } catch (err) {
      console.error('同意手机号查看失败', err);
      wx.hideLoading();
      this.setData({ approveContactRequestSubmitting: false });
      wx.showToast({ title: '处理失败', icon: 'none' });
    } finally {
      this._approvingContactRequest = false;
    }
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
