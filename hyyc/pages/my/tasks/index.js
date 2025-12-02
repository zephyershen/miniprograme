const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');

// 使用云开发数据库 tasks 集合加载「我的任务」
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';

Page({
  data: { tab: 'owner', list: [], isLoading: true },
  onShow(){ this.load(); },
  setTab(e){ this.setData({ tab: e.currentTarget.dataset.k }, ()=> this.load()); },
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
          const list = (res.data || []).map(doc => ({
            ...doc,
            id: doc._id,
            amountText: formatMoney(doc.amount),
            // 未设置截止时间时，显示「不限」
            deadlineText: doc.deadline ? formatDateTime(doc.deadline) : '不限'
          }));
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
      await db.collection(TASK_COLLECTION).doc(id).remove();
      toast('已删除');
      // 删除成功后刷新列表
      this.load();
    } catch (err) {
      console.error('删除任务失败', err);
      this.setData({ isLoading: false });
      toast('删除失败，请稍后重试');
    }
  },
  toDetail(e){
    const { id, role } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/task/detail/index?id=${id}&role=${role||''}&accepted=1` });
  }
});
