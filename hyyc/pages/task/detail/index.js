const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');
const access = require('../../../config/access');
const { getStoredUser } = require('../../../utils/userIdentity');

// 使用云开发数据库 tasks 集合加载任务详情
const db = wx.cloud.database();
const _ = db.command;
const TASK_COLLECTION = 'tasks';
const MSG_COLLECTION = 'messages';
const REFUND_SYNC_MIN_DELAY_MS = 30000;
const REFUND_SYNC_MAX_DELAY_MS = 5 * 60 * 1000;
const TEMP_URL_BATCH_SIZE = 20;

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function isCloudFileID(v = '') {
  return String(v || '').indexOf('cloud://') === 0;
}

function normalizeImageList(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((item) => pickStr(item))
    .filter(Boolean);
}

function safeFormatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (!d || Number.isNaN(d.getTime())) return '';
  return formatDateTime(d);
}

function isRefundSyncHardStop(code = '') {
  const normalized = pickStr(code);
  return normalized === 'MISSING_REFUND_META'
    || normalized === 'TASK_NOT_FOUND'
    || normalized === 'NO_PERMISSION';
}

function resolveTaskCancelState(task = {}) {
  const t = task && typeof task === 'object' ? task : {};
  const pay = t.pay && typeof t.pay === 'object' ? t.pay : {};
  const cancelRequest = t.cancelRequest && typeof t.cancelRequest === 'object' ? t.cancelRequest : {};
  const refund = (pay.refund && typeof pay.refund === 'object')
    ? pay.refund
    : ((cancelRequest.refund && typeof cancelRequest.refund === 'object') ? cancelRequest.refund : {});
  let statusRaw = pickStr(t.status);
  let payStatus = pickStr(pay.status);
  let cancelStatus = pickStr(cancelRequest.status);
  const refundStatus = pickStr(refund.status);
  const hasApprovalMarker = !!(
    cancelRequest.approvedAt
    || pickStr(cancelRequest.approvedByUserId, cancelRequest.approvedByOpenid, cancelRequest.approvedByName)
  );
  const hasRefundRequest = !!pickStr(refund.reqSeqId, refund.reqDate);

  if (cancelStatus === 'pending' && hasApprovalMarker) {
    if (payStatus === 'refunded' || refundStatus === 'success') {
      cancelStatus = 'approved';
    } else if (payStatus === 'refund_pending' || refundStatus === 'processing' || refundStatus === 'requested' || hasRefundRequest) {
      cancelStatus = 'refund_pending';
    }
  }

  if (cancelStatus === 'approved') {
    statusRaw = 'cancelled';
    payStatus = payStatus || 'refunded';
  } else if (cancelStatus === 'refund_pending') {
    statusRaw = 'cancelled';
    if (payStatus !== 'refunded') payStatus = 'refund_pending';
  }

  return { statusRaw, payStatus, cancelStatus };
}

Page({
		  data: {
		    task: {},
	    isOwner: false,
	    accepted: false,
	    isWorker: false,
	    canAccept: false,
	    canSubmit: false,
	    canApprove: false,
	    isLoading: true,
	    workflowEnabled: !!(access && access.features && access.features.taskWorkflow),
	    // 任务发布者视角下，该任务下所有会话的未读消息总数（以“有未读的会话数量”计）
	    unreadCount: 0,
	    // 普通住户视角：当前任务下，与业主聊天的未读消息条数
		    peerUnreadCount: 0
		  },
    _guardRealnameAccess() {
      const me = getStoredUser();
      if (me && me.realname) return true;
      const hasUser = !!(me && me.id);
      wx.showModal({
        title: hasUser ? '完成实名后可查看任务' : '请先登录',
        content: hasUser
          ? '你已经完成基础注册，但还需要完成实名，才能查看任务详情和接单。'
          : '请先登录后再查看任务详情。',
        confirmText: hasUser ? '去实名' : '去登录',
        cancelText: '返回',
        success: (res) => {
          if (res && res.confirm) {
            wx.navigateTo({ url: hasUser ? '/pages/auth/realname/index' : '/pages/welcome/index' });
            return;
          }
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index/index' }) });
        }
      });
      this.setData({ isLoading: false });
      return false;
    },
  _refundSyncing: false,
	  _refundSyncTimer: null,
	  _refundSyncRetryCount: 0,
	  _pageVisible: false,
	  _setNumericDataIfChanged(key = '', value = 0) {
	    const field = pickStr(key);
	    if (!field) return;
	    const nextValue = Number(value) || 0;
	    if (Number(this.data[field]) === nextValue) return;
	    this.setData({ [field]: nextValue });
	  },
	  async _getTempFileURLMap(fileIDs = []) {
    const uniq = [];
    const seen = {};
    normalizeImageList(fileIDs).forEach((fileID) => {
      if (!isCloudFileID(fileID) || seen[fileID]) return;
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
    return map;
  },
  _resolveImageURLs(images = [], urlMap = {}) {
    return normalizeImageList(images).map((item) => {
      if (!isCloudFileID(item)) return item;
      return pickStr(urlMap[item], item);
    });
  },
  async _hydrateTaskMedia(taskId = '', task = {}) {
    const currentTaskId = pickStr(taskId, task && task.id);
    if (!currentTaskId) return;

    const taskImages = normalizeImageList(task.images);
    const submitView = task.submitView && typeof task.submitView === 'object' ? task.submitView : null;
    const submitImages = normalizeImageList(submitView && submitView.images);
    const fileIDs = taskImages.concat(submitImages).filter((item) => isCloudFileID(item));

    if (!fileIDs.length) return;

    try {
      const urlMap = await this._getTempFileURLMap(fileIDs);
      if (pickStr(this.data.task && this.data.task.id) !== currentTaskId) return;

      const patch = {
        'task.images': this._resolveImageURLs(taskImages, urlMap),
      };
      if (submitView) {
        patch['task.submitView.images'] = this._resolveImageURLs(submitImages, urlMap);
      }
      this.setData(patch);
    } catch (err) {
      console.warn('加载任务详情图片失败', err);
    }
  },
  _applyTaskDetailDoc(t = {}, id = '', myId = '') {
    // 地址展示优先使用「楼栋 + 房门号」，如果没有门牌号，则退回到原来的 address 文本
    const locationText = (t.building && t.door)
      ? `${t.building} ${t.door}`
      : (t.address || '');

    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * ONE_DAY;
    const rawDeadline = t.deadline;
    const createdAt = t.createdAt;
    const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : null;
    // 未设置截止时间时，默认从创建时间起 7 天内有效
    const effectiveDeadline = rawDeadline != null
      ? rawDeadline
      : (createdTs ? (createdTs + ONE_WEEK) : null);
    const isExpired = effectiveDeadline != null && effectiveDeadline <= now;

    const resolvedCancelState = resolveTaskCancelState(t);
    const statusRaw = resolvedCancelState.statusRaw;
    const payStatus = resolvedCancelState.payStatus;
    const statusMap = {
      '': '已发布',
      posted: '已发布',
      pay_pending: '待付款',
      accepted: '已接单',
      submitted: '待确认',
      completed: '已完成',
      cancelled: '已取消'
    };
    const statusText = isExpired
      ? '已过期'
      : (statusRaw === 'cancelled' && payStatus === 'refund_pending'
        ? '退款中'
        : (statusMap[statusRaw] || statusRaw || '已发布'));
    const taskImages = normalizeImageList(t.images);
    const submitSource = t.submit && typeof t.submit === 'object' ? t.submit : {};
    const submitNote = pickStr(submitSource.note);
    const submitImages = normalizeImageList(submitSource.images);
    const submittedAtText = safeFormatDateTime(submitSource.submittedAt);
    const hasSubmitRecord = !!(submitNote || submitImages.length || submittedAtText);

    const task = {
      ...t,
      id,
      images: taskImages,
      amountText: formatMoney(t.amount),
      statusRaw,
      payStatus,
      // 截止时间：未设置则展示默认过期时间
      deadlineText: effectiveDeadline ? formatDateTime(effectiveDeadline) : '默认 7 天内有效',
      // 状态：如果已过期，优先展示“已过期”
      statusText,
      locationText,
      submitView: hasSubmitRecord ? {
        note: submitNote,
        images: submitImages,
        submittedAtText,
      } : null
    };

    // 是否为任务发布人：根据 ownerId 和当前登录用户 id 判断
    const isOwner = !!(myId && t.ownerId && myId === t.ownerId);
    const isWorker = !!(myId && t.workerId && myId === t.workerId);

    const canAccept = !isOwner && !isExpired && (statusRaw === '' || statusRaw === 'posted');
    const canSubmit = !isOwner && isWorker && statusRaw === 'accepted';
    const canApprove = isOwner && statusRaw === 'submitted';
    const canRefundDirect = isOwner && statusRaw === 'posted';
    const accepted = isWorker && (statusRaw === 'accepted' || statusRaw === 'submitted');

    this.setData({
      task,
      isOwner,
      accepted,
      isWorker,
      canAccept,
      canSubmit,
      canApprove,
      canRefundDirect,
      isLoading: false
    });
    this._hydrateTaskMedia(id, task);
    this._maybeSyncPendingRefund(t);

    // 详情页只在进入/返回时刷新未读，不再常驻实时监听，避免长时间停留时持续耗电。
    this.clearBadgeWatch();
    if (isOwner) {
      this.loadUnreadCount(task.id, myId);
    } else if (t.ownerId) {
      this.loadPeerUnread(task.id, t.ownerId, myId);
    }
  },
  _loadTaskDetail(taskId = '', options = {}) {
    const id = pickStr(taskId, this.data.task && this.data.task.id);
    const silent = !!(options && options.silent);
    if (!id) {
      if (!silent) {
        toast('缺少任务 ID');
        this.setData({ isLoading: false });
      }
      return;
    }

    const me = getStoredUser();
    const myId = me.id || '';

    if (!silent) {
      this.setData({ isLoading: true });
    }

    db.collection(TASK_COLLECTION).doc(id).get({
      success: (res) => {
        this._applyTaskDetailDoc((res && res.data) || {}, id, myId);
      },
      fail: (err) => {
        console.error('加载任务详情失败', err);
        this.setData({ isLoading: false });
        if (!silent) {
          toast('任务不存在或已被删除');
        }
      }
    });
  },
			  onLoad(q){
      if (!this._guardRealnameAccess()) return;
	    this._pageVisible = true;
	    const id = q.id;
	    this._loadTaskDetail(id);
			  },
  _maybeSyncPendingRefund(task = {}) {
    const resolved = resolveTaskCancelState(task);
    if (pickStr(resolved.payStatus) !== 'refund_pending') {
      this._clearRefundSyncTimer();
      return;
    }
    const taskId = pickStr(task._id, task.id, this.data.task && this.data.task.id);
    if (!taskId) return;
    this._refundSyncRetryCount = 0;
    this._runRefundSync(taskId);
  },
  _scheduleRefundSync(taskId = '') {
    const currentTaskId = pickStr(taskId, this.data.task && this.data.task.id);
    if (!currentTaskId || !this._pageVisible) return;
    if (this._refundSyncTimer) {
      clearTimeout(this._refundSyncTimer);
      this._refundSyncTimer = null;
    }
    const delay = Math.min(
      REFUND_SYNC_MIN_DELAY_MS * Math.pow(2, Math.max(0, this._refundSyncRetryCount - 1)),
      REFUND_SYNC_MAX_DELAY_MS
    );
    this._refundSyncTimer = setTimeout(() => {
      this._refundSyncTimer = null;
      if (!this._pageVisible) return;
      this._runRefundSync(currentTaskId);
    }, delay);
  },
  _clearRefundSyncTimer() {
    if (this._refundSyncTimer) {
      clearTimeout(this._refundSyncTimer);
      this._refundSyncTimer = null;
    }
    this._refundSyncRetryCount = 0;
  },
  _runRefundSync(taskId = '') {
    const currentTaskId = pickStr(taskId, this.data.task && this.data.task.id);
    if (!currentTaskId || this._refundSyncing) return;
    const task = this.data.task || {};
    if (pickStr(task.payStatus) !== 'refund_pending' && pickStr(task.statusText) !== '退款中') {
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
        this._clearRefundSyncTimer();
        this._loadTaskDetail(currentTaskId, { silent: true });
        return;
      }
      if (ret && ret.ok === false && isRefundSyncHardStop(ret.code)) {
        this._clearRefundSyncTimer();
        return;
      }
      this._refundSyncRetryCount += 1;
      this._scheduleRefundSync(currentTaskId);
    }).catch((err) => {
      console.warn('同步退款状态失败', err);
      this._refundSyncRetryCount += 1;
      this._scheduleRefundSync(currentTaskId);
    }).finally(() => {
      this._refundSyncing = false;
    });
  },
			  onShow(){
      if (!this._guardRealnameAccess()) return;
	    this._pageVisible = true;
			    // 从其它页面返回时重新拉最新任务状态，避免按钮沿用旧缓存
			    const task = this.data.task || {};
			    if (!task.id) return;
        this._loadTaskDetail(task.id, { silent: true });
			  },

			  onHide(){
	    this._pageVisible = false;
			    // 离开详情页时关闭监听，避免重复监听和资源浪费
			    this.clearBadgeWatch();
        this._clearRefundSyncTimer();
			  },

			  onUnload(){
	    this._pageVisible = false;
			    this.clearBadgeWatch();
        this._clearRefundSyncTimer();
			  },
		  // 统计当前任务下，发布者视角的未读消息总数（按“消息条数”统计）
		  loadUnreadCount(tid, ownerId){
	    if (!tid || !ownerId) {
	      this._setNumericDataIfChanged('unreadCount', 0);
	      return;
	    }
		    db.collection(MSG_COLLECTION)
		      .where({
	          tid,
          ownerId,
          fromUserId: _.neq(ownerId),
          readByOwner: _.neq(true)
        })
		      .count({
		        success: (res) => {
		          this._setNumericDataIfChanged('unreadCount', Number(res && res.total) || 0);
		        },
		        fail: (err) => {
		          console.error('统计未读消息失败', err);
		          this._setNumericDataIfChanged('unreadCount', 0);
		        }
		      });
		  },
			  // 普通住户视角：统计当前任务下与业主会话中的未读消息条数
		  loadPeerUnread(tid, ownerId, peerUserId){
		    if (!tid || !ownerId || !peerUserId) {
		      this._setNumericDataIfChanged('peerUnreadCount', 0);
		      return;
		    }
		    db.collection(MSG_COLLECTION)
		      .where({
	          tid,
          ownerId,
          peerUserId,
          fromUserId: ownerId,
          readByPeer: _.neq(true)
        })
		      .count({
		        success: (res) => {
		          this._setNumericDataIfChanged('peerUnreadCount', Number(res && res.total) || 0);
		        },
		        fail: (err) => {
		          console.error('统计住户未读消息失败', err);
		          this._setNumericDataIfChanged('peerUnreadCount', 0);
		        }
			      });
		  },

	  // 根据当前身份，为任务详情页挂载实时监听，用于实时刷新未读角标
	  setupBadgeWatch(task, myId, isOwner){
	    this.clearBadgeWatch();
	  },

	  clearBadgeWatch(){
	    if (this._badgeWatcher && this._badgeWatcher.close) {
	      this._badgeWatcher.close();
	    }
	    this._badgeWatcher = null;
	  },

	  // 业主视角：监听当前任务下所有消息变化，实时计算未读消息总数（按“消息条数”）
	  openOwnerBadgeWatch(tid, ownerId){
	    const self = this;
	    this.clearBadgeWatch();
	    this._badgeWatcher = db.collection(MSG_COLLECTION)
	      .where({ tid, ownerId })
	      .orderBy('createTime', 'desc')
	      .watch({
	        onChange(snapshot){
	          const docs = (snapshot && snapshot.docs) || [];
	          // 业主未读 = 所有来自住户、且 readByOwner !== true 的消息条数之和
	          const unreadTotal = (docs || []).filter(doc => {
	            return doc.fromUserId && doc.fromUserId !== ownerId && doc.readByOwner !== true;
	          }).length;
	          self.setData({ unreadCount: unreadTotal });
	        },
	        onError(err){
	          console.error('任务详情未读会话 watch error', err);
	        }
	      });
	  },

	  // 住户视角：监听当前任务下自己与业主会话的消息变化，实时计算未读条数
	  openPeerBadgeWatch(tid, ownerId, peerUserId){
	    const self = this;
	    this.clearBadgeWatch();
	    this._badgeWatcher = db.collection(MSG_COLLECTION)
	      .where({ tid, ownerId, peerUserId })
	      .orderBy('createTime', 'desc')
	      .watch({
	        onChange(snapshot){
	          const docs = (snapshot && snapshot.docs) || [];
	          const unread = (docs || []).filter(doc => {
	            return doc.fromUserId === ownerId && doc.readByPeer !== true;
	          }).length;
	          self.setData({ peerUnreadCount: unread });
	        },
	        onError(err){
          console.error('任务详情住户未读 watch error', err);
	        }
	      });
	  },
  // 预览任务图片（支持多张左右滑动）
  previewTaskImage(e){
    const idx = Number(e.currentTarget.dataset.index || 0);
    const images = this.data.task.images || [];
    if (!images.length) return;
    wx.previewImage({
      current: images[idx] || images[0],
      urls: images
    });
  },
  previewSubmitImage(e){
    const idx = Number(e.currentTarget.dataset.index || 0);
    const submitView = this.data.task && this.data.task.submitView;
    const images = normalizeImageList(submitView && submitView.images);
    if (!images.length) return;
    wx.previewImage({
      current: images[idx] || images[0],
      urls: images
    });
  },
  accept(){
    if (!this.data.workflowEnabled) {
      toast('当前操作暂未开放');
      return;
    }
    // 发布者不能接受自己发布的任务，按钮在 UI 上也会置灰
    if (this.data.isOwner) {
      toast('这是你发布的任务，无需自己接受');
      return;
    }
    const task = this.data.task || {};
    if (!task.id) return toast('缺少任务 ID');
    wx.showLoading({ title: '接单中', mask: true });
    wx.cloud.callFunction({
      name: 'taskAccept',
      data: { taskId: task.id }
    }).then((res) => {
      const r = res && res.result ? res.result : null;
      wx.hideLoading();
      if (!r || !r.ok) {
        const msg = (r && r.msg) || (r && r.code === 'ALREADY_ACCEPTED' ? '任务已被别人接走了' : '接单失败');
        toast(msg);
        return;
      }
      toast('已接单');
      wx.redirectTo({ url: '/pages/task/detail/index?id=' + task.id });
    }).catch((err) => {
      console.error('接单失败', err);
      wx.hideLoading();
      toast('接单失败');
    });
  },
  toChat(){
    const task = this.data.task || {};
    const tid = task.id || '';
    if (!tid) {
      toast('缺少任务 ID');
      return;
    }
    const peerUserId = this.data.isOwner ? pickStr(task.workerId) : '';
    if (this.data.isOwner && !peerUserId) {
      toast('还没有接单人');
      return;
    }
    const url = peerUserId
      ? `/pages/chat/room/index?tid=${tid}&peerUserId=${peerUserId}`
      : `/pages/chat/room/index?tid=${tid}`;
    wx.navigateTo({ url });
  },
  // 任务发布者查看该任务下所有聊天会话列表
  toChatSessions(){
    const task = this.data.task || {};
    if (!task.id) {
      toast('缺少任务 ID');
      return;
    }
    wx.navigateTo({
      url: `/pages/chat/sessions/index?tid=${task.id}`
    });
  },
  toSubmit(){
    if (!this.data.workflowEnabled) {
      toast('当前操作暂未开放');
      return;
    }
    wx.navigateTo({ url: '/pages/task/submit/index?tid=' + this.data.task.id });
  },
  async onRefundTask() {
    if (!this.data.isOwner) {
      toast('只有发布者可以发起退款');
      return;
    }
    if (!this.data.canRefundDirect) {
      toast('当前任务状态不支持直接退款');
      return;
    }
    const task = this.data.task || {};
    if (!task.id) {
      toast('缺少任务 ID');
      return;
    }
    const okCancel = await confirm('该任务已付款。发起退款后会按原支付路径退回，退款完成后才能删除记录。是否继续？', '发起退款');
    if (!okCancel) return;

    wx.showLoading({ title: '退款中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskCancelFlow',
        data: {
          action: 'cancel_direct',
          taskId: task.id,
        }
      });
      const ret = (res && res.result) || {};
      wx.hideLoading();
      if (!ret || ret.ok !== true) {
        toast((ret && ret.msg) || '退款失败');
        return;
      }
      toast(ret.msg || '已取消，退款处理中');
      this._loadTaskDetail(task.id, { silent: true });
    } catch (err) {
      console.error('直接退款失败', err);
      wx.hideLoading();
      toast('退款失败，请稍后重试');
    }
  },
  async approve(){
    if (!this.data.workflowEnabled) {
      toast('当前操作暂未开放');
      return;
    }
    if (!this.data.isOwner) {
      toast('只有发布者可以确认完成');
      return;
    }
    if (!this.data.canApprove) {
      toast('请先等待对方提交完成');
      return;
    }
    const ok = await confirm('确认任务已完成并打款给对方？');
    if (!ok) return;

    const task = this.data.task || {};
    if (!task.id) return toast('缺少任务 ID');

    wx.showLoading({ title: '确认并打款', mask: true });
    try {
      const r = await wx.cloud.callFunction({
        name: 'huifuMiniappPay',
        data: {
          action: 'delay_confirm_task',
          taskId: task.id
        }
      });
      const ret = r && r.result ? r.result : null;
      wx.hideLoading();

      if (!ret || !ret.ok) {
        const msg = (ret && ret.err)
          ? (typeof ret.err === 'string' ? ret.err : (ret.err.msg || '打款失败'))
          : '打款失败';
        toast(msg);
        return;
      }

      if (ret.pending) {
        toast(ret.msg || '正在确认打款，请稍后刷新');
        wx.redirectTo({ url: '/pages/task/detail/index?id=' + task.id });
        return;
      }

      toast('已确认完成');
      wx.redirectTo({ url: '/pages/task/detail/index?id=' + task.id });
    } catch (err) {
      console.error('确认完成失败', err);
      wx.hideLoading();
      toast('确认完成失败');
    }
  }
});
