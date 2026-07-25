const { resolveCloudFileUrls } = require('../../services/cloud-media.js');

async function resolveMessageMedia(messages = []) {
  const fileIds = [];
  messages.forEach((message) => {
    if (message && message.actorAvatarFileId) fileIds.push(message.actorAvatarFileId);
    if (message && message.itemThumbnailFileId) fileIds.push(message.itemThumbnailFileId);
  });
  if (!fileIds.length) return messages;
  const resolved = await resolveCloudFileUrls(fileIds);
  const urls = new Map(resolved.map((entry) => [entry.fileId, entry.url]));
  return messages.map((message) => ({
    ...message,
    actorAvatarUrl: urls.get(message.actorAvatarFileId) || message.actorAvatarUrl || '',
    itemThumbnailUrl: urls.get(message.itemThumbnailFileId) || message.itemThumbnailUrl || ''
  }));
}

module.exports = { resolveMessageMedia };
