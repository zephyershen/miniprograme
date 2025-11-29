const { required, isPhone, isIdNumber } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');
const { exchangePhoneNumber, validateInvite } = require('../../../utils/api');
const { distanceMeters } = require('../../../utils/geo');
const community = require('../../../config/community');

// 使用云开发数据库，当前示例将实名信息存入 userInfo 集合
const db = wx.cloud.database();
const USER_COLLECTION = 'userInfo';

Page({
  data: {
    // 默认填充测试数据，方便开发联调；正式上线前请改回空值
    form: {
      name: '测试用户',
      idNumber: '110101199001010011',
      phone: '13800138000',
      inviteCode: 'HYYC2025',
      community: community.name,
      building: '11栋',
      floor: '7',
      unit: '01',
      door: '701'
    },
    errors: {},
    buildingRange: [],
    // 对应 “11栋”（下标从 0 开始）
    buildingIndex: 10,
    doorRange: [[],[]], // [floors, units]
    // 对应 “7 楼 01 户” -> 第 7 层（索引 6）、01 户（索引 0）
    doorIndex: [6,0],
    MAX_FLOOR: 33,
    phoneVerified: false,
    // 业务 loading 状态（接口请求时用）
    isLoading: false,
    // 定位相关：初始为“尚未定位”，需要用户主动点击“获取定位”
    inCommunity: false,
    locationText: '尚未定位，请点击右侧“获取定位”',
    // 已存在用户提示弹层
    showUserExist: false
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
      // 兼容不支持可选链的环境：安全地从事件对象取 detail
      const detail = (e && e.detail) || {};
      console.log('phone event detail ===>', detail); // 方便真机调试查看 errMsg 和 code
      const code = detail.code;
      const errMsg = detail.errMsg || '';
      if (!code) {
        // 没有拿到 code，根据不同情况给出更清晰的提示
        if (errMsg.indexOf('user deny') !== -1) {
          toast('您取消了手机号授权');
        } else if (errMsg.indexOf('no permission') !== -1) {
          toast('当前小程序未开通获取手机号能力，请联系管理员在微信后台开通');
        } else if (errMsg) {
          toast('获取手机号失败：' + errMsg);
        } else {
          toast('获取手机号失败，请稍后再试');
        }
        return;
      }
      this.setData({ isLoading: true });
      const r = await exchangePhoneNumber(code);
      this.setData({ isLoading: false });
      if (r.ok) {
        this.setData({ 'form.phone': r.phoneNumber, phoneVerified: true });
        toast('已获取手机号');
      } else { toast('获取手机号失败'); }
    }catch(err){ console.log(err); toast('获取手机号异常'); this.setData({ isLoading: false }); }
  },
  // 移除短信验证码流程，仅保留一键获取手机号
  async getLocation(){
    // TODO: 开发临时逻辑：强制视为在小区内，方便测试注册
    // 点击“获取定位”按钮后，直接当作已在小区范围内
    this.setData({
      inCommunity: true,
      locationText: `开发测试：已视为在${community.name}范围内`
    });
    return;

    // 下面是真实定位逻辑，上线前请恢复：
    // const self = this;
    // this.setData({ isLoading: true });
    // wx.getLocation({ type:'gcj02', isHighAccuracy:true, highAccuracyExpireTime: 5000,
    //   success(res){
    //     const d = distanceMeters(res.latitude, res.longitude, community.center.lat, community.center.lng);
    //     const inRange = d <= community.radiusMeters;
    //     self.setData({ inCommunity: inRange, locationText: inRange?`已在${community.name}范围内（~${Math.round(d)}m）`:`不在小区范围（距中心约${Math.round(d)}m）`, isLoading: false });
    //   },
    //   fail(){ self.setData({ inCommunity:false, locationText:'定位失败，请重试', isLoading: false }); }
    // });
  },
  goBack(){ wx.navigateBack({ fail: ()=> wx.switchTab({ url: '/pages/home/index/index' })}); },
  submit(){
    const f = this.data.form; const errors = {};
	    errors.name = required(f.name,'请输入姓名');
	    errors.idNumber = isIdNumber(f.idNumber);
	    errors.phone = isPhone(f.phone);
	    // 小区名称必须包含配置中的小区名，用于过滤非本小区业主
	    errors.community = required(f.community,'请输入小区');
	    const communityInput = String(f.community || '').trim();
	    if (!errors.community && communityInput.indexOf(community.name) === -1) {
	      // 这里不要把正确小区名称直接提示给用户，只给一个模糊错误信息
	      errors.community = '小区名称不正确，请联系物业确认后再填写';
	    }
    errors.building = required(f.building,'请选择楼栋');
    errors.door = required(f.door,'请选择门号');
    errors.inviteCode = required(f.inviteCode,'请输入小区邀请码');
    Object.keys(errors).forEach(k=>{ if(!errors[k]) delete errors[k]; });
    if (Object.keys(errors).length){ this.setData({errors}); return; }
    
    this.setData({ isLoading: true });
	    const checkAll = async ()=>{
	      // 1) 手机号：目前只做格式校验，不再强制一键获取（待后台开通获取手机号能力后再恢复）
	      // 2) 邀请码
	      const ri = await validateInvite(f.inviteCode, f.building, f.door);
	      if (!ri.ok) { toast('邀请码无效'); return false; }
	      // 3) 定位（可作为硬性或提示，这里默认为硬性）
	      if (!this.data.inCommunity) { toast('请在小区内完成定位'); return false; }
	      return true;
	    };
	    checkAll().then(async ok=>{
	      if (!ok) {
	        this.setData({ isLoading: false });
	        return;
	      }

	      // 先检查数据库中是否已经有同名+同身份证号的用户
	      let existRes;
	      try {
	        existRes = await db.collection(USER_COLLECTION)
	          .where({
	            name: f.name,
	            idNumber: f.idNumber
	          })
	          .limit(1)
	          .get();
	      } catch (err) {
	        console.error('查询用户是否存在失败', err);
	        toast('检查用户信息失败，请稍后重试');
	        this.setData({ isLoading: false });
	        return;
	      }

	      if (existRes && existRes.data && existRes.data.length > 0) {
	        // 已经存在用户：弹出带 Lottie 动画的错误提示弹层
	        this.setData({ isLoading: false, showUserExist: true });
	        return;
	      }

	      try {
	        // 将实名信息写入云开发数据库 userInfo 集合
	        await db.collection(USER_COLLECTION).add({
	          data: {
	            ...f,
	            realname: true,
	            verified: true,
	            createdAt: new Date()
	          }
	        });
	      } catch (err) {
	        console.error('保存到云数据库失败', err);
	        toast('保存到云数据库失败，请稍后重试');
	      }

	      this.setData({ isLoading: false });

	      // 本地缓存一份，兼容后续页面读取
	      // 存储兼容：保留 building 文本，如 “11栋”，并存储 door 如 “701”
	      wx.setStorageSync('hyyc_user', { ...f, id:'me', realname:true, verified:true });
	      toast('实名完成');
	      wx.switchTab({ url: '/pages/home/index/index' });
	    });
  },
  onUserExistConfirm(){
    // 关闭错误弹层并回到欢迎页，让用户直接登录
    this.setData({ showUserExist: false });
    wx.redirectTo({ url: '/pages/auth/welcome/index' });
  }
});
