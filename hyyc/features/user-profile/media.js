const {
  uploadCloudFile,
  resolveCloudFileUrls
} = require('../../services/cloud-media.js');

async function uploadAvatar(filePath, options = {}) {
  const uploaded = await uploadCloudFile(filePath, 'avatar', options);
  return uploaded.fileId;
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
