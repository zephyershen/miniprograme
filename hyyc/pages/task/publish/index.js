const { required } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');

Page({
  data: {
    form: { title:'', desc:'', amount:'', deadline:'', address:'', images:[], building:'' },
    errors: {},
    buildingRange: [],
    buildingIndex: 0
  },
  onShow(){
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/auth/realname/index' });
      return;
    }
    // 初始化楼栋列表，默认选中用户楼栋
    const buildings = Array.from({length:23}, (_,i)=> `${i+1}栋`);
    let idx = 0;
    if (u && u.building) idx = Math.max(0, buildings.indexOf(u.building));
    this.setData({ buildingRange: buildings, buildingIndex: idx, 'form.building': buildings[idx] });
  },
  onInput(e){ const k=e.currentTarget.dataset.k; this.setData({ [`form.${k}`]: e.detail.value }); },
  onDate(e){ this.setData({ 'form.deadline': e.detail.value }); },
  chooseImg(){
    wx.chooseImage({ count:3, success: ({tempFilePaths}) => {
      this.setData({ 'form.images': (this.data.form.images||[]).concat(tempFilePaths) });
    }});
  },
  reset(){ this.setData({ form: { title:'', desc:'', amount:'', deadline:'', address:'', images:[], building:'' }, errors:{} }); },
  submit(){
    const f=this.data.form, errors={};
    errors.title=required(f.title,'请填写标题');
    errors.desc=required(f.desc,'请填写说明');
    errors.amount=required(f.amount,'请填写佣金');
    errors.deadline=required(f.deadline,'请选择截止日期');
    errors.address=required(f.address,'请填写地址');
    errors.building=required(f.building,'请选择发布楼栋');
    Object.keys(errors).forEach(k=>{ if(!errors[k]) delete errors[k]; });
    if(Object.keys(errors).length){ this.setData({errors}); return; }
    toast('已发布（演示）');
    wx.switchTab({ url: '/pages/home/index/index' });
  },
  onBuilding(e){
    const idx = Number(e.detail.value||0);
    const val = this.data.buildingRange[idx];
    this.setData({ buildingIndex: idx, 'form.building': val });
  }
});
