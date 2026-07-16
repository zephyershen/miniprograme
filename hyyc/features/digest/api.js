const { callCloudFunction } = require('../../services/cloud-functions.js');

function getDashboard() {
  return callCloudFunction('digestStore', { action: 'dashboard' });
}

function ingestLink(url, requestId) {
  return callCloudFunction('digestIngest', { url, requestId });
}

function storeAction(action, payload = {}) {
  return callCloudFunction('digestStore', { action, ...payload });
}

module.exports = { getDashboard, ingestLink, storeAction };
