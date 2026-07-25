const crypto = require('node:crypto');

function messageEventId(type, sourceId) {
  return crypto.createHash('sha256')
    .update(`${String(type || '')}:${String(sourceId || '')}`)
    .digest('hex');
}

function messageEventDocument(type, sourceId, payload = {}, createdAt = new Date()) {
  const shortText = (value, maximum) => (
    typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  );
  const document = {
    _id: messageEventId(type, sourceId),
    type,
    sourceId: String(sourceId || ''),
    ownerKey: payload.ownerKey || '',
    itemId: payload.itemId || '',
    itemTitle: shortText(payload.itemTitle, 120),
    itemThumbnailFileId: shortText(payload.itemThumbnailFileId, 700),
    commentId: payload.commentId || '',
    commentPreview: shortText(payload.commentPreview, 160),
    parentCommentId: payload.parentCommentId || '',
    replyToCommentId: payload.replyToCommentId || '',
    replyToOwnerKey: payload.replyToOwnerKey || '',
    threadOwnerKey: payload.threadOwnerKey || '',
    replyToPreview: shortText(payload.replyToPreview, 120),
    rootCommentPreview: shortText(payload.rootCommentPreview, 120),
    planKey: payload.planKey || '',
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: createdAt,
    claimId: '',
    claimedAt: null,
    claimExpiresAt: null,
    createdAt,
    updatedAt: createdAt
  };
  const rejectionReason = typeof payload.rejectionReason === 'string'
    ? payload.rejectionReason.trim().slice(0, 120)
    : '';
  if (rejectionReason) document.rejectionReason = rejectionReason;
  return document;
}

function writableDocument(document) {
  const value = { ...(document || {}) };
  delete value._id;
  return value;
}

module.exports = { messageEventId, messageEventDocument, writableDocument };
