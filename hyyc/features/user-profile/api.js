const { callCloudFunction } = require('../../services/cloud-functions.js');

function getUserProfile() {
  return callCloudFunction('knowledgeFeed', { action: 'profile' });
}

function saveUserProfile(profile) {
  return callCloudFunction('knowledgeFeed', { action: 'saveProfile', profile });
}

module.exports = { getUserProfile, saveUserProfile };
