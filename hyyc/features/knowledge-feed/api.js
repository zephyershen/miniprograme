const { callCloudFunction } = require('../../services/cloud-functions.js');

function getKnowledgeFeed(options = {}) {
  const query = typeof options === 'boolean' ? { force: options } : options;
  return callCloudFunction('knowledgeFeed', { action: 'feed', ...query });
}

function getKnowledgeItem(id) {
  return callCloudFunction('knowledgeFeed', { action: 'item', id });
}

module.exports = { getKnowledgeFeed, getKnowledgeItem };
