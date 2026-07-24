const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { uploadAvatar, resolveAvatarUrl } = require('../features/user-profile/media.js');
const { decorateUserProfile } = require('../features/user-profile/model.js');
const { decorateComments } = require('../features/engagement/model.js');
const {
  commentMediaFileIds,
  resolveCommentMedia
} = require('../features/engagement/media.js');
const { resolveCloudFileUrls } = require('../services/cloud-media.js');

const OWNER = 'a'.repeat(64);
const UPLOAD = 'b'.repeat(48);

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
});
