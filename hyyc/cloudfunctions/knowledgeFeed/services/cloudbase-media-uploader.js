const https = require('node:https');

const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

function putBuffer(urlValue, headers, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    if (url.protocol !== 'https:') {
      reject(new Error('CLOUDBASE_UPLOAD_URL_INVALID'));
      return;
    }
    const request = https.request(url, {
      method: 'PUT',
      headers,
      timeout: timeoutMs
    }, (response) => {
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_ERROR_RESPONSE_BYTES) {
          response.destroy(new Error('CLOUDBASE_UPLOAD_RESPONSE_TOO_LARGE'));
        }
      });
      response.on('error', reject);
      response.on('end', () => {
        const statusCode = Number(response.statusCode) || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ statusCode });
          return;
        }
        const error = new Error('CLOUDBASE_MEDIA_UPLOAD_FAILED');
        error.statusCode = statusCode;
        reject(error);
      });
    });
    request.on('timeout', () => request.destroy(new Error('CLOUDBASE_MEDIA_UPLOAD_TIMEOUT')));
    request.on('error', reject);
    request.end(body);
  });
}

function createCloudbaseMediaUploader({
  getUploadMetadata,
  put = putBuffer,
  timeoutMs = 15000
}) {
  if (typeof getUploadMetadata !== 'function') {
    throw new Error('CLOUDBASE_UPLOAD_METADATA_REQUIRED');
  }

  return async function uploadMedia({ cloudPath, fileContent, contentType }) {
    if (typeof cloudPath !== 'string'
      || !cloudPath
      || !Buffer.isBuffer(fileContent)
      || !fileContent.length
      || !/^image\/(?:jpeg|png)$/.test(contentType || '')) {
      throw new Error('CLOUDBASE_MEDIA_UPLOAD_INVALID');
    }
    const metadataResponse = await getUploadMetadata({ cloudPath });
    const metadata = metadataResponse && metadataResponse.data;
    if (!metadata
      || !/^https:\/\//i.test(metadata.url || '')
      || typeof metadata.token !== 'string'
      || typeof metadata.authorization !== 'string'
      || typeof metadata.cosFileId !== 'string'
      || typeof metadata.fileId !== 'string') {
      throw new Error('CLOUDBASE_UPLOAD_METADATA_INVALID');
    }
    await put(metadata.url, {
      Signature: metadata.authorization,
      authorization: metadata.authorization,
      'x-cos-security-token': metadata.token,
      'x-cos-meta-fileid': metadata.cosFileId,
      key: encodeURIComponent(cloudPath),
      'content-type': contentType,
      'content-length': String(fileContent.length)
    }, fileContent, timeoutMs);
    return { fileID: metadata.fileId };
  };
}

module.exports = {
  MAX_ERROR_RESPONSE_BYTES,
  putBuffer,
  createCloudbaseMediaUploader
};
