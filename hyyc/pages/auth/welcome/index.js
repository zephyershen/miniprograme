// 登录/注册入口欢迎页，展示客厅 Lottie 动画 + 两个卡通风按钮
const lottie = require('lottie-miniprogram');
// 小程序不支持直接 require .json，这里用 .js 包了一层
const livingRoomAnim = require('../../../assets/lottie/living-room.js');
// 使用云开发数据库，登录时根据 _openid 查询 userInfo 集合
const db = wx.cloud.database();
const USER_COLLECTION = 'userInfo';

// 与 wxss 中 .hero-lottie-box/.hero-lottie-canvas 宽高保持一致（单位：rpx）
// 这里适当减小尺寸 + 提高清晰度上限，保证真机更顺滑一些
const LOTTIE_SIZE_RPX = 360;

Page({
  data: {
    // 登录中的 loading 状态，防止重复点击
    isLoading: false
  },

  // 页面每次显示（包括从注册页返回）时尝试播放动画
  onShow() {
    // 首次进入时 onShow 会早于 onReady，此时节点可能还没就绪；
    // 等页面 ready 之后再启动，避免偶发的重复初始化导致卡顿。
    if (this._pageReady) {
      this.playLottie();
    }
  },

  onReady() {
    this._pageReady = true;
    this.playLottie();
  },

  onHide() {
    this.stopLottie();
  },

  onUnload() {
    this.stopLottie();
  },

  // 注册按钮：不再调用任何授权接口，只负责跳转到实名注册页
  onRegisterTap() {
    wx.navigateTo({ url: '/pages/auth/realname/index' });
  },

  // 登录按钮：根据 openid 查询 userInfo，如果已实名则直接进入首页，否则引导去注册
  async onLoginTap() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    // 顶部显示一个系统自带的「加载中」提示，并禁止点击背景
    wx.showLoading({ title: '登录中...', mask: true });

    try {
      // 1）通过云函数 login 获取当前用户在本小程序下的 openid
      const fnRes = await wx.cloud.callFunction({ name: 'login' });
      const openid = fnRes && fnRes.result && fnRes.result.openid;

      if (!openid) {
        wx.showToast({ title: '获取登录信息失败', icon: 'none' });
        return;
      }

      // 2）根据 _openid 查询 userInfo，看是否已经实名/注册
      const queryRes = await db.collection(USER_COLLECTION)
        .where({ _openid: openid })
        .limit(1)
        .get();

      const list = (queryRes && queryRes.data) || [];
      if (!list.length) {
        // 没找到实名信息，引导用户先去注册
        wx.showModal({
          title: '尚未注册',
          content: '未找到您的实名信息，请先完成注册。',
          confirmText: '去注册',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/auth/realname/index' });
            }
          }
        });
        return;
      }

      // 3）已找到实名信息：把用户信息存到本地缓存，并进入首页
      const userDoc = list[0] || {};
      const { _id, ...plain } = userDoc;
      // 兼容后续页面：提供一个通用的 id 字段，同时保留实名标记
      const cachedUser = {
        ...plain,
        id: _id || plain.id || 'me'
      };
      try {
        wx.setStorageSync('hyyc_user', cachedUser);
      } catch (e) {
        console.error('缓存用户信息失败', e);
      }

      wx.showToast({ title: '登录成功', icon: 'success' });

      // 稍微延时一下再跳转，避免 toast 还没显示就切页
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/index/index' });
      }, 400);
    } catch (err) {
      console.error('登录失败', err);
      wx.showToast({ title: '登录失败，请稍后重试', icon: 'none' });
    } finally {
      // 不管成功还是失败，都在最后关闭 loading 状态
      this.setData({ isLoading: false });
      wx.hideLoading();
    }
  },

  playLottie() {
    // 已经有实例就不用重复创建
    if (this._lottieInstance || this._lottieInitializing) return;
    this._lottieInitializing = true;

    this.createSelectorQuery()
      .select('#hero-canvas')
      .node(res => {
        // 可能出现：页面刚显示就立刻跳转/隐藏，回调里拿不到节点
        if (!res || !res.node) {
          this._lottieInitializing = false;
          return;
        }
        // 防止极端情况下多次触发回调导致重复创建实例
        if (this._lottieInstance) {
          this._lottieInitializing = false;
          return;
        }
        const canvas = res.node;

        // 处理清晰度 & 流畅度：
        // 使用 getWindowInfo 获取像素比，但为了让动画更流畅，
        // 把实际渲染的像素密度限制在一个较小的值，肉眼看不出区别。
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const rawDpr = win.pixelRatio || 1;
        // 在电脑模拟器上像素密度（pixelRatio：相当于「同样宽度塞多少个像素点」）通常较低，
        // 手机上会高很多，如果完全按原始值渲染会非常耗性能。
        // 这里做一层分级：超高分屏设备再稍微降一点，换更稳定的帧率。
        let dpr = Math.min(rawDpr, 2);
        if (rawDpr >= 3) {
          dpr = 1.5;
        }
        const pxPerRpx = win.screenWidth / 750; // 750 是小程序设计宽
        const logicalSize = LOTTIE_SIZE_RPX * pxPerRpx;

        canvas.width = logicalSize * dpr;
        canvas.height = logicalSize * dpr;

        const context = canvas.getContext('2d');
        context.scale(dpr, dpr);

        lottie.setup(canvas);
        // 降低一点绘制精度，换取真机更稳定的帧率
        if (typeof lottie.setQuality === 'function') {
          // 可在 'high' | 'medium' | 'low' 之间调整
          lottie.setQuality('medium');
        }
        this._lottieInstance = lottie.loadAnimation({
          renderer: 'canvas',
          loop: true, // 现在画框不会再淡出，可以放心循环播放
          autoplay: true,
          animationData: livingRoomAnim,
          rendererSettings: { context }
        });

        // 调回接近原始速度，减少慢动作带来的「一卡一卡」感知
        if (this._lottieInstance && this._lottieInstance.setSpeed) {
          this._lottieInstance.setSpeed(1);
        }
        this._lottieInitializing = false;
      })
      .exec();
  },

  stopLottie() {
    if (this._lottieInstance && this._lottieInstance.destroy) {
      this._lottieInstance.destroy();
    }
    this._lottieInstance = null;
    this._lottieInitializing = false;
  }
});
