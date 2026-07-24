function decorateUserProfile(value = {}) {
  const source = value || {};
  const nickname = typeof source.nickname === 'string' ? source.nickname : '';
  const avatarFileId = typeof source.avatarFileId === 'string' ? source.avatarFileId : '';
  const avatarUrl = typeof source.avatarUrl === 'string' ? source.avatarUrl : '';
  const sourceReview = source.review && typeof source.review === 'object'
    ? source.review
    : {};
  const reviewStatus = ['pending', 'rejected'].includes(sourceReview.status)
    ? sourceReview.status
    : 'none';
  const review = {
    status: reviewStatus,
    nickname: reviewStatus === 'pending' && typeof sourceReview.nickname === 'string'
      ? sourceReview.nickname
      : '',
    avatarFileId: reviewStatus === 'pending'
      && typeof sourceReview.avatarFileId === 'string'
      ? sourceReview.avatarFileId
      : '',
    avatarUrl: reviewStatus === 'pending'
      && typeof sourceReview.avatarUrl === 'string'
      ? sourceReview.avatarUrl
      : '',
    message: reviewStatus === 'rejected' && typeof sourceReview.message === 'string'
      ? sourceReview.message
      : '',
    submittedAt: sourceReview.submittedAt || null
  };
  const reviewPending = review.status === 'pending';
  const displayNickname = reviewPending && review.nickname ? review.nickname : nickname;
  const displayAvatarFileId = reviewPending && review.avatarFileId
    ? review.avatarFileId
    : avatarFileId;
  return {
    nickname,
    avatarFileId,
    avatarUrl,
    review,
    reviewPending,
    displayNickname,
    displayAvatarFileId,
    displayAvatarUrl: reviewPending && review.avatarUrl ? review.avatarUrl : avatarUrl,
    initial: displayNickname ? [...displayNickname][0] : '读',
    isComplete: Boolean(nickname && avatarFileId)
  };
}

function applyUserProfileAvatar(profile = {}, avatarUrl = '', displayAvatarUrl = '') {
  const approvedUrl = typeof avatarUrl === 'string' ? avatarUrl : '';
  const displayUrl = typeof displayAvatarUrl === 'string' && displayAvatarUrl
    ? displayAvatarUrl
    : approvedUrl;
  return {
    ...profile,
    avatarUrl: approvedUrl,
    displayAvatarUrl: displayUrl,
    review: {
      ...(profile.review || {}),
      avatarUrl: profile.reviewPending ? displayUrl : ''
    }
  };
}

module.exports = { decorateUserProfile, applyUserProfileAvatar };
