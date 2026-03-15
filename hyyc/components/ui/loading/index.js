// 使用 lottie 播放购物袋加载动画
const lottie = require('lottie-miniprogram');
// 小程序不支持直接 require .json，这里用 .js 包了一层
const shoppingBagAnim = require('../../../assets/loading/shopping-bag.js');

// 与 wxss 中 .lottie-box/.lottie-canvas 的宽高保持一致（单位：rpx）
const LOTTIE_SIZE_RPX = 200;

Component({
  properties: {
    show: { type: Boolean, value: false },
    text: { type: String, value: '正在加载' }
  },
  data: {
    rendered: false
  },
  observers: {
    // canvas 原生层在 hidden 切换下可能残影，改成显示时创建、隐藏时销毁。
    show(val) {
      if (val) {
        this._ensureRenderedAndPlay();
      } else {
        this.hideLottie();
      }
    }
  },
  lifetimes: {
    ready() {
      if (this.properties.show) {
        this._ensureRenderedAndPlay();
      }
    },
    detached() {
      this.destroyLottie();
    }
  },
  methods: {
    _ensureRenderedAndPlay() {
      if (this.data.rendered) {
        this.playLottie();
        return;
      }
      this.setData({ rendered: true }, () => {
        if (wx.nextTick) {
          wx.nextTick(() => {
            if (!this.properties.show) return;
            this.playLottie();
          });
        } else {
          setTimeout(() => {
            if (!this.properties.show) return;
            this.playLottie();
          }, 0);
        }
      });
    },
    playLottie() {
      if (!this.properties.show || !this.data.rendered) return;
      // 已经有实例就直接继续播放，不重复创建
      if (this._lottieInstance) {
        if (this._lottieInstance.play) this._lottieInstance.play();
        return;
      }

      this.createSelectorQuery()
        .select('.lottie-canvas')
        .node(res => {
          if (!res || !res.node) return;
          const canvas = res.node;
          this._canvasNode = canvas;

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
          this._canvasContext = context;

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
    hideLottie() {
      this.destroyLottie();
      if (this.data.rendered) {
        this.setData({ rendered: false });
      }
    },
    pauseLottie() {
      if (!this._lottieInstance) return;
      // 有的版本支持 pause，有的只有 stop；优先 pause
      if (this._lottieInstance.pause) {
        this._lottieInstance.pause();
      } else if (this._lottieInstance.stop) {
        this._lottieInstance.stop();
      }
    },
    destroyLottie() {
      if (this._canvasContext && this._canvasNode) {
        try {
          this._canvasContext.clearRect(0, 0, this._canvasNode.width, this._canvasNode.height);
        } catch (e) {
          // ignore
        }
      }
      if (this._lottieInstance && this._lottieInstance.destroy) {
        this._lottieInstance.destroy();
      }
      this._lottieInstance = null;
      this._canvasContext = null;
      this._canvasNode = null;
    }
  }
});
