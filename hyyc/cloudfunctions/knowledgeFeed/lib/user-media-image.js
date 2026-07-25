const crypto = require('node:crypto');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { AppError } = require('./errors');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const DEFAULT_MAX_DIMENSION = 4096;
const DEFAULT_MAX_PIXELS = 12 * 1024 * 1024;

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

function jpegFrameInfo(buffer, segments = jpegSegments(buffer)) {
  const frames = segments.filter((segment) => segment.marker === 0xc0 || segment.marker === 0xc2);
  if (frames.length !== 1) throw invalidImage();
  const frame = frames[0];
  if (frame.end - frame.start < 6) throw invalidImage();
  const components = buffer[frame.start + 5];
  if (![1, 3].includes(components)
    || frame.end - frame.start < 6 + (components * 3)
    || buffer[frame.start] !== 8) {
    throw invalidImage();
  }
  return {
    marker: frame.marker,
    precision: buffer[frame.start],
    height: buffer.readUInt16BE(frame.start + 1),
    width: buffer.readUInt16BE(frame.start + 3),
    components
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

function jpegSegment(marker, data) {
  if (!Buffer.isBuffer(data) || data.length > 0xffff - 2) throw invalidImage();
  const header = Buffer.allocUnsafe(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

function minimalOrientationExif(orientation) {
  if (!Number.isInteger(orientation) || orientation < 2 || orientation > 8) return null;
  const data = Buffer.alloc(32);
  data.write('Exif\u0000\u0000', 0, 'binary');
  data.write('II', 6, 'ascii');
  data.writeUInt16LE(42, 8);
  data.writeUInt32LE(8, 10);
  data.writeUInt16LE(1, 14);
  data.writeUInt16LE(0x0112, 16);
  data.writeUInt16LE(3, 18);
  data.writeUInt32LE(1, 20);
  data.writeUInt16LE(orientation, 24);
  data.writeUInt32LE(0, 28);
  return jpegSegment(0xe1, data);
}

function jpegImageEnd(buffer, scanOffset) {
  let offset = scanOffset;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const markerStart = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) return offset;
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      throw invalidImage();
    }
    if (marker === 0x01) continue;
    if (offset + 2 > buffer.length) throw invalidImage();
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw invalidImage();
    offset += length;
    if (offset <= markerStart) throw invalidImage();
  }
  throw invalidImage();
}

function sanitizeJpegContainer(buffer, orientation) {
  if (!Buffer.isBuffer(buffer)
    || buffer.length < 4
    || buffer[0] !== 0xff
    || buffer[1] !== 0xd8) {
    throw invalidImage();
  }
  const output = [buffer.subarray(0, 2)];
  const orientationSegment = minimalOrientationExif(orientation);
  let orientationInserted = false;
  let offset = 2;

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) throw invalidImage();
    const markerStart = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw invalidImage();
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) throw invalidImage();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      output.push(buffer.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > buffer.length) throw invalidImage();
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw invalidImage();

    if (marker === 0xda) {
      if (orientationSegment && !orientationInserted) output.push(orientationSegment);
      const end = jpegImageEnd(buffer, offset + length);
      output.push(buffer.subarray(markerStart, end));
      return Buffer.concat(output);
    }

    const dataStart = offset + 2;
    const segmentEnd = offset + length;
    const data = buffer.subarray(dataStart, segmentEnd);
    const isApplicationSegment = marker >= 0xe0 && marker <= 0xef;
    if (!isApplicationSegment && marker !== 0xfe) {
      if (orientationSegment && !orientationInserted) {
        output.push(orientationSegment);
        orientationInserted = true;
      }
      output.push(buffer.subarray(markerStart, segmentEnd));
    } else if (marker === 0xe0
      && data.length >= 14
      && data.subarray(0, 5).toString('binary') === 'JFIF\u0000') {
      const jfif = Buffer.from(data.subarray(0, 14));
      jfif[12] = 0;
      jfif[13] = 0;
      output.push(jpegSegment(marker, jfif));
    }
    offset = segmentEnd;
  }
  throw invalidImage();
}

function sanitizeJpeg(buffer, maxBytes, options) {
  const segments = jpegSegments(buffer);
  const frame = jpegFrameInfo(buffer, segments);
  const dimensions = assertDimensions(frame, options);
  let decoded;
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
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
  const orientation = exifOrientation(buffer, segments);
  const output = sanitizeJpegContainer(buffer, orientation);
  if (output.length > maxBytes) throw invalidImage('The processed image is too large');
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return {
    buffer: output,
    width: swapsAxes ? dimensions.height : dimensions.width,
    height: swapsAxes ? dimensions.width : dimensions.height
  };
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
  jpegFrameInfo,
  exifOrientation,
  assertDimensions,
  sanitizeJpegContainer,
  sanitizeImagePayload
};
