const { tasks } = require('../../../utils/mock');
const { formatMoney, formatDate } = require('../../../utils/format');

Page({
  data: { tab: 'owner', list: [] },
  onShow(){ this.load(); },
  setTab(e){ this.setData({ tab: e.currentTarget.dataset.k }, ()=> this.load()); },
  load(){
    const list = tasks.map(t=>({ ...t, amountText: formatMoney(t.amount), deadlineText: formatDate(t.deadline) }));
    this.setData({ list });
  },
  toDetail(e){
    const { id, role } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/task/detail/index?id=${id}&role=${role||''}&accepted=1` });
  }
});
