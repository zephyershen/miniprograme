const { callCloudFunction } = require('../../services/cloud-functions.js');
const { isProductFeatureEnabled } = require('../../config/product-features.js');

function getMessages() {
  return callCloudFunction('knowledgeFeed', {
    action: 'messages',
    includeComments: isProductFeatureEnabled('comments')
  });
}

function markMessageRead(messageId, messageVersion = '') {
  return callCloudFunction('knowledgeFeed', {
    action: 'markMessageRead',
    messageId,
    includeComments: isProductFeatureEnabled('comments'),
    ...(messageVersion ? { messageVersion } : {})
  });
}

function deleteMessage(messageId) {
  return callCloudFunction('knowledgeFeed', {
    action: 'deleteMessage',
    messageId,
    includeComments: isProductFeatureEnabled('comments')
  });
}

function markAllMessagesRead() {
  return callCloudFunction('knowledgeFeed', {
    action: 'markAllMessagesRead',
    includeComments: isProductFeatureEnabled('comments')
  });
}

module.exports = {
  getMessages,
  markMessageRead,
  deleteMessage,
  markAllMessagesRead
};
