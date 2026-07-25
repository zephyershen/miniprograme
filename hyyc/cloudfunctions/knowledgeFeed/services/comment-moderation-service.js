const { AppError } = require('../lib/errors');
const {
  commentRejectionReason,
  decideModeration
} = require('../policies/moderation-policy');

function safeTempFileUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
}

function createCommentModerationService({
  provider,
  getTempFileURL,
  logger = { warn: () => {} },
  now = () => Date.now()
}) {
  async function imageUrlsFor(attachments) {
    const fileIds = (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => attachment && attachment.fileId)
      .filter(Boolean);
    if (!fileIds.length) return [];
    let response;
    try {
      response = await getTempFileURL({ fileList: fileIds });
    } catch (error) {
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '图片暂时无法发布，请稍后再试');
    }
    const results = Array.isArray(response && response.fileList) ? response.fileList : [];
    const byId = new Map(results.map((item) => [item.fileID || item.fileId, item]));
    const urls = fileIds.map((fileId) => {
      const item = byId.get(fileId);
      return item && Number(item.status) === 0 ? safeTempFileUrl(item.tempFileURL) : '';
    });
    if (urls.some((url) => !url)) {
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '图片暂时无法发布，请稍后再试');
    }
    return urls;
  }

  async function review({ content = '', attachments = [] } = {}) {
    if (!provider || provider.enabled !== true || typeof provider.moderateComment !== 'function') {
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '评论暂时无法发布，请稍后再试');
    }
    const imageUrls = await imageUrlsFor(attachments);
    let result;
    try {
      result = await provider.moderateComment({ content, imageUrls });
    } catch (error) {
      logger.warn('Comment moderation failed', { code: error && error.code || 'UNKNOWN' });
      throw new AppError('CONTENT_REVIEW_UNAVAILABLE', '评论暂时无法发布，请稍后再试');
    }
    const decision = decideModeration(result);
    if (decision.verdict !== 'allow') {
      const uncertain = decision.verdict === 'unsure';
      const error = new AppError(
        uncertain ? 'CONTENT_REVIEW_UNAVAILABLE' : 'CONTENT_REJECTED',
        uncertain ? '评论暂时无法发布，请调整后重试' : '评论包含不适合公开的内容，请调整后重试'
      );
      if (!uncertain) {
        error.rejectionReason = commentRejectionReason(decision.categories);
        error.moderation = {
          status: 'rejected',
          verdict: 'reject',
          confidence: decision.confidence,
          categories: decision.categories,
          reason: typeof result.reason === 'string' ? result.reason.slice(0, 80) : ''
        };
      }
      throw error;
    }
    return {
      status: 'approved',
      verdict: 'allow',
      confidence: decision.confidence,
      categories: decision.categories,
      reason: result.reason,
      provider: result.provider || provider.name || '',
      model: result.model || provider.model || '',
      usage: result.usage || null,
      reviewedAt: new Date(now())
    };
  }

  return { review, imageUrlsFor };
}

module.exports = { safeTempFileUrl, createCommentModerationService };
