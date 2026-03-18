const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');
const { getStoredUser } = require('../../../utils/userIdentity');

// 使用云开发数据库 tasks 集合加载「我的任务」
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';
const REFUND_SYNC_INTERVAL_MS = 3000;

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
  onShow(){ this.load(); },
  onHide(){ this._stopPendingRefundTimer(); },
  onUnload(){ this._stopPendingRefundTimer(); },
  setTab(e){
    // 切换 tab 时退出批量模式
    this._stopPendingRefundTimer();
    this.setData({ tab: e.currentTarget.dataset.k, batchMode: false, selectedIds: [] }, ()=> this.load());
  },
  load(options = {}){
    const silent = !!(options && options.silent);
    if (this._loadingTasks) return;
    this._loadingTasks = true;
    const u = getStoredUser();
    if (!u || !u.realname) {
      this._loadingTasks = false;
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    const userId = u.id || '';
    if (!userId) {
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
      .orderBy('createdAt', 'desc')
      .get({
        success: (res) => {
          const now = Date.now();
          const ONE_DAY = 24 * 60 * 60 * 1000;
          const ONE_WEEK = 7 * ONE_DAY;
          const ONE_MONTH = 30 * ONE_DAY;
          const isOwnerTab = this.data.tab === 'owner';
          const docs = (res.data || []).filter((doc) => {
            if (isOwnerTab) {
              return !doc || !doc.ownerDeletedAt;
            }
            return !doc || !doc.workerDeletedAt;
          });

          const list = docs.map(doc => {
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
            // 没有设置截止时间时，默认从创建时间起 7 天内有效
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
            return {
              ...doc,
              id: doc._id,
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
              // 未设置截止时间时，展示默认过期时间
              deadlineText: hasDeadline ? formatDateTime(effectiveDeadline) : '默认 7 天内有效',
              isActive,
              isExpired
            };
          });

          this.setData({
            list,
            isLoading: false,
            deletableCount: isOwnerTab ? list.filter(item => item && item.canDeleteRecord).length : 0
          });
          this._syncPendingRefunds(list);
          this._updatePendingRefundTimer(list);
          this._loadingTasks = false;

          // 仅在“我发布的”列表中，自动清理：已过期且超过 30 天的任务（连同聊天记录一起删除）
          if (this.data.tab === 'owner' && docs.length) {
              const expiredTooLongIds = docs
              .map(doc => {
                const statusRaw = (doc.status == null ? '' : String(doc.status).trim());
                const pay = doc.pay && typeof doc.pay === 'object' ? doc.pay : {};
                const payStatus = (pay.status == null ? '' : String(pay.status).trim());
                const canAutoDelete = statusRaw === 'pay_pending' || (statusRaw === 'cancelled' && payStatus === 'refunded');
                if (!canAutoDelete) return null;
                const rawDeadline = doc.deadline;
                const createdAt = doc.createdAt;
                const createdTs = createdAt && createdAt.getTime ? createdAt.getTime() : null;
                const effectiveDeadline = rawDeadline != null
                  ? rawDeadline
                  : (createdTs ? (createdTs + ONE_WEEK) : null);
                if (!effectiveDeadline) return null;
                if (now - effectiveDeadline >= ONE_MONTH) {
                  return doc._id;
                }
                return null;
              })
              .filter(id => !!id);

            if (expiredTooLongIds.length) {
              Promise.all(
                expiredTooLongIds.map(id => this._deleteTaskWithMessages(id))
              ).then(() => {
                // 自动清理后刷新一次列表
                this.load();
              }).catch(err => {
                console.error('自动清理过期任务失败', err);
              });
            }
          }
        },
        fail: (err) => {
          console.error('加载我的任务失败', err);
          this.setData({ isLoading: false, list: [] });
          this._loadingTasks = false;
          wx.showToast({ title: '任务加载失败', icon: 'none' });
        }
      });
  },
  _startPendingRefundTimer() {
    if (this._pendingRefundTimer) return;
    this._pendingRefundTimer = setInterval(() => {
      this.load({ silent: true });
    }, REFUND_SYNC_INTERVAL_MS);
  },
  _stopPendingRefundTimer() {
    if (this._pendingRefundTimer) {
      clearInterval(this._pendingRefundTimer);
      this._pendingRefundTimer = null;
    }
  },
  _updatePendingRefundTimer(list = []) {
    const hasPendingRefund = (Array.isArray(list) ? list : [])
      .some(item => pickStr(item && item.payStatus) === 'refund_pending');
    if (hasPendingRefund) {
      this._startPendingRefundTimer();
    } else {
      this._stopPendingRefundTimer();
    }
  },
  _syncPendingRefunds(list = []) {
    if (this._syncingPendingRefunds) return;
    const pendingTaskIds = (Array.isArray(list) ? list : [])
      .filter(item => pickStr(item && item.payStatus) === 'refund_pending')
      .map(item => pickStr(item && item.id))
      .filter(Boolean)
      .slice(0, 5);
    if (!pendingTaskIds.length) return;

    this._syncingPendingRefunds = true;
    Promise.allSettled(
      pendingTaskIds.map(taskId => wx.cloud.callFunction({
        name: 'taskCancelFlow',
        data: {
          action: 'sync_refund_status',
          taskId,
        }
      }))
    ).then((results) => {
      const shouldReload = results.some((item) => {
        const ret = item && item.status === 'fulfilled' && item.value ? item.value.result : null;
        return !!(
          ret
          && ret.ok
          && (ret.already || (ret.refund && pickStr(ret.refund.status) === 'success'))
        );
      });
      if (shouldReload) this.load({ silent: true });
    }).finally(() => {
      this._syncingPendingRefunds = false;
    });
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
  onEditTask(e){
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // 在当前列表中找到对应任务的数据，方便在发布页直接回填，而不用再请求一次云端
    const list = this.data.list || [];
    const task = list.find(t => t.id === id || t._id === id) || null;
    // 把要编辑的任务 ID 和原始任务对象暂存到本地，再切换到底部「发布」tab
    wx.setStorageSync('hyyc_edit_task_id', id);
    if (task) {
      wx.setStorageSync('hyyc_edit_task_data', task);
    }
    wx.switchTab({ url: '/pages/publish/index/index' });
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
