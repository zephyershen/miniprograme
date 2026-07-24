const crypto = require('node:crypto');

function messageEventId(type, sourceId) {
  return crypto.createHash('sha256')
    .update(`${String(type || '')}:${String(sourceId || '')}`)
    .digest('hex');
}

function messageEventDocument(type, sourceId, payload = {}, createdAt = new Date()) {
  return {
    _id: messageEventId(type, sourceId),
    type,
    sourceId: String(sourceId || ''),
    ownerKey: payload.ownerKey || '',
    itemId: payload.itemId || '',
    itemTitle: payload.itemTitle || '',
    commentId: payload.commentId || '',
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
}

function writableDocument(document) {
  const value = { ...(document || {}) };
  delete value._id;
  return value;
}

module.exports = { messageEventId, messageEventDocument, writableDocument };
