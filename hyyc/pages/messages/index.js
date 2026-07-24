const {
  createMessagesState,
  normalizeMessagesResult
} = require('../../features/messages/model.js');
const {
  loadMessages: loadMessagesSession,
  markMessageRead,
  markAllMessagesRead
} = require('../../features/messages/session.js');

function messageNavigationUrl(message) {
  if (!message || !message.itemId) return '';
  const comments = message.openComments ? '&comments=1' : '';
  return `/pages/feed-detail/index?id=${encodeURIComponent(message.itemId)}${comments}`;
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
    this.messagesLoaded = false;
    this.messageReadInFlight = new Set();
    this.messageMutationGeneration = 0;
    return this.loadMessages();
  },

  onShow() {
    if (this.messagesLoaded) this.loadMessages({ force: true, preserveCurrent: true });
  },

  onUnload() {
    this.pageDisposed = true;
    this.messagesLoadRequestId = (this.messagesLoadRequestId || 0) + 1;
    this.messageMutationGeneration = (this.messageMutationGeneration || 0) + 1;
    if (this.messageReadInFlight) this.messageReadInFlight.clear();
  },

  onPullDownRefresh() {
    return this.loadMessages({ force: true, preserveCurrent: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  retryLoadMessages() {
    return this.loadMessages({ force: true });
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
        unreadCount: result.unreadCount,
        hasUnread: result.hasUnread
      });
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
    const message = (this.data.messages || []).find((item) => item.id === messageId);
    if (!message) return Promise.resolve(false);
    const readRequest = this.syncMessageRead(message);
    const url = messageNavigationUrl(message);
    if (url) wx.navigateTo({ url });
    return readRequest;
  },

  async markAllMessages() {
    if (this.data.markingAll || !this.data.hasUnread) return false;
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

module.exports = { messageNavigationUrl };
