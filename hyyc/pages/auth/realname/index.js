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
      nickname: '',
      name: '测试用户',
      idNumber: '110101199001010011',
      phone: '',
      inviteCode: 'HYYC2025',
      community: community.name,
      building: '11栋',
      floor: '7',
      door: '701'
    },
    errors: {},
    buildingRange: [],
    // 对应 “11栋”（下标从 0 开始）
    buildingIndex: 10,
    doorRange: [[],[]], // [floors, rooms]
    // 对应 “7 楼 01 户” -> 第 7 层（索引 6）、第 1 户（索引 0）
    doorIndex: [6,0],
    MAX_FLOOR: 33,
    phoneVerified: false,
    // 业务 loading 状态（接口请求时用）
    isLoading: false,
    // 协议勾选：默认未同意
    agreeChecked: false,
    // 定位相关：初始为“尚未定位”，需要用户主动点击“获取定位”
    inCommunity: false,
    locationText: '尚未定位，请点击右侧“获取定位”',
    // 已存在用户提示弹层
    showUserExist: false,
    // 点击“获取”时用来聚焦昵称输入框，触发键盘上方的“微信昵称”选择
    nicknameFocus: false
  },
  // 用户点击“获取”后，聚焦昵称输入框；用户可从键盘上方一键选择微信昵称
  onGetWechatProfile() {
    // 新版规则：微信不会再把真实昵称直接返回给 getUserProfile，
    // 推荐用 input 的 type="nickname" 让用户从键盘上方一键选择微信昵称。
    this.setData({ nicknameFocus: true }, () => {
      // 立刻再置回 false，方便用户下次还能再次点击“获取”触发聚焦
      setTimeout(() => this.setData({ nicknameFocus: false }), 200);
    });
    toast('请在键盘上方选择微信昵称');
  },
  onInput(e){
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    const patch = { [`form.${key}`]: value };
    // 用户手动改了手机号后，就不再算“一键获取过”
    if (key === 'phone') patch.phoneVerified = false;
    this.setData(patch);
  },
  onLoad(){
    // 初始化楼栋（1-23栋）与门号（1-MAX_FLOOR 楼 × 01-04 户）
    const buildings = Array.from({length:23}, (_,i)=> `${i+1}栋`);
    const floors = Array.from({length:this.data.MAX_FLOOR}, (_,i)=> `${i+1}楼`);
    const rooms = ['01户','02户','03户','04户'];
    this.setData({ buildingRange: buildings, doorRange: [floors, rooms] });
  },
  onBuilding(e){
    const idx = Number(e.detail.value||0);
    const val = this.data.buildingRange[idx];
    this.setData({ buildingIndex: idx, 'form.building': val });
  },
  onDoorChange(e){
    const [fi, ui] = e.detail.value || [0,0];
    const floorNum = fi + 1; // 1-based
    const roomNo = (ui + 1).toString().padStart(2,'0');
    const door = `${floorNum}${roomNo}`; // 701,702...
    this.setData({
      doorIndex: [fi,ui],
      'form.floor': `${floorNum}`,
      'form.door': door
    });
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
      } else { toast(r.msg || '获取手机号失败'); }
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
  toggleAgree(){
    this.setData({ agreeChecked: !this.data.agreeChecked });
  },
  openLegalDoc(e){
    const type = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || '';
    if (!type) return;
    wx.navigateTo({ url: '/pages/auth/legal/doc/index?type=' + encodeURIComponent(type) });
  },
  goBack(){ wx.navigateBack({ fail: ()=> wx.switchTab({ url: '/pages/home/index/index' })}); },
  submit(){
    const f = this.data.form; const errors = {};
	    errors.name = required(f.name,'请输入姓名');
	    errors.idNumber = isIdNumber(f.idNumber);
	    // 手机号输入框已禁用，只允许走「获取手机号」授权
	    errors.phone = this.data.phoneVerified ? isPhone(f.phone) : '请点击右侧“获取”授权手机号';
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

    if (!this.data.agreeChecked) {
      toast('请先阅读并同意用户协议和隐私政策');
      return;
    }
    
	    this.setData({ isLoading: true });
		    const checkAll = async ()=>{
		      // 1) 手机号：已在表单校验阶段强制要求“获取手机号”授权
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
	      // 通过云函数在服务端执行“查重 + 写入”一体化的实名注册
	      let regResult;
	      try {
	        const fnRes = await wx.cloud.callFunction({
	          name: 'registerUser',
	          data: { form: f, agree: this.data.agreeChecked }
	        });
	        regResult = fnRes && fnRes.result;
	      } catch (err) {
	        console.error('调用 registerUser 失败', err);
	        toast('实名失败，请稍后重试');
	        this.setData({ isLoading: false });
	        return;
	      }

		      // 身份证号已存在 / 同一微信已注册：弹出提示，不写入本地缓存
		      if (regResult && (regResult.code === 'ID_EXISTS' || regResult.code === 'OPENID_EXISTS')) {
		        this.setData({ isLoading: false, showUserExist: true });
		        return;
		      }

	      if (!regResult || regResult.ok !== true) {
	        // 其他错误（参数问题 / 事务失败等）
	        toast(regResult && regResult.msg ? regResult.msg : '实名失败，请稍后重试');
	        this.setData({ isLoading: false });
	        return;
	      }

	      const user = regResult.user || {};

	      this.setData({ isLoading: false });

	      // 本地缓存一份，兼容后续页面读取
	      try {
	        wx.setStorageSync('hyyc_user', user);
	      } catch (e) {
	        console.error('缓存实名用户信息失败', e);
	      }

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
