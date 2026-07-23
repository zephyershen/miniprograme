const {
  uploadCloudFile,
  resolveCloudFileUrls
} = require('../../services/cloud-media.js');
const { applyCommentMedia } = require('./model.js');

const COMMENT_IMAGE_LIMIT = 3;
const COMMENT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const CLOUD_MEDIA_BATCH_SIZE = 50;

async function chooseCommentImages(existingCount = 0) {
  const count = Math.max(0, COMMENT_IMAGE_LIMIT - Number(existingCount || 0));
  if (!count) return [];
  const result = await wx.chooseMedia({
    count,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    sizeType: ['compressed']
  });
  const files = ((result && result.tempFiles) || []).filter((file) => file && file.tempFilePath);
  const oversized = files.find((file) => Number(file.size) > COMMENT_IMAGE_MAX_BYTES);
  if (oversized) throw new Error('单张图片请控制在 3MB 内');
  return files.map((file) => ({
    tempFilePath: file.tempFilePath,
    width: Math.max(0, Math.floor(Number(file.width) || 0)),
    height: Math.max(0, Math.floor(Number(file.height) || 0)),
    size: Math.max(0, Math.floor(Number(file.size) || 0))
  }));
}

async function uploadCommentImages(images = []) {
  const uploaded = [];
  for (const image of images) {
    uploaded.push({
      type: 'image',
      fileId: await uploadCloudFile(image.tempFilePath, 'comment'),
      width: image.width,
      height: image.height
    });
  }
  return uploaded;
}

function previewLocalImages(images, currentPath) {
  const urls = (images || []).map((image) => image.tempFilePath).filter(Boolean);
  if (!urls.length) return;
  wx.previewImage({ current: currentPath || urls[0], urls });
}

function commentMediaFileIds(comments = []) {
  const fileIds = [];
  comments.forEach((comment) => {
    const avatarFileId = comment && comment.author && comment.author.avatarFileId;
    if (typeof avatarFileId === 'string' && avatarFileId) fileIds.push(avatarFileId);
    (comment && comment.attachments || []).forEach((attachment) => {
      if (attachment && typeof attachment.fileId === 'string' && attachment.fileId) {
        fileIds.push(attachment.fileId);
      }
    });
  });
  return [...new Set(fileIds)];
}

async function resolveCommentMedia(comments = [], resolver = resolveCloudFileUrls) {
  const fileIds = commentMediaFileIds(comments);
  const mediaUrls = new Map(fileIds
    .filter((fileId) => !fileId.startsWith('cloud://'))
    .map((fileId) => [fileId, fileId]));
  const cloudFileIds = fileIds.filter((fileId) => fileId.startsWith('cloud://'));
  for (let index = 0; index < cloudFileIds.length; index += CLOUD_MEDIA_BATCH_SIZE) {
    const batch = cloudFileIds.slice(index, index + CLOUD_MEDIA_BATCH_SIZE);
    let resolved = [];
    try {
      resolved = await resolver(batch);
    } catch (error) {
      resolved = [];
    }
    (resolved || []).forEach((entry) => {
      if (entry && entry.fileId && entry.url) mediaUrls.set(entry.fileId, entry.url);
    });
  }
  return applyCommentMedia(comments, mediaUrls);
}

async function previewCommentImages(comment, currentFileId, resolver = resolveCloudFileUrls) {
  const [resolvedComment] = await resolveCommentMedia([comment], resolver);
  const attachments = resolvedComment && resolvedComment.attachments || [];
  const urls = attachments.map((attachment) => attachment.url).filter(Boolean);
  const current = (attachments.find((attachment) => attachment.fileId === currentFileId) || {}).url
    || urls[0];
  if (!current || !urls.length) throw new Error('图片暂时无法打开');
  wx.previewImage({ current, urls });
}

module.exports = {
  COMMENT_IMAGE_LIMIT,
  COMMENT_IMAGE_MAX_BYTES,
  chooseCommentImages,
  uploadCommentImages,
  previewLocalImages,
  commentMediaFileIds,
  resolveCommentMedia,
  previewCommentImages
};
