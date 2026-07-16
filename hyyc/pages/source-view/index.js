const { DIRECT_WEBVIEW_HOSTS } = require('../../config/constants.js');
const { getOriginAction } = require('../../features/knowledge-feed/reading.js');

Page({
  data: {
    url: '',
    error: ''
  },

  onLoad(options) {
    let url = '';
    try {
      url = decodeURIComponent(options.url || '');
    } catch (error) {
      this.setData({ error: '原文链接格式无效' });
      return;
    }
    const action = getOriginAction(url, DIRECT_WEBVIEW_HOSTS);
    if (!action.canOpen) {
      this.setData({ url, error: '这个来源暂时不能在小程序内直接打开' });
      return;
    }
    this.setData({ url });
  },

  onWebError() {
    this.setData({ error: '原始页面加载失败，可以复制链接后在浏览器查看' });
  },

  copyOriginal() {
    if (!this.data.url) return;
    wx.setClipboardData({
      data: this.data.url,
      success: () => wx.showToast({ title: '原文链接已复制', icon: 'none' })
    });
  }
});
