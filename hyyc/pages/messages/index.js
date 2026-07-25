const {
  createMessagesState,
  normalizeMessagesResult,
  mergeResolvedMessageMedia,
  removeMessageFromState
} = require('../../features/messages/model.js');
const { resolveMessageMedia } = require('../../features/messages/media.js');
const {
  loadMessages: loadMessagesSession,
  markMessageRead,
  deleteMessage: deleteMessageSession,
  markAllMessagesRead
} = require('../../features/messages/session.js');

const SWIPE_DELETE_WIDTH_RPX = 136;
const MESSAGE_REFRESH_INTERVAL_MS = 10 * 1000;

function touchPoint(event, ending = false) {
  const values = ending
    ? event && event.changedTouches
    : event && event.touches;
  const point = values && values[0];
  if (!point) return null;
  return {
    x: Number(point.clientX),
    y: Number(point.clientY)
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function messageNavigationUrl(message) {
  if (!message || !message.itemId) return '';
  const comments = message.openComments ? '&comments=1' : '';
  const comment = message.commentId
    ? `&commentId=${encodeURIComponent(message.commentId)}`
    : '';
  return `/pages/feed-detail/index?id=${encodeURIComponent(message.itemId)}${comments}${comment}`;
}

function sameMessageIds(left = [], right = []) {
  return left.length === right.length
    && left.every((message, index) => message.id === right[index].id);
}

function messageReadStatePatch(current = [], next = [], rootPath = 'messages') {
  if (!sameMessageIds(current, next)) return null;
  if (current.some((message, index) => message.version !== next[index].version)) return null;
  return next.reduce((patch, message, index) => {
    if (current[index].isRead !== message.isRead) {
      patch[`${rootPath}[${index}].isRead`] = message.isRead;
    }
    if (current[index].unread !== message.unread) {
      patch[`${rootPath}[${index}].unread`] = message.unread;
    }
    return patch;
  }, {});
}

Page({
  data: createMessagesState(),

  onLoad() {
    this.pageDisposed = false;
    this.messagesPageVisible = false;
    this.messagesLoaded = false;
    this.messageReadInFlight = new Set();
    this.messageMutationGeneration = 0;
    this.messageSwipeGesture = null;
    this.messageDeleteWidth = SWIPE_DELETE_WIDTH_RPX / 2;
    try {
      const windowInfo = typeof wx.getWindowInfo === 'function'
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      const windowWidth = Number(windowInfo && windowInfo.windowWidth);
      if (windowWidth > 0) {
        this.messageDeleteWidth = windowWidth * SWIPE_DELETE_WIDTH_RPX / 750;
      }
    } catch (error) {
      // The 375px fallback keeps the gesture usable in older runtimes.
    }
    return this.loadMessages();
  },

  onShow() {
    this.messagesPageVisible = true;
    const refresh = this.messagesLoaded
      ? this.refreshMessagesInBackground()
      : Promise.resolve(false);
    this.scheduleMessagesRefresh();
    return refresh;
  },

  onHide() {
    this.messagesPageVisible = false;
    this.stopMessagesRefresh();
  },

  onUnload() {
    this.pageDisposed = true;
    this.messagesPageVisible = false;
    this.stopMessagesRefresh();
    this.messagesLoadRequestId = (this.messagesLoadRequestId || 0) + 1;
    this.messageMutationGeneration = (this.messageMutationGeneration || 0) + 1;
    this.messageSwipeGesture = null;
    if (this.messageReadInFlight) this.messageReadInFlight.clear();
  },

  scheduleMessagesRefresh(delay = MESSAGE_REFRESH_INTERVAL_MS) {
    this.stopMessagesRefresh();
    if (this.pageDisposed || !this.messagesPageVisible) return;
    this.messagesRefreshTimer = setTimeout(async () => {
      this.messagesRefreshTimer = null;
      await this.refreshMessagesInBackground();
      this.scheduleMessagesRefresh();
    }, delay);
  },

  stopMessagesRefresh() {
    if (this.messagesRefreshTimer) clearTimeout(this.messagesRefreshTimer);
    this.messagesRefreshTimer = null;
  },

  async refreshMessagesInBackground() {
    if (this.pageDisposed || !this.messagesPageVisible
      || this.messagesBackgroundRefreshActive
      || this.data.deletingMessageId
      || this.data.markingAll) return false;
    this.messagesBackgroundRefreshActive = true;
    try {
      return await this.loadMessages({ force: true, preserveCurrent: true });
    } finally {
      this.messagesBackgroundRefreshActive = false;
    }
  },

  onPullDownRefresh() {
    return this.loadMessages({ force: true, preserveCurrent: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  retryLoadMessages() {
    return this.loadMessages({ force: true });
  },

  switchMessageTab(event) {
    const tab = event.currentTarget.dataset.tab || 'interaction';
    if (tab === this.data.activeMessageTab) return;
    this.setData({
      activeMessageTab: tab,
      swipedMessageId: '',
      swipeDraggingId: '',
      swipeDragOffset: 0
    });
  },

  onMessageTouchStart(event) {
    if (this.data.deletingMessageId || this.data.markingAll) return;
    const messageId = event.currentTarget.dataset.messageId || '';
    const point = touchPoint(event);
    if (!messageId || !point) return;
    const wasOpen = this.data.swipedMessageId === messageId;
    this.messageSwipeGesture = {
      messageId,
      startX: point.x,
      startY: point.y,
      axis: '',
      wasOpen,
      offset: wasOpen ? -this.messageDeleteWidth : 0
    };
    if (this.data.swipedMessageId && !wasOpen) {
      this.setData({ swipedMessageId: '' });
    }
  },

  onMessageTouchMove(event) {
    const gesture = this.messageSwipeGesture;
    const point = touchPoint(event);
    if (!gesture || !point) return;
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    if (!gesture.axis) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 5) return;
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }
    if (gesture.axis !== 'horizontal') return;
    gesture.offset = clamp(
      (gesture.wasOpen ? -this.messageDeleteWidth : 0) + deltaX,
      -this.messageDeleteWidth,
      0
    );
    this.setData({
      swipeDraggingId: gesture.messageId,
      swipeDragOffset: gesture.offset
    });
  },

  onMessageTouchEnd(event) {
    const gesture = this.messageSwipeGesture;
    this.messageSwipeGesture = null;
    if (!gesture) return;
    if (gesture.axis !== 'horizontal') {
      if (this.data.swipeDraggingId) {
        this.setData({ swipeDraggingId: '', swipeDragOffset: 0 });
      }
      return;
    }
    const point = touchPoint(event, true);
    const deltaX = point ? point.x - gesture.startX : 0;
    const threshold = this.messageDeleteWidth * 0.25;
    const shouldOpen = gesture.wasOpen
      ? deltaX <= threshold
      : deltaX < -threshold;
    this.suppressMessageTapId = gesture.messageId;
    this.suppressMessageTapUntil = Date.now() + 300;
    this.setData({
      swipedMessageId: shouldOpen ? gesture.messageId : '',
      swipeDraggingId: '',
      swipeDragOffset: 0
    });
  },

  onMessageTouchCancel() {
    const gesture = this.messageSwipeGesture;
    this.messageSwipeGesture = null;
    this.setData({
      swipedMessageId: gesture && gesture.wasOpen ? gesture.messageId : '',
      swipeDraggingId: '',
      swipeDragOffset: 0
    });
  },

  async loadMessages({ force = false, preserveCurrent = false } = {}) {
    if (this.pageDisposed) return false;
    const requestId = (this.messagesLoadRequestId || 0) + 1;
    this.messagesLoadRequestId = requestId;
    const showLoading = !preserveCurrent && !this.messagesLoaded;
    this.setData(showLoading
      ? { loading: true, error: '' }
      : { error: '' });
    try {
      const result = normalizeMessagesResult(await loadMessagesSession({ force }));
      if (this.pageDisposed || requestId !== this.messagesLoadRequestId) return false;
      this.messagesLoaded = true;
      const messagesChanged = JSON.stringify(this.data.messages) !== JSON.stringify(result.messages);
      this.setData({
        loading: false,
        error: '',
        ...(messagesChanged ? { messages: result.messages } : {}),
        interactionCount: result.interactionCount,
        systemCount: result.systemCount,
        unreadCount: result.unreadCount,
        hasUnread: result.hasUnread,
        ...(!result.messages.some((message) => message.id === this.data.swipedMessageId)
          ? { swipedMessageId: '' }
          : {})
      });
      this.resolveVisibleMessageMedia(result.messages);
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.messagesLoadRequestId) return false;
      if (preserveCurrent && (this.data.messages || []).length) {
        this.setData({ loading: false, error: '' });
        return false;
      }
      this.setData({
        loading: false,
        error: (error && error.message) || '消息暂时无法加载，请稍后重试'
      });
      return false;
    }
  },

  async resolveVisibleMessageMedia(messages) {
    const requestId = (this.messageMediaRequestId || 0) + 1;
    this.messageMediaRequestId = requestId;
    try {
      const resolved = await resolveMessageMedia(messages);
      if (this.pageDisposed || requestId !== this.messageMediaRequestId) return false;
      this.setData({
        messages: mergeResolvedMessageMedia(this.data.messages, resolved)
      });
      return true;
    } catch (error) {
      return false;
    }
  },

  applyMessageReadLocally(messageId) {
    const current = (this.data.messages || []).find((message) => message.id === messageId);
    if (!current || current.isRead) return false;
    const index = this.data.messages.findIndex((message) => message.id === messageId);
    const unreadCount = Math.max(0, Number(this.data.unreadCount || 0) - 1);
    this.setData({
      [`messages[${index}].isRead`]: true,
      [`messages[${index}].unread`]: false,
      unreadCount,
      hasUnread: unreadCount > 0
    });
    return true;
  },

  async syncMessageRead(message) {
    if (!message || message.isRead || this.messageReadInFlight.has(message.id)) return true;
    const mutationGeneration = (this.messageMutationGeneration || 0) + 1;
    this.messageMutationGeneration = mutationGeneration;
    this.messageReadInFlight.add(message.id);
    this.applyMessageReadLocally(message.id);
    try {
      const result = normalizeMessagesResult(
        await markMessageRead(message.id, message.version)
      );
      if (!this.pageDisposed && mutationGeneration === this.messageMutationGeneration) {
        const readPatch = messageReadStatePatch(this.data.messages, result.messages);
        this.setData({
          ...(readPatch === null ? { messages: result.messages } : readPatch),
          unreadCount: result.unreadCount,
          hasUnread: result.hasUnread
        });
      }
      return true;
    } catch (error) {
      if (!this.pageDisposed && mutationGeneration === this.messageMutationGeneration) {
        wx.showToast({ title: '未读状态稍后同步', icon: 'none' });
      }
      return false;
    } finally {
      this.messageReadInFlight.delete(message.id);
    }
  },

  openMessage(event) {
    const messageId = event && event.currentTarget && event.currentTarget.dataset.messageId;
    if (this.suppressMessageTapId === messageId && Date.now() < this.suppressMessageTapUntil) {
      this.suppressMessageTapId = '';
      return Promise.resolve(false);
    }
    if (this.data.swipedMessageId) {
      this.setData({ swipedMessageId: '' });
      return Promise.resolve(false);
    }
    const message = (this.data.messages || []).find((item) => item.id === messageId);
    if (!message) return Promise.resolve(false);
    const readRequest = this.syncMessageRead(message);
    const url = messageNavigationUrl(message);
    if (url) wx.navigateTo({ url });
    return readRequest;
  },

  async deleteMessage(event) {
    const messageId = event && event.currentTarget && event.currentTarget.dataset.messageId;
    if (!messageId || this.data.deletingMessageId || this.data.markingAll) return false;
    const optimisticState = removeMessageFromState(this.data, messageId);
    if (!optimisticState) return false;
    const previous = {
      messages: this.data.messages,
      interactionCount: this.data.interactionCount,
      systemCount: this.data.systemCount,
      unreadCount: this.data.unreadCount,
      hasUnread: this.data.hasUnread
    };
    const mutationGeneration = (this.messageMutationGeneration || 0) + 1;
    this.messageMutationGeneration = mutationGeneration;
    this.messageMediaRequestId = (this.messageMediaRequestId || 0) + 1;
    this.setData({
      ...optimisticState,
      deletingMessageId: messageId,
      swipedMessageId: '',
      swipeDraggingId: '',
      swipeDragOffset: 0
    });
    try {
      const result = normalizeMessagesResult(await deleteMessageSession(messageId));
      if (this.pageDisposed || mutationGeneration !== this.messageMutationGeneration) return false;
      this.setData({
        messages: result.messages,
        interactionCount: result.interactionCount,
        systemCount: result.systemCount,
        unreadCount: result.unreadCount,
        hasUnread: result.hasUnread
      });
      this.resolveVisibleMessageMedia(result.messages);
      return true;
    } catch (error) {
      if (!this.pageDisposed && mutationGeneration === this.messageMutationGeneration) {
        this.setData(previous);
        wx.showToast({
          title: (error && error.message) || '删除失败，请重试',
          icon: 'none'
        });
      }
      return false;
    } finally {
      if (!this.pageDisposed && this.data.deletingMessageId === messageId) {
        this.setData({ deletingMessageId: '' });
      }
    }
  },

  async markAllMessages() {
    if (this.data.markingAll || this.data.deletingMessageId || !this.data.hasUnread) return false;
    const mutationGeneration = (this.messageMutationGeneration || 0) + 1;
    this.messageMutationGeneration = mutationGeneration;
    const previous = {
      messages: this.data.messages,
      unreadCount: this.data.unreadCount,
      hasUnread: this.data.hasUnread
    };
    const optimisticPatch = this.data.messages.reduce((patch, message, index) => {
      if (!message.isRead) patch[`messages[${index}].isRead`] = true;
      if (message.unread) patch[`messages[${index}].unread`] = false;
      return patch;
    }, {});
    this.setData({
      markingAll: true,
      ...optimisticPatch,
      unreadCount: 0,
      hasUnread: false
    });
    try {
      const result = normalizeMessagesResult(await markAllMessagesRead());
      if (this.pageDisposed || mutationGeneration !== this.messageMutationGeneration) return false;
      const readPatch = messageReadStatePatch(this.data.messages, result.messages);
      this.setData({
        ...(readPatch === null ? { messages: result.messages } : readPatch),
        unreadCount: result.unreadCount,
        hasUnread: result.hasUnread
      });
      return true;
    } catch (error) {
      if (!this.pageDisposed && mutationGeneration === this.messageMutationGeneration) {
        this.setData(previous);
        wx.showToast({
          title: (error && error.message) || '全部标记已读失败，请重试',
          icon: 'none'
        });
      }
      return false;
    } finally {
      if (!this.pageDisposed) this.setData({ markingAll: false });
    }
  }
});

module.exports = {
  SWIPE_DELETE_WIDTH_RPX,
  MESSAGE_REFRESH_INTERVAL_MS,
  touchPoint,
  messageNavigationUrl
};
