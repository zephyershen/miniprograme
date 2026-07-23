const test = require('node:test');
const assert = require('node:assert/strict');

const {
  commentContainsFile,
  createUserMediaPublicationVerifier
} = require('../cloudfunctions/knowledgeFeed/services/user-media-publication-verifier');

const OWNER = 'a'.repeat(64);
const OTHER = 'd'.repeat(64);
const COMMENT_ID = 'b'.repeat(64);
const ITEM_ID = 'item_test_01';
const FILE_ID = `cloud://env/user-media/published/comments/${OWNER}/${'c'.repeat(48)}.jpg`;
const APPROVED = Object.freeze({ status: 'approved' });

test('publication verifier accepts only the approved profile that references the exact file', async () => {
  let profile = {
    ownerKey: OWNER,
    avatarFileId: FILE_ID,
    moderation: APPROVED
  };
  const verifier = createUserMediaPublicationVerifier({
    profileRepository: { get: async () => profile },
    engagementRepository: { getComment: async () => null }
  });
  const record = {
    ownerKey: OWNER,
    status: 'published',
    publishedFileId: FILE_ID,
    publicationIntent: { kind: 'profile', referenceId: OWNER }
  };

  assert.equal(await verifier.isAttached(record), true);
  profile = { ...profile, avatarFileId: 'cloud://env/different.jpg' };
  assert.equal(await verifier.isAttached(record), false);
  profile = { ...profile, avatarFileId: FILE_ID, moderation: { status: 'rejected' } };
  assert.equal(await verifier.isAttached(record), false);
});

test('publication verifier checks comment owner, item, moderation, status, and exact attachment', async () => {
  let requested = null;
  let comment = {
    authorKey: OWNER,
    status: 'active',
    moderation: APPROVED,
    attachments: [{ type: 'image', fileId: FILE_ID }]
  };
  const verifier = createUserMediaPublicationVerifier({
    profileRepository: { get: async () => null },
    engagementRepository: {
      getComment: async (commentId, itemId) => {
        requested = { commentId, itemId };
        return { comment };
      }
    }
  });
  const record = {
    ownerKey: OWNER,
    status: 'published',
    publishedFileId: FILE_ID,
    publicationIntent: {
      kind: 'comment',
      referenceId: COMMENT_ID,
      itemId: ITEM_ID
    }
  };

  assert.equal(commentContainsFile(comment, FILE_ID), true);
  assert.equal(await verifier.isAttached(record), true);
  assert.deepEqual(requested, { commentId: COMMENT_ID, itemId: ITEM_ID });
  comment = { ...comment, authorKey: 'd'.repeat(64) };
  assert.equal(await verifier.isAttached(record), false);
  comment = {
    ...comment,
    authorKey: OWNER,
    attachments: [{ type: 'image', fileId: `${FILE_ID}-other` }]
  };
  assert.equal(await verifier.isAttached(record), false);
});

test('legacy authorization requires an approved current business record and matching access', async () => {
  const legacyAvatar = 'cloud://env/user-media/avatars/current.webp';
  const legacyComment = 'cloud://env/user-media/comments/current.webp';
  const rejected = 'cloud://env/user-media/comments/rejected.webp';
  const verifier = createUserMediaPublicationVerifier({
    profileRepository: {
      get: async () => null,
      findByAvatarFileIds: async () => [{
        ownerKey: OWNER,
        avatarFileId: legacyAvatar,
        moderation: APPROVED
      }]
    },
    engagementRepository: {
      getComment: async () => null,
      findByAttachmentFileIds: async () => [{
        authorKey: OWNER,
        status: 'active',
        moderation: APPROVED,
        attachments: [{ type: 'image', fileId: legacyComment }]
      }, {
        authorKey: OWNER,
        status: 'active',
        moderation: { status: 'rejected' },
        attachments: [{ type: 'image', fileId: rejected }]
      }]
    }
  });

  assert.deepEqual(await verifier.authorizedLegacyFileIds(
    [legacyAvatar, legacyComment, rejected],
    { ownerKey: OWNER, comments: false }
  ), [legacyAvatar]);
  assert.deepEqual(new Set(await verifier.authorizedLegacyFileIds(
    [legacyAvatar, legacyComment, rejected],
    { ownerKey: OTHER, comments: true }
  )), new Set([legacyAvatar, legacyComment]));
});
