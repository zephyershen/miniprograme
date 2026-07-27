const { callCloudFunction } = require('../../services/cloud-functions.js');

function mutationId(prefix = 'column') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function listColumnEntries() {
  return callCloudFunction('knowledgeFeed', { action: 'columnAdminList' });
}

function getColumnEntry(id) {
  return callCloudFunction('knowledgeFeed', { action: 'columnAdminGet', id });
}

function createColumnDraft(kind) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnAdminCreateDraft',
    kind,
    mutationId: mutationId('create')
  });
}

function saveColumnDraft(id, expectedVersion, draft) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnAdminSaveDraft',
    id,
    expectedVersion,
    draft,
    mutationId: mutationId('save')
  });
}

function publishColumnDraft(id, expectedVersion) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnAdminPublish',
    id,
    expectedVersion,
    mutationId: mutationId('publish')
  });
}

function unpublishColumnEntry(id, expectedVersion) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnAdminUnpublish',
    id,
    expectedVersion,
    mutationId: mutationId('unpublish')
  });
}

function getColumnDraftPreview(id) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnAdminPreview',
    id
  });
}

function uploadColumnMedia(id, payload) {
  return callCloudFunction('knowledgeFeed', {
    action: 'columnAdminUploadMedia',
    id,
    extension: payload.extension,
    contentBase64: payload.contentBase64
  });
}

module.exports = {
  mutationId,
  listColumnEntries,
  getColumnEntry,
  createColumnDraft,
  saveColumnDraft,
  publishColumnDraft,
  unpublishColumnEntry,
  getColumnDraftPreview,
  uploadColumnMedia
};
