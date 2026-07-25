const { callCloudFunction } = require('./cloud-functions.js');

const CLOUD_FUNCTION_UPLOAD_MAX_BYTES = 480 * 1024;
const IMAGE_COMPRESSION_PRESETS = Object.freeze([
  Object.freeze({ maxDimension: 1600, quality: 82 }),
  Object.freeze({ maxDimension: 1280, quality: 70 }),
  Object.freeze({ maxDimension: 1024, quality: 58 }),
  Object.freeze({ maxDimension: 800, quality: 48 }),
  Object.freeze({ maxDimension: 640, quality: 42 }),
  Object.freeze({ maxDimension: 480, quality: 36 })
]);
const IMAGE_COMPRESSION_QUALITIES = Object.freeze(
  IMAGE_COMPRESSION_PRESETS.map((preset) => preset.quality)
);
const IMAGE_ORIENTATIONS = Object.freeze({
  up: 1,
  'up-mirrored': 2,
  down: 3,
  'down-mirrored': 4,
  'left-mirrored': 5,
  right: 6,
  'right-mirrored': 7,
  left: 8
});
const CANVAS_ORIENTATION_TRANSFORMS = Object.freeze({
  2: Object.freeze([-1, 0, 0, 1]),
  3: Object.freeze([-1, 0, 0, -1]),
  4: Object.freeze([1, 0, 0, -1]),
  5: Object.freeze([0, 1, 1, 0]),
  6: Object.freeze([0, 1, -1, 0]),
  7: Object.freeze([0, -1, -1, 0]),
  8: Object.freeze([0, -1, 1, 0])
});
const MAX_BASE64_LENGTH = Object.freeze({
  avatar: (Math.ceil(CLOUD_FUNCTION_UPLOAD_MAX_BYTES / 3) * 4) + 4,
  comment: (Math.ceil(CLOUD_FUNCTION_UPLOAD_MAX_BYTES / 3) * 4) + 4
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

function localFileSize(filePath) {
  const manager = wx.getFileSystemManager();
  if (!manager || typeof manager.stat !== 'function') return Promise.resolve(0);
  return callbackOrPromise((success, fail) => manager.stat({
    path: filePath,
    success: (result) => success(Number(result && result.stats && result.stats.size) || 0),
    fail
  })).catch(() => 0);
}

function localImageInfo(filePath) {
  if (typeof wx.getImageInfo !== 'function') {
    return Promise.resolve({ width: 0, height: 0 });
  }
  return callbackOrPromise((success, fail) => wx.getImageInfo({
    src: filePath,
    success,
    fail
  }));
}

function scaledImageSize(imageInfo, maxDimension) {
  const width = Math.max(0, Math.floor(Number(imageInfo && imageInfo.width) || 0));
  const height = Math.max(0, Math.floor(Number(imageInfo && imageInfo.height) || 0));
  if (!width || !height) return { width: 0, height: 0 };
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

function imageOrientation(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 8) return numeric;
  return IMAGE_ORIENTATIONS[String(value || '').toLowerCase()] || 1;
}

function orientedScaledImageSize(imageInfo, maxDimension) {
  const source = scaledImageSize(imageInfo, maxDimension);
  const orientation = imageOrientation(imageInfo && imageInfo.orientation);
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    width: swapsAxes ? source.height : source.width,
    height: swapsAxes ? source.width : source.height,
    orientation
  };
}

function imageExtensionFromBase64(contentBase64, fallback = '') {
  if (String(contentBase64 || '').startsWith('/9j/')) return 'jpg';
  if (String(contentBase64 || '').startsWith('iVBORw0KGgo')) return 'png';
  return fallback;
}

function imageExtensionFromInfo(imageInfo, fallback = '') {
  const type = String(imageInfo && imageInfo.type || '').toLowerCase();
  if (type === 'jpeg' || type === 'jpg') return 'jpg';
  if (type === 'png') return 'png';
  return fallback;
}

function compressLocalImage(filePath, preset, imageInfo) {
  if (typeof wx.compressImage !== 'function') {
    return Promise.reject(new Error('当前微信版本无法压缩图片，请升级微信后重试'));
  }
  const size = scaledImageSize(imageInfo, preset.maxDimension);
  return callbackOrPromise((success, fail) => wx.compressImage({
    src: filePath,
    quality: preset.quality,
    ...(size.width && size.height ? {
      compressedWidth: size.width,
      compressedHeight: size.height
    } : {}),
    success: (result) => success(result && result.tempFilePath),
    fail
  }));
}

function canvasSelectorQuery(component) {
  if (component && typeof component.createSelectorQuery === 'function') {
    return component.createSelectorQuery();
  }
  if (typeof wx.createSelectorQuery === 'function') {
    const query = wx.createSelectorQuery();
    return component && typeof query.in === 'function' ? query.in(component) : query;
  }
  return null;
}

function selectCanvasNode(component, canvasId) {
  const query = canvasSelectorQuery(component);
  if (!query || typeof query.select !== 'function') {
    return Promise.reject(new Error('当前页面无法读取图片转换画布'));
  }
  return new Promise((resolve, reject) => {
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvas = result && result[0] && result[0].node;
        if (!canvas || typeof canvas.getContext !== 'function') {
          reject(new Error('图片转换画布尚未准备好'));
          return;
        }
        resolve(canvas);
      });
  });
}

function loadCanvasImage(canvas, filePath) {
  if (!canvas || typeof canvas.createImage !== 'function') {
    return Promise.reject(new Error('当前微信版本无法解码这张图片'));
  }
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败，请重新选择'));
    image.src = filePath;
  });
}

function waitForCanvasFrame(canvas) {
  return new Promise((resolve) => {
    if (canvas && typeof canvas.requestAnimationFrame === 'function') {
      canvas.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function applyCanvasOrientation(context, orientation, sourceWidth, sourceHeight) {
  if (orientation === 1) return;
  if (!context || typeof context.transform !== 'function') {
    throw new Error('当前微信版本无法校正照片方向，请升级微信后重试');
  }
  const offsets = {
    2: [sourceWidth, 0],
    3: [sourceWidth, sourceHeight],
    4: [0, sourceHeight],
    5: [0, 0],
    6: [sourceHeight, 0],
    7: [sourceHeight, sourceWidth],
    8: [0, sourceWidth]
  };
  context.transform(...CANVAS_ORIENTATION_TRANSFORMS[orientation], ...offsets[orientation]);
}

async function renderLocalImageAsJpeg(filePath, preset, imageInfo, canvasOptions) {
  const {
    component,
    canvasId
  } = canvasOptions || {};
  if (!component
    || !canvasId
    || typeof wx.canvasToTempFilePath !== 'function') {
    throw new Error('当前页面无法转换图片格式');
  }
  const size = orientedScaledImageSize(imageInfo, preset.maxDimension);
  if (!size.width || !size.height) throw new Error('无法读取图片尺寸');

  const canvas = await selectCanvasNode(component, canvasId);
  canvas.width = size.width;
  canvas.height = size.height;
  const image = await loadCanvasImage(canvas, imageInfo && imageInfo.path || filePath);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  const contextSaved = typeof context.save === 'function';
  if (contextSaved) context.save();
  applyCanvasOrientation(
    context,
    size.orientation,
    size.sourceWidth,
    size.sourceHeight
  );
  context.drawImage(image, 0, 0, size.sourceWidth, size.sourceHeight);
  if (contextSaved && typeof context.restore === 'function') context.restore();
  await waitForCanvasFrame(canvas);

  const convertedPath = await callbackOrPromise((success, fail) => wx.canvasToTempFilePath({
    canvas,
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    destWidth: size.width,
    destHeight: size.height,
    fileType: 'jpg',
    quality: preset.quality / 100,
    success: (result) => success(result && result.tempFilePath),
    fail
  }, component));
  const convertedInfo = await localImageInfo(convertedPath);
  const convertedExtension = imageExtensionFromInfo(
    convertedInfo,
    fileExtension(convertedPath)
  );
  if (convertedExtension !== 'jpg'
    || imageOrientation(convertedInfo && convertedInfo.orientation) !== 1
    || (Number(convertedInfo && convertedInfo.width)
      && Number(convertedInfo.width) !== size.width)
    || (Number(convertedInfo && convertedInfo.height)
      && Number(convertedInfo.height) !== size.height)) {
    throw new Error('图片转换失败，请重新选择');
  }
  return convertedPath;
}

async function compressedImagePayload(filePath, kind, extension, imageInfo) {
  if (extension !== 'jpg') return null;
  for (const preset of IMAGE_COMPRESSION_PRESETS) {
    let compressedPath;
    try {
      compressedPath = await compressLocalImage(filePath, preset, imageInfo);
    } catch (error) {
      continue;
    }
    if (!compressedPath) continue;
    const compressedBase64 = await readLocalFileBase64(compressedPath);
    const compressedExtension = imageExtensionFromBase64(
      compressedBase64,
      fileExtension(compressedPath) || extension
    );
    if (compressedExtension
      && typeof compressedBase64 === 'string'
      && compressedBase64
      && compressedBase64.length <= MAX_BASE64_LENGTH[kind]) {
      return {
        contentBase64: compressedBase64,
        extension: compressedExtension,
        previewPath: compressedPath
      };
    }
  }
  return null;
}

async function canvasImagePayload(filePath, kind, imageInfo, canvasOptions) {
  if (!canvasOptions) return null;
  let lastError = null;
  for (const preset of IMAGE_COMPRESSION_PRESETS) {
    let convertedPath;
    try {
      convertedPath = await renderLocalImageAsJpeg(
        filePath,
        preset,
        imageInfo,
        canvasOptions
      );
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!convertedPath) continue;
    const contentBase64 = await readLocalFileBase64(convertedPath);
    if (typeof contentBase64 === 'string'
      && contentBase64
      && contentBase64.length <= MAX_BASE64_LENGTH[kind]) {
      return {
        contentBase64,
        extension: 'jpg',
        previewPath: convertedPath
      };
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function imagePayloadForFunction(filePath, kind, options = {}) {
  let extension = fileExtension(filePath);
  const [imageInfo, sourceSize] = await Promise.all([
    localImageInfo(filePath).catch(() => ({ width: 0, height: 0 })),
    localFileSize(filePath)
  ]);
  extension = imageExtensionFromInfo(imageInfo, extension);
  const sourcePath = imageInfo && imageInfo.path || filePath;
  const supportedExtension = ['jpg', 'png'].includes(extension);

  if (options.canvas) {
    const convertedPayload = await canvasImagePayload(
      sourcePath,
      kind,
      imageInfo,
      options.canvas
    );
    if (convertedPayload) return convertedPayload;
    throw new Error('图片处理失败，请重新选择图片');
  }

  if (sourceSize <= CLOUD_FUNCTION_UPLOAD_MAX_BYTES) {
    const contentBase64 = await readLocalFileBase64(sourcePath);
    const detectedExtension = imageExtensionFromBase64(contentBase64, extension);
    if (typeof contentBase64 === 'string'
      && contentBase64
      && ['jpg', 'png'].includes(detectedExtension)
      && contentBase64.length <= MAX_BASE64_LENGTH[kind]) {
      return {
        contentBase64,
        extension: detectedExtension,
        previewPath: sourcePath
      };
    }
  }

  if (supportedExtension) {
    const compressedPayload = await compressedImagePayload(
      sourcePath,
      kind,
      extension,
      imageInfo
    );
    if (compressedPayload) return compressedPayload;
  }

  const contentBase64 = await readLocalFileBase64(sourcePath);
  extension = imageExtensionFromBase64(contentBase64, extension);
  if (typeof contentBase64 !== 'string' || !contentBase64) {
    throw new Error('图片读取失败，请重新选择');
  }
  throw new Error(kind === 'avatar'
    ? '头像处理失败，请重新选择图片'
    : '图片处理失败，请重新选择图片');
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

async function uploadCloudFile(filePath, kind, options = {}) {
  if (!filePath) throw new Error('No image was selected');
  if (!MAX_BASE64_LENGTH[kind]) throw new Error('Unsupported image type');
  const payload = await imagePayloadForFunction(filePath, kind, options);
  const { contentBase64, extension } = payload;
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
  return {
    fileId,
    previewPath: payload.previewPath || filePath
  };
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
  CLOUD_FUNCTION_UPLOAD_MAX_BYTES,
  IMAGE_COMPRESSION_PRESETS,
  IMAGE_COMPRESSION_QUALITIES,
  MAX_BASE64_LENGTH,
  fileExtension,
  scaledImageSize,
  imageOrientation,
  orientedScaledImageSize,
  applyCanvasOrientation,
  imageExtensionFromBase64,
  imageExtensionFromInfo,
  validReservedCloudPath,
  temporaryUrlMaxAgeMs,
  isUsableCloudMediaUrl,
  successfulTempFileEntry,
  isUserMediaFileId,
  imagePayloadForFunction,
  uploadCloudFile,
  resolveCloudFileUrls,
  previewCloudImages
};
