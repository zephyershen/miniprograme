const { formatDateTime } = require('../../../utils/format');

function pickStr(...vals) {
  for (let i = 0; i < vals.length; i += 1) {
    const s = String(vals[i] == null ? '' : vals[i]).trim();
    if (s) return s;
  }
  return '';
}

Page({
  data: {
    isLoading: true,
    list: [],
    displayList: [],
    filter: 'all',
    summary: {
      totalUnread: 0,
      taskUnread: 0,
      goodsUnread: 0,
      sessionCount: 0,
    },
    subscribeTemplates: [],
    subscribeEnabled: false,
    subscribeLoading: false,
  },

  onShow() {
    this.loadMessageCenter();
    this.loadSubscribeConfig();
  },

  _updateDisplayList(nextFilter = this.data.filter, nextList = this.data.list) {
    const filter = pickStr(nextFilter, 'all');
    const list = Array.isArray(nextList) ? nextList : [];
    let displayList = list;
    if (filter === 'task') {
      displayList = list.filter((item) => item && item.kind === 'task');
    } else if (filter === 'goods') {
      displayList = list.filter((item) => item && item.kind === 'goods');
    }
    this.setData({
      filter,
      displayList,
    });
  },

  async loadMessageCenter() {
    this.setData({ isLoading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'getMessageCenter' });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.msg, '消息中心加载失败'));
      }

      const list = (Array.isArray(ret.list) ? ret.list : []).map((item) => ({
        ...item,
        lastTimeText: item && item.lastTs ? formatDateTime(item.lastTs) : '',
      }));

      this.setData({
        list,
        summary: ret.summary || {},
        isLoading: false,
      });
      this._updateDisplayList(this.data.filter, list);
    } catch (err) {
      console.error('加载消息中心失败', err);
      this.setData({
        list: [],
        displayList: [],
        summary: {
          totalUnread: 0,
          taskUnread: 0,
          goodsUnread: 0,
          sessionCount: 0,
        },
        isLoading: false,
      });
      wx.showToast({ title: pickStr(err && err.message, '加载失败'), icon: 'none' });
    }
  },

  async loadSubscribeConfig() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getSubscribeConfig' });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true) return;
      const templates = Array.isArray(ret.templates) ? ret.templates : [];
      this.setData({
        subscribeTemplates: templates,
        subscribeEnabled: !!ret.chatEnabled,
      });
    } catch (err) {
      console.warn('加载订阅消息配置失败', err);
    }
  },

  onFilterTap(e) {
    const filter = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.filter, 'all');
    this._updateDisplayList(filter, this.data.list);
  },

  onSessionTap(e) {
    const url = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url);
    if (!url) return;
    wx.navigateTo({ url });
  },

  async onEnableSubscribe() {
    if (this.data.subscribeLoading) return;
    const templateIds = (Array.isArray(this.data.subscribeTemplates) ? this.data.subscribeTemplates : [])
      .map((item) => pickStr(item && item.templateId))
      .filter(Boolean);
    if (!templateIds.length) {
      wx.showToast({ title: '还没配置订阅模板', icon: 'none' });
      return;
    }
    if (!wx.requestSubscribeMessage) {
      wx.showToast({ title: '当前基础库不支持', icon: 'none' });
      return;
    }

    this.setData({ subscribeLoading: true });
    try {
      const result = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: templateIds,
          success: resolve,
          fail: reject,
          complete: () => this.setData({ subscribeLoading: false }),
        });
      });
      const acceptedCount = templateIds.filter((id) => pickStr(result && result[id]) === 'accept').length;
      wx.showToast({
        title: acceptedCount ? `已开启 ${acceptedCount} 项提醒` : '未同意订阅',
        icon: 'none',
      });
    } catch (err) {
      console.error('请求订阅消息失败', err);
      this.setData({ subscribeLoading: false });
      wx.showToast({ title: '请求订阅失败', icon: 'none' });
    }
  },
});
