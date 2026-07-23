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
      attachmentMediaCount: attachments.filter((attachment) => attachment.url).length,
      createdLabel: formatCommentDate(comment.createdAt, now)
    };
  });
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
  applyCommentMedia
};
