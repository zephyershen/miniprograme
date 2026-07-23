const jpeg = require('jpeg-js');

const RENDERER_QUALITY_FIELDS = Object.freeze([
  'policyVersion',
  'verdict',
  'targetMatched',
  'reviewRequired',
  'reasonCode'
]);
const RENDERER_VERDICTS = new Set(['accept', 'reject', 'retry', 'unsure']);

function previewReviewError(code, audit = null) {
  const error = new Error(code);
  error.code = code;
  if (audit) error.previewQualityAudit = audit;
  return error;
}

function normalizedReasonCode(value, fallback = 'UNSPECIFIED') {
  const normalized = String(value || '').trim().toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function assertRendererQuality(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw previewReviewError('PREVIEW_QUALITY_CONTRACT_INVALID');
  }
  const keys = Object.keys(value);
  if (keys.length !== RENDERER_QUALITY_FIELDS.length
    || keys.some((key) => !RENDERER_QUALITY_FIELDS.includes(key))
    || !Number.isInteger(value.policyVersion)
    || value.policyVersion < 1
    || !RENDERER_VERDICTS.has(value.verdict)
    || typeof value.targetMatched !== 'boolean'
    || typeof value.reviewRequired !== 'boolean'
    || typeof value.reasonCode !== 'string'
    || !value.reasonCode.trim()
    || value.reasonCode.length > 64) {
    throw previewReviewError('PREVIEW_QUALITY_CONTRACT_INVALID');
  }
  return {
    policyVersion: value.policyVersion,
    verdict: value.verdict,
    targetMatched: value.targetMatched,
    reviewRequired: value.reviewRequired,
    reasonCode: normalizedReasonCode(value.reasonCode)
  };
}

function compactReviewItem(item = {}, finalUrl = '') {
  return {
    id: String(item.id || '').slice(0, 80),
    title: String(item.title || '').slice(0, 240),
    titleEn: String(item.titleEn || '').slice(0, 240),
    summary: String(item.summary || '').slice(0, 600),
    source: String(item.source || '').slice(0, 120),
    url: String(item.url || '').slice(0, 1200),
    finalUrl: String(finalUrl || '').slice(0, 1200)
  };
}

function redirectSignals(targetUrl, finalUrl) {
  try {
    const target = new URL(targetUrl);
    const final = new URL(finalUrl);
    return {
      redirected: target.href !== final.href,
      hostMatched: target.hostname.toLowerCase() === final.hostname.toLowerCase()
    };
  } catch (error) {
    return { redirected: false, hostMatched: false };
  }
}

function selectRepresentativeImages(images, maxImages = 1) {
  const candidates = (Array.isArray(images) ? images : []).filter(Buffer.isBuffer);
  const limit = Math.max(1, Math.min(3, Math.floor(Number(maxImages) || 1)));
  if (candidates.length <= limit) return candidates;
  if (limit === 1) return [candidates[0]];
  return Array.from({ length: limit }, (_, index) => (
    candidates[Math.round(index * (candidates.length - 1) / (limit - 1))]
  ));
}

function inspectJpegVisualSignal(buffer, { maxSamples = 50000 } = {}) {
  let decoded;
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      tolerantDecoding: true,
      maxMemoryUsageInMB: 64,
      maxResolutionInMP: 5
    });
  } catch (error) {
    throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_INVALID');
  }
  if (!decoded || !decoded.data || !decoded.width || !decoded.height) {
    throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_INVALID');
  }
  const pixelCount = decoded.width * decoded.height;
  const step = Math.max(1, Math.floor(pixelCount / Math.max(1000, Number(maxSamples) || 50000)));
  let count = 0;
  let luminanceSum = 0;
  let squaredLuminanceSum = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    const luminance = (0.2126 * decoded.data[offset])
      + (0.7152 * decoded.data[offset + 1])
      + (0.0722 * decoded.data[offset + 2]);
    count += 1;
    luminanceSum += luminance;
    squaredLuminanceSum += luminance * luminance;
  }
  const meanLuminance = count ? luminanceSum / count : 0;
  const variance = count
    ? Math.max(0, (squaredLuminanceSum / count) - (meanLuminance * meanLuminance))
    : 0;
  return {
    width: decoded.width,
    height: decoded.height,
    meanLuminance,
    luminanceDeviation: Math.sqrt(variance)
  };
}

function resizeRgbaNearest(source, sourceWidth, sourceHeight, width, height) {
  if (sourceWidth === width && sourceHeight === height) return source;
  const target = Buffer.allocUnsafe(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width));
      const sourceOffset = ((sourceY * sourceWidth) + sourceX) * 4;
      const targetOffset = ((y * width) + x) * 4;
      target[targetOffset] = source[sourceOffset];
      target[targetOffset + 1] = source[sourceOffset + 1];
      target[targetOffset + 2] = source[sourceOffset + 2];
      target[targetOffset + 3] = source[sourceOffset + 3];
    }
  }
  return target;
}

function resizeRepresentativeJpeg(buffer, {
  maxWidth = 720,
  maxHeight = 900,
  maxBytes = 320 * 1024,
  quality = 60
} = {}) {
  let decoded;
  try {
    decoded = jpeg.decode(buffer, {
      useTArray: true,
      tolerantDecoding: true,
      maxMemoryUsageInMB: 64,
      maxResolutionInMP: 5
    });
  } catch (error) {
    throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_INVALID');
  }
  if (!decoded || !decoded.data || !decoded.width || !decoded.height) {
    throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_INVALID');
  }
  const widthLimit = Math.max(320, Math.min(1080, Math.floor(Number(maxWidth) || 720)));
  const heightLimit = Math.max(400, Math.min(1350, Math.floor(Number(maxHeight) || 900)));
  const byteLimit = Math.max(64 * 1024, Math.floor(Number(maxBytes) || 320 * 1024));
  const baseScale = Math.min(1, widthLimit / decoded.width, heightLimit / decoded.height);
  const attempts = [
    { scale: baseScale, quality: Math.max(35, Math.min(75, Number(quality) || 60)) },
    { scale: baseScale * 0.82, quality: 52 },
    { scale: baseScale * 0.68, quality: 44 }
  ];
  let smallest = null;
  for (const attempt of attempts) {
    const width = Math.max(240, Math.round(decoded.width * attempt.scale));
    const height = Math.max(300, Math.round(decoded.height * attempt.scale));
    const data = resizeRgbaNearest(decoded.data, decoded.width, decoded.height, width, height);
    const encoded = Buffer.from(jpeg.encode({ data, width, height }, attempt.quality).data);
    smallest = encoded;
    if (encoded.length <= byteLimit) return encoded;
  }
  if (smallest && smallest.length <= byteLimit) return smallest;
  throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_TOO_LARGE');
}

function reviewedAtValue(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function createSourcePreviewReviewService({
  provider,
  minConfidence = 0.9,
  maxImages = 1,
  reviewDeadlineMs = 210 * 1000,
  imageMaxWidth = 720,
  imageMaxHeight = 900,
  imageMaxBytes = 320 * 1024,
  imageQuality = 60,
  deterministicFastPathMinBytes = 12 * 1024,
  now = () => new Date(),
  clock = () => Date.now()
} = {}) {
  const threshold = Math.max(0.5, Math.min(1, Number(minConfidence) || 0.9));

  function baseAudit(quality) {
    return {
      policyVersion: quality.policyVersion,
      verdict: quality.verdict,
      targetMatched: quality.targetMatched,
      reviewRequired: quality.reviewRequired,
      reasonCode: quality.reasonCode,
      confidence: quality.reviewRequired ? 0 : 1,
      reviewer: quality.reviewRequired ? 'ai' : 'deterministic',
      provider: quality.reviewRequired ? String(provider && provider.name || '').slice(0, 64) : 'renderer',
      model: quality.reviewRequired ? String(provider && provider.model || '').slice(0, 80) : '',
      reviewedAt: reviewedAtValue(now)
    };
  }

  async function review({ item, rendererQuality, images, finalUrl = '' } = {}) {
    const rendererQualityProof = assertRendererQuality(rendererQuality);
    let quality = rendererQualityProof;
    let rendererAudit = {
      ...baseAudit(quality),
      ...redirectSignals(item && item.url, finalUrl)
    };
    if (quality.verdict !== 'accept') {
      throw previewReviewError('PREVIEW_RENDERER_REJECTED', rendererAudit);
    }
    if (!quality.reviewRequired) {
      if (quality.targetMatched !== true) {
        throw previewReviewError('PREVIEW_RENDERER_TARGET_UNCONFIRMED', rendererAudit);
      }
      const representative = selectRepresentativeImages(images, 1)[0];
      if (!representative) {
        throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_MISSING', {
          ...rendererAudit,
          verdict: 'unsure',
          reasonCode: 'REVIEW_IMAGE_MISSING'
        });
      }
      let visualSignal;
      try {
        visualSignal = inspectJpegVisualSignal(representative);
      } catch (error) {
        error.previewQualityAudit = {
          ...rendererAudit,
          verdict: 'unsure',
          reasonCode: normalizedReasonCode(error && error.code, 'REVIEW_IMAGE_INVALID')
        };
        throw error;
      }
      if (visualSignal.luminanceDeviation < 4) {
        throw previewReviewError('PREVIEW_VISUALLY_BLANK', {
          ...rendererAudit,
          verdict: 'reject',
          reasonCode: 'VISUALLY_BLANK_CAPTURE'
        });
      }
      const minimumFastPathBytes = Math.max(
        8 * 1024,
        Math.floor(Number(deterministicFastPathMinBytes) || (12 * 1024))
      );
      if (representative.length >= minimumFastPathBytes) return rendererAudit;
      quality = {
        ...quality,
        reviewRequired: true,
        reasonCode: 'SPARSE_CAPTURE_REQUIRES_AI'
      };
      rendererAudit = {
        ...baseAudit(quality),
        ...redirectSignals(item && item.url, finalUrl)
      };
    }

    if (!provider || provider.enabled !== true || typeof provider.reviewSourcePreview !== 'function') {
      throw previewReviewError('PREVIEW_AI_REVIEW_UNAVAILABLE', {
        ...rendererAudit,
        verdict: 'unsure',
        reasonCode: 'AI_REVIEW_UNAVAILABLE'
      });
    }
    let representatives;
    try {
      representatives = selectRepresentativeImages(images, maxImages)
        .map((image) => resizeRepresentativeJpeg(image, {
          maxWidth: imageMaxWidth,
          maxHeight: imageMaxHeight,
          maxBytes: imageMaxBytes,
          quality: imageQuality
        }));
    } catch (error) {
      error.previewQualityAudit = {
        ...rendererAudit,
        verdict: 'unsure',
        reasonCode: normalizedReasonCode(error && error.code, 'REVIEW_IMAGE_INVALID')
      };
      throw error;
    }
    if (!representatives.length) {
      throw previewReviewError('PREVIEW_AI_REVIEW_IMAGE_MISSING', {
        ...rendererAudit,
        verdict: 'unsure',
        reasonCode: 'REVIEW_IMAGE_MISSING'
      });
    }

    let result;
    try {
      result = await provider.reviewSourcePreview({
        item: compactReviewItem(item, finalUrl),
        rendererQuality: quality,
        reviewDeadlineAt: clock() + Math.max(1000, Number(reviewDeadlineMs) || 210 * 1000),
        imageUrls: representatives.map((buffer) => (
          `data:image/jpeg;base64,${buffer.toString('base64')}`
        ))
      });
    } catch (error) {
      const timedOut = String(error && (error.code || error.message) || '') === 'INTELLIGENCE_TIMEOUT';
      throw previewReviewError(
        timedOut ? 'PREVIEW_AI_REVIEW_TIMEOUT' : 'PREVIEW_AI_REVIEW_FAILED',
        {
          ...rendererAudit,
          verdict: 'unsure',
          reasonCode: timedOut ? 'AI_REVIEW_TIMEOUT' : 'AI_REVIEW_FAILED'
        }
      );
    }

    const confidence = Math.max(0, Math.min(1, Number(result && result.confidence) || 0));
    const audit = {
      ...rendererAudit,
      verdict: ['accept', 'reject', 'retry', 'unsure'].includes(result && result.verdict)
        ? result.verdict
        : 'unsure',
      targetMatched: result && result.targetMatched === true,
      reasonCode: normalizedReasonCode(result && result.reasonCode),
      confidence: Math.round(confidence * 1000) / 1000,
      provider: String(result && result.provider || provider.name || '').slice(0, 64),
      model: String(result && result.model || provider.model || '').slice(0, 80)
    };
    if (audit.verdict !== 'accept') {
      throw previewReviewError(`PREVIEW_AI_REVIEW_${audit.verdict.toUpperCase()}`, audit);
    }
    if (!audit.targetMatched) {
      throw previewReviewError('PREVIEW_AI_REVIEW_TARGET_MISMATCH', audit);
    }
    if (audit.confidence < threshold) {
      throw previewReviewError('PREVIEW_AI_REVIEW_LOW_CONFIDENCE', audit);
    }
    return audit;
  }

  return Object.freeze({ review });
}

module.exports = {
  RENDERER_QUALITY_FIELDS,
  assertRendererQuality,
  compactReviewItem,
  redirectSignals,
  selectRepresentativeImages,
  inspectJpegVisualSignal,
  resizeRepresentativeJpeg,
  previewReviewError,
  createSourcePreviewReviewService
};
