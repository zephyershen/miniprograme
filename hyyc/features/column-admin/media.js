const { imagePayloadForFunction } = require('../../services/cloud-media.js');
const { uploadColumnMedia } = require('./api.js');

async function uploadColumnImage(entryId, filePath, options = {}) {
  if (!entryId || !filePath) throw new Error('请先创建草稿再上传图片');
  const payload = await imagePayloadForFunction(filePath, 'column', options);
  const uploaded = await uploadColumnMedia(entryId, payload);
  return {
    ...uploaded,
    image: payload.previewPath || filePath,
    previewImage: payload.previewPath || filePath
  };
}

module.exports = { uploadColumnImage };
