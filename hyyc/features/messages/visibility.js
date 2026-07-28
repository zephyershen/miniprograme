const { isProductFeatureEnabled } = require('../../config/product-features.js');
const { normalizeMessagesResult } = require('./model.js');

const COMMENT_MESSAGE_KINDS = new Set([
  'comment_review_approved',
  'comment_approved',
  'comment_review_rejected',
  'comment_rejected',
  'comment_review_failed',
  'thread_comment_published',
  'comment_received',
  'thread_activity'
]);

function isCommentMessage(message) {
  if (!message) return false;
  const route = message.route && typeof message.route === 'object' ? message.route : {};
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  const kinds = [message.kind, message.type]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const categories = [
    message.category,
    message.messageCategory,
    route.category,
    payload.category
  ].map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  return kinds.some((kind) => (
    COMMENT_MESSAGE_KINDS.has(kind)
    || kind.startsWith('comment_')
    || kind.startsWith('thread_comment_')
  ))
    || categories.some((category) => (
      ['comment', 'comments', 'discussion'].includes(category)
    ))
    || message.openComments === true
    || route.openComments === true
    || payload.openComments === true
    || Boolean(
      message.commentId
      || message.parentCommentId
      || message.replyToCommentId
      || route.commentId
      || route.parentCommentId
      || route.replyToCommentId
      || payload.commentId
      || payload.parentCommentId
      || payload.replyToCommentId
    );
}

function filterProductMessages(result, {
  commentsEnabled = isProductFeatureEnabled('comments')
} = {}) {
  const source = result && typeof result === 'object' ? result : {};
  if (commentsEnabled) return source;
  const messages = (Array.isArray(source.messages) ? source.messages : [])
    .filter((message) => !isCommentMessage(message));
  const unreadCount = messages.filter((message) => message && message.unread).length;
  return {
    ...source,
    messages,
    interactionCount: messages.filter((message) => message && message.isInteraction).length,
    systemCount: messages.filter((message) => message && !message.isInteraction).length,
    unreadCount,
    hasUnread: unreadCount > 0
  };
}

function visibleMessagesResult(value, now = Date.now(), options) {
  const commentsEnabled = options && typeof options.commentsEnabled === 'boolean'
    ? options.commentsEnabled
    : isProductFeatureEnabled('comments');
  if (commentsEnabled) return normalizeMessagesResult(value, now);
  const source = value && typeof value === 'object' ? value : {};
  const rawVisibleResult = {
    ...source,
    messages: (Array.isArray(source.messages) ? source.messages : [])
      .filter((message) => !isCommentMessage(message))
  };
  return filterProductMessages(
    normalizeMessagesResult(rawVisibleResult, now),
    { commentsEnabled: false }
  );
}

module.exports = {
  COMMENT_MESSAGE_KINDS,
  isCommentMessage,
  filterProductMessages,
  visibleMessagesResult
};
