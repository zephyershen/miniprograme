const { callCloudFunction } = require('./cloud-functions.js');

const MAX_BASE64_LENGTH = Object.freeze({
  avatar: (Math.ceil((1 * 1024 * 1024) / 3) * 4) + 4,
  comment: (Math.ceil((3 * 1024 * 1024) / 3) * 4) + 4
});

function fileExtension(filePath) {
  const match = String(filePath || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  const extension = match ? match[1].toLowerCase() : 'jpg';
  if (extension === 'jpeg') return 'jpg';
  return ['jpg', 'png'].includes(extension) ? extension : '';
}

function validReservedCloudPath(value, kind, extension) {
  const directory = kind === 'avatar' ? 'avatars' : kind === 'comment' ? 'comments' : '';
  if (!directory) return false;
  const pattern = new RegExp(
    `^user-media/staging/[a-f0-9]{64}/${directory}/[a-f0-9]{48}\\.${extension}$`
  );
  return typeof value === 'string' && pattern.test(value);
}

function callbackOrPromise(invoke) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let task;
    try {
      task = invoke(succeed, fail);
    } catch (error) {
      fail(error);
      return;
    }
    if (task && typeof task.then === 'function') task.then(succeed, fail);
  });
}

function readLocalFileBase64(filePath) {
  const manager = wx.getFileSystemManager();
  return callbackOrPromise((success, fail) => manager.readFile({
    filePath,
    encoding: 'base64',
    success: (result) => success(result && result.data),
    fail
  }));
}

function temporaryUrlMaxAgeMs(value) {
  const maxAge = Number(value);
  if (!Number.isFinite(maxAge) || maxAge <= 0) return 0;
  return maxAge > 24 * 60 * 60 ? Math.floor(maxAge) : Math.floor(maxAge * 1000);
}

function isUsableCloudMediaUrl(value) {
  return /^https:\/\//i.test(String(value || ''));
}

function successfulTempFileEntry(entry) {
  if (!entry || !isUsableCloudMediaUrl(entry.tempFileURL)) return false;
  if (entry.status !== undefined) return entry.status === 0 || entry.status === '0';
  if (entry.code !== undefined) return entry.code === 'SUCCESS';
  return entry.errMsg === 'ok';
}

function isUserMediaFileId(fileId) {
  return typeof fileId === 'string' && /\/user-media\//.test(fileId);
}

async function uploadCloudFile(filePath, kind) {
  if (!filePath) throw new Error('No image was selected');
  if (!MAX_BASE64_LENGTH[kind]) throw new Error('Unsupported image type');
  const extension = fileExtension(filePath);
  if (!extension) throw new Error('Only JPG and PNG images are supported');
  const contentBase64 = await readLocalFileBase64(filePath);
  if (typeof contentBase64 !== 'string'
    || !contentBase64
    || contentBase64.length > MAX_BASE64_LENGTH[kind]) {
    throw new Error(kind === 'avatar'
      ? 'The avatar must be no larger than 1 MB'
      : 'Each image must be no larger than 3 MB');
  }
  const reservation = await callCloudFunction('knowledgeFeed', {
    action: 'uploadMedia',
    kind,
    extension,
    contentBase64
  });
  const cloudPath = reservation && reservation.cloudPath;
  const fileId = reservation && reservation.fileId;
  if (!validReservedCloudPath(cloudPath, kind, extension)
    || typeof fileId !== 'string'
    || !fileId.endsWith(`/${cloudPath}`)) {
    throw new Error('The media upload response was invalid');
  }
  return fileId;
}

function normalizeServerMediaEntry(entry) {
  if (!entry || typeof entry.fileId !== 'string' || !isUsableCloudMediaUrl(entry.url)) return null;
  return {
    fileId: entry.fileId,
    url: entry.url,
    maxAgeMs: temporaryUrlMaxAgeMs(entry.maxAge)
  };
}

async function resolveCloudFileUrls(fileIds = []) {
  const values = [...new Set(
    fileIds.filter((fileId) => typeof fileId === 'string' && fileId)
  )];
  if (!values.length) return [];
  const userMedia = values.filter(isUserMediaFileId);
  const ordinaryMedia = values.filter((fileId) => !isUserMediaFileId(fileId));
  const resolved = [];

  if (ordinaryMedia.length) {
    const result = await wx.cloud.getTempFileURL({ fileList: ordinaryMedia });
    resolved.push(...((result && result.fileList) || [])
      .filter(successfulTempFileEntry)
      .map((entry) => ({
        fileId: entry.fileID || entry.fileId,
        url: entry.tempFileURL,
        maxAgeMs: temporaryUrlMaxAgeMs(entry.maxAge)
      })));
  }

  if (userMedia.length) {
    const result = await callCloudFunction('knowledgeFeed', {
      action: 'resolveUserMedia',
      fileIds: userMedia.slice(0, 50)
    });
    resolved.push(...((result && result.files) || [])
      .map(normalizeServerMediaEntry)
      .filter(Boolean));
  }

  const byId = new Map(resolved.map((entry) => [entry.fileId, entry]));
  return values.map((fileId) => byId.get(fileId)).filter(Boolean);
}

async function previewCloudImages(fileIds, currentFileId) {
  const resolved = await resolveCloudFileUrls(fileIds);
  const urls = resolved.map((entry) => entry.url);
  const current = (resolved.find((entry) => entry.fileId === currentFileId) || resolved[0] || {}).url;
  if (!current || !urls.length) throw new Error('The image is temporarily unavailable');
  wx.previewImage({ current, urls });
}

module.exports = {
  MAX_BASE64_LENGTH,
  fileExtension,
  validReservedCloudPath,
  temporaryUrlMaxAgeMs,
  isUsableCloudMediaUrl,
  successfulTempFileEntry,
  isUserMediaFileId,
  uploadCloudFile,
  resolveCloudFileUrls,
  previewCloudImages
};
