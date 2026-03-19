const { formatDateTime } = require('../../../utils/format');
const MESSAGE_RENDER_BATCH = 30;
const SWIPE_DELETE_WIDTH_RPX = 160;
const SWIPE_TRIGGER_RATIO = 0.45;

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
    displayList: [],
    filter: 'all',
    summary: {
      totalUnread: 0,
      taskUnread: 0,
      goodsUnread: 0,
      sessionCount: 0,
    },
    deletingKey: '',
    hasMoreDisplay: false,
  },

  onLoad() {
    this._allList = [];
    this._filteredList = [];
    this._renderCount = 0;
    try {
      const info = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const windowWidth = Number(info && info.windowWidth) || 375;
      this._swipeDeleteWidthPx = Math.round(windowWidth * SWIPE_DELETE_WIDTH_RPX / 750);
    } catch (err) {
      this._swipeDeleteWidthPx = 80;
    }
  },

  onShow() {
    this.loadMessageCenter();
  },

  _getSwipeDeleteWidthPx() {
    return Math.max(72, Number(this._swipeDeleteWidthPx) || 80);
  },

  _buildFilteredList(nextFilter = this.data.filter, nextList = this._allList) {
    const filter = pickStr(nextFilter, 'all');
    const list = Array.isArray(nextList) ? nextList : [];
    let displayList = list;
    if (filter === 'task') {
      displayList = list.filter((item) => item && item.kind === 'task');
    } else if (filter === 'goods') {
      displayList = list.filter((item) => item && item.kind === 'goods');
    }
    return { filter, displayList };
  },

  _rebuildDisplayList(nextFilter = this.data.filter, options = {}) {
    const resetPage = !!(options && options.resetPage);
    const extra = (options && options.extra) || {};
    const { filter, displayList } = this._buildFilteredList(nextFilter, this._allList);
    this._filteredList = displayList;
    if (resetPage) {
      this._renderCount = Math.min(displayList.length, MESSAGE_RENDER_BATCH);
    } else {
      const nextCount = Math.max(MESSAGE_RENDER_BATCH, Number(this._renderCount) || 0);
      this._renderCount = Math.min(displayList.length, nextCount);
    }
    this.setData({
      filter,
      displayList: displayList.slice(0, this._renderCount),
      hasMoreDisplay: this._renderCount < displayList.length,
      ...extra,
    });
  },

  _buildSummaryFromList(list = []) {
    return (Array.isArray(list) ? list : []).reduce((acc, item) => {
      const unread = Number(item && item.unreadCount) || 0;
      acc.totalUnread += unread;
      if (item && item.kind === 'goods') {
        acc.goodsUnread += unread;
        acc.goodsSessionCount += 1;
      } else {
        acc.taskUnread += unread;
        acc.taskSessionCount += 1;
      }
      acc.sessionCount += 1;
      return acc;
    }, {
      totalUnread: 0,
      taskUnread: 0,
      goodsUnread: 0,
      taskSessionCount: 0,
      goodsSessionCount: 0,
      sessionCount: 0,
    });
  },

  _normalizeList(list = []) {
    return (Array.isArray(list) ? list : []).map((item) => ({
      ...item,
      swipeOffsetPx: Math.max(0, Number(item && item.swipeOffsetPx) || 0),
      swipeMoving: !!(item && item.swipeMoving),
    }));
  },

  _getCurrentSwipeOffset(key = '') {
    const targetKey = pickStr(key);
    const item = (this._allList || []).find((session) => pickStr(session && session.key) === targetKey);
    return Math.max(0, Number(item && item.swipeOffsetPx) || 0);
  },

  _resetTouchState() {
    this._touchSessionKey = '';
    this._touchStartX = 0;
    this._touchStartY = 0;
    this._touchStartOffsetPx = 0;
    this._touchDragging = false;
  },

  _setSwipeState(sessionKey = '', offsetPx = 0, moving = false) {
    const key = pickStr(sessionKey);
    const deleteWidth = this._getSwipeDeleteWidthPx();
    const nextOffset = Math.max(0, Math.min(deleteWidth, Number(offsetPx) || 0));
    let changed = false;
    this._allList = (this._allList || []).map((item) => {
      const itemKey = pickStr(item && item.key);
      const itemOffset = itemKey && itemKey === key ? nextOffset : 0;
      const itemMoving = !!(itemKey && itemKey === key && moving);
      if ((Number(item && item.swipeOffsetPx) || 0) === itemOffset && !!(item && item.swipeMoving) === itemMoving) {
        return item;
      }
      changed = true;
      return {
        ...item,
        swipeOffsetPx: itemOffset,
        swipeMoving: itemMoving,
      };
    });
    const openedKey = nextOffset > 0 ? key : '';
    if (!changed && pickStr(this._openedSwipeKey) === openedKey) return;
    this._openedSwipeKey = openedKey;
    this._rebuildDisplayList(this.data.filter);
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
        swipeOffsetPx: 0,
        swipeMoving: false,
      }));

      this._allList = this._normalizeList(list);
      this._openedSwipeKey = '';
      this._rebuildDisplayList(this.data.filter, {
        resetPage: true,
        extra: {
          summary: ret.summary || this._buildSummaryFromList(this._allList),
          isLoading: false,
        }
      });
    } catch (err) {
      console.error('加载消息中心失败', err);
      this._allList = [];
      this._filteredList = [];
      this._renderCount = 0;
      this.setData({
        displayList: [],
        summary: {
          totalUnread: 0,
          taskUnread: 0,
          goodsUnread: 0,
          sessionCount: 0,
        },
        isLoading: false,
        hasMoreDisplay: false,
      });
      wx.showToast({ title: pickStr(err && err.message, '加载失败'), icon: 'none' });
    }
  },

  onFilterTap(e) {
    const filter = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.filter, 'all');
    this._openedSwipeKey = '';
    this._allList = this._normalizeList((this._allList || []).map((item) => ({
      ...item,
      swipeOffsetPx: 0,
      swipeMoving: false,
    })));
    this._rebuildDisplayList(filter, { resetPage: true });
  },

  onSessionTap(e) {
    if (pickStr(this._openedSwipeKey)) {
      this._setSwipeState('', 0, false);
      return;
    }
    const url = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url);
    if (!url) return;
    wx.navigateTo({ url });
  },

  onSessionTouchStart(e) {
    const key = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key);
    const touch = e && e.touches && e.touches[0];
    if (!key || !touch) return;
    this._touchSessionKey = key;
    this._touchStartX = Number(touch.pageX) || 0;
    this._touchStartY = Number(touch.pageY) || 0;
    this._touchStartOffsetPx = this._getCurrentSwipeOffset(key);
    this._touchDragging = false;
  },

  onSessionTouchMove(e) {
    const key = pickStr(this._touchSessionKey);
    const touch = e && e.touches && e.touches[0];
    if (!key || !touch) return;

    const dx = (Number(touch.pageX) || 0) - (Number(this._touchStartX) || 0);
    const dy = (Number(touch.pageY) || 0) - (Number(this._touchStartY) || 0);

    if (!this._touchDragging) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        this._resetTouchState();
        return;
      }
      this._touchDragging = true;
    }

    this._setSwipeState(key, (Number(this._touchStartOffsetPx) || 0) - dx, true);
  },

  onSessionTouchEnd() {
    const key = pickStr(this._touchSessionKey);
    if (!key) return;

    if (!this._touchDragging) {
      if (pickStr(this._openedSwipeKey) && pickStr(this._openedSwipeKey) !== key) {
        this._setSwipeState('', 0, false);
      }
      this._resetTouchState();
      return;
    }

    const currentOffset = this._getCurrentSwipeOffset(key);
    const deleteWidth = this._getSwipeDeleteWidthPx();
    const shouldOpen = currentOffset >= deleteWidth * SWIPE_TRIGGER_RATIO;
    this._setSwipeState(shouldOpen ? key : '', shouldOpen ? deleteWidth : 0, false);
    this._resetTouchState();
  },

  onSessionTouchCancel() {
    const key = pickStr(this._touchSessionKey);
    if (!key) return;
    const deleteWidth = this._getSwipeDeleteWidthPx();
    const currentOffset = this._getCurrentSwipeOffset(key);
    const shouldOpen = currentOffset >= deleteWidth * SWIPE_TRIGGER_RATIO;
    this._setSwipeState(shouldOpen ? key : '', shouldOpen ? deleteWidth : 0, false);
    this._resetTouchState();
  },

  async onDeleteTap(e) {
    const key = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key);
    const kind = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.kind);
    const targetId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.targetId);
    const peerUserId = pickStr(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.peerUserId);
    if (!key || !kind || !targetId || !peerUserId) return;
    if (pickStr(this.data.deletingKey) === key) return;

    this.setData({ deletingKey: key });
    try {
      const res = await wx.cloud.callFunction({
        name: 'deleteMessageCenterSession',
        data: {
          key,
          kind,
          targetId,
          peerUserId,
        }
      });
      const ret = (res && res.result) || {};
      if (!ret || ret.ok !== true) {
        throw new Error(pickStr(ret && ret.msg, '删除失败'));
      }

      this._allList = (this._allList || [])
        .filter((item) => pickStr(item && item.key) !== key)
        .map((item) => ({
          ...item,
          swipeOffsetPx: 0,
          swipeMoving: false,
        }));
      this._openedSwipeKey = '';
      this._rebuildDisplayList(this.data.filter, {
        extra: {
          summary: this._buildSummaryFromList(this._allList),
        }
      });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      console.error('删除消息中心会话失败', err);
      wx.showToast({ title: pickStr(err && err.message, '删除失败'), icon: 'none' });
    } finally {
      this._resetTouchState();
      this.setData({ deletingKey: '' });
    }
  },

  onReachBottom() {
    const total = Array.isArray(this._filteredList) ? this._filteredList.length : 0;
    if (!total) return;
    if ((Number(this._renderCount) || 0) >= total) return;
    this._renderCount = Math.min(total, (Number(this._renderCount) || 0) + MESSAGE_RENDER_BATCH);
    this.setData({
      displayList: this._filteredList.slice(0, this._renderCount),
      hasMoreDisplay: this._renderCount < total,
    });
  },
});
