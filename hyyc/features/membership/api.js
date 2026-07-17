const { callCloudFunction } = require('../../services/cloud-functions.js');

function getMembershipStatus() {
  return callCloudFunction('knowledgeFeed', { action: 'entitlements' });
}

module.exports = { getMembershipStatus };
