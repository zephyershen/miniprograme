const { callCloudFunction } = require('../../services/cloud-functions.js');

function getCuratedFeed(options = {}) {
  return callCloudFunction('knowledgeFeed', { action: 'feed', mode: 'curated', ...options });
}

module.exports = { getCuratedFeed };
