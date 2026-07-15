function makeError(error) {
  const next = new Error(error && error.message ? error.message : '服务暂时不可用，请稍后重试');
  next.code = error && error.code ? error.code : 'TEMPORARY_FAILURE';
  return next;
}

async function callCloudFunction(name, data) {
  const response = await wx.cloud.callFunction({ name, data });
  const result = response && response.result;

  if (!result || result.ok !== true) {
    throw makeError(result && result.error);
  }

  return result.data;
}

function getDashboard() {
  return callCloudFunction('digestStore', { action: 'dashboard' });
}

function getKnowledgeFeed(force = false) {
  return callCloudFunction('knowledgeFeed', { action: 'feed', force });
}

function getKnowledgeItem(id) {
  return callCloudFunction('knowledgeFeed', { action: 'item', id });
}

function ingestLink(url, requestId) {
  return callCloudFunction('digestIngest', { url, requestId });
}

function storeAction(action, payload = {}) {
  return callCloudFunction('digestStore', { action, ...payload });
}

module.exports = {
  getDashboard,
  getKnowledgeFeed,
  getKnowledgeItem,
  ingestLink,
  storeAction
};
