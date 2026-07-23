const {
  ANALYSIS_SCHEMA,
  BATCH_ANALYSIS_SCHEMA,
  DIGEST_SCHEMA,
  COLUMN_CASE_SCHEMA,
  COMMENT_MODERATION_SCHEMA,
  SOURCE_PREVIEW_REVIEW_SCHEMA,
  assertSchema,
  normalizeAnalysisResult,
  normalizeAnalysisBatch,
  normalizeDigestResult,
  normalizeColumnCaseResult,
  normalizeCommentModeration,
  normalizeSourcePreviewReview
} = require('./intelligence-contracts');
const {
  ANALYSIS_INSTRUCTIONS,
  DIGEST_INSTRUCTIONS,
  COLUMN_CASE_INSTRUCTIONS,
  COMMENT_MODERATION_INSTRUCTIONS,
  PROFILE_MODERATION_INSTRUCTIONS,
  SOURCE_PREVIEW_REVIEW_INSTRUCTIONS
} = require('./intelligence-prompts');

function providerError(code, status = 0) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function readResponseText(response, maxBytes = 512 * 1024) {
  const limit = Math.max(1, Number(maxBytes) || 512 * 1024);
  const declaredLength = Number(response
    && response.headers
    && typeof response.headers.get === 'function'
    && response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw providerError('INTELLIGENCE_RESPONSE_TOO_LARGE', response.status);
  }

  if (response && response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        size += chunk.byteLength;
        if (size > limit) {
          if (typeof reader.cancel === 'function') await reader.cancel().catch(() => {});
          throw providerError('INTELLIGENCE_RESPONSE_TOO_LARGE', response.status);
        }
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      if (typeof reader.releaseLock === 'function') reader.releaseLock();
    }
  }

  const text = await response.text();
  if (Buffer.byteLength(String(text || ''), 'utf8') > limit) {
    throw providerError('INTELLIGENCE_RESPONSE_TOO_LARGE', response.status);
  }
  return text;
}

function responseText(document) {
  const parts = [];
  for (const item of (Array.isArray(document && document.output) ? document.output : [])) {
    for (const content of (Array.isArray(item && item.content) ? item.content : [])) {
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('').trim();
}

function usageFrom(document) {
  const usage = document && document.usage || {};
  return {
    inputTokens: Math.max(0, Number(usage.input_tokens) || 0),
    outputTokens: Math.max(0, Number(usage.output_tokens) || 0),
    reasoningTokens: Math.max(
      0,
      Number(usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens) || 0
    ),
    totalTokens: Math.max(0, Number(usage.total_tokens) || 0),
    costUsdTicks: Math.max(0, Number(usage.cost_in_usd_ticks) || 0)
  };
}

function usageShare(usage, index, size) {
  const result = {};
  for (const key of [
    'inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'costUsdTicks'
  ]) {
    const total = Math.max(0, Math.floor(Number(usage && usage[key]) || 0));
    result[key] = Math.floor(total / size) + (index < (total % size) ? 1 : 0);
  }
  return result;
}

function deadlineTimeout(configuredTimeoutMs, deadlineAt) {
  const configured = Math.max(1, Number(configuredTimeoutMs) || 1);
  const deadline = Number(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= 0) return configured;
  return Math.max(1, Math.min(configured, deadline - Date.now()));
}

function compactDigestItem(item) {
  return {
    id: item.id,
    title: item.title || '',
    summary: item.summary || '',
    source: item.source || '',
    publishedAt: item.publishedAt || null,
    channelKey: item.channelKey || '',
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : [],
    curationScore: Number(item.curationScore) || 0,
    curationReason: item.curationReason || ''
  };
}

function createPackyIntelligenceProvider({
  apiKey,
  baseUrl,
  model,
  reasoningEffort = 'low',
  timeoutMs = 90000,
  moderationTimeoutMs = timeoutMs,
  sourcePreviewReviewTimeoutMs = timeoutMs,
  analysisMaxOutputTokens = 1800,
  analysisBatchMaxOutputTokens = 3600,
  digestMaxOutputTokens = 3600,
  columnCaseMaxOutputTokens = 2800,
  sourcePreviewReviewMaxOutputTokens = 300,
  responseMaxBytes = 512 * 1024,
  fetchImpl = globalThis.fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  const endpoint = normalizedBaseUrl(baseUrl);
  if (!apiKey || !endpoint || !model || typeof fetchImpl !== 'function') {
    throw providerError('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
  }

  async function requestStructured({
    instructions,
    payload,
    schema,
    schemaName,
    maxOutputTokens,
    imageUrls = [],
    operationTimeoutMs = timeoutMs
  }) {
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), operationTimeoutMs);
    let response;
    let responseBody;
    try {
      response = await fetchImpl(`${endpoint}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: reasoningEffort },
          input: imageUrls.length
            ? [{
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: `${instructions.trim()}\n\n<untrusted_input>\n${JSON.stringify(payload)}\n</untrusted_input>`
                  },
                  ...imageUrls.slice(0, 3).map((imageUrl) => ({
                    type: 'input_image',
                    image_url: imageUrl
                  }))
                ]
              }]
            : `${instructions.trim()}\n\n<untrusted_input>\n${JSON.stringify(payload)}\n</untrusted_input>`,
          max_output_tokens: maxOutputTokens,
          text: {
            format: {
              type: 'json_schema',
              name: schemaName,
              strict: true,
              schema
            }
          }
        }),
        signal: controller.signal
      });
      try {
        responseBody = await readResponseText(response, responseMaxBytes);
      } catch (error) {
        if (error && error.code === 'INTELLIGENCE_RESPONSE_TOO_LARGE') throw error;
        if (error && error.name === 'AbortError') throw error;
        throw providerError('INTELLIGENCE_RESPONSE_INVALID', response.status);
      }
    } catch (error) {
      if (error && /^INTELLIGENCE_[A-Z0-9_]+$/.test(error.code || '')) throw error;
      if (error && error.name === 'AbortError') {
        throw providerError('INTELLIGENCE_TIMEOUT');
      }
      throw providerError('INTELLIGENCE_NETWORK_FAILURE');
    } finally {
      clearTimeoutImpl(timeout);
    }

    let document;
    try {
      document = JSON.parse(responseBody);
    } catch (error) {
      throw providerError('INTELLIGENCE_RESPONSE_INVALID', response.status);
    }
    if (!response.ok || document.error) {
      if (response.status === 429) throw providerError('INTELLIGENCE_RATE_LIMITED', 429);
      if ([401, 403].includes(response.status)) {
        throw providerError('INTELLIGENCE_AUTH_FAILED', response.status);
      }
      throw providerError('INTELLIGENCE_UPSTREAM_FAILURE', response.status);
    }
    const output = responseText(document);
    if (!output) throw providerError('INTELLIGENCE_RESPONSE_EMPTY', response.status);
    try {
      const value = JSON.parse(output);
      assertSchema(value, schema);
      return {
        value,
        model: document.model || model,
        usage: usageFrom(document)
      };
    } catch (error) {
      throw providerError('INTELLIGENCE_OUTPUT_INVALID', response.status);
    }
  }

  async function analyzeItem(item) {
    const response = await requestStructured({
      instructions: ANALYSIS_INSTRUCTIONS,
      payload: item,
      schema: ANALYSIS_SCHEMA,
      schemaName: 'knowledge_feed_analysis',
      maxOutputTokens: analysisMaxOutputTokens
    });
    return {
      ...normalizeAnalysisResult(response.value),
      provider: 'packy',
      model: response.model,
      usage: response.usage
    };
  }

  async function analyzeItems(items) {
    const candidates = (Array.isArray(items) ? items : [])
      .filter((item) => item && typeof item.itemId === 'string')
      .slice(0, 5);
    if (!candidates.length) throw providerError('INTELLIGENCE_BATCH_EMPTY');
    const response = await requestStructured({
      instructions: `${ANALYSIS_INSTRUCTIONS}\n请逐条分析 items，原样返回每条 itemId，不得遗漏或增加条目。`,
      payload: { items: candidates },
      schema: BATCH_ANALYSIS_SCHEMA,
      schemaName: 'knowledge_feed_analysis_batch',
      maxOutputTokens: analysisBatchMaxOutputTokens
    });
    return normalizeAnalysisBatch(
      response.value,
      candidates.map((item) => item.itemId)
    ).map((result, index) => ({
      ...result,
      provider: 'packy',
      model: response.model,
      usage: usageShare(response.usage, index, candidates.length)
    }));
  }

  async function generateDigest(window, items, previousDigest = null) {
    const candidates = (Array.isArray(items) ? items : []).map(compactDigestItem);
    const response = await requestStructured({
      instructions: DIGEST_INSTRUCTIONS,
      payload: {
        window,
        previousExecutiveSummary: previousDigest && previousDigest.executiveSummary || '',
        items: candidates
      },
      schema: DIGEST_SCHEMA,
      schemaName: 'knowledge_feed_digest',
      maxOutputTokens: digestMaxOutputTokens
    });
    return {
      ...normalizeDigestResult(response.value, candidates.map((item) => item.id)),
      provider: 'packy',
      model: response.model,
      usage: response.usage
    };
  }

  async function generateColumnCase(context, items) {
    const candidates = (Array.isArray(items) ? items : []).map(compactDigestItem);
    const response = await requestStructured({
      instructions: COLUMN_CASE_INSTRUCTIONS,
      payload: { context, items: candidates },
      schema: COLUMN_CASE_SCHEMA,
      schemaName: 'knowledge_column_case',
      maxOutputTokens: columnCaseMaxOutputTokens
    });
    return {
      ...normalizeColumnCaseResult(response.value, {
        allowedItemIds: candidates.map((item) => item.id),
        allowedDossierKeys: context && context.allowedDossierKeys,
        allowedLessonIds: context && context.allowedLessonIds
      }),
      provider: 'packy', model: response.model, usage: response.usage
    };
  }

  async function moderateComment({ content = '', imageUrls = [] } = {}) {
    const images = (Array.isArray(imageUrls) ? imageUrls : [])
      .filter((value) => typeof value === 'string' && /^(https:\/\/|data:image\/)/i.test(value))
      .slice(0, 3);
    const response = await requestStructured({
      instructions: COMMENT_MODERATION_INSTRUCTIONS,
      payload: { content: String(content || '').slice(0, 280), imageCount: images.length },
      imageUrls: images,
      schema: COMMENT_MODERATION_SCHEMA,
      schemaName: 'knowledge_comment_moderation',
      maxOutputTokens: 450,
      operationTimeoutMs: moderationTimeoutMs
    });
    return {
      ...normalizeCommentModeration(response.value),
      provider: 'packy',
      model: response.model,
      usage: response.usage
    };
  }

  async function moderateProfile({ nickname = '', avatarUrl = '' } = {}) {
    const images = typeof avatarUrl === 'string' && /^(https:\/\/|data:image\/)/i.test(avatarUrl)
      ? [avatarUrl]
      : [];
    const response = await requestStructured({
      instructions: PROFILE_MODERATION_INSTRUCTIONS,
      payload: { nickname: String(nickname || '').slice(0, 24), hasAvatar: images.length === 1 },
      imageUrls: images,
      schema: COMMENT_MODERATION_SCHEMA,
      schemaName: 'knowledge_profile_moderation',
      maxOutputTokens: 450,
      operationTimeoutMs: moderationTimeoutMs
    });
    return {
      ...normalizeCommentModeration(response.value),
      provider: 'packy',
      model: response.model,
      usage: response.usage
    };
  }

  async function reviewSourcePreview({
    item = {}, rendererQuality = {}, imageUrls = [], reviewDeadlineAt = 0
  } = {}) {
    const images = (Array.isArray(imageUrls) ? imageUrls : [])
      .filter((value) => typeof value === 'string' && /^(https:\/\/|data:image\/)/i.test(value))
      .slice(0, 3);
    if (!images.length) throw providerError('INTELLIGENCE_IMAGE_REQUIRED');
    const response = await requestStructured({
      instructions: SOURCE_PREVIEW_REVIEW_INSTRUCTIONS,
      payload: { item, rendererQuality, imageCount: images.length },
      imageUrls: images,
      schema: SOURCE_PREVIEW_REVIEW_SCHEMA,
      schemaName: 'knowledge_source_preview_review',
      maxOutputTokens: sourcePreviewReviewMaxOutputTokens,
      operationTimeoutMs: deadlineTimeout(sourcePreviewReviewTimeoutMs, reviewDeadlineAt)
    });
    return {
      ...normalizeSourcePreviewReview(response.value),
      provider: 'packy', model: response.model, usage: response.usage
    };
  }

  return Object.freeze({
    name: 'packy-grok',
    enabled: true,
    model,
    analyzeItem,
    analyzeItems,
    generateDigest,
    generateColumnCase,
    moderateComment,
    moderateProfile,
    reviewSourcePreview
  });
}

module.exports = {
  responseText,
  readResponseText,
  usageFrom,
  usageShare,
  deadlineTimeout,
  createPackyIntelligenceProvider
};
