const { visualRevisionStem } = require('../lib/visual-version');

function validHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : '';
  } catch (error) {
    return '';
  }
}

function decodeThumbnail(value, maximumBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes * 4 / 3) + 8) {
    throw new Error('THUMBNAIL_INVALID');
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > maximumBytes || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('THUMBNAIL_INVALID');
  }
  return buffer;
}

function createListThumbnailService({ cloud, config, fetchImpl = fetch }) {
  function assertConfigured() {
    const rendererUrl = validHttpsUrl(config.rendererUrl).replace(/\/$/, '');
    if (!rendererUrl || typeof config.rendererToken !== 'string' || config.rendererToken.length < 32) {
      throw new Error('THUMBNAIL_RENDERER_UNAVAILABLE');
    }
    return rendererUrl;
  }

  async function temporarySourceUrl(fileId) {
    if (typeof fileId !== 'string' || !fileId.startsWith('cloud://')) {
      throw new Error('THUMBNAIL_SOURCE_FILE_INVALID');
    }
    const result = await cloud.getTempFileURL({
      fileList: [{ fileID: fileId, maxAge: 10 * 60 }]
    });
    const file = result && Array.isArray(result.fileList)
      ? result.fileList.find((entry) => entry && entry.fileID === fileId)
      : null;
    const url = validHttpsUrl(file && file.tempFileURL);
    if (!url || (file.code && file.code !== 'SUCCESS')) {
      throw new Error('THUMBNAIL_SOURCE_URL_FAILED');
    }
    return url;
  }

  async function requestThumbnail(sourceUrl) {
    const url = validHttpsUrl(sourceUrl);
    if (!url) throw new Error('THUMBNAIL_SOURCE_URL_INVALID');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.rendererTimeoutMs);
    try {
      const response = await fetchImpl(`${assertConfigured()}/thumbnail`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.rendererToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ version: config.version, url }),
        signal: controller.signal,
        redirect: 'error'
      });
      const declaredLength = Number(response.headers && response.headers.get
        && response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > config.maxResponseBytes) {
        throw new Error('THUMBNAIL_RESPONSE_TOO_LARGE');
      }
      if (!response.ok) throw new Error(`THUMBNAIL_HTTP_${response.status}`);
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.length > config.maxResponseBytes) throw new Error('THUMBNAIL_RESPONSE_TOO_LARGE');
      const payload = JSON.parse(raw.toString('utf8'));
      const data = payload && payload.ok && payload.data;
      if (!data
        || Number(data.version) !== Number(config.version)
        || Number(data.width) !== Number(config.width)
        || Number(data.height) !== Number(config.height)
        || data.mimeType !== 'image/jpeg') {
        throw new Error('THUMBNAIL_CONTRACT_MISMATCH');
      }
      return decodeThumbnail(data.data, config.maxImageBytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function uploadThumbnail(item, image) {
    const result = await cloud.uploadFile({
      cloudPath: `${config.cloudPathPrefix}${visualRevisionStem(item)}-v${config.version}.jpg`,
      fileContent: image
    });
    if (!result || typeof result.fileID !== 'string'
      || !result.fileID.startsWith(config.fileIdPrefix)) {
      throw new Error('THUMBNAIL_UPLOAD_FAILED');
    }
    return result.fileID;
  }

  async function resolveAndUploadFromFile(item, fileId) {
    const sourceUrl = await temporarySourceUrl(fileId);
    return uploadThumbnail(item, await requestThumbnail(sourceUrl));
  }

  return {
    temporarySourceUrl,
    requestThumbnail,
    uploadThumbnail,
    resolveAndUploadFromFile
  };
}

module.exports = {
  validHttpsUrl,
  decodeThumbnail,
  createListThumbnailService
};
