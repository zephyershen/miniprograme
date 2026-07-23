const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileModerationService } = require('../cloudfunctions/knowledgeFeed/services/profile-moderation-service');
const { createUserProfileService } = require('../cloudfunctions/knowledgeFeed/services/user-profile-service');

test('reviews both nickname and avatar before persisting a public profile', async () => {
  let reviewed;
  let saved;
  const moderation = createProfileModerationService({
    provider: {
      enabled: true,
      moderateProfile: async (input) => {
        reviewed = input;
        return {
          verdict: 'allow', confidence: 0.99, categories: [],
          provider: 'test', model: 'test-model'
        };
      }
    },
    getTempFileURL: async () => ({
      fileList: [{ status: 0, tempFileURL: 'https://temporary.example/avatar.jpg' }]
    })
  });
  const service = createUserProfileService({
    repository: {
      get: async () => null,
      save: async (ownerKey, profile, updatedAt) => {
        saved = { ownerKey, profile, updatedAt };
        return { current: null, document: profile };
      }
    },
    config: {},
    profileModerationService: moderation,
    userMediaService: {
      filesForReview: async (actor, kind, fileIds) => fileIds,
      publishOwned: async () => ['cloud://env/user-media/published/avatars/owner/new.jpg'],
      bindPublished: async () => null,
      discardUnpublished: async () => null,
      deleteOwned: async () => null,
      isOwnedPublishedFileId: () => false
    }
  });
  await service.save({
    nickname: '  小 明  ',
    avatarFileId: 'cloud://env/user-media/staging/owner/avatars/new.jpg'
  }, { ownerKey: 'owner' });
  assert.deepEqual(reviewed, {
    nickname: '小 明', avatarUrl: 'https://temporary.example/avatar.jpg'
  });
  assert.equal(saved.profile.avatarFileId, 'cloud://env/user-media/published/avatars/owner/new.jpg');
  assert.equal(saved.profile.moderation.status, 'approved');
});

test('fails profile edits closed and removes a rejected newly uploaded avatar', async () => {
  const deleted = [];
  const moderation = createProfileModerationService({
    provider: {
      enabled: true,
      moderateProfile: async () => ({ verdict: 'reject' })
    },
    getTempFileURL: async () => ({
      fileList: [{ status: 0, tempFileURL: 'https://temporary.example/avatar.jpg' }]
    })
  });
  const service = createUserProfileService({
    repository: {
      get: async () => ({ avatarFileId: 'cloud://env/user-media/avatars/old.jpg' }),
      save: async () => assert.fail('rejected profiles must not be saved')
    },
    config: {},
    profileModerationService: moderation,
    userMediaService: {
      filesForReview: async (actor, kind, fileIds) => fileIds,
      publishOwned: async () => assert.fail('rejected avatars must not be published'),
      discardUnpublished: async (actor, kind, fileIds) => deleted.push(...fileIds),
      deleteOwned: async () => null,
      isOwnedPublishedFileId: () => false
    }
  });
  await assert.rejects(() => service.save({
    nickname: '昵称', avatarFileId: 'cloud://env/user-media/staging/owner/avatars/new.jpg'
  }, { ownerKey: 'owner' }), /不适合公开展示/);
  assert.deepEqual(deleted, ['cloud://env/user-media/staging/owner/avatars/new.jpg']);
});

test('does not publish a profile when an allow verdict is uncertain', async () => {
  const moderation = createProfileModerationService({
    provider: {
      enabled: true,
      moderateProfile: async () => ({
        verdict: 'allow', confidence: 0.4, categories: ['other']
      })
    },
    getTempFileURL: async () => ({
      fileList: [{ status: 0, tempFileURL: 'https://temporary.example/avatar.jpg' }]
    })
  });
  await assert.rejects(
    () => moderation.review({
      nickname: '昵称', avatarFileId: 'cloud://env/user-media/avatars/new.jpg'
    }),
    (error) => error.code === 'CONTENT_REVIEW_UNAVAILABLE'
  );
});
