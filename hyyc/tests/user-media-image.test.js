const test = require('node:test');
const assert = require('node:assert/strict');
const jpeg = require('../cloudfunctions/knowledgeFeed/node_modules/jpeg-js');
const {
  PNG
} = require('../cloudfunctions/knowledgeFeed/node_modules/pngjs');
const {
  sanitizeImagePayload,
  imageFormat
} = require('../cloudfunctions/knowledgeFeed/lib/user-media-image');
const {
  createCloudbaseMediaUploader
} = require('../cloudfunctions/knowledgeFeed/services/cloudbase-media-uploader');

function rgba(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 30;
    data[index + 1] = 140;
    data[index + 2] = 220;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

function jpegInput(width = 2, height = 2) {
  return Buffer.from(jpeg.encode(rgba(width, height), 90).data);
}

function pngInput(width = 2, height = 2) {
  return PNG.sync.write(rgba(width, height));
}

test('fully decodes and re-encodes JPEG and PNG uploads into static metadata-free images', () => {
  const originalJpeg = jpegInput();
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x0e,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00
  ]);
  const jpegWithMetadata = Buffer.concat([
    originalJpeg.subarray(0, 2),
    exif,
    originalJpeg.subarray(2)
  ]);
  const sanitizedJpeg = sanitizeImagePayload(
    jpegWithMetadata.toString('base64'),
    'jpeg',
    1024 * 1024
  );
  assert.equal(sanitizedJpeg.extension, 'jpg');
  assert.equal(sanitizedJpeg.mimeType, 'image/jpeg');
  assert.equal(imageFormat(sanitizedJpeg.buffer), 'jpeg');
  assert.equal(sanitizedJpeg.buffer.includes(Buffer.from('Exif\u0000\u0000')), false);
  assert.deepEqual(
    [jpeg.decode(sanitizedJpeg.buffer).width, jpeg.decode(sanitizedJpeg.buffer).height],
    [2, 2]
  );

  const sanitizedPng = sanitizeImagePayload(
    pngInput().toString('base64'),
    'png',
    1024 * 1024
  );
  assert.equal(sanitizedPng.extension, 'png');
  assert.equal(sanitizedPng.mimeType, 'image/png');
  assert.equal(imageFormat(sanitizedPng.buffer), 'png');
  assert.deepEqual(
    [PNG.sync.read(sanitizedPng.buffer).width, PNG.sync.read(sanitizedPng.buffer).height],
    [2, 2]
  );
});

test('rejects animated formats, extension spoofing, corrupt files, and oversized dimensions', () => {
  const gif = Buffer.from('GIF89a000000000000', 'ascii').toString('base64');
  const webp = Buffer.from('RIFF0000WEBPVP8 ', 'ascii').toString('base64');
  assert.throws(() => sanitizeImagePayload(gif, 'gif', 1024), /valid JPG or PNG/i);
  assert.throws(() => sanitizeImagePayload(webp, 'webp', 1024), /valid JPG or PNG/i);
  assert.throws(
    () => sanitizeImagePayload(pngInput().toString('base64'), 'jpg', 1024 * 1024),
    /does not match/i
  );
  assert.throws(
    () => sanitizeImagePayload(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'), 'jpg', 1024),
    /valid JPG or PNG|does not match/i
  );

  const oversizedHeader = pngInput();
  oversizedHeader.writeUInt32BE(5000, 16);
  assert.throws(
    () => sanitizeImagePayload(oversizedHeader.toString('base64'), 'png', 1024 * 1024),
    /dimensions are too large/i
  );
});

test('server uploader sets exact image MIME and byte length on the immutable object', async () => {
  const body = jpegInput();
  let putCall;
  const upload = createCloudbaseMediaUploader({
    getUploadMetadata: async ({ cloudPath }) => {
      assert.equal(cloudPath, 'user-media/staging/owner/avatar.jpg');
      return {
        data: {
          url: 'https://bucket.example.test/signed-upload',
          token: 'temporary-token',
          authorization: 'signed-authorization',
          cosFileId: 'cos-file-id',
          fileId: 'cloud://env/user-media/staging/owner/avatar.jpg'
        }
      };
    },
    put: async (...args) => {
      putCall = args;
      return { statusCode: 200 };
    }
  });
  assert.deepEqual(await upload({
    cloudPath: 'user-media/staging/owner/avatar.jpg',
    fileContent: body,
    contentType: 'image/jpeg'
  }), {
    fileID: 'cloud://env/user-media/staging/owner/avatar.jpg'
  });
  assert.equal(putCall[0], 'https://bucket.example.test/signed-upload');
  assert.equal(putCall[1]['content-type'], 'image/jpeg');
  assert.equal(putCall[1]['content-length'], String(body.length));
  assert.equal(putCall[2], body);
});
