const { formatMoney, formatDateTime } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');

// 使用云开发数据库 tasks 集合加载任务详情
const db = wx.cloud.database();
const TASK_COLLECTION = 'tasks';

Page({
  data: { task: {}, isOwner: false, accepted: false, isLoading: true },
  onLoad(q){
    this.setData({ isLoading: true });
    const id = q.id;
    if (!id) {
      toast('缺少任务 ID');
      this.setData({ isLoading: false });
      return;
    }

    db.collection(TASK_COLLECTION).doc(id).get({
      success: (res) => {
        const t = res.data || {};
        const task = {
          ...t,
          id,
          amountText: formatMoney(t.amount),
          // 未设置截止时间时，显示「不限」
          deadlineText: t.deadline ? formatDateTime(t.deadline) : '不限',
          statusText: t.status === 'posted' ? '已发布' : (t.status || '')
        };
        this.setData({
          task,
          isOwner: q.role === 'owner',
          accepted: q.accepted === '1',
          isLoading: false
        });
      },
      fail: (err) => {
        console.error('加载任务详情失败', err);
        this.setData({ isLoading: false });
        toast('任务不存在或已被删除');
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
  accept(){ toast('已接受（演示）'); this.setData({ accepted: true }); },
  toChat(){ wx.navigateTo({ url: '/pages/chat/room/index?tid=' + this.data.task.id }); },
  toSubmit(){ wx.navigateTo({ url: '/pages/task/submit/index?tid=' + this.data.task.id }); },
  async approve(){
    const ok = await confirm('确认任务已完成并打款给对方？');
    if (ok) { toast('已确认完成（演示）'); }
  }
});
