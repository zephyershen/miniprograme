const { callCloudFunction } = require('../../services/cloud-functions.js');

function getMessages() {
  return callCloudFunction('knowledgeFeed', { action: 'messages' });
}

function markMessageRead(messageId, messageVersion = '') {
  return callCloudFunction('knowledgeFeed', {
    action: 'markMessageRead',
    messageId,
    ...(messageVersion ? { messageVersion } : {})
  });
}

function markAllMessagesRead() {
  return callCloudFunction('knowledgeFeed', { action: 'markAllMessagesRead' });
}

module.exports = {
  getMessages,
  markMessageRead,
  markAllMessagesRead
};
