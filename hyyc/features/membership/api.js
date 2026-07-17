const { callCloudFunction } = require('../../services/cloud-functions.js');

function getMembershipStatus() {
  return callCloudFunction('knowledgeFeed', { action: 'entitlements' });
}

function setMembershipRolePreview(role) {
  return callCloudFunction('knowledgeFeed', { action: 'setRolePreview', role });
}

module.exports = { getMembershipStatus, setMembershipRolePreview };
