// 登录/注册入口欢迎页，展示客厅 Lottie 动画 + 两个卡通风按钮
const lottie = require('lottie-miniprogram');
// 小程序不支持直接 require .json，这里用 .js 包了一层
const livingRoomAnim = require('../../../assets/lottie/living-room.js');

// 与 wxss 中 .hero-lottie-box/.hero-lottie-canvas 宽高保持一致（单位：rpx）
// 这里适当减小尺寸 + 提高清晰度上限，保证真机更顺滑一些
const LOTTIE_SIZE_RPX = 360;

Page({
  data: {},

  // 页面每次显示（包括从注册页返回）时尝试播放动画
  onShow() {
    this.playLottie();
  },

  onReady() {
    this.playLottie();
  },

  onHide() {
    this.stopLottie();
  },

  onUnload() {
    this.stopLottie();
  },

  // 跳转到实名认证信息填写页
  onRegisterTap() {
    wx.navigateTo({
      url: '/pages/auth/realname/index'
    });
  },

  playLottie() {
    // 已经有实例就不用重复创建
    if (this._lottieInstance) return;

    this.createSelectorQuery()
      .select('#hero-canvas')
      .node(res => {
        if (!res || !res.node) return;
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
      })
      .exec();
  },

  stopLottie() {
    if (this._lottieInstance && this._lottieInstance.destroy) {
      this._lottieInstance.destroy();
    }
    this._lottieInstance = null;
  }
});
