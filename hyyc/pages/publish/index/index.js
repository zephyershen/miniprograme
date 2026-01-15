Page({
  data: {
    isLoading: false,
    taskIconSrc: '',
    productsIconSrc: ''
  },
  onShow(){
    const u = wx.getStorageSync('hyyc_user');
    if (!u || !u.realname) {
      wx.navigateTo({ url: '/pages/auth/realname/index' });
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
  loadPublishIcons() {
    const TASK_ICON_FILE_ID =
      'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/miniprogrampics/task.png';
    const PRODUCTS_ICON_FILE_ID =
      'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/miniprogrampics/products.png';

    // wx.cloud.init 已在 app.js onLaunch 里做过；这里直接使用即可
    this.setData({ isLoading: true });

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
        wx.showToast({ title: '图片加载失败，请稍后重试', icon: 'none' });
      });
  },
  onChoosePublishTask(){
    wx.navigateTo({ url: '/pages/publish/task/index' });
  },
  onChoosePublishGoods(){
    wx.navigateTo({ url: '/pages/publish/goods/index' });
  }
});
