const { tasks } = require('../../../utils/mock');
const { formatMoney, formatDate } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');

Page({
  data: { task: {}, isOwner: false, accepted: false, isLoading: true },
  onLoad(q){
    this.setData({ isLoading: true });
    setTimeout(() => {
      const t = tasks.find(i=>i.id===q.id) || tasks[0];
      this.setData({ 
        task: { ...t, amountText: formatMoney(t.amount), deadlineText: formatDate(t.deadline), statusText: '已发布' },
        isOwner: q.role==='owner', 
        accepted: q.accepted==='1',
        isLoading: false
      });
    }, 600);
  },
  accept(){ toast('已接受（演示）'); this.setData({ accepted: true }); },
  toChat(){ wx.navigateTo({ url: '/pages/chat/room/index?tid=' + this.data.task.id }); },
  toSubmit(){ wx.navigateTo({ url: '/pages/task/submit/index?tid=' + this.data.task.id }); },
  async approve(){
    const ok = await confirm('确认任务已完成并打款给对方？');
    if (ok) { toast('已确认完成（演示）'); }
  }
});

