const { tasks } = require('../../../utils/mock');
const { formatMoney, formatDate } = require('../../../utils/format');

Page({
  data: { filter: 'all', list: [], isLoading: true },
  onShow(){
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      // 未实名用户，先进入带 Lottie 动画的欢迎页（再由后续逻辑决定去登录/注册）
      wx.navigateTo({ url: '/pages/auth/welcome/index' });
      return;
    }
    this.load();
  },
  changeFilter(e){ this.setData({ filter: e.currentTarget.dataset.k }, ()=> this.load()); },
  load(){
    this.setData({ isLoading: true });
    setTimeout(() => {
      const u = wx.getStorageSync('hyyc_user')||{};
      const userBuilding = (u.building||'').trim();
      let list = tasks.map(t=>({
        ...t,
        amountText: formatMoney(t.amount),
        deadlineText: formatDate(t.deadline),
        statusText: t.status==='posted'?'已发布':t.status
      }));

      if (this.data.filter==='money') {
        list = list.sort((a,b)=>b.amount-a.amount);
      } else if (this.data.filter==='new') {
        list = list.sort((a,b)=>b.deadline-a.deadline);
      } else if (this.data.filter==='building') {
        if (!userBuilding) {
          wx.showModal({ title:'提示', content:'请先在实名里填写楼栋，便于筛选本楼栋任务',
            success: (res)=>{ if(res.confirm){ wx.navigateTo({ url:'/pages/auth/realname/index' }); } }
          });
        } else {
          list = list.filter(t=>{
            const b = (t.building || this.parseBuilding(t.address) || '').trim();
            return b && b === userBuilding;
          });
        }
      }
      this.setData({ list, isLoading: false });
    }, 800);
  },
  parseBuilding(addr=''){
    const m = String(addr).match(/([0-9]+|[一二三四五六七八九十]+)栋/);
    return m ? (m[1] + '栋') : '';
  },
  goPublish(){ wx.switchTab({ url: '/pages/task/publish/index' }); },
  toDetail(e){
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/task/detail/index?id=' + id });
  }
});
