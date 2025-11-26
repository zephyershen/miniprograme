// 使用 lottie 播放购物袋加载动画
const lottie = require('lottie-miniprogram');
// 小程序不支持直接 require .json，这里用 .js 包了一层
const shoppingBagAnim = require('../../../assets/lottie/shopping-bag.js');

// 与 wxss 中 .lottie-box/.lottie-canvas 的宽高保持一致（单位：rpx）
const LOTTIE_SIZE_RPX = 200;

Component({
  properties: {
    show: { type: Boolean, value: false },
    text: { type: String, value: '正在加载' }
  },
  observers: {
    // show 打开时启动动画，关闭时销毁动画
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
      // 组件渲染完成后，如一开始就需要展示，也补播一次
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
      // 已经有实例就不用重复创建
      if (this._lottieInstance) return;

      this.createSelectorQuery()
        .select('#loading-canvas')
        .node(res => {
          if (!res || !res.node) return;
          const canvas = res.node;

          // 解决人物被“拉长/压扁”的问题：
          // 使用推荐的 getWindowInfo 获取像素比和屏幕宽度，
          // 低版本基础库不支持时再回退到 getSystemInfoSync，避免老接口直接报 warning。
          const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = win.pixelRatio || 1;
          const pxPerRpx = win.screenWidth / 750; // 750 是小程序默认设计宽
          const logicalSize = LOTTIE_SIZE_RPX * pxPerRpx; // 视觉上的大小（px）

          canvas.width = logicalSize * dpr;
          canvas.height = logicalSize * dpr;

          const context = canvas.getContext('2d');
          context.scale(dpr, dpr);

          lottie.setup(canvas);
          this._lottieInstance = lottie.loadAnimation({
            renderer: 'canvas',
            loop: true,
            autoplay: true,
            animationData: shoppingBagAnim,
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
    }
  }
});
