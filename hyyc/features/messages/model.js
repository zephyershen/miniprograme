const MESSAGE_KINDS = Object.freeze({
  membership_succeeded: Object.freeze({
    label: '会员',
    glyph: 'P',
    tone: 'success',
    title: 'Pro 会员已开通',
    body: '会员权益已经生效，可以继续查看完整内容。'
  }),
  membership_activated: Object.freeze({
    label: '会员',
    glyph: 'P',
    tone: 'success',
    title: 'Pro 会员已开通',
    body: '会员权益已经生效，可以继续查看完整内容。'
  }),
  subscription_success: Object.freeze({
    label: '会员',
    glyph: 'P',
    tone: 'success',
    title: 'Pro 会员已开通',
    body: '会员权益已经生效，可以继续查看完整内容。'
  }),
  profile_review_approved: Object.freeze({
    label: '个人资料',
    glyph: '资',
    tone: 'success',
    title: '资料审核通过',
    body: '新的头像和昵称已经开始展示。'
  }),
  profile_approved: Object.freeze({
    label: '个人资料',
    glyph: '资',
    tone: 'success',
    title: '资料审核通过',
    body: '新的头像和昵称已经开始展示。'
  }),
  profile_review_rejected: Object.freeze({
    label: '个人资料',
    glyph: '资',
    tone: 'warning',
    title: '资料审核未通过',
    body: '请调整头像或昵称后重新提交。'
  }),
  profile_rejected: Object.freeze({
    label: '个人资料',
    glyph: '资',
    tone: 'warning',
    title: '资料审核未通过',
    body: '请调整头像或昵称后重新提交。'
  }),
  profile_review_failed: Object.freeze({
    label: '个人资料',
    glyph: '资',
    tone: 'warning',
    title: '资料审核未完成',
    body: '本次审核未能完成，请重新提交资料。'
  }),
  comment_review_approved: Object.freeze({
    label: '评论审核',
    glyph: '评',
    tone: 'success',
    title: '评论审核通过',
    body: '你的评论已经发布。'
  }),
  comment_approved: Object.freeze({
    label: '评论审核',
    glyph: '评',
    tone: 'success',
    title: '评论审核通过',
    body: '你的评论已经发布。'
  }),
  comment_review_rejected: Object.freeze({
    label: '评论审核',
    glyph: '评',
    tone: 'warning',
    title: '评论审核未通过',
    body: '未通过原因：内容不符合社区发布规范。评论文字及待审图片已删除。'
  }),
  comment_rejected: Object.freeze({
    label: '评论审核',
    glyph: '评',
    tone: 'warning',
    title: '评论审核未通过',
    body: '未通过原因：内容不符合社区发布规范。评论文字及待审图片已删除。'
  }),
  comment_review_failed: Object.freeze({
    label: '评论审核',
    glyph: '评',
    tone: 'warning',
    title: '评论审核未完成',
    body: '本次审核未能完成，请重新提交评论。'
  }),
  thread_comment_published: Object.freeze({
    label: '讨论动态',
    glyph: '讯',
    tone: 'info',
    title: '你参与的资讯有新评论',
    body: '打开资讯，看看讨论中的新观点。'
  }),
  comment_received: Object.freeze({
    label: '讨论动态',
    glyph: '讯',
    tone: 'info',
    title: '你参与的资讯有新评论',
    body: '打开资讯，看看讨论中的新观点。'
  }),
  thread_activity: Object.freeze({
    label: '讨论动态',
    glyph: '讯',
    tone: 'info',
    title: '你参与的资讯有新评论',
    body: '打开资讯，看看讨论中的新观点。'
  })
});

const DEFAULT_KIND = Object.freeze({
  label: '站内消息',
  glyph: '讯',
  tone: 'info',
  title: '你有一条新消息',
  body: '打开后可查看这条消息的详细内容。'
});

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function messageInitial(value) {
  const nickname = safeString(value) || '读者';
  return [...nickname][0] || '读';
}

function formatMessageDate(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const distance = Math.max(0, Number(now) - timestamp);
  if (distance < 60 * 1000) return '刚刚';
  if (distance < 60 * 60 * 1000) return `${Math.floor(distance / 60000)} 分钟前`;
  if (distance < 24 * 60 * 60 * 1000) return `${Math.floor(distance / 3600000)} 小时前`;
  const date = new Date(timestamp);
  const current = new Date(now);
  const dateLabel = `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  return date.getFullYear() === current.getFullYear()
    ? dateLabel
    : `${date.getFullYear()}.${dateLabel}`;
}

function messageItemId(source = {}) {
  const route = source.route && typeof source.route === 'object' ? source.route : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  return safeString(source.itemId) || safeString(route.itemId) || safeString(payload.itemId);
}

function decorateMessage(source = {}, now = Date.now()) {
  source = source && typeof source === 'object' ? source : {};
  const id = safeString(source.id) || safeString(source._id);
  if (!id) return null;
  const kind = safeString(source.kind) || safeString(source.type);
  const presentation = MESSAGE_KINDS[kind] || DEFAULT_KIND;
  const route = source.route && typeof source.route === 'object' ? source.route : {};
  const occurredAt = source.occurredAt || source.createdAt || null;
  const isRead = source.unread === false || source.isRead === true || Boolean(source.readAt);
  const itemId = messageItemId(source);
  const actorNickname = safeString(source.actorNickname);
  const replyToCommentId = safeString(source.replyToCommentId);
  const isOwnComment = [
    'comment_review_approved',
    'comment_approved'
  ].includes(kind);
  const isInteraction = [
    'thread_comment_published',
    'comment_received',
    'thread_activity',
    'comment_review_approved',
    'comment_approved'
  ].includes(kind);
  return {
    id,
    version: safeString(source.version)
      || safeString(source.sourceEventId)
      || safeString(source.lastEventId),
    kind,
    kindLabel: presentation.label,
    glyph: presentation.glyph,
    tone: presentation.tone,
    title: safeString(source.title) || presentation.title,
    body: safeString(source.body) || safeString(source.copy) || presentation.body,
    itemId,
    itemTitle: safeString(source.itemTitle),
    itemThumbnailFileId: safeString(source.itemThumbnailFileId),
    itemThumbnailUrl: safeString(source.itemThumbnailUrl),
    commentId: safeString(source.commentId),
    parentCommentId: safeString(source.parentCommentId),
    replyToCommentId,
    commentPreview: safeString(source.commentPreview)
      || safeString(source.body)
      || safeString(source.copy),
    replyToPreview: safeString(source.replyToPreview),
    rootCommentPreview: safeString(source.rootCommentPreview),
    actorNickname,
    actorInitial: messageInitial(actorNickname),
    actorAvatarFileId: safeString(source.actorAvatarFileId),
    actorAvatarUrl: safeString(source.actorAvatarUrl),
    isOwnComment,
    isInteraction,
    interactionVerb: isOwnComment
      ? '已发布'
      : (replyToCommentId ? '回复了评论' : '参与了讨论'),
    openComments: source.openComments === true || route.openComments === true,
    isRead,
    unread: !isRead,
    occurredAt,
    occurredLabel: formatMessageDate(occurredAt, now),
    canOpenItem: Boolean(itemId)
  };
}

function mergeResolvedMessageMedia(currentMessages = [], resolvedMessages = []) {
  const resolvedById = new Map(
    resolvedMessages.filter((message) => message && message.id)
      .map((message) => [message.id, message])
  );
  return currentMessages.map((message) => {
    const resolved = resolvedById.get(message && message.id);
    if (!resolved) return message;
    return {
      ...message,
      actorAvatarUrl: resolved.actorAvatarUrl || message.actorAvatarUrl || '',
      itemThumbnailUrl: resolved.itemThumbnailUrl || message.itemThumbnailUrl || ''
    };
  });
}

function normalizeMessagesResult(value = {}, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const messages = (Array.isArray(source.messages) ? source.messages : [])
    .map((message, index) => ({
      message: decorateMessage(message, now),
      index
    }))
    .filter((entry) => entry.message)
    .sort((left, right) => {
      const leftTime = new Date(left.message.occurredAt).getTime();
      const rightTime = new Date(right.message.occurredAt).getTime();
      const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
      const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
      return safeRight - safeLeft || left.index - right.index;
    })
    .map((entry) => entry.message);
  const visibleUnreadCount = messages.filter((message) => message.unread).length;
  const suppliedUnreadCount = Number(source.unreadCount);
  const unreadCount = Number.isFinite(suppliedUnreadCount)
    ? Math.max(visibleUnreadCount, Math.max(0, Math.floor(suppliedUnreadCount)))
    : visibleUnreadCount;
  return {
    messages,
    interactionCount: messages.filter((message) => message.isInteraction).length,
    systemCount: messages.filter((message) => !message.isInteraction).length,
    unreadCount,
    hasUnread: unreadCount > 0
  };
}

function removeMessageFromState(state = {}, messageId) {
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const removed = messages.find((message) => message && message.id === messageId);
  if (!removed) return null;
  const nextMessages = messages.filter((message) => message && message.id !== messageId);
  const unreadCount = Math.max(
    0,
    Math.floor(Number(state.unreadCount) || 0) - (removed.unread ? 1 : 0)
  );
  return {
    messages: nextMessages,
    interactionCount: nextMessages.filter((message) => message.isInteraction).length,
    systemCount: nextMessages.filter((message) => !message.isInteraction).length,
    unreadCount,
    hasUnread: unreadCount > 0
  };
}

function createMessagesState() {
  return {
    loading: true,
    error: '',
    messages: [],
    interactionCount: 0,
    systemCount: 0,
    unreadCount: 0,
    hasUnread: false,
    markingAll: false,
    activeMessageTab: 'interaction',
    swipedMessageId: '',
    swipeDraggingId: '',
    swipeDragOffset: 0,
    deletingMessageId: ''
  };
}

module.exports = {
  MESSAGE_KINDS,
  formatMessageDate,
  decorateMessage,
  mergeResolvedMessageMedia,
  normalizeMessagesResult,
  removeMessageFromState,
  createMessagesState
};
