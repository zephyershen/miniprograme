const { AppError } = require('../lib/errors');
const { moderationApproved } = require('../policies/moderation-policy');

function normalizeNickname(value, maxLength = 24) {
  const nickname = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!nickname) throw new AppError('INVALID_REQUEST', '请填写昵称');
  if (nickname.length > maxLength) {
    throw new AppError('INVALID_REQUEST', `昵称最多 ${maxLength} 个字`);
  }
  return nickname;
}

function profileView(profile) {
  const approved = moderationApproved(profile && profile.moderation);
  const nickname = approved && typeof profile.nickname === 'string' ? profile.nickname : '';
  const avatarFileId = approved && typeof profile.avatarFileId === 'string'
    ? profile.avatarFileId
    : '';
  return {
    nickname,
    avatarFileId,
    initial: nickname ? [...nickname][0] : '读',
    isComplete: Boolean(nickname && avatarFileId)
  };
}

function assertAvatarFileId(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 700) {
    throw new AppError('INVALID_REQUEST', '请选择有效的微信头像');
  }
  return value;
}

function createUserProfileService({
  repository,
  config,
  profileModerationService,
  userMediaService,
  now = () => Date.now()
}) {
  async function get(actor) {
    return { profile: profileView(await repository.get(actor.ownerKey)) };
  }

  async function getStored(actor) {
    return repository.get(actor.ownerKey);
  }

  async function save(payload, actor) {
    const current = await repository.get(actor.ownerKey);
    const nickname = normalizeNickname(payload && payload.nickname);
    const requestedAvatarFileId = payload && payload.avatarFileId
      || current && current.avatarFileId;
    if (typeof requestedAvatarFileId !== 'string' || !requestedAvatarFileId
      || requestedAvatarFileId.length > 700) {
      throw new AppError('INVALID_REQUEST', '请选择有效的微信头像');
    }
    const avatarChanged = !current || current.avatarFileId !== requestedAvatarFileId;
    let reviewAvatarFileId = requestedAvatarFileId;
    if (avatarChanged) {
      if (!userMediaService) throw new Error('USER_MEDIA_SERVICE_REQUIRED');
      [reviewAvatarFileId] = await userMediaService.filesForReview(
        actor,
        'avatar',
        [requestedAvatarFileId]
      );
    }
    let moderation;
    try {
      moderation = await profileModerationService.review({
        nickname,
        avatarFileId: reviewAvatarFileId
      });
    } catch (error) {
      if (avatarChanged && error && error.code === 'CONTENT_REJECTED') {
        await userMediaService.discardUnpublished(
          actor,
          'avatar',
          [requestedAvatarFileId]
        ).catch(() => null);
      }
      throw error;
    }
    const avatarFileId = avatarChanged
      ? (await userMediaService.publishOwned(
        actor,
        'avatar',
        [requestedAvatarFileId],
        { kind: 'profile', id: actor.ownerKey }
      ))[0]
      : requestedAvatarFileId;
    const saved = await repository.save(
      actor.ownerKey,
      { nickname, avatarFileId, moderation },
      new Date(now())
    );
    if (userMediaService && userMediaService.isOwnedPublishedFileId(avatarFileId)) {
      await userMediaService.bindPublished(actor, 'avatar', [avatarFileId], {
        kind: 'profile',
        id: actor.ownerKey
      });
    }
    const oldAvatar = saved.current && saved.current.avatarFileId;
    if (oldAvatar && oldAvatar !== avatarFileId
      && userMediaService && userMediaService.isOwnedPublishedFileId(oldAvatar)) {
      await userMediaService.deleteOwned(actor, 'avatar', [oldAvatar]).catch(() => null);
    }
    return { profile: profileView(saved.document) };
  }

  return { get, getStored, save };
}

module.exports = {
  normalizeNickname,
  profileView,
  assertAvatarFileId,
  createUserProfileService
};
