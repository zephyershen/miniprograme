function decorateUserProfile(value = {}) {
  const source = value || {};
  const nickname = typeof source.nickname === 'string' ? source.nickname : '';
  const avatarFileId = typeof source.avatarFileId === 'string' ? source.avatarFileId : '';
  const avatarUrl = typeof source.avatarUrl === 'string' ? source.avatarUrl : '';
  return {
    nickname,
    avatarFileId,
    avatarUrl,
    initial: nickname ? [...nickname][0] : '读',
    isComplete: Boolean(nickname && avatarFileId)
  };
}

function applyUserProfileAvatar(profile = {}, avatarUrl = '') {
  return { ...profile, avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : '' };
}

module.exports = { decorateUserProfile, applyUserProfileAvatar };
