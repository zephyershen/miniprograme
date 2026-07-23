const { moderationApproved } = require('../policies/moderation-policy');

function commentContainsFile(comment, fileId) {
  return Array.isArray(comment && comment.attachments)
    && comment.attachments.some((attachment) => (
      attachment && attachment.type === 'image' && attachment.fileId === fileId
    ));
}

function commentReadable(comment, access = {}) {
  if (!comment || !moderationApproved(comment.moderation)) return false;
  if (comment.status === 'active') return access.comments === true;
  return ['hidden', 'appealed'].includes(comment.status)
    && (access.isAdmin === true || comment.authorKey === access.ownerKey);
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
      && ['active', 'hidden', 'appealed'].includes(comment.status)
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

  async function canRead(record, access = {}) {
    const binding = record && record.businessBinding;
    if (!record || record.status !== 'published' || !binding
      || binding.state !== 'attached') return false;
    if (binding.kind === 'profile') {
      const profile = await profileRepository.get(binding.referenceId);
      return Boolean(profile
        && profile.ownerKey === record.ownerKey
        && moderationApproved(profile.moderation)
        && profile.avatarFileId === record.publishedFileId
        && (access.comments === true || access.ownerKey === record.ownerKey));
    }
    if (binding.kind !== 'comment' || typeof binding.itemId !== 'string') return false;
    const result = await engagementRepository.getComment(
      binding.referenceId,
      binding.itemId
    );
    const comment = result && result.comment;
    return Boolean(comment
      && comment.authorKey === record.ownerKey
      && commentContainsFile(comment, record.publishedFileId)
      && commentReadable(comment, access));
  }

  async function authorizedLegacyFileIds(fileIds, access = {}) {
    const requested = new Set(
      (Array.isArray(fileIds) ? fileIds : [])
        .filter((fileId) => typeof fileId === 'string' && fileId.length <= 700)
    );
    if (!requested.size) return [];
    const canReadComments = access.comments === true;
    const ownerKey = typeof access.ownerKey === 'string' ? access.ownerKey : '';
    const canSearchComments = canReadComments || Boolean(ownerKey);
    const [profiles, comments] = await Promise.all([
      typeof profileRepository.findByAvatarFileIds === 'function'
        ? profileRepository.findByAvatarFileIds([...requested])
        : [],
      canSearchComments && typeof engagementRepository.findByAttachmentFileIds === 'function'
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
      if (!commentReadable(comment, access)) return;
      (Array.isArray(comment.attachments) ? comment.attachments : [])
        .filter((attachment) => attachment
          && attachment.type === 'image'
          && requested.has(attachment.fileId))
        .forEach((attachment) => authorized.add(attachment.fileId));
    });
    return [...authorized];
  }

  return { isAttached, canRead, authorizedLegacyFileIds };
}

module.exports = {
  commentContainsFile,
  commentReadable,
  createUserMediaPublicationVerifier
};
