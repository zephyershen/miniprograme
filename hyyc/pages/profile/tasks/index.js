const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');
const { getStoredUser } = require('../../../utils/userIdentity');

// 使用云开发数据库 tasks 集合加载「我的任务」
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';
const REFUND_SYNC_MIN_DELAY_MS = 30000;
const REFUND_SYNC_MAX_DELAY_MS = 5 * 60 * 1000;
const AUTO_CLEAN_DELAY_MS = 1500;
const AUTO_CLEAN_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const AUTO_CLEAN_STORAGE_KEY = 'hyyc_profile_tasks_owner_autoclean_at';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
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

  return { statusRaw, payStatus };
}

function canOwnerDeleteTaskRecord(statusRaw = '', payStatus = '') {
  const status = pickStr(statusRaw);
  const pay = pickStr(payStatus);
  return status === 'pay_pending'
    || status === 'completed'
    || (status === 'cancelled' && pay === 'refunded');
}

function canWorkerDeleteTaskRecord(statusRaw = '', payStatus = '') {
  const status = pickStr(statusRaw);
  const pay = pickStr(payStatus);
  return status === 'completed'
    || (status === 'cancelled' && pay === 'refunded');
}

function buildTaskListView(doc = {}, options = {}) {
  const now = Number(options.now) || Date.now();
  const isOwnerTab = !!options.isOwnerTab;
  const selectedIds = Array.isArray(options.selectedIds) ? options.selectedIds : [];
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  const resolvedCancelState = resolveTaskCancelState(doc);
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
  const statusText = statusRaw === 'cancelled' && payStatus === 'refund_pending'
    ? '退款中'
    : (statusMap[statusRaw] || statusRaw || '已发布');

  const rawDeadline = doc.deadline;
  const createdAt = doc.createdAt;
  const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : null;
  const effectiveDeadline = rawDeadline != null
    ? rawDeadline
    : (createdTs ? (createdTs + ONE_WEEK) : null);
  const hasDeadline = effectiveDeadline != null;
  const isExpired = hasDeadline && effectiveDeadline <= now;
  const isActive = hasDeadline ? effectiveDeadline > now : true;
  let ownerActionText = '';
  if (isOwnerTab) {
    if (statusRaw === 'pay_pending') {
      ownerActionText = '删除';
    } else if (statusRaw === 'posted') {
      ownerActionText = '删除';
    } else if (statusRaw === 'accepted' || statusRaw === 'submitted') {
      ownerActionText = '申请取消';
    } else if (statusRaw === 'completed') {
      ownerActionText = '删除记录';
    } else if (statusRaw === 'cancelled' && payStatus === 'refunded') {
      ownerActionText = '删除记录';
    }
  }

  const id = pickStr(doc._id, doc.id);
  return {
    id,
    title: pickStr(doc.title, '未命名任务'),
    workerId: pickStr(doc.workerId),
    amountText: formatMoney(doc.amount),
    statusRaw,
    payStatus,
    statusText,
    canPay: isOwnerTab && statusRaw === 'pay_pending',
    canEdit: isOwnerTab && statusRaw === 'posted',
    ownerActionText,
    canRefundDirect: isOwnerTab && statusRaw === 'posted',
    needsCancelRequest: isOwnerTab && (statusRaw === 'accepted' || statusRaw === 'submitted'),
    canDeleteRecord: isOwnerTab
      ? canOwnerDeleteTaskRecord(statusRaw, payStatus)
      : canWorkerDeleteTaskRecord(statusRaw, payStatus),
    deadlineText: hasDeadline ? formatDateTime(effectiveDeadline) : '默认 7 天内有效',
    isActive,
    isExpired,
    selected: selectedIds.indexOf(id) > -1,
  };
}

function getPendingRefundTaskIds(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => pickStr(item && item.payStatus) === 'refund_pending')
    .map((item) => pickStr(item && item.id))
    .filter(Boolean)
    .slice(0, 5);
}

function isHardStopRefundSyncError(result = {}) {
  const code = pickStr(result && result.code);
  return code === 'TASK_NOT_FOUND'
    || code === 'NO_PERMISSION'
    || code === 'MISSING_REFUND_META';
}

function getExpiredAutoCleanupTaskIds(docs = [], now = Date.now()) {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_WEEK = 7 * ONE_DAY;
  const ONE_MONTH = 30 * ONE_DAY;
  return (Array.isArray(docs) ? docs : [])
    .map((doc) => {
      const statusRaw = pickStr(doc && doc.status);
      const pay = doc && doc.pay && typeof doc.pay === 'object' ? doc.pay : {};
      const payStatus = pickStr(pay.status);
      const canAutoDelete = statusRaw === 'pay_pending' || (statusRaw === 'cancelled' && payStatus === 'refunded');
      if (!canAutoDelete) return '';
      const rawDeadline = doc && doc.deadline;
      const createdAt = doc && doc.createdAt;
      const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : null;
      const effectiveDeadline = rawDeadline != null
        ? rawDeadline
        : (createdTs ? (createdTs + ONE_WEEK) : null);
      if (!effectiveDeadline) return '';
      return now - effectiveDeadline >= ONE_MONTH ? pickStr(doc && doc._id) : '';
    })
    .filter(Boolean);
}

Page({
  data: {
    tab: 'owner',
    list: [],
    isLoading: true,
    // 批量删除相关
    batchMode: false,      // 是否处于批量选择模式
    selectedIds: [],       // 已选中的任务ID数组
    isAllSelected: false,  // 是否全选
    isPartialSelected: false, // 是否半选
    deletableCount: 0
  },
  _syncingPendingRefunds: false,
  _loadingTasks: false,
  _pendingRefundTimer: null,
  _pendingRefundTaskIds: [],
  _pendingRefundRetryCount: 0,
  _autoCleanupTimer: null,
  _pageVisible: false,
  onShow(){
    this._pageVisible = true;
    this.load();
  },
  onHide(){
    this._pageVisible = false;
    this._stopPendingRefundTimer();
    this._stopAutoCleanupTimer();
  },
  onUnload(){
    this._pageVisible = false;
    this._stopPendingRefundTimer();
    this._stopAutoCleanupTimer();
  },
  setTab(e){
    // 切换 tab 时退出批量模式
    this._stopPendingRefundTimer();
    this._stopAutoCleanupTimer();
    this.setData({ tab: e.currentTarget.dataset.k, batchMode: false, selectedIds: [] }, ()=> this.load());
  },
  load(options = {}){
    const silent = !!(options && options.silent);
    const skipRefundSync = !!(options && options.skipRefundSync);
    if (this._loadingTasks) return;
    this._loadingTasks = true;
    const u = getStoredUser();
    if (!u || !u.id) {
      this._stopPendingRefundTimer();
      this._stopAutoCleanupTimer();
      this._loadingTasks = false;
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }
    if (!u.realname) {
      this._stopPendingRefundTimer();
      this._stopAutoCleanupTimer();
      this._loadingTasks = false;
      toast('请先完成实名后再查看任务');
      wx.navigateTo({ url: '/pages/auth/realname/index' });
      return;
    }

    const userId = u.id || '';
    if (!userId) {
      this._stopPendingRefundTimer();
      this._stopAutoCleanupTimer();
      this._loadingTasks = false;
      this.setData({ list: [], isLoading: false });
      return;
    }

    if (!silent) {
      this.setData({ isLoading: true });
    }

    // owner：我发布的；worker：我接受的（目前暂未真正接单，可能为空）
    const field = this.data.tab === 'owner' ? 'ownerId' : 'workerId';

    db.collection(TASK_COLLECTION)
      .where({ [field]: userId })
      .field({
        title: true,
        amount: true,
        status: true,
        pay: true,
        cancelRequest: true,
        deadline: true,
        createdAt: true,
        ownerDeletedAt: true,
        workerDeletedAt: true,
        workerId: true,
      })
      .orderBy('createdAt', 'desc')
      .get({
        success: (res) => {
          const now = Date.now();
          const isOwnerTab = this.data.tab === 'owner';
          const prevSelectedIds = Array.isArray(this.data.selectedIds) ? this.data.selectedIds : [];
          const docs = (res.data || []).filter((doc) => {
            if (isOwnerTab) {
              return !doc || !doc.ownerDeletedAt;
            }
            return !doc || !doc.workerDeletedAt;
          });

          const list = docs.map((doc) => buildTaskListView(doc, {
            now,
            isOwnerTab,
            selectedIds: prevSelectedIds,
          }));
          const deletableIds = isOwnerTab
            ? list.filter((item) => item && item.canDeleteRecord).map((item) => item.id)
            : [];
          const selectedIds = isOwnerTab
            ? prevSelectedIds.filter((id) => deletableIds.indexOf(id) > -1)
            : [];
          if (selectedIds.length !== prevSelectedIds.length) {
            list.forEach((item) => {
              item.selected = selectedIds.indexOf(item.id) > -1;
            });
          }
          const isAllSelected = !!(deletableIds.length && selectedIds.length === deletableIds.length);
          const isPartialSelected = !!(selectedIds.length && selectedIds.length < deletableIds.length);

          this.setData({
            list,
            isLoading: false,
            selectedIds,
            isAllSelected,
            isPartialSelected,
            deletableCount: isOwnerTab ? deletableIds.length : 0
          });
          this._scheduleAutoCleanup(docs, now);
          if (skipRefundSync) {
            this._updatePendingRefundTimer(list);
          } else {
            this._pendingRefundRetryCount = 0;
            this._syncPendingRefunds(list);
          }
          this._loadingTasks = false;
        },
        fail: (err) => {
          console.error('加载我的任务失败', err);
          this._stopPendingRefundTimer();
          this._stopAutoCleanupTimer();
          this.setData({ isLoading: false, list: [] });
          this._loadingTasks = false;
          wx.showToast({ title: '任务加载失败', icon: 'none' });
        }
      });
  },
  _schedulePendingRefundSync() {
    if (!this._pageVisible || !this._pendingRefundTaskIds.length) return;
    if (this._pendingRefundTimer) {
      clearTimeout(this._pendingRefundTimer);
      this._pendingRefundTimer = null;
    }
    const delay = Math.min(
      REFUND_SYNC_MIN_DELAY_MS * Math.pow(2, Math.max(0, this._pendingRefundRetryCount - 1)),
      REFUND_SYNC_MAX_DELAY_MS
    );
    this._pendingRefundTimer = setTimeout(() => {
      this._pendingRefundTimer = null;
      if (!this._pageVisible) return;
      this._syncPendingRefunds();
    }, delay);
  },
  _stopPendingRefundTimer() {
    if (this._pendingRefundTimer) {
      clearTimeout(this._pendingRefundTimer);
      this._pendingRefundTimer = null;
    }
    this._pendingRefundTaskIds = [];
    this._pendingRefundRetryCount = 0;
  },
  _updatePendingRefundTimer(list = []) {
    const pendingTaskIds = getPendingRefundTaskIds(list);
    this._pendingRefundTaskIds = pendingTaskIds;
    if (pendingTaskIds.length) {
      this._schedulePendingRefundSync();
    } else {
      this._stopPendingRefundTimer();
    }
  },
  _syncPendingRefunds(list = []) {
    if (this._syncingPendingRefunds) return;
    const pendingTaskIds = (Array.isArray(list) && list.length)
      ? getPendingRefundTaskIds(list)
      : (Array.isArray(this._pendingRefundTaskIds) ? this._pendingRefundTaskIds.slice(0, 5) : []);
    if (!pendingTaskIds.length) {
      this._stopPendingRefundTimer();
      return;
    }
    if (!this._pageVisible) return;
    this._pendingRefundTaskIds = pendingTaskIds;

    this._syncingPendingRefunds = true;
    wx.cloud.callFunction({
      name: 'taskCancelFlow',
      data: {
        action: 'batch_sync_refund_status',
        taskIds: pendingTaskIds,
      }
    }).then((res) => {
      const result = res && res.result ? res.result : null;
      const results = result && Array.isArray(result.results) ? result.results : [];
      if (!result || result.ok !== true || !results.length) {
        this._pendingRefundRetryCount += 1;
        this._schedulePendingRefundSync();
        return;
      }
      const shouldReload = results.some((item) => !!(item && item.ok && (item.changed || item.already)));
      const retryTaskIds = results
        .filter((item) => {
          if (!item) return false;
          if (item.ok) {
            return !!item.stillPending || pickStr(item.refundStatus, item.refund && item.refund.status) === 'processing';
          }
          return !isHardStopRefundSyncError(item);
        })
        .map((item) => pickStr(item && item.taskId))
        .filter(Boolean);
      if (shouldReload) {
        this._pendingRefundTaskIds = retryTaskIds;
        this._pendingRefundRetryCount = 0;
        this.load({ silent: true, skipRefundSync: true });
        return;
      }
      if (retryTaskIds.length) {
        this._pendingRefundTaskIds = retryTaskIds;
        this._pendingRefundRetryCount += 1;
        this._schedulePendingRefundSync();
      } else {
        this._stopPendingRefundTimer();
      }
    }).catch((err) => {
      console.error('同步退款状态失败', err);
      this._pendingRefundRetryCount += 1;
      this._schedulePendingRefundSync();
    }).finally(() => {
      this._syncingPendingRefunds = false;
    });
  },
  _stopAutoCleanupTimer() {
    if (this._autoCleanupTimer) {
      clearTimeout(this._autoCleanupTimer);
      this._autoCleanupTimer = null;
    }
  },
  _scheduleAutoCleanup(docs = [], now = Date.now()) {
    this._stopAutoCleanupTimer();
    if (!this._pageVisible || this.data.tab !== 'owner') return;
    const expiredTooLongIds = getExpiredAutoCleanupTaskIds(docs, now);
    if (!expiredTooLongIds.length) return;
    const lastAt = Number(wx.getStorageSync(AUTO_CLEAN_STORAGE_KEY)) || 0;
    if (lastAt && now - lastAt < AUTO_CLEAN_COOLDOWN_MS) return;
    this._autoCleanupTimer = setTimeout(() => {
      this._autoCleanupTimer = null;
      if (!this._pageVisible || this.data.tab !== 'owner') return;
      wx.setStorageSync(AUTO_CLEAN_STORAGE_KEY, Date.now());
      Promise.all(expiredTooLongIds.map((id) => this._deleteTaskWithMessages(id)))
        .then(() => {
          if (this._pageVisible && this.data.tab === 'owner') {
            this.load({ silent: true, skipRefundSync: true });
          }
        })
        .catch((err) => {
          console.error('自动清理过期任务失败', err);
        });
    }, AUTO_CLEAN_DELAY_MS);
  },
  async onDeleteTask(e){
    const id = e.currentTarget.dataset.id;
    if (!id) { return; }

    const list = this.data.list || [];
    const item = list.find(t => t.id === id || t._id === id) || null;
    if (!item) {
      toast('任务不存在');
      return;
    }

    if (this.data.tab === 'worker') {
      if (!item.canDeleteRecord) {
        toast('当前任务暂不能删除记录');
        return;
      }

      const okDeleteWorkerRecord = await confirm('删除后只会从“我接受的”里移除，不会影响发布者记录和任务聊天。', '删除记录');
      if (!okDeleteWorkerRecord) return;

      this.setData({ isLoading: true });
      try {
        await this._deleteTaskWithMessages(id, 'worker_record');
        toast('已删除');
        this.load();
      } catch (err) {
        console.error('删除接单记录失败', err);
        this.setData({ isLoading: false });
        toast((err && err.message) || '删除失败，请稍后重试');
      }
      return;
    }

    // 只允许在“我发布的”标签下删除任务本身
    if (this.data.tab !== 'owner') {
      toast('只有自己发布的任务可以删除');
      return;
    }

    if (item.needsCancelRequest) {
      if (!item.workerId) {
        toast('缺少接单人信息，暂时无法发起取消申请');
        return;
      }
      const okGotoChat = await confirm('该任务已被接单，取消必须先征得接单人同意。现在去聊天里发起取消申请？', '去发起');
      if (!okGotoChat) return;
      wx.navigateTo({ url: `/pages/chat/room/index?tid=${id}&peerUserId=${item.workerId}` });
      return;
    }

    if (item.canRefundDirect) {
      const goRefund = await confirm('该任务已付款，请先发起退款，退款完成后再删除记录。现在去任务详情发起退款？', '先退款');
      if (!goRefund) return;
      wx.navigateTo({ url: `/pages/task/detail/index?id=${id}` });
      return;
    }

    if (!item.canDeleteRecord) {
      toast('当前任务请先处理退款或取消，再删除记录');
      return;
    }

    const ok = await confirm('确定要删除这个任务吗？删除后无法恢复。', item.canDeleteRecord ? '删除记录' : '删除任务');
    if (!ok) return;

    this.setData({ isLoading: true });

    try {
      // 通过云函数删除任务及其下所有聊天记录（文字 + 图片）
      await this._deleteTaskWithMessages(id);
      toast('已删除');
      // 删除成功后刷新列表
      this.load();
    } catch (err) {
      console.error('删除任务失败', err);
      this.setData({ isLoading: false });
      toast((err && err.message) || '删除失败，请稍后重试');
    }
  },
  // 编辑我发布的任务：跳转到发布页，并带上要编辑的任务 ID
  async onEditTask(e){
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const res = await db.collection(TASK_COLLECTION).doc(id).get();
      const task = (res && res.data) || null;
      wx.hideLoading();
      if (!task) {
        toast('任务不存在');
        return;
      }
      wx.setStorageSync('hyyc_edit_task_id', id);
      wx.setStorageSync('hyyc_edit_task_data', task);
      wx.switchTab({ url: '/pages/publish/index/index' });
    } catch (err) {
      console.error('加载待编辑任务失败', err);
      wx.hideLoading();
      toast('加载任务失败，请稍后重试');
    }
  },
  // 对“待付款(pay_pending)”的任务，继续拉起支付
  async onPayTask(e){
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    const ok = await confirm('该任务还未付款，继续支付后才会对外展示。是否继续？', '继续支付');
    if (!ok) return;

    // 取小程序 appid（用于 Huifu 的 wx_data.sub_appid）
    let appid = '';
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
      appid = info && info.miniProgram ? (info.miniProgram.appId || '') : '';
    } catch (e2) {
      // ignore
    }

    wx.showLoading({ title: '生成 pay_info', mask: true });
    try {
      const payRes = await wx.cloud.callFunction({
        name: 'huifuMiniappPay',
        data: {
          action: 'delay_jspay_task',
          taskId: id,
          subAppid: appid || undefined,
        }
      });
      const pr = payRes && payRes.result ? payRes.result : null;
      if (!pr || !pr.ok) {
        wx.hideLoading();
        const msg = (pr && pr.err)
          ? (typeof pr.err === 'string' ? pr.err : (pr.err.msg || '下单失败'))
          : '下单失败';
        toast(msg);
        return;
      }

      wx.showLoading({ title: '调起支付', mask: true });
      await wx.requestPayment({ ...(pr.payParams || {}) });

      wx.showLoading({ title: '更新状态', mask: true });
      const payOkRes = await wx.cloud.callFunction({
        name: 'taskPaySuccess',
        data: { taskId: id }
      });
      const por = payOkRes && payOkRes.result ? payOkRes.result : null;
      wx.hideLoading();
      if (!por || !por.ok) {
        toast('支付成功，但状态更新失败（稍后刷新重试）');
        return;
      }

      toast('已发布');
      this.load();
    } catch (err) {
      console.error('继续支付失败', err);
      wx.hideLoading();
      const msg = (err && err.errMsg && String(err.errMsg).indexOf('cancel') > -1) ? '支付已取消' : '支付失败';
      toast(msg);
    }
  },
  // 查看我发布的任务详情：与任务广场的详情逻辑保持一致
  toDetailOwner(e){
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/task/detail/index?id=${id}` });
  },
  toDetail(e){
    const { id, role } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/task/detail/index?id=${id}&role=${role||''}&accepted=1` });
  },

  // ========== 批量删除相关方法 ==========

  // 进入/退出批量选择模式
  toggleBatchMode(){
    const batchMode = !this.data.batchMode;
    this.setData({ batchMode, selectedIds: [] });
  },

  // 切换单个任务的选中状态
  toggleSelect(e){
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const list = this.data.list || [];
    const item = list.find(task => task && task.id === id);
    if (!item || !item.canDeleteRecord) {
      toast('该任务当前不能删除');
      return;
    }
    const selectedIds = [...this.data.selectedIds];
    const idx = selectedIds.indexOf(id);
    if (idx > -1) {
      selectedIds.splice(idx, 1);
    } else {
      selectedIds.push(id);
    }
    this._updateSelectState(selectedIds);
  },

  // 全选/取消全选
  toggleSelectAll(){
    const { list, selectedIds } = this.data;
    const allIds = list.filter(item => item && item.canDeleteRecord).map(item => item.id);
    if (!allIds.length) {
      toast('当前没有可删除的任务');
      return;
    }
    // 如果已经全选，则取消全选；否则全选
    if (selectedIds.length === allIds.length) {
      this._updateSelectState([]);
    } else {
      this._updateSelectState(allIds);
    }
  },

  // 更新选中状态（同步更新 list 中每个 item 的 selected 属性）
  _updateSelectState(selectedIds){
    const list = this.data.list.map(item => ({
      ...item,
      selected: selectedIds.indexOf(item.id) > -1
    }));
    const deletableCount = list.filter(item => item && item.canDeleteRecord).length;
    // 计算是否全选、是否半选
    const isAllSelected = deletableCount > 0 && selectedIds.length > 0 && selectedIds.length === deletableCount;
    const isPartialSelected = selectedIds.length > 0 && selectedIds.length < deletableCount;
    this.setData({ selectedIds, list, isAllSelected, isPartialSelected, deletableCount });
  },

  // 删除单个任务及其下所有聊天记录
  // 为了绕过小程序端数据库权限（例如 messages 集合“仅创建者可写”），
  // 这里统一通过云函数 deleteTaskWithMessages 来执行真正的删除逻辑。
  _deleteTaskWithMessages(taskId, mode = ''){
    if (!taskId) return Promise.resolve();
    return wx.cloud.callFunction({
      name: 'deleteTaskWithMessages',
      data: {
        tid: taskId,
        mode: pickStr(mode),
      }
    }).then(res => {
      const result = (res && res.result) || {};
      if (!result || result.ok !== true) {
        const msg = (result && result.msg) || '删除失败，请稍后重试';
        // 抛出错误让调用方走到 catch 分支，不要误以为删除成功
        return Promise.reject(new Error(msg));
      }
      return result;
    });
  },

  // 批量删除
  async onBatchDelete(){
    const { selectedIds } = this.data;
    if (!selectedIds.length) {
      toast('请先选择要删除的任务');
      return;
    }

    // 保护：批量删除只针对“我发布的”任务
    if (this.data.tab !== 'owner') {
      toast('只能批量删除自己发布的任务');
      return;
    }

    const ok = await confirm(`确定要删除选中的 ${selectedIds.length} 个任务吗？删除后无法恢复。`, '批量删除');
    if (!ok) return;

    this.setData({ isLoading: true });

    try {
      // 逐个删除选中的任务及其聊天记录
      const promises = selectedIds.map(id => this._deleteTaskWithMessages(id));
      await Promise.all(promises);
      toast(`已删除 ${selectedIds.length} 个任务`);
      // 退出批量模式并刷新列表
      this.setData({ batchMode: false, selectedIds: [] });
      this.load();
    } catch (err) {
      console.error('批量删除任务失败', err);
      this.setData({ isLoading: false });
      toast((err && err.message) || '删除失败，请稍后重试');
    }
  }
});
