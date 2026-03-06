const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');
const access = require('../../../config/access');

// 使用云开发数据库 tasks 集合加载任务详情
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';
const MSG_COLLECTION = 'messages';

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
		  onLoad(q){
    this.setData({ isLoading: true });
    const id = q.id;
    if (!id) {
      toast('缺少任务 ID');
      this.setData({ isLoading: false });
      return;
    }

    const me = wx.getStorageSync('hyyc_user') || {};
    const myId = me.id || '';

    db.collection(TASK_COLLECTION).doc(id).get({
      success: (res) => {
        const t = res.data || {};
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

        const statusRaw = (t.status == null ? '' : String(t.status).trim());
        const statusMap = {
          '': '已发布',
          posted: '已发布',
          pay_pending: '待付款',
          accepted: '已接单',
          submitted: '待确认',
          completed: '已完成',
          cancelled: '已取消'
        };
        const statusText = isExpired ? '已过期' : (statusMap[statusRaw] || statusRaw || '已发布');

        const task = {
          ...t,
          id,
          amountText: formatMoney(t.amount),
          // 截止时间：未设置则展示默认过期时间
          deadlineText: effectiveDeadline ? formatDateTime(effectiveDeadline) : '默认 7 天内有效',
          // 状态：如果已过期，优先展示“已过期”
          statusText,
          locationText
        };

        // 是否为任务发布人：根据 ownerId 和当前登录用户 id 判断
		        const isOwner = !!(myId && t.ownerId && myId === t.ownerId);
        const isWorker = !!(myId && t.workerId && myId === t.workerId);

        const canAccept = !isOwner && !isExpired && (statusRaw === '' || statusRaw === 'posted');
        const canSubmit = !isOwner && isWorker && statusRaw === 'accepted';
        const canApprove = isOwner && statusRaw === 'submitted';
        const accepted = isWorker && (statusRaw === 'accepted' || statusRaw === 'submitted');

	        this.setData({
	          task,
	          isOwner,
	          accepted,
	          isWorker,
	          canAccept,
	          canSubmit,
	          canApprove,
	          isLoading: false
	        });

		        // 根据当前身份分别统计未读：
		        // - 任务发布者：统计所有住户会话的未读数量（以会话计）
		        // - 普通住户：统计自己与业主会话中的未读消息条数
		        if (isOwner) {
		          this.loadUnreadCount(task.id, myId);
		          this.setupBadgeWatch(task, myId, true);
		        } else if (t.ownerId) {
		          this.loadPeerUnread(task.id, t.ownerId, myId);
		          this.setupBadgeWatch(task, myId, false);
		        }
      },
      fail: (err) => {
        console.error('加载任务详情失败', err);
        this.setData({ isLoading: false });
        toast('任务不存在或已被删除');
      }
    });
  },
		  onShow(){
		    // 从其它页面返回时刷新未读数 + 重新挂载实时监听
		    const task = this.data.task || {};
		    if (!task.id) return;
		    const me = wx.getStorageSync('hyyc_user') || {};
		    const myId = me.id || '';
		    if (!myId) return;
		    if (this.data.isOwner) {
		      // 任务发布者：刷新所有住户会话的未读数量（以会话计数）
		      this.loadUnreadCount(task.id, myId);
		      this.setupBadgeWatch(task, myId, true);
		    } else {
		      // 普通住户：刷新自己这一端的未读消息数量
		      this.loadPeerUnread(task.id, task.ownerId, myId);
		      this.setupBadgeWatch(task, myId, false);
		    }
		  },

		  onHide(){
		    // 离开详情页时关闭监听，避免重复监听和资源浪费
		    this.clearBadgeWatch();
		  },

		  onUnload(){
		    this.clearBadgeWatch();
		  },
	  // 统计当前任务下，发布者视角的未读消息总数（按“消息条数”统计）
	  loadUnreadCount(tid, ownerId){
    if (!tid || !ownerId) {
      this.setData({ unreadCount: 0 });
      return;
    }
    this.setData({ unreadCount: 0 });
	    db.collection(MSG_COLLECTION)
	      .where({ tid, ownerId })
	      .orderBy('createTime', 'desc')
	      .limit(500)
	      .get({
	        success: (res) => {
	          const docs = (res && res.data) || [];
	          // 业主未读 = 所有来自住户、且 readByOwner !== true 的消息条数之和
	          const unreadTotal = (docs || []).filter(doc => {
	            return doc.fromUserId && doc.fromUserId !== ownerId && doc.readByOwner !== true;
	          }).length;
	          this.setData({ unreadCount: unreadTotal });
	        },
	        fail: (err) => {
	          console.error('统计未读消息失败', err);
	          this.setData({ unreadCount: 0 });
	        }
	      });
	  },
		  // 普通住户视角：统计当前任务下与业主会话中的未读消息条数
	  loadPeerUnread(tid, ownerId, peerUserId){
	    if (!tid || !ownerId || !peerUserId) {
	      this.setData({ peerUnreadCount: 0 });
	      return;
	    }
	    this.setData({ peerUnreadCount: 0 });
	    db.collection(MSG_COLLECTION)
	      .where({ tid, ownerId, peerUserId })
	      .orderBy('createTime', 'desc')
	      .limit(200)
	      .get({
	        success: (res) => {
	          const docs = (res && res.data) || [];
	          // 对住户来说：未读消息 = 来自业主的消息，且 readByPeer !== true
	          const unread = (docs || []).filter(doc => {
	            return doc.fromUserId === ownerId && doc.readByPeer !== true;
	          }).length;
	          this.setData({ peerUnreadCount: unread });
	        },
	        fail: (err) => {
	          console.error('统计住户未读消息失败', err);
	          this.setData({ peerUnreadCount: 0 });
	        }
		      });
	  },

	  // 根据当前身份，为任务详情页挂载实时监听，用于实时刷新未读角标
	  setupBadgeWatch(task, myId, isOwner){
	    if (!task || !task.id || !task.ownerId || !myId) {
	      this.clearBadgeWatch();
	      return;
	    }
	    if (isOwner) {
	      this.openOwnerBadgeWatch(task.id, myId);
	    } else {
	      this.openPeerBadgeWatch(task.id, task.ownerId, myId);
	    }
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
  toChat(){ wx.navigateTo({ url: '/pages/chat/room/index?tid=' + this.data.task.id }); },
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

      toast('已确认完成');
      wx.redirectTo({ url: '/pages/task/detail/index?id=' + task.id });
    } catch (err) {
      console.error('确认完成失败', err);
      wx.hideLoading();
      toast('确认完成失败');
    }
  }
});
