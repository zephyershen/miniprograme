// 错误提示弹层，使用 Lottie Error 动画
const lottie = require('lottie-miniprogram');
// 小程序不支持直接 require .json，这里用 .js 包了一层
const errorAnim = require('../../../assets/error/error.js');

// 与 wxss 中 .lottie-box/.lottie-canvas 的宽高保持一致（单位：rpx）
const LOTTIE_SIZE_RPX = 280;

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    message: { type: String, value: '出错了，请稍后重试' },
    confirmText: { type: String, value: '确定' }
  },
  observers: {
    show(val) {
      if (val) {
        this.playLottie();
      } else {
        this.stopLottie();
      }
    }
  },
  lifetimes: {
    ready() {
      if (this.properties.show) {
        this.playLottie();
      }
    },
    detached() {
      this.stopLottie();
    }
  },
  methods: {
    playLottie() {
      if (this._lottieInstance) return;

      this.createSelectorQuery()
        .select('#error-canvas')
        .node(res => {
          if (!res || !res.node) return;
          const canvas = res.node;

          const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = win.pixelRatio || 1;
          const pxPerRpx = win.screenWidth / 750;
          const logicalSize = LOTTIE_SIZE_RPX * pxPerRpx;

          canvas.width = logicalSize * dpr;
          canvas.height = logicalSize * dpr;

          const context = canvas.getContext('2d');
          context.scale(dpr, dpr);

          lottie.setup(canvas);
          this._lottieInstance = lottie.loadAnimation({
            renderer: 'canvas',
            loop: true,
            autoplay: true,
            animationData: errorAnim,
            rendererSettings: { context }
          });
        })
        .exec();
    },
    stopLottie() {
      if (this._lottieInstance && this._lottieInstance.destroy) {
        this._lottieInstance.destroy();
      }
      this._lottieInstance = null;
    },
    onConfirm() {
      this.triggerEvent('confirm');
    }
  }
});
