const crypto = require('node:crypto');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { AppError } = require('./errors');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_MAX_PIXELS = 12 * 1024 * 1024;
const JPEG_QUALITY_STEPS = Object.freeze([85, 75, 65, 55]);

function invalidImage(message = 'Choose a valid JPG or PNG image') {
  return new AppError('INVALID_REQUEST', message);
}

function canonicalExtension(value) {
  const extension = typeof value === 'string'
    ? value.replace(/^\./, '').trim().toLowerCase()
    : '';
  if (!IMAGE_EXTENSIONS.has(extension)) throw invalidImage();
  return extension === 'jpeg' ? 'jpg' : extension;
}

function decodeBase64(value, maxBytes) {
  const sizeLimit = Math.max(1, Number(maxBytes) || 0);
  const maxEncodedLength = (Math.ceil(sizeLimit / 3) * 4) + 4;
  if (typeof value !== 'string'
    || !value
    || value.length > maxEncodedLength
    || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(value)) {
    throw invalidImage('The image payload is invalid or too large');
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > sizeLimit) {
    throw invalidImage('The image is too large');
  }
  return buffer;
}

function imageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  )) return 'png';
  return '';
}

function pngDimensions(buffer) {
  if (buffer.length < 33
    || buffer.readUInt32BE(8) !== 13
    || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw invalidImage();
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSegments(buffer) {
  const segments = [];
  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) throw invalidImage();
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw invalidImage();
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw invalidImage();
    segments.push({
      marker,
      start: offset + 2,
      end: offset + length
    });
    offset += length;
  }
  return segments;
}

function jpegDimensions(buffer, segments = jpegSegments(buffer)) {
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  const frame = segments.find((segment) => startOfFrame.has(segment.marker));
  if (!frame || frame.end - frame.start < 6) throw invalidImage();
  return {
    height: buffer.readUInt16BE(frame.start + 1),
    width: buffer.readUInt16BE(frame.start + 3)
  };
}

function exifOrientation(buffer, segments) {
  const app1 = segments.find((segment) => segment.marker === 0xe1
    && buffer.subarray(segment.start, segment.start + 6).toString('binary') === 'Exif\u0000\u0000');
  if (!app1) return 1;
  const tiff = app1.start + 6;
  if (tiff + 8 > app1.end) return 1;
  const byteOrder = buffer.subarray(tiff, tiff + 2).toString('ascii');
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return 1;
  const read16 = (offset) => littleEndian
    ? buffer.readUInt16LE(offset)
    : buffer.readUInt16BE(offset);
  const read32 = (offset) => littleEndian
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset);
  if (read16(tiff + 2) !== 42) return 1;
  const directory = tiff + read32(tiff + 4);
  if (directory + 2 > app1.end) return 1;
  const count = read16(directory);
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + (index * 12);
    if (entry + 12 > app1.end) return 1;
    if (read16(entry) !== 0x0112 || read16(entry + 2) !== 3 || read32(entry + 4) !== 1) continue;
    const orientation = read16(entry + 8);
    return orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}

function assertDimensions(dimensions, options = {}) {
  const width = Number(dimensions && dimensions.width);
  const height = Number(dimensions && dimensions.height);
  const maxDimension = Math.max(1, Number(options.maxDimension) || DEFAULT_MAX_DIMENSION);
  const maxPixels = Math.max(1, Number(options.maxPixels) || DEFAULT_MAX_PIXELS);
  if (!Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > maxDimension
    || height > maxDimension
    || width * height > maxPixels) {
    throw invalidImage('The image dimensions are too large');
  }
  return { width, height };
}

function orientedPixels(decoded, orientation) {
  if (orientation === 1) return decoded;
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  const width = swapsAxes ? sourceHeight : sourceWidth;
  const height = swapsAxes ? sourceWidth : sourceHeight;
  const data = Buffer.allocUnsafe(width * height * 4);
  for (let sourceY = 0; sourceY < sourceHeight; sourceY += 1) {
    for (let sourceX = 0; sourceX < sourceWidth; sourceX += 1) {
      let targetX;
      let targetY;
      if (orientation === 2) [targetX, targetY] = [sourceWidth - 1 - sourceX, sourceY];
      else if (orientation === 3) [targetX, targetY] = [sourceWidth - 1 - sourceX, sourceHeight - 1 - sourceY];
      else if (orientation === 4) [targetX, targetY] = [sourceX, sourceHeight - 1 - sourceY];
      else if (orientation === 5) [targetX, targetY] = [sourceY, sourceX];
      else if (orientation === 6) [targetX, targetY] = [sourceHeight - 1 - sourceY, sourceX];
      else if (orientation === 7) [targetX, targetY] = [sourceHeight - 1 - sourceY, sourceWidth - 1 - sourceX];
      else [targetX, targetY] = [sourceY, sourceWidth - 1 - sourceX];
      const sourceOffset = ((sourceY * sourceWidth) + sourceX) * 4;
      const targetOffset = ((targetY * width) + targetX) * 4;
      decoded.data.copy(data, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return { width, height, data };
}

function sanitizeJpeg(buffer, maxBytes, options) {
  const segments = jpegSegments(buffer);
  const dimensions = assertDimensions(jpegDimensions(buffer, segments), options);
  let decoded;
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: Math.max(1, Math.ceil(
        (Number(options.maxPixels) || DEFAULT_MAX_PIXELS) / 1000000
      )),
      maxMemoryUsageInMB: 96
    });
  } catch (error) {
    throw invalidImage();
  }
  if (!decoded || decoded.width !== dimensions.width || decoded.height !== dimensions.height) {
    throw invalidImage();
  }
  const pixels = orientedPixels({
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data)
  }, exifOrientation(buffer, segments));
  let output = null;
  for (const quality of JPEG_QUALITY_STEPS) {
    output = Buffer.from(jpeg.encode(pixels, quality).data);
    if (output.length <= maxBytes) break;
  }
  if (!output || output.length > maxBytes) throw invalidImage('The processed image is too large');
  return { buffer: output, width: pixels.width, height: pixels.height };
}

function sanitizePng(buffer, maxBytes, options) {
  const dimensions = assertDimensions(pngDimensions(buffer), options);
  let decoded;
  try {
    decoded = PNG.sync.read(buffer, { checkCRC: true });
  } catch (error) {
    throw invalidImage();
  }
  if (!decoded || decoded.width !== dimensions.width || decoded.height !== dimensions.height) {
    throw invalidImage();
  }
  let output;
  try {
    output = PNG.sync.write({
      width: decoded.width,
      height: decoded.height,
      data: Buffer.from(decoded.data)
    }, {
      colorType: 6,
      inputColorType: 6,
      inputHasAlpha: true,
      deflateLevel: 9,
      deflateStrategy: 3
    });
  } catch (error) {
    throw invalidImage();
  }
  if (output.length > maxBytes) throw invalidImage('The processed image is too large');
  return { buffer: output, width: decoded.width, height: decoded.height };
}

function sanitizeImagePayload(value, extensionValue, maxBytes, options = {}) {
  const extension = canonicalExtension(extensionValue);
  const input = decodeBase64(value, maxBytes);
  const format = imageFormat(input);
  if ((extension === 'jpg' && format !== 'jpeg') || (extension === 'png' && format !== 'png')) {
    throw invalidImage('The image content does not match its extension');
  }
  const sanitized = extension === 'jpg'
    ? sanitizeJpeg(input, maxBytes, options)
    : sanitizePng(input, maxBytes, options);
  return {
    ...sanitized,
    extension,
    format: extension === 'jpg' ? 'jpeg' : 'png',
    mimeType: extension === 'jpg' ? 'image/jpeg' : 'image/png',
    sha256: crypto.createHash('sha256').update(sanitized.buffer).digest('hex')
  };
}

module.exports = {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  canonicalExtension,
  decodeBase64,
  imageFormat,
  pngDimensions,
  jpegDimensions,
  exifOrientation,
  assertDimensions,
  orientedPixels,
  sanitizeImagePayload
};
