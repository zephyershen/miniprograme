const { callCloudFunction } = require('../../services/cloud-functions.js');

function getColumnHome() {
  return callCloudFunction('knowledgeFeed', { action: 'columnHome' });
}

function getColumnLesson(id) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnLesson',
    id,
    lessonId: id,
    lessonKey: id,
    key: id,
    slug: id
  });
}

function getColumnPractical(id) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnPractical',
    id,
    practicalId: id,
    practicalKey: id,
    key: id,
    slug: id
  });
}

function getColumnCases({ cursor = null, limit = 8 } = {}) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnCases',
    cursor,
    limit,
    pageSize: limit
  });
}

function getColumnCase(id) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnCase',
    id,
    caseId: id,
    caseKey: id,
    key: id,
    slug: id
  });
}

function getTrendDossier(id) {
  return callCloudFunction('knowledgeFeed', {
    action: 'trendDossier',
    id,
    trendId: id,
    dossierKey: id,
    key: id,
    slug: id
  });
}

module.exports = {
  getColumnHome,
  getColumnLesson,
  getColumnPractical,
  getColumnCases,
  getColumnCase,
  getTrendDossier
};
