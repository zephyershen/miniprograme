const { moderationApproved } = require('../policies/moderation-policy');

function commentContainsFile(comment, fileId) {
  return Array.isArray(comment && comment.attachments)
    && comment.attachments.some((attachment) => (
      attachment && attachment.type === 'image' && attachment.fileId === fileId
    ));
}

function createUserMediaPublicationVerifier({
  profileRepository,
  engagementRepository
}) {
  async function profileAttached(record, intent) {
    if (intent.referenceId !== record.ownerKey) return false;
    const profile = await profileRepository.get(intent.referenceId);
    return Boolean(profile
      && profile.ownerKey === record.ownerKey
      && moderationApproved(profile.moderation)
      && profile.avatarFileId === record.publishedFileId);
  }

  async function commentAttached(record, intent) {
    if (typeof intent.itemId !== 'string' || !intent.itemId) return false;
    const result = await engagementRepository.getComment(
      intent.referenceId,
      intent.itemId
    );
    const comment = result && result.comment;
    return Boolean(comment
      && comment.authorKey === record.ownerKey
      && comment.status === 'active'
      && moderationApproved(comment.moderation)
      && commentContainsFile(comment, record.publishedFileId));
  }

  async function isAttached(record) {
    const intent = record && record.publicationIntent;
    if (!record || record.status !== 'published' || !intent) return false;
    if (intent.kind === 'profile') return profileAttached(record, intent);
    if (intent.kind === 'comment') return commentAttached(record, intent);
    return false;
  }

  async function authorizedLegacyFileIds(fileIds, access = {}) {
    const requested = new Set(
      (Array.isArray(fileIds) ? fileIds : [])
        .filter((fileId) => typeof fileId === 'string' && fileId.length <= 700)
    );
    if (!requested.size) return [];
    const canReadComments = access.comments === true;
    const ownerKey = typeof access.ownerKey === 'string' ? access.ownerKey : '';
    const [profiles, comments] = await Promise.all([
      typeof profileRepository.findByAvatarFileIds === 'function'
        ? profileRepository.findByAvatarFileIds([...requested])
        : [],
      canReadComments && typeof engagementRepository.findByAttachmentFileIds === 'function'
        ? engagementRepository.findByAttachmentFileIds([...requested])
        : []
    ]);
    const authorized = new Set();
    (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
      const profileOwnerKey = profile && (profile.ownerKey || profile._id);
      const fileId = profile && profile.avatarFileId;
      if (requested.has(fileId)
        && moderationApproved(profile.moderation)
        && (canReadComments || profileOwnerKey === ownerKey)) {
        authorized.add(fileId);
      }
    });
    (Array.isArray(comments) ? comments : []).forEach((comment) => {
      if (!comment
        || comment.status !== 'active'
        || !moderationApproved(comment.moderation)) return;
      (Array.isArray(comment.attachments) ? comment.attachments : [])
        .filter((attachment) => attachment
          && attachment.type === 'image'
          && requested.has(attachment.fileId))
        .forEach((attachment) => authorized.add(attachment.fileId));
    });
    return [...authorized];
  }

  return { isAttached, authorizedLegacyFileIds };
}

module.exports = {
  commentContainsFile,
  createUserMediaPublicationVerifier
};
