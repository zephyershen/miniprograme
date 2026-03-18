const { resolveAvatarURL, saveAvatarTempURLMap } = require('../../../utils/avatarCache');
const { getStoredUser } = require('../../../utils/userIdentity');

// 使用云开发数据库 messages 集合做聊天记录
const db = wx.cloud.database();
const _ = db.command;
const MSG_COLLECTION = 'messages';
const TASK_COLLECTION = 'tasks';
const TEMP_URL_BATCH_SIZE = 20;
const REFUND_SYNC_INTERVAL_MS = 3000;
const CHAT_RECENT_WATCH_LIMIT = 40;
const CHAT_HISTORY_PAGE_SIZE = 40;

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
    canRequestTaskRelease: false,
    hasPendingTaskRelease: false,
    canApproveTaskRelease: false,
    pendingTaskReleaseRequestId: '',
    approveTaskReleaseSubmitting: false,
    localResolvedTaskReleaseRequestId: '',
    canApproveContactRequest: false,
    pendingContactRequestId: '',
    approveContactRequestSubmitting: false,
    localResolvedContactRequestId: '',
    hasMoreHistory: false,
    loadingHistory: false,
  },

  // 用于防抖的滚动定时器
  _scrollTimer: null,
  // 标记用户是否正在手动滚动
  _userScrolling: false,
  // 防止重复触发“同意取消”
  _approvingTaskCancel: false,
  _approvingTaskRelease: false,
  _approvingContactRequest: false,
  _refundSyncing: false,
  _roomDocs: [],
  _lastRenderedMsgSignature: '',
  _historyDocs: [],
  _realtimeDocs: [],
  _historyExhausted: false,

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

  async _fetchPublicProfile(openid = '', userId = '') {
    const targetOpenid = pickStr(openid);
    const targetUserId = pickStr(userId);
    if (!targetOpenid && !targetUserId) return null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserPublicProfile',
        data: {
          openid: targetOpenid,
          userId: targetUserId,
        }
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
    const fallbackName = isOwner ? '发布者' : (pickStr(task.workerId) ? '接单人' : '咨询用户');
    const cached = me && typeof me === 'object' ? me : {};
    const fromTask = {
      role,
      userId: isOwner ? pickStr(task.ownerId) : pickStr(task.workerId, this.data.peerUserId),
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
        this._refreshDecoratedMsgs();
      }
    } catch (err) {
      console.warn('快速加载聊天头像失败', err);
    }
  },

  async _hydrateParticipantProfile(baseProfile = {}) {
    const base = baseProfile && typeof baseProfile === 'object' ? { ...baseProfile } : {};
    const publicProfile = await this._fetchPublicProfile(base.openid, base.userId);
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
    this._refreshDecoratedMsgs();
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
      this._refreshDecoratedMsgs();
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
    const releaseRequest = t.releaseRequest && typeof t.releaseRequest === 'object' ? t.releaseRequest : {};
    const releaseRequestId = pickStr(releaseRequest.requestId);
    const rawReleaseStatus = pickStr(releaseRequest.status);
    const contactRequest = t.contactRequest && typeof t.contactRequest === 'object' ? t.contactRequest : {};
    const contactRequestId = pickStr(contactRequest.requestId);
    const rawContactStatus = pickStr(contactRequest.status);
    const localResolvedTaskCancelRequestId = pickStr(this.data.localResolvedTaskCancelRequestId);
    const localResolvedTaskReleaseRequestId = pickStr(this.data.localResolvedTaskReleaseRequestId);
    const localResolvedContactRequestId = pickStr(this.data.localResolvedContactRequestId);
    const locallyResolved = !!(requestId && requestId === localResolvedTaskCancelRequestId);
    const locallyResolvedRelease = !!(releaseRequestId && releaseRequestId === localResolvedTaskReleaseRequestId);
    const locallyResolvedContact = !!(contactRequestId && contactRequestId === localResolvedContactRequestId);
    const effectiveCancelStatus = locallyResolved && cancelStatus === 'pending' ? 'approved' : cancelStatus;
    const effectiveReleaseStatus = locallyResolvedRelease && rawReleaseStatus === 'pending' ? 'approved' : rawReleaseStatus;
    const effectiveContactStatus = locallyResolvedContact && rawContactStatus === 'pending' ? 'approved' : rawContactStatus;
    const syncedResolved = locallyResolved && effectiveCancelStatus !== 'pending';
    const syncedResolvedRelease = locallyResolvedRelease && effectiveReleaseStatus !== 'pending';
    const syncedResolvedContact = locallyResolvedContact && effectiveContactStatus !== 'pending';
    const nextCancelRequest = {
      ...cancelRequest,
      ...(effectiveCancelStatus ? { status: effectiveCancelStatus } : {}),
    };
    const nextReleaseRequest = {
      ...releaseRequest,
      ...(effectiveReleaseStatus ? { status: effectiveReleaseStatus } : {}),
    };
    const nextContactRequest = {
      ...contactRequest,
      ...(effectiveContactStatus ? { status: effectiveContactStatus } : {}),
    };
    const canRequestTaskCancel = meId
      && meId === ownerId
      && (statusRaw === 'accepted' || statusRaw === 'submitted')
      && !!workerId
      && effectiveCancelStatus !== 'pending'
      && effectiveReleaseStatus !== 'pending';
    const canRequestTaskRelease = meId
      && meId === workerId
      && statusRaw === 'accepted'
      && effectiveReleaseStatus !== 'pending'
      && effectiveCancelStatus !== 'pending';
    const canApproveTaskCancel = meId
      && meId === workerId
      && (statusRaw === 'accepted' || statusRaw === 'submitted')
      && effectiveCancelStatus === 'pending'
      && !!requestId;
    const canApproveTaskRelease = meId
      && meId === ownerId
      && statusRaw === 'accepted'
      && effectiveReleaseStatus === 'pending'
      && !!releaseRequestId;
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
        releaseRequest: nextReleaseRequest,
        contactRequest: nextContactRequest,
      },
      canRequestTaskCancel,
      hasPendingTaskCancel: effectiveCancelStatus === 'pending',
      canApproveTaskCancel,
      pendingTaskCancelRequestId: requestId,
      localResolvedTaskCancelRequestId: syncedResolved ? '' : localResolvedTaskCancelRequestId,
      approveTaskCancelSubmitting: syncedResolved ? false : this.data.approveTaskCancelSubmitting,
      canRequestTaskRelease,
      hasPendingTaskRelease: effectiveReleaseStatus === 'pending',
      canApproveTaskRelease,
      pendingTaskReleaseRequestId: releaseRequestId,
      localResolvedTaskReleaseRequestId: syncedResolvedRelease ? '' : localResolvedTaskReleaseRequestId,
      approveTaskReleaseSubmitting: syncedResolvedRelease ? false : this.data.approveTaskReleaseSubmitting,
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

  _closeRoomWatch() {
    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }
    this._watcher = null;
  },

  _closeTaskWatch() {
    if (this._taskWatcher && this._taskWatcher.close) {
      this._taskWatcher.close();
    }
    this._taskWatcher = null;
  },

  _bindKeyboardHeightChange() {
    if (this._keyboardHeightHandler) return;
    this._keyboardHeightHandler = (res) => {
      this.setData({ keyboardHeight: res.height || 0 });
      if (res.height > 0) {
        setTimeout(() => {
          this._scrollToBottom();
        }, 100);
      }
    };
    wx.onKeyboardHeightChange(this._keyboardHeightHandler);
  },

  _unbindKeyboardHeightChange() {
    if (!this._keyboardHeightHandler) return;
    try {
      wx.offKeyboardHeightChange(this._keyboardHeightHandler);
    } catch (err) {
      wx.offKeyboardHeightChange();
    }
    this._keyboardHeightHandler = null;
  },

  _roomHasUnreadForMe(docs = [], ownerId = '', peerUserId = '', meId = '') {
    const currentMeId = pickStr(meId);
    if (!currentMeId) return false;
    if (currentMeId === pickStr(ownerId)) {
      return (Array.isArray(docs) ? docs : []).some((doc) => (
        pickStr(doc && doc.fromUserId)
        && pickStr(doc && doc.fromUserId) !== pickStr(ownerId)
        && doc.readByOwner !== true
      ));
    }
    if (currentMeId === pickStr(peerUserId)) {
      return (Array.isArray(docs) ? docs : []).some((doc) => (
        pickStr(doc && doc.fromUserId) === pickStr(ownerId)
        && doc.readByPeer !== true
      ));
    }
    return false;
  },

  _markTaskRoomRead(ownerId = '', peerUserId = '', docs = [], force = false) {
    const tid = pickStr(this.data.tid);
    const me = this.data.me || {};
    const meId = pickStr(me.id);
    const currentOwnerId = pickStr(ownerId, this.data.ownerId);
    const currentPeerUserId = pickStr(peerUserId, this.data.peerUserId);
    if (!tid || !meId || !currentOwnerId || !currentPeerUserId) return;
    if (!force && !this._roomHasUnreadForMe(docs, currentOwnerId, currentPeerUserId, meId)) return;

    if (meId === currentOwnerId) {
      wx.cloud.callFunction({
        name: 'markMessagesReadByOwner',
        data: { tid, ownerId: currentOwnerId, peerUserId: currentPeerUserId }
      }).catch(err => {
        console.error('调用 markMessagesReadByOwner 失败', err);
      });
    } else if (meId === currentPeerUserId) {
      wx.cloud.callFunction({
        name: 'markMessagesReadByPeer',
        data: { tid, ownerId: currentOwnerId, peerUserId: currentPeerUserId }
      }).catch(err => {
        console.error('调用 markMessagesReadByPeer 失败', err);
      });
    }
  },

  _buildVisibleMsgSignature(msgs = []) {
    return JSON.stringify((Array.isArray(msgs) ? msgs : []).map((item) => ([
      pickStr(item && item.id),
      item && item.mine ? 1 : 0,
      pickStr(item && item.type),
      pickStr(item && item.text),
      pickStr(item && item.imageUrl),
      pickStr(item && item.avatarUrl),
      pickStr(item && item.taskCancelStatusText),
      pickStr(item && item.taskReleaseStatusText),
      pickStr(item && item.contactRequestStatusText),
    ])));
  },

  _getMsgId(doc = {}) {
    return pickStr(doc && (doc._id || doc.id));
  },

  _getMsgTs(doc = {}) {
    const raw = doc && doc.createTime;
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (raw && typeof raw === 'object' && Number.isFinite(raw.$date)) return raw.$date;
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : 0;
  },

  _sortRoomDocsAsc(docs = []) {
    return (Array.isArray(docs) ? docs.slice() : []).sort((a, b) => {
      const diff = this._getMsgTs(a) - this._getMsgTs(b);
      if (diff) return diff;
      return this._getMsgId(a).localeCompare(this._getMsgId(b));
    });
  },

  _mergeUniqueRoomDocs(...lists) {
    const map = {};
    lists.forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((doc) => {
        const id = this._getMsgId(doc);
        if (!id) return;
        map[id] = doc;
      });
    });
    return this._sortRoomDocsAsc(Object.keys(map).map((id) => map[id]));
  },

  _composeRoomDocs() {
    return this._mergeUniqueRoomDocs(this._historyDocs, this._realtimeDocs);
  },

  _applyRoomDocs(options = {}) {
    const firstLoad = !!options.firstLoad || !this.data.contentReady;
    const docs = this._composeRoomDocs();
    const msgs = this._decorateMsgs(docs, this.data.me);
    const renderSignature = this._buildVisibleMsgSignature(msgs);
    const nextData = {};
    const shouldRenderMsgs = firstLoad || renderSignature !== this._lastRenderedMsgSignature;

    this._roomDocs = docs;

    if (typeof options.loadingHistory === 'boolean') {
      nextData.loadingHistory = options.loadingHistory;
    }
    if (typeof options.hasMoreHistory === 'boolean') {
      nextData.hasMoreHistory = options.hasMoreHistory;
    }
    if (firstLoad) {
      nextData.isLoading = false;
      nextData.contentReady = true;
      if (msgs.length && !this._userScrolling) {
        nextData.scrollTop = 999999;
        nextData.scrollWithAnimation = false;
      }
    }
    if (shouldRenderMsgs) {
      nextData.msgs = msgs;
    }

    if (Object.keys(nextData).length) {
      this.setData(nextData);
      if (shouldRenderMsgs) {
        this._lastRenderedMsgSignature = renderSignature;
      }
    }

    return msgs;
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

  _applyLocalTaskReleaseResolved(requestId) {
    const normalizedRequestId = pickStr(requestId);
    if (!normalizedRequestId) return;
    const nextMsgs = (this.data.msgs || []).map((item) => {
      const taskRelease = item && item.taskRelease && typeof item.taskRelease === 'object' ? item.taskRelease : null;
      if (!taskRelease || pickStr(taskRelease.requestId) !== normalizedRequestId) return item;
      return {
        ...item,
        taskRelease: { ...taskRelease, status: 'approved' },
        taskReleaseStatusText: '任务已释放，可继续接单',
        taskReleaseStatusClass: 'task-cancel-card-status task-cancel-card-status-success',
      };
    });
    const currentTaskInfo = this.data.taskInfo && typeof this.data.taskInfo === 'object'
      ? this.data.taskInfo
      : null;
    const nextTaskInfo = currentTaskInfo ? {
      ...currentTaskInfo,
      statusRaw: 'posted',
      workerId: '',
      releaseRequest: {
        ...((currentTaskInfo.releaseRequest && typeof currentTaskInfo.releaseRequest === 'object')
          ? currentTaskInfo.releaseRequest
          : {}),
        requestId: normalizedRequestId,
        status: 'approved',
      }
    } : currentTaskInfo;

    this.setData({
      msgs: nextMsgs,
      taskInfo: nextTaskInfo,
      canRequestTaskCancel: false,
      canRequestTaskRelease: false,
      hasPendingTaskRelease: false,
      canApproveTaskRelease: false,
      approveTaskReleaseSubmitting: false,
      localResolvedTaskReleaseRequestId: normalizedRequestId,
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
    const peerProfile = this.data.peerProfile && typeof this.data.peerProfile === 'object' ? this.data.peerProfile : {};
    const targetUserId = pickStr(peerProfile.userId, this.data.peerUserId);
    const targetOpenid = pickStr(peerProfile.openid);
    wx.navigateTo({
      url: `/pages/user/profile/index?tid=${tid}&targetRole=${peerRole}&targetUserId=${encodeURIComponent(targetUserId)}&targetOpenid=${encodeURIComponent(targetOpenid)}`
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
    const me = getStoredUser();
    if (!me || !me.id) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    // 如果从其他入口（例如未来的列表页）带了 peerUserId，就直接使用
    const peerFromQuery = (q && q.peerUserId) || '';

    this._historyDocs = [];
    this._realtimeDocs = [];
    this._roomDocs = [];
    this._lastRenderedMsgSignature = '';
    this._historyExhausted = false;

    this.setData({
      tid,
      me,
      isLoading: true,
      contentReady: false,
      msgs: [],
      hasMoreHistory: false,
      loadingHistory: false,
    });

    this._bindKeyboardHeightChange();

    // 先根据任务 ID 查询任务详情，拿到发布人 ownerId，再决定 peerUserId
    this._initRoomWithTask(tid, me, peerFromQuery);
  },

  onShow() {
    this._bindKeyboardHeightChange();
    const tid = pickStr(this.data.tid);
    if (tid && !this._taskWatcher) {
      this._openTaskWatch(tid);
    }
    const ownerId = pickStr(this.data.ownerId);
    const peerUserId = pickStr(this.data.peerUserId);
    if (tid && ownerId && peerUserId && !this._watcher) {
      this.openWatch({ tid, ownerId, peerUserId });
      this._markTaskRoomRead(ownerId, peerUserId, [], true);
    }
  },

  onHide() {
    this._closeRoomWatch();
    this._closeTaskWatch();
    this._clearRefundSyncTimer();
    this._unbindKeyboardHeightChange();
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
  },

  onUnload() {
    this.onHide();
    this._historyDocs = [];
    this._realtimeDocs = [];
    this._roomDocs = [];
    this._lastRenderedMsgSignature = '';
    this._historyExhausted = false;
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

  async loadOlderMsgs() {
    if (this.data.loadingHistory || !this.data.hasMoreHistory) return;
    const tid = pickStr(this.data.tid);
    const ownerId = pickStr(this.data.ownerId);
    const peerUserId = pickStr(this.data.peerUserId);
    const oldestDoc = (Array.isArray(this._roomDocs) && this._roomDocs.length)
      ? this._roomDocs[0]
      : null;
    const oldestTs = this._getMsgTs(oldestDoc);
    if (!tid || !ownerId || !peerUserId || !oldestTs) {
      this._historyExhausted = true;
      this.setData({ hasMoreHistory: false });
      return;
    }

    this.setData({ loadingHistory: true });
    try {
      const res = await db.collection(MSG_COLLECTION)
        .where({
          tid,
          ownerId,
          peerUserId,
          createTime: _.lt(new Date(oldestTs)),
        })
        .orderBy('createTime', 'desc')
        .limit(CHAT_HISTORY_PAGE_SIZE)
        .get();
      const olderDocs = this._sortRoomDocsAsc((res && res.data) || []);
      this._historyDocs = this._mergeUniqueRoomDocs(olderDocs, this._historyDocs);
      this._historyExhausted = olderDocs.length < CHAT_HISTORY_PAGE_SIZE;
      this._applyRoomDocs({
        loadingHistory: false,
        hasMoreHistory: !this._historyExhausted,
      });
    } catch (err) {
      console.error('加载更早任务聊天消息失败', err);
      this.setData({ loadingHistory: false });
      wx.showToast({ title: '加载历史消息失败', icon: 'none' });
    }
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

        // 首次进入聊天页时主动回写一次已读。
        self._markTaskRoomRead(ownerId, peerUserId, [], true);

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
  openWatch(room, useFullScanFallback = false) {
    const { tid, ownerId, peerUserId } = room || {};
    if (!tid || !ownerId || !peerUserId) {
      return;
    }

    const self = this;
    if (this._watcher && this._watcher.close) {
      this._watcher.close();
    }
    let query = db.collection(MSG_COLLECTION)
      .where({ tid, ownerId, peerUserId });
    query = useFullScanFallback
      ? query.orderBy('createTime', 'asc')
      : query.orderBy('createTime', 'desc').limit(CHAT_RECENT_WATCH_LIMIT);

    this._watcher = query.watch({
        onChange(snapshot) {
          const rawDocs = (snapshot && snapshot.docs) || [];
          const realtimeDocs = useFullScanFallback
            ? self._sortRoomDocsAsc(rawDocs).slice(-CHAT_RECENT_WATCH_LIMIT)
            : self._sortRoomDocsAsc(rawDocs);
          const oldMsgsLen = self._roomDocs.length;
          self._realtimeDocs = realtimeDocs;
          const msgs = self._applyRoomDocs({
            firstLoad: !self.data.contentReady,
            hasMoreHistory: !self._historyExhausted && (self.data.hasMoreHistory || rawDocs.length >= CHAT_RECENT_WATCH_LIMIT),
          });

          if (self.data.contentReady && self._roomDocs.length > oldMsgsLen && msgs[msgs.length - 1]) {
            self._scrollToBottom();
          }

          // 仅在当前快照里确实存在未读消息时才回写已读，避免重复云函数调用。
          self._markTaskRoomRead(ownerId, peerUserId, realtimeDocs, false);
        },
        onError(err) {
          console.error('chat watch error', err);
          if (!useFullScanFallback) {
            self._closeRoomWatch();
            self.openWatch(room, true);
          }
        }
      });
  },

  // 把云数据库里的原始记录，转换成页面需要的字段
  _decorateMsgs(docs, me) {
    const userId = (me && me.id) || '';
    const localResolvedTaskCancelRequestId = pickStr(this.data.localResolvedTaskCancelRequestId);
    const localResolvedTaskReleaseRequestId = pickStr(this.data.localResolvedTaskReleaseRequestId);
    const localResolvedContactRequestId = pickStr(this.data.localResolvedContactRequestId);
    const meProfile = this.data.meProfile && typeof this.data.meProfile === 'object' ? this.data.meProfile : {};
    const peerProfile = this.data.peerProfile && typeof this.data.peerProfile === 'object' ? this.data.peerProfile : {};
    const taskInfo = this.data.taskInfo && typeof this.data.taskInfo === 'object' ? this.data.taskInfo : {};
    const taskInfoCancel = taskInfo.cancelRequest && typeof taskInfo.cancelRequest === 'object' ? taskInfo.cancelRequest : {};
    const taskInfoCancelRequestId = pickStr(taskInfoCancel.requestId);
    const taskInfoCancelStatus = pickStr(taskInfoCancel.status);
    const taskInfoRelease = taskInfo.releaseRequest && typeof taskInfo.releaseRequest === 'object' ? taskInfo.releaseRequest : {};
    const taskInfoReleaseRequestId = pickStr(taskInfoRelease.requestId);
    const taskInfoReleaseStatus = pickStr(taskInfoRelease.status);
    return (docs || []).map(doc => {
      const id = doc._id || doc.id;
      const fromUserId = doc.fromUserId || '';
      const mine = !!(userId && fromUserId === userId);
      const taskCancel = doc.taskCancel && typeof doc.taskCancel === 'object' ? doc.taskCancel : null;
      const taskRelease = doc.taskRelease && typeof doc.taskRelease === 'object' ? doc.taskRelease : null;
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
      const rawReleaseStatus = pickStr(taskRelease && taskRelease.status);
      const releaseStatus = localResolvedTaskReleaseRequestId
        && pickStr(taskRelease && taskRelease.requestId) === localResolvedTaskReleaseRequestId
        && rawReleaseStatus === 'pending'
        ? 'approved'
        : rawReleaseStatus;
      const effectiveTaskReleaseStatus = taskInfoReleaseRequestId
        && taskInfoReleaseRequestId === pickStr(taskRelease && taskRelease.requestId)
        && taskInfoReleaseStatus
        ? taskInfoReleaseStatus
        : releaseStatus;
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
      let taskReleaseStatusText = '';
      let taskReleaseStatusClass = 'task-cancel-card-status';
      if (effectiveTaskReleaseStatus === 'approved') {
        taskReleaseStatusText = '任务已释放，可继续接单';
        taskReleaseStatusClass = 'task-cancel-card-status task-cancel-card-status-success';
      } else if (effectiveTaskReleaseStatus === 'rejected') {
        taskReleaseStatusText = '已拒绝';
      } else {
        taskReleaseStatusText = '等待发布者同意';
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
        taskCancelText: taskCancel ? `${pickStr(taskCancel.requesterName, '发布者')}申请取消任务。` : '',
        taskCancelStatusText,
        taskCancelStatusClass,
        taskCancelActionable: !!(
          taskCancel
          && effectiveTaskCancelStatus === 'pending'
          && userId
          && pickStr(taskCancel.approverUserId) === userId
        ),
        taskRelease,
        taskReleaseText: taskRelease ? `${pickStr(taskRelease.requesterName, '接单人')}申请释放当前任务，处理后任务会重新开放接单。` : '',
        taskReleaseStatusText,
        taskReleaseStatusClass,
        taskReleaseActionable: !!(
          taskRelease
          && effectiveTaskReleaseStatus === 'pending'
          && userId
          && pickStr(taskRelease.approverUserId) === userId
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

  _refreshDecoratedMsgs() {
    this._applyRoomDocs();
  },

  async requestTaskRelease() {
    if (!this.data.canRequestTaskRelease) {
      wx.showToast({ title: '当前任务暂不能申请释放', icon: 'none' });
      return;
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '申请释放任务',
        content: '发起后，需要发布者同意，任务会恢复为可接单状态，不会退款。是否继续？',
        confirmText: '申请释放',
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
          action: 'request_release',
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
      wx.showToast({ title: '已申请释放', icon: 'success' });
    } catch (err) {
      console.error('申请释放任务失败', err);
      wx.hideLoading();
      wx.showToast({ title: '发起失败', icon: 'none' });
    }
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

  async approveTaskRelease(e) {
    if (this._approvingTaskRelease) return;
    const requestId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId);
    if (!requestId) {
      wx.showToast({ title: '缺少申请信息', icon: 'none' });
      return;
    }
    this._approvingTaskRelease = true;
    this.setData({ approveTaskReleaseSubmitting: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskCancelFlow',
        data: {
          action: 'approve_release',
          taskId: this.data.tid,
          requestId,
        }
      });
      const ret = (res && res.result) || {};
      wx.hideLoading();
      if (!ret || ret.ok !== true) {
        this.setData({ approveTaskReleaseSubmitting: false });
        wx.showToast({ title: (ret && ret.msg) || '处理失败', icon: 'none' });
        return;
      }
      this._applyLocalTaskReleaseResolved(requestId);
      this._reloadTaskState();
      wx.showToast({ title: '任务已释放', icon: 'success' });
    } catch (err) {
      console.error('同意释放任务失败', err);
      wx.hideLoading();
      this.setData({ approveTaskReleaseSubmitting: false });
      wx.showToast({ title: '处理失败', icon: 'none' });
    } finally {
      this._approvingTaskRelease = false;
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

  _sendTaskMessage(type = 'text', payload = {}) {
    const tid = this.data.tid;
    const ownerId = this.data.ownerId || '';
    const peerUserId = this.data.peerUserId || '';
    if (!tid || !ownerId || !peerUserId) {
      wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
      return Promise.reject(new Error('missing_room_info'));
    }
    return wx.cloud.callFunction({
      name: 'chatSendMessage',
      data: {
        bizType: 'task',
        tid,
        ownerId,
        peerUserId,
        type,
        ...payload,
      }
    }).then((res) => {
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.msg, '发送失败'));
      }
      return ret;
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
    this._sendTaskMessage('text', { text }).catch(err => {
      console.error('send message error', err);
      this.setData({ text });
      wx.showToast({ title: pickStr(err && err.message, '发送失败'), icon: 'none' });
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
            self._sendTaskMessage('image', { imageUrl: fileID }).catch(err => {
              console.error('send image message error', err);
              wx.showToast({ title: pickStr(err && err.message, '发送图片失败'), icon: 'none' });
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
