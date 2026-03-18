const { getStoredUser } = require('../../../utils/userIdentity');

Page({
  data: {
    isLoading: false,
    taskIconSrc: '',
    productsIconSrc: '',
    // 只用于控制 loading：两张图片都“有结果（加载成功/失败）”后才关掉遮罩
    taskIconLoaded: false,
    productsIconLoaded: false
  },
  onShow(){
    const u = getStoredUser();
    if (!u || !u.realname) {
      // 避免一进入页面就出现“获取手机号”授权流程：先进入欢迎页，让用户自主选择登录/注册
      wx.navigateTo({ url: '/pages/welcome/index' });
      return;
    }

    // 兼容「从我的任务点编辑」：先切到发布 tab，再自动跳到发布任务表单页
    const editId = wx.getStorageSync('hyyc_edit_task_id') || '';
    if (editId) {
      wx.navigateTo({ url: '/pages/publish/task/index' });
      return;
    }

    // 只在第一次进入时加载一次（避免每次切 tab 都重新下载）
    if (this.data.taskIconSrc && this.data.productsIconSrc) return;

    this.loadPublishIcons();
  },
  onUnload() {
    // 防止页面销毁后 timer 还在跑
    if (this._publishIconsLoadingTimer) clearTimeout(this._publishIconsLoadingTimer);
    this._publishIconsLoadingTimer = null;
  },
  loadPublishIcons() {
    const TASK_ICON_FILE_ID =
      'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/miniprogrampics/task.png';
    const PRODUCTS_ICON_FILE_ID =
      'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/miniprogrampics/products.png';
    // 使用云存储图片处理样式：publish_imgs（在云开发平台里配置的那个）
    // 这样缩略规则（宽度/格式）都在云端改，代码不用跟着改。
    const PUBLISH_ICON_STYLE = 'publish_imgs';
    // 云存储样式在 URL 上的体现，是把样式名拼到路径末尾：
    //   https://.../task.png  ->  https://.../task.png/publish_imgs
    // 注意：样式要放在 ? 查询参数之前（如果有的话）。
    const applyImageStyle = (tempFileURL = '', styleName = '') => {
      const url = String(tempFileURL || '');
      const style = String(styleName || '').trim();
      if (!url || !style) return url;

      // 已经带样式了就不重复加（避免出现 /publish_imgs/publish_imgs）
      if (url.indexOf(`/${style}`) >= 0) return url;

      const hashIdx = url.indexOf('#');
      const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
      const hashPart = hashIdx >= 0 ? url.slice(hashIdx) : '';

      const qIdx = beforeHash.indexOf('?');
      if (qIdx < 0) return `${beforeHash}/${style}${hashPart}`;
      return `${beforeHash.slice(0, qIdx)}/${style}${beforeHash.slice(qIdx)}${hashPart}`;
    };

    // wx.cloud.init 已在 app.js onLaunch 里做过；这里直接使用即可
    if (this._publishIconsLoadingTimer) clearTimeout(this._publishIconsLoadingTimer);
    this._publishIconsLoadingTimer = null;
    this.setData({
      isLoading: true,
      taskIconLoaded: false,
      productsIconLoaded: false
    });

    // 新逻辑：先拿临时 URL，再把样式名拼到 URL 路径末尾（publish_imgs）
    wx.cloud.getTempFileURL({
      fileList: [
        { fileID: TASK_ICON_FILE_ID, maxAge: 60 * 60 },
        { fileID: PRODUCTS_ICON_FILE_ID, maxAge: 60 * 60 }
      ]
    })
      .then((res) => {
        const list = (res && res.fileList) ? res.fileList : [];
        const map = {};
        list.forEach((it) => {
          if (it && it.fileID && it.tempFileURL) {
            map[it.fileID] = applyImageStyle(it.tempFileURL, PUBLISH_ICON_STYLE);
          }
        });
        const taskUrl = map[TASK_ICON_FILE_ID] || '';
        const productsUrl = map[PRODUCTS_ICON_FILE_ID] || '';
        if (!taskUrl || !productsUrl) throw new Error('empty tempFileURL');
        // 注意：这里先只把 src 塞给 <image>，不要立刻关 loading；
        // 需要等到两张 <image> 都触发 bindload/binderror 才关（否则会出现“遮罩关了但图片还没出来”）。
        this.setData({ taskIconSrc: taskUrl, productsIconSrc: productsUrl });

        // 兜底：极端情况下（网络很差/事件未触发）不要一直转圈
        this._publishIconsLoadingTimer = setTimeout(() => {
          if (this.data && this.data.isLoading) {
            this.setData({ isLoading: false });
          }
          this._publishIconsLoadingTimer = null;
        }, 8000);
      })
      .catch((err) => {
        console.error('获取发布页缩略图失败', err);
        if (this._publishIconsLoadingTimer) clearTimeout(this._publishIconsLoadingTimer);
        this._publishIconsLoadingTimer = null;
        this.setData({ isLoading: false });
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
      });

    /* 备选方案：不走 style，直接在 URL 上追加处理参数（缩略图）
    // 等比缩放到 512 宽并转 webp（想改尺寸/格式，改这里）
    const PUBLISH_ICON_PROCESS = 'imageView2/2/w/512/format/webp';
    const withProcess = (url = '') => {
      const s = String(url || '');
      if (!s) return '';
      if (s.indexOf('imageView2/') >= 0 || s.indexOf('imageMogr2/') >= 0) return s;
      return s + (s.indexOf('?') >= 0 ? '&' : '?') + PUBLISH_ICON_PROCESS;
    };

    wx.cloud.getTempFileURL({
      fileList: [
        { fileID: TASK_ICON_FILE_ID, maxAge: 60 * 60 },
        { fileID: PRODUCTS_ICON_FILE_ID, maxAge: 60 * 60 }
      ]
    })
      .then((res) => {
        const list = (res && res.fileList) ? res.fileList : [];
        const map = {};
        list.forEach((it) => {
          if (it && it.fileID && it.tempFileURL) map[it.fileID] = it.tempFileURL;
        });
        const taskUrl = withProcess(map[TASK_ICON_FILE_ID] || '');
        const productsUrl = withProcess(map[PRODUCTS_ICON_FILE_ID] || '');
        if (!taskUrl || !productsUrl) throw new Error('empty tempFileURL');
        this.setData({
          taskIconSrc: taskUrl,
          productsIconSrc: productsUrl,
          isLoading: false
        });
      })
      .catch((err) => {
        console.error('获取发布页缩略图失败', err);
        this.setData({ isLoading: false });
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
      });
    */

    /* 原逻辑：下载原图（保留，方便对比/回退）
    Promise.all([
      wx.cloud.downloadFile({ fileID: TASK_ICON_FILE_ID }),
      wx.cloud.downloadFile({ fileID: PRODUCTS_ICON_FILE_ID })
    ])
      .then(([taskRes, productsRes]) => {
        this.setData({
          taskIconSrc: taskRes.tempFilePath,
          productsIconSrc: productsRes.tempFilePath,
          isLoading: false
        });
      })
      .catch(() => {
        this.setData({ isLoading: false });
        wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
      });
    */
  },
  onChoosePublishTask(){
    wx.navigateTo({ url: '/pages/publish/task/index' });
  },
  onChoosePublishGoods(){
    wx.navigateTo({ url: '/pages/publish/goods/index' });
  },
  onTaskIconLoad() {
    this.setData({ taskIconLoaded: true });
    this.tryHidePublishLoading();
  },
  onTaskIconError(e) {
    console.warn('发布页 task icon 加载失败', e);
    // 失败也算“有结果”，避免一直卡在 loading
    this.setData({ taskIconLoaded: true });
    this.tryHidePublishLoading();
  },
  onProductsIconLoad() {
    this.setData({ productsIconLoaded: true });
    this.tryHidePublishLoading();
  },
  onProductsIconError(e) {
    console.warn('发布页 products icon 加载失败', e);
    this.setData({ productsIconLoaded: true });
    this.tryHidePublishLoading();
  },
  tryHidePublishLoading() {
    // 两张图都“加载完成/失败”后，才关掉 loading
    if (!this.data.isLoading) return;
    if (this.data.taskIconLoaded && this.data.productsIconLoaded) {
      if (this._publishIconsLoadingTimer) clearTimeout(this._publishIconsLoadingTimer);
      this._publishIconsLoadingTimer = null;
      this.setData({ isLoading: false });
    }
  }
});
