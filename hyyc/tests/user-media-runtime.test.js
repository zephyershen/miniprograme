const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { uploadAvatar, resolveAvatarUrl } = require('../features/user-profile/media.js');
const { decorateUserProfile } = require('../features/user-profile/model.js');
const { decorateComments } = require('../features/engagement/model.js');
const {
  chooseCommentImages,
  commentMediaFileIds,
  resolveCommentMedia,
  resolveFreshCommentMedia,
  uploadCommentImages
} = require('../features/engagement/media.js');
const {
  IMAGE_COMPRESSION_PRESETS,
  IMAGE_COMPRESSION_QUALITIES,
  MAX_BASE64_LENGTH,
  applyCanvasOrientation,
  imageOrientation,
  orientedScaledImageSize,
  resolveCloudFileUrls
} = require('../services/cloud-media.js');

const OWNER = 'a'.repeat(64);
const UPLOAD = 'b'.repeat(48);

test('normalizes mirrored and rotated phone-photo orientations on the canvas', () => {
  assert.equal(imageOrientation('right'), 6);
  assert.equal(imageOrientation('left-mirrored'), 5);
  assert.deepEqual(orientedScaledImageSize({
    width: 4032,
    height: 3024,
    orientation: 'right'
  }, 1600), {
    sourceWidth: 1600,
    sourceHeight: 1200,
    width: 1200,
    height: 1600,
    orientation: 6
  });
  const transforms = [];
  applyCanvasOrientation({
    transform: (...values) => transforms.push(values)
  }, 6, 1600, 1200);
  assert.deepEqual(transforms, [[0, 1, -1, 0, 1200, 0]]);
});

test('does not reject a selected source photo by its original file size', async () => {
  const previousWx = global.wx;
  global.wx = {
    chooseMedia: async (options) => {
      assert.deepEqual(options.sizeType, ['compressed']);
      return {
        tempFiles: [{
          tempFilePath: 'wxfile://large-phone-photo.jpg',
          width: 4032,
          height: 3024,
          size: 80 * 1024 * 1024
        }]
      };
    }
  };
  try {
    const [selected] = await chooseCommentImages();
    assert.equal(selected.tempFilePath, 'wxfile://large-phone-photo.jpg');
    assert.equal(selected.size, 80 * 1024 * 1024);
  } finally {
    global.wx = previousWx;
  }
});

test('uploads new media only to a server-reserved staging path', async () => {
  const previousWx = global.wx;
  const cloudPath = `user-media/staging/${OWNER}/avatars/${UPLOAD}.jpg`;
  const fileId = `cloud://env/${cloudPath}`;
  const contentBase64 = '/9j/AAECAwQFBgcICQ==';
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getFileSystemManager: () => ({
      readFile: ({ filePath, encoding, success }) => {
        assert.equal(filePath, 'wxfile://avatar.jpg');
        assert.equal(encoding, 'base64');
        success({ data: contentBase64 });
      }
    }),
    cloud: {
      callFunction: async ({ name, data }) => {
        assert.equal(name, 'knowledgeFeed');
        assert.deepEqual(data, {
          action: 'uploadMedia',
          kind: 'avatar',
          extension: 'jpg',
          contentBase64
        });
        return {
          result: {
            ok: true,
            data: {
              cloudPath,
              fileId
            }
          }
        };
      }
    }
  };
  try {
    assert.equal(await uploadAvatar('wxfile://avatar.jpg'), fileId);
  } finally {
    global.wx = previousWx;
  }
});

test('compresses a normal phone photo below the cloud-function payload limit before upload', async () => {
  const previousWx = global.wx;
  const cloudPath = `user-media/staging/${OWNER}/comments/${UPLOAD}.jpg`;
  const fileId = `cloud://env/${cloudPath}`;
  const oversizedBase64 = 'a'.repeat(MAX_BASE64_LENGTH.comment + 1);
  const safeBase64 = '/9j/AAECAwQFBgcICQ==';
  const compressions = [];
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getFileSystemManager: () => ({
      stat: ({ path, success }) => {
        assert.equal(path, 'wxfile://photo.jpg');
        success({ stats: { size: 8 * 1024 * 1024 } });
      },
      readFile: ({ filePath, encoding, success }) => {
        assert.equal(encoding, 'base64');
        assert.notEqual(filePath, 'wxfile://photo.jpg');
        success({
          data: filePath === 'wxfile://compressed-1280x960-70.jpg'
            ? safeBase64
            : oversizedBase64
        });
      }
    }),
    getImageInfo: ({ src, success }) => {
      assert.equal(src, 'wxfile://photo.jpg');
      success({ width: 4032, height: 3024, type: 'jpg', path: src });
    },
    compressImage: ({
      quality,
      compressedWidth,
      compressedHeight,
      success
    }) => {
      compressions.push({ quality, compressedWidth, compressedHeight });
      success({
        tempFilePath: `wxfile://compressed-${compressedWidth}x${compressedHeight}-${quality}.jpg`
      });
    },
    cloud: {
      callFunction: async ({ name, data }) => {
        assert.equal(name, 'knowledgeFeed');
        assert.equal(data.action, 'uploadMedia');
        assert.equal(data.kind, 'comment');
        assert.equal(data.extension, 'jpg');
        assert.equal(data.contentBase64, safeBase64);
        return {
          result: {
            ok: true,
            data: { cloudPath, fileId }
          }
        };
      }
    }
  };
  try {
    const [uploaded] = await uploadCommentImages([{
      tempFilePath: 'wxfile://photo.jpg',
      width: 2048,
      height: 1536
    }]);
    assert.deepEqual(compressions, [
      { quality: 82, compressedWidth: 1600, compressedHeight: 1200 },
      { quality: 70, compressedWidth: 1280, compressedHeight: 960 }
    ]);
    assert.deepEqual(
      compressions.map((entry) => entry.quality),
      IMAGE_COMPRESSION_QUALITIES.slice(0, 2)
    );
    assert.deepEqual(IMAGE_COMPRESSION_PRESETS[1], {
      maxDimension: 1280,
      quality: 70
    });
    assert.equal(uploaded.fileId, fileId);
    assert.equal(uploaded.previewPath, 'wxfile://compressed-1280x960-70.jpg');
    assert.equal(uploaded.width, 2048);
    assert.equal(uploaded.height, 1536);
  } finally {
    global.wx = previousWx;
  }
});

test('converts an oversized PNG screenshot to a resized JPEG before upload on iOS', async () => {
  const previousWx = global.wx;
  const cloudPath = `user-media/staging/${OWNER}/comments/${UPLOAD}.jpg`;
  const fileId = `cloud://env/${cloudPath}`;
  const oversizedPngBase64 = `iVBORw0KGgo${'a'.repeat(MAX_BASE64_LENGTH.comment + 1)}`;
  const safeJpegBase64 = '/9j/AAECAwQFBgcICQ==';
  const canvasDraws = [];
  const canvas = {
    width: 0,
    height: 0,
    createImage() {
      const image = {};
      Object.defineProperty(image, 'src', {
        set(value) {
          image.source = value;
          queueMicrotask(() => image.onload());
        }
      });
      return image;
    },
    getContext(type) {
      assert.equal(type, '2d');
      const draw = {};
      this.currentDraw = draw;
      return {
        set fillStyle(value) { draw.fill = value; },
        fillRect: (x, y, width, height) => {
          draw.fillRect = { x, y, width, height };
        },
        drawImage: (image, x, y, width, height) => {
          Object.assign(draw, { src: image.source, x, y, width, height });
        }
      };
    }
  };
  const component = {
    createSelectorQuery() {
      return {
        select(selector) {
          assert.equal(selector, '#commentMediaCompressor');
          return this;
        },
        fields(options) {
          assert.deepEqual(options, { node: true, size: true });
          return this;
        },
        exec(callback) {
          callback([{ node: canvas, width: 1, height: 1 }]);
        }
      };
    }
  };
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getFileSystemManager: () => ({
      stat: ({ path, success }) => {
        assert.equal(path, 'wxfile://screenshot.png');
        success({ stats: { size: 12 * 1024 * 1024 } });
      },
      readFile: ({ filePath, encoding, success }) => {
        assert.equal(encoding, 'base64');
        assert.notEqual(filePath, 'wxfile://screenshot.png');
        success({
          data: filePath === 'wxfile://canvas-590x1280.jpg'
            ? safeJpegBase64
            : oversizedPngBase64
        });
      }
    }),
    getImageInfo: ({ src, success }) => {
      if (src === 'wxfile://screenshot.png') {
        success({ width: 1179, height: 2556, type: 'png', orientation: 'up', path: src });
        return;
      }
      const match = /^wxfile:\/\/canvas-(\d+)x(\d+)\.jpg$/.exec(src);
      assert.ok(match, `unexpected converted image path: ${src}`);
      success({
        width: Number(match[1]),
        height: Number(match[2]),
        type: 'jpg',
        orientation: 'up',
        path: src
      });
    },
    compressImage: () => assert.fail('iOS PNG files must use the JPEG canvas path'),
    canvasToTempFilePath: (options, owner) => {
      assert.equal(owner, component);
      assert.equal(options.canvas, canvas);
      assert.equal(options.fileType, 'jpg');
      canvasDraws.push({ ...canvas.currentDraw });
      options.success({
        tempFilePath: `wxfile://canvas-${options.destWidth}x${options.destHeight}.jpg`
      });
    },
    cloud: {
      callFunction: async ({ name, data }) => {
        assert.equal(name, 'knowledgeFeed');
        assert.equal(data.action, 'uploadMedia');
        assert.equal(data.kind, 'comment');
        assert.equal(data.extension, 'jpg');
        assert.equal(data.contentBase64, safeJpegBase64);
        return {
          result: {
            ok: true,
            data: { cloudPath, fileId }
          }
        };
      }
    }
  };
  try {
    const [uploaded] = await uploadCommentImages([{
      tempFilePath: 'wxfile://screenshot.png',
      width: 1179,
      height: 2556
    }], {
      canvas: {
        component,
        canvasId: 'commentMediaCompressor'
      }
    });
    assert.equal(canvasDraws.length, 2);
    assert.deepEqual(canvasDraws[0], {
      fill: '#ffffff',
      fillRect: { x: 0, y: 0, width: 738, height: 1600 },
      src: 'wxfile://screenshot.png',
      x: 0,
      y: 0,
      width: 738,
      height: 1600
    });
    assert.equal(canvas.width, 590);
    assert.equal(canvas.height, 1280);
    assert.equal(uploaded.fileId, fileId);
    assert.equal(uploaded.previewPath, 'wxfile://canvas-590x1280.jpg');
  } finally {
    global.wx = previousWx;
  }
});

test('resolves a stored profile avatar to a renderable URL without exposing the cloud file ID to WXML', async () => {
  const fileId = 'cloud://env/user-media/avatars/me.webp';
  let requested;
  const url = await resolveAvatarUrl(fileId, async (fileIds) => {
    requested = fileIds;
    return [{ fileId, url: 'https://temporary.example/me.webp' }];
  });
  assert.deepEqual(requested, [fileId]);
  assert.equal(url, 'https://temporary.example/me.webp');
  assert.equal(await resolveAvatarUrl('https://cdn.example/me.webp'), 'https://cdn.example/me.webp');
});

test('resolves private user media only through the guarded backend action', async () => {
  const previousWx = global.wx;
  const fileId = `cloud://env/user-media/published/avatars/${OWNER}/${UPLOAD}.jpg`;
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    cloud: {
      getTempFileURL: async () => assert.fail('private user media must not use client storage reads'),
      callFunction: async ({ name, data }) => {
        assert.equal(name, 'knowledgeFeed');
        assert.deepEqual(data, { action: 'resolveUserMedia', fileIds: [fileId] });
        return {
          result: {
            ok: true,
            data: {
              files: [{
                fileId,
                url: 'https://temporary.example/approved.jpg',
                maxAge: 300
              }]
            }
          }
        };
      }
    }
  };
  try {
    assert.deepEqual(await resolveCloudFileUrls([fileId]), [{
      fileId,
      url: 'https://temporary.example/approved.jpg',
      maxAgeMs: 300000
    }]);
  } finally {
    global.wx = previousWx;
  }
});

test('keeps profile and comment text placeholders usable before or after media resolution failure', () => {
  const profile = decorateUserProfile({
    nickname: 'Zephyr',
    avatarFileId: 'cloud://env/user-media/avatars/me.webp'
  });
  const [comment] = decorateComments([{
    id: 'comment-1',
    content: '这条评论不应被图片加载阻塞',
    createdAt: '2026-07-21T08:00:00.000Z',
    author: {
      nickname: 'Zephyr',
      initial: 'Z',
      avatarFileId: profile.avatarFileId
    },
    attachments: [{ fileId: 'cloud://env/user-media/comments/photo.webp' }]
  }], Date.parse('2026-07-21T08:01:00.000Z'));
  assert.equal(profile.avatarUrl, '');
  assert.equal(profile.initial, 'Z');
  assert.equal(comment.content, '这条评论不应被图片加载阻塞');
  assert.equal(comment.author.initial, 'Z');
  assert.equal(comment.author.avatarUrl, '');
  assert.equal(comment.attachments[0].url, '');
});

test('shows the pending profile candidate without treating it as approved for comments', () => {
  const pendingAvatar = `cloud://env/user-media/review/avatars/${OWNER}/${UPLOAD}.jpg`;
  const profile = decorateUserProfile({
    nickname: '',
    avatarFileId: '',
    review: {
      status: 'pending',
      nickname: '待审昵称',
      avatarFileId: pendingAvatar
    }
  });
  assert.equal(profile.displayNickname, '待审昵称');
  assert.equal(profile.displayAvatarFileId, pendingAvatar);
  assert.equal(profile.reviewPending, true);
  assert.equal(profile.isComplete, false);
});

test('batches comment avatars and attachments and maps resolved URLs back to their owners', async () => {
  const comments = Array.from({ length: 26 }, (_, index) => ({
    id: `comment-${index}`,
    author: {
      initial: String(index),
      avatarFileId: `cloud://env/user-media/avatars/${index}.webp`
    },
    attachments: [{ fileId: `cloud://env/user-media/comments/${index}.webp` }]
  }));
  const batches = [];
  const resolved = await resolveCommentMedia(comments, async (fileIds) => {
    batches.push(fileIds);
    return fileIds.map((fileId) => ({ fileId, url: `https://temporary.example/${encodeURIComponent(fileId)}` }));
  });
  assert.equal(commentMediaFileIds(comments).length, 52);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 2]);
  assert.match(resolved[0].author.avatarUrl, /^https:\/\//);
  assert.match(resolved[25].attachments[0].url, /^https:\/\//);
  assert.equal(resolved[0].author.avatarFileId, comments[0].author.avatarFileId);
});

test('keeps comment content and initials when a CloudBase media batch fails', async () => {
  const [comment] = await resolveCommentMedia([{
    id: 'comment-fail-open',
    content: '图片失败时仍然显示文字',
    author: { initial: '图', avatarFileId: 'cloud://env/avatar.webp' },
    attachments: [{ fileId: 'cloud://env/photo.webp' }]
  }], async () => { throw new Error('temporary media failure'); });
  assert.equal(comment.content, '图片失败时仍然显示文字');
  assert.equal(comment.author.initial, '图');
  assert.equal(comment.author.avatarUrl, '');
  assert.equal(comment.attachments[0].url, '');
});

test('refreshes a cloud image URL instead of previewing a cached temporary address', async () => {
  const fileId = 'cloud://env/user-media/published/comments/photo.jpg';
  let requested = [];
  const resolved = await resolveFreshCommentMedia({
    id: 'comment-refresh',
    author: {},
    attachments: [{
      fileId,
      url: 'https://temporary.example/expired.jpg'
    }]
  }, async (fileIds) => {
    requested = fileIds;
    return [{
      fileId,
      url: 'https://temporary.example/fresh.jpg'
    }];
  });
  assert.deepEqual(requested, [fileId]);
  assert.equal(resolved.attachments[0].url, 'https://temporary.example/fresh.jpg');
});

test('profile, profile editor and comment list do not bind stored cloud IDs directly as image sources', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'pages/profile/index.wxml',
    'pages/profile-edit/index.wxml',
    'components/comment-sheet/index.wxml'
  ];
  files.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, /src="\{\{[^}]+(?:avatarFileId|attachment\.fileId)[^}]*\}\}"/);
  });
  const commentSource = fs.readFileSync(
    path.join(root, 'components/comment-sheet/index.wxml'),
    'utf8'
  );
  assert.match(commentSource, /binderror="handleCommentImageError"/);
  assert.match(commentSource, /图片审核中/);
  assert.match(commentSource, /图片暂时无法显示/);
});
