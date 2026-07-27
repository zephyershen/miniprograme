const { callCloudFunction } = require('../../services/cloud-functions.js');

function getKnowledgeFeed(options = {}) {
  const query = typeof options === 'boolean' ? { force: options } : options;
  return callCloudFunction('knowledgeFeed', { action: 'feed', ...query });
}

function getKnowledgeFeedUpdates(options = {}) {
  return callCloudFunction('knowledgeFeed', { action: 'feedUpdates', ...options });
}

function getKnowledgeFeedDay(options = {}) {
  return callCloudFunction('knowledgeFeed', { action: 'feedDay', ...options });
}

function searchKnowledgeFeed(options = {}) {
  return callCloudFunction('knowledgeFeed', { action: 'feedSearch', ...options });
}

function getKnowledgeItem(id) {
  return callCloudFunction('knowledgeFeed', { action: 'item', id });
}

module.exports = {
  getKnowledgeFeed,
  getKnowledgeFeedDay,
  getKnowledgeFeedUpdates,
  searchKnowledgeFeed,
  getKnowledgeItem
};
