const { AppError } = require('../lib/errors');
const { decideModeration } = require('../policies/moderation-policy');
const { safeTempFileUrl } = require('./comment-moderation-service');

function createProfileModerationService({
  provider,
  getTempFileURL,
  logger = { warn: () => {} },
  now = () => Date.now()
}) {
  async function avatarUrlFor(fileId) {
    let response;
    try {
      response = await getTempFileURL({ fileList: [fileId] });
    } catch (error) {
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '资料暂时无法保存，请稍后再试');
    }
    const item = Array.isArray(response && response.fileList) ? response.fileList[0] : null;
    const url = item && Number(item.status) === 0 ? safeTempFileUrl(item.tempFileURL) : '';
    if (!url) throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '资料暂时无法保存，请稍后再试');
    return url;
  }

  async function review({ nickname, avatarFileId }) {
    if (!provider || provider.enabled !== true || typeof provider.moderateProfile !== 'function') {
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '资料暂时无法保存，请稍后再试');
    }
    const avatarUrl = await avatarUrlFor(avatarFileId);
    let result;
    try {
      result = await provider.moderateProfile({ nickname, avatarUrl });
    } catch (error) {
      logger.warn('Profile moderation failed', { code: error && error.code || 'UNKNOWN' });
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '资料暂时无法保存，请稍后再试');
    }
    const decision = decideModeration(result);
    if (decision.verdict !== 'allow') {
      throw new AppError(
        decision.verdict === 'unsure' ? 'CONTENT_REVIEW_UNAVAILABLE' : 'CONTENT_REJECTED',
        decision.verdict === 'unsure'
          ? '资料暂时无法保存，请调整后再试'
          : '头像或昵称不适合公开展示，请调整后重试'
      );
    }
    return {
      status: 'approved',
      provider: result.provider || provider.name || '',
      model: result.model || provider.model || '',
      reviewedAt: new Date(now())
    };
  }

  return { review, avatarUrlFor };
}

module.exports = { createProfileModerationService };
