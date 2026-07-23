const {
  uploadCloudFile,
  resolveCloudFileUrls
} = require('../../services/cloud-media.js');

function uploadAvatar(filePath) {
  return uploadCloudFile(filePath, 'avatar');
}

async function resolveAvatarUrl(avatarFileId, resolver = resolveCloudFileUrls) {
  const fileId = typeof avatarFileId === 'string' ? avatarFileId.trim() : '';
  if (!fileId) return '';
  if (!fileId.startsWith('cloud://')) return fileId;
  const resolved = await resolver([fileId]);
  const match = (resolved || []).find((entry) => entry && entry.fileId === fileId);
  return match && typeof match.url === 'string' ? match.url : '';
}

module.exports = { uploadAvatar, resolveAvatarUrl };
