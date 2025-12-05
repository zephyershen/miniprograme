const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');

// 使用云开发数据库 tasks 集合加载「我的任务」
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';

Page({
  data: {
    tab: 'owner',
    list: [],
    isLoading: true,
    // 批量删除相关
    batchMode: false,      // 是否处于批量选择模式
    selectedIds: [],       // 已选中的任务ID数组
    isAllSelected: false,  // 是否全选
    isPartialSelected: false // 是否半选
  },
  onShow(){ this.load(); },
  setTab(e){
    // 切换 tab 时退出批量模式
    this.setData({ tab: e.currentTarget.dataset.k, batchMode: false, selectedIds: [] }, ()=> this.load());
  },
  load(){
    const u = wx.getStorageSync('hyyc_user') || {};
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/auth/realname/index' });
      return;
    }

    const userId = u.id || '';
    if (!userId) {
      this.setData({ list: [], isLoading: false });
      return;
    }

    this.setData({ isLoading: true });

    // owner：我发布的；worker：我接受的（目前暂未真正接单，可能为空）
    const field = this.data.tab === 'owner' ? 'ownerId' : 'workerId';

    db.collection(TASK_COLLECTION)
      .where({ [field]: userId })
      .orderBy('createdAt', 'desc')
      .get({
        success: (res) => {
          const now = Date.now();
          const list = (res.data || []).map(doc => {
            const deadlineTs = doc.deadline;
            const hasDeadline = deadlineTs != null;
            const isExpired = hasDeadline && deadlineTs <= now;
            const isActive = !hasDeadline || deadlineTs > now;
            return {
              ...doc,
              id: doc._id,
              amountText: formatMoney(doc.amount),
              // 未设置截止时间时，显示「不限」
              deadlineText: hasDeadline ? formatDateTime(deadlineTs) : '不限',
              isActive,
              isExpired
            };
          });
          this.setData({ list, isLoading: false });
        },
        fail: (err) => {
          console.error('加载我的任务失败', err);
          this.setData({ isLoading: false, list: [] });
          wx.showToast({ title: '任务加载失败', icon: 'none' });
        }
      });
  },
  async onDeleteTask(e){
    const id = e.currentTarget.dataset.id;
    if (!id) { return; }

    // 只允许在“我发布的”标签下删除
    if (this.data.tab !== 'owner') {
      toast('只有自己发布的任务可以删除');
      return;
    }

    const ok = await confirm('确定要删除这个任务吗？删除后无法恢复。', '删除任务');
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
      toast('删除失败，请稍后重试');
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
    wx.switchTab({ url: '/pages/task/publish/index' });
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
    const allIds = list.map(item => item.id);
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
    // 计算是否全选、是否半选
    const isAllSelected = selectedIds.length > 0 && selectedIds.length === list.length;
    const isPartialSelected = selectedIds.length > 0 && selectedIds.length < list.length;
    this.setData({ selectedIds, list, isAllSelected, isPartialSelected });
  },

  // 删除单个任务及其下所有聊天记录
  // 为了绕过小程序端数据库权限（例如 messages 集合“仅创建者可写”），
  // 这里统一通过云函数 deleteTaskWithMessages 来执行真正的删除逻辑。
  _deleteTaskWithMessages(taskId){
    if (!taskId) return Promise.resolve();
    return wx.cloud.callFunction({
      name: 'deleteTaskWithMessages',
      data: { tid: taskId }
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
      toast('删除失败，请稍后重试');
    }
  }
});
