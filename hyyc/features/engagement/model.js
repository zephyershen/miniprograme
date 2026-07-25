function engagementCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function formatActionCount(value) {
  const count = engagementCount(value);
  if (!count) return '';
  if (count > 9999) return `${Math.floor(count / 1000) / 10}万`;
  if (count > 999) return `${Math.floor(count / 100) / 10}k`;
  return String(count);
}

function decorateEngagement(value = {}) {
  return {
    liked: value.liked === true,
    favorited: value.favorited === true,
    canComment: value.canComment === true,
    likeCount: engagementCount(value.likeCount),
    commentCount: engagementCount(value.commentCount),
    favoriteCount: engagementCount(value.favoriteCount),
    likeLabel: formatActionCount(value.likeCount),
    commentLabel: formatActionCount(value.commentCount)
  };
}

function decorateItemEngagement(item = {}) {
  return { ...item, engagement: decorateEngagement(item.engagement) };
}

function applyItemEngagement(items = [], itemId, engagement) {
  return items.map((item) => item && item.id === itemId
    ? { ...item, engagement: decorateEngagement(engagement) }
    : item);
}

function formatSavedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '保存时间待确认';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}.${day} 收藏`;
}

function decorateFavorites(items = []) {
  return items.map((item) => ({ ...item, savedLabel: formatSavedDate(item.savedAt) }));
}

function formatCommentDate(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '刚刚';
  const distance = Math.max(0, now - timestamp);
  if (distance < 60 * 1000) return '刚刚';
  if (distance < 60 * 60 * 1000) return `${Math.floor(distance / 60000)} 分钟前`;
  if (distance < 24 * 60 * 60 * 1000) return `${Math.floor(distance / 3600000)} 小时前`;
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function decorateComments(comments = [], now = Date.now()) {
  return comments.map((comment) => {
    const attachments = (comment.attachments || []).map((attachment) => ({
      ...attachment,
      url: typeof attachment.url === 'string' ? attachment.url : ''
    }));
    return {
      ...comment,
      author: {
        ...(comment.author || {}),
        avatarUrl: typeof (comment.author || {}).avatarUrl === 'string'
          ? comment.author.avatarUrl
          : ''
      },
      attachments,
      attachmentCount: attachments.length,
      attachmentMediaCount: attachments.filter((attachment) => attachment.url).length,
      createdLabel: formatCommentDate(comment.createdAt, now)
    };
  });
}

function arrangeCommentThreads(comments = []) {
  const roots = [];
  const repliesByRoot = new Map();
  const knownIds = new Set(
    comments.filter((comment) => comment && comment.id).map((comment) => comment.id)
  );
  comments.forEach((comment) => {
    if (!comment || !comment.parentCommentId || !knownIds.has(comment.parentCommentId)) {
      roots.push(comment);
      return;
    }
    const replies = repliesByRoot.get(comment.parentCommentId) || [];
    replies.push(comment);
    repliesByRoot.set(comment.parentCommentId, replies);
  });
  const byOldestFirst = (left, right) => {
    const leftTime = new Date(left && left.createdAt).getTime();
    const rightTime = new Date(right && right.createdAt).getTime();
    return (Number.isFinite(leftTime) ? leftTime : 0)
      - (Number.isFinite(rightTime) ? rightTime : 0);
  };
  return roots.flatMap((root) => [
    root,
    ...(repliesByRoot.get(root && root.id) || []).sort(byOldestFirst)
  ]);
}

function decorateCommentThreads(comments = [], now = Date.now()) {
  return arrangeCommentThreads(decorateComments(comments, now));
}

function createOptimisticPendingComment({
  id,
  content = '',
  images = [],
  profile = {},
  replyTarget = null,
  createdAt = new Date().toISOString(),
  statusLabel = '正在发送'
} = {}) {
  const nickname = profile.nickname || profile.displayNickname || '读者';
  const avatarFileId = profile.avatarFileId || profile.displayAvatarFileId || '';
  const avatarUrl = profile.avatarUrl || profile.displayAvatarUrl || '';
  return decorateComments([{
    id,
    content,
    attachments: images.map((image, index) => {
      const localPath = image.tempFilePath || image.localPath || image.url || '';
      return {
        type: 'image',
        fileId: image.fileId || `local:${id}:${index}`,
        width: image.width,
        height: image.height,
        url: localPath,
        localPath
      };
    }),
    author: {
      nickname,
      avatarFileId,
      avatarUrl,
      initial: profile.initial || [...nickname][0] || '读'
    },
    authorLabel: nickname,
    parentCommentId: replyTarget && (replyTarget.parentCommentId || replyTarget.id) || '',
    replyToCommentId: replyTarget && replyTarget.id || '',
    replyToNickname: replyTarget && replyTarget.nickname || '',
    replyToPreview: replyTarget && replyTarget.preview || '',
    isReply: Boolean(replyTarget && replyTarget.id),
    isMine: true,
    reviewPending: true,
    statusLabel,
    canDelete: false,
    canReport: false,
    canAppeal: false,
    canRestore: false,
    localPending: true,
    createdAt
  }])[0];
}

function updateOptimisticPendingComment(comments = [], id, updates = {}) {
  return comments.map((comment) => {
    if (!comment || comment.id !== id) return comment;
    return decorateComments([{ ...comment, ...updates }])[0];
  });
}

function mergeLocalCommentMedia(comment = {}, localComment = {}) {
  const localAttachments = localComment.attachments || [];
  return {
    ...comment,
    attachments: (comment.attachments || []).map((attachment, index) => {
      const local = localAttachments[index] || {};
      return {
        ...attachment,
        ...(local.url ? { url: local.url } : {}),
        ...(local.localPath ? { localPath: local.localPath } : {})
      };
    })
  };
}

function applyCommentMedia(comments = [], mediaUrls = new Map()) {
  return comments.map((comment) => {
    const author = comment.author || {};
    const attachments = (comment.attachments || []).map((attachment) => ({
      ...attachment,
      url: mediaUrls.get(attachment.fileId) || attachment.url || ''
    }));
    return {
      ...comment,
      author: {
        ...author,
        avatarUrl: mediaUrls.get(author.avatarFileId) || author.avatarUrl || ''
      },
      attachments,
      attachmentCount: attachments.length,
      attachmentMediaCount: attachments.filter((attachment) => attachment.url).length
    };
  });
}

function mergeResolvedCommentMedia(currentComments = [], resolvedComments = []) {
  const resolvedById = new Map(
    resolvedComments
      .filter((comment) => comment && comment.id)
      .map((comment) => [comment.id, comment])
  );
  return currentComments.map((comment) => {
    if (!comment || !comment.id) return comment;
    const resolved = resolvedById.get(comment.id);
    if (!resolved) return comment;
    const resolvedAttachments = new Map(
      (resolved.attachments || [])
        .filter((attachment) => attachment && attachment.fileId)
        .map((attachment) => [attachment.fileId, attachment])
    );
    const attachments = (comment.attachments || []).map((attachment, index) => {
      const resolvedAttachment = resolvedAttachments.get(attachment.fileId)
        || (resolved.attachments || [])[index];
      if (!resolvedAttachment) return attachment;
      const resolvedUrl = /^https:\/\//i.test(resolvedAttachment.url || '')
        ? resolvedAttachment.url
        : '';
      return {
        ...attachment,
        ...resolvedAttachment,
        url: resolvedUrl || attachment.url || attachment.localPath || '',
        ...(attachment.localPath ? { localPath: attachment.localPath } : {})
      };
    });
    const currentAuthor = comment.author || {};
    const resolvedAuthor = resolved.author || {};
    return {
      ...comment,
      author: {
        ...currentAuthor,
        ...resolvedAuthor,
        avatarUrl: resolvedAuthor.avatarUrl || currentAuthor.avatarUrl || ''
      },
      attachments,
      attachmentCount: attachments.length,
      attachmentMediaCount: attachments.filter((attachment) => attachment.url).length
    };
  });
}

module.exports = {
  engagementCount,
  formatActionCount,
  decorateEngagement,
  decorateItemEngagement,
  applyItemEngagement,
  formatSavedDate,
  decorateFavorites,
  formatCommentDate,
  decorateComments,
  arrangeCommentThreads,
  decorateCommentThreads,
  createOptimisticPendingComment,
  updateOptimisticPendingComment,
  mergeLocalCommentMedia,
  applyCommentMedia,
  mergeResolvedCommentMedia
};
