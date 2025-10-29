const { required, isPhone, isIdNumber } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');
const { exchangePhoneNumber, validateInvite } = require('../../../utils/api');
const { distanceMeters } = require('../../../utils/geo');
const community = require('../../../config/community');

Page({
  data: {
    form: { name: '', idNumber: '', phone: '', inviteCode:'', community: '', building: '', floor: '', unit: '', door: '' },
    errors: {},
    buildingRange: [],
    buildingIndex: 0,
    doorRange: [[],[]], // [floors, units]
    doorIndex: [0,0],
    MAX_FLOOR: 33,
    phoneVerified: false,
    inCommunity: false,
    locationText: '未获取定位'
  },
  onInput(e){
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },
  onLoad(){
    // 初始化楼栋（1-23栋）与门号（1-MAX_FLOOR 楼 × 01-04 户）
    const buildings = Array.from({length:23}, (_,i)=> `${i+1}栋`);
    const floors = Array.from({length:this.data.MAX_FLOOR}, (_,i)=> `${i+1}楼`);
    const units = ['01户','02户','03户','04户'];
    this.setData({ buildingRange: buildings, doorRange: [floors, units] });
  },
  onBuilding(e){
    const idx = Number(e.detail.value||0);
    const val = this.data.buildingRange[idx];
    this.setData({ buildingIndex: idx, 'form.building': val });
  },
  onDoorChange(e){
    const [fi, ui] = e.detail.value || [0,0];
    const floorNum = fi + 1; // 1-based
    const unitNum = (ui + 1).toString().padStart(2,'0');
    const door = `${floorNum}${unitNum}`; // 701,702...
    this.setData({ doorIndex: [fi,ui], 'form.floor': `${floorNum}`, 'form.unit': unitNum, 'form.door': door });
  },
  async onGetPhoneNumber(e){
    try{
      const code = e?.detail?.code;
      if (!code) { toast('未授权手机号'); return; }
      const r = await exchangePhoneNumber(code);
      if (r.ok) {
        this.setData({ 'form.phone': r.phoneNumber, phoneVerified: true });
        toast('已获取手机号');
      } else { toast('获取手机号失败'); }
    }catch(err){ console.log(err); toast('获取手机号异常'); }
  },
  // 移除短信验证码流程，仅保留一键获取手机号
  async getLocation(){
    const self = this;
    wx.getLocation({ type:'gcj02', isHighAccuracy:true, highAccuracyExpireTime: 5000,
      success(res){
        const d = distanceMeters(res.latitude, res.longitude, community.center.lat, community.center.lng);
        const inRange = d <= community.radiusMeters;
        self.setData({ inCommunity: inRange, locationText: inRange?`已在${community.name}范围内（~${Math.round(d)}m）`:`不在小区范围（距中心约${Math.round(d)}m）` });
      },
      fail(){ self.setData({ inCommunity:false, locationText:'定位失败，请重试' }); }
    });
  },
  goBack(){ wx.navigateBack({ fail: ()=> wx.switchTab({ url: '/pages/home/index/index' })}); },
  submit(){
    const f = this.data.form; const errors = {};
    errors.name = required(f.name,'请输入姓名');
    errors.idNumber = isIdNumber(f.idNumber);
    errors.phone = isPhone(f.phone);
    errors.community = required(f.community,'请输入小区');
    errors.building = required(f.building,'请选择楼栋');
    errors.door = required(f.door,'请选择门号');
    errors.inviteCode = required(f.inviteCode,'请输入小区邀请码');
    Object.keys(errors).forEach(k=>{ if(!errors[k]) delete errors[k]; });
    if (Object.keys(errors).length){ this.setData({errors}); return; }
    const self = this;
    const checkAll = async ()=>{
      // 1) 手机号获取校验（必须使用一键获取）
      if (!this.data.phoneVerified) { toast('请点击“获取”按钮获取微信手机号'); return false; }
      // 2) 邀请码
      const ri = await validateInvite(f.inviteCode, f.building, f.door);
      if (!ri.ok) { toast('邀请码无效'); return false; }
      // 3) 定位（可作为硬性或提示，这里默认为硬性）
      if (!this.data.inCommunity) { toast('请在小区内完成定位'); return false; }
      return true;
    };
    checkAll().then(ok=>{
      if (!ok) return;
      // 存储兼容：保留 building 文本，如 “11栋”，并存储 door 如 “701”
      wx.setStorageSync('hyyc_user', { ...f, id:'me', realname:true, verified:true });
      toast('实名完成');
      wx.switchTab({ url: '/pages/home/index/index' });
    });
  }
});
