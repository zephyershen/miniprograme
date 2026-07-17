const { callCloudFunction } = require('../../services/cloud-functions.js');

function getBriefing(windowKey) {
  return callCloudFunction('knowledgeFeed', { action: 'digest', windowKey });
}

function getDigestReference(digestId, itemId) {
  return callCloudFunction('knowledgeFeed', { action: 'digestReference', digestId, itemId });
}

module.exports = { getBriefing, getDigestReference };
