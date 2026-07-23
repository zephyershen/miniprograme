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

function errorStatus(error) {
  const candidates = [
    error && error.status,
    error && error.statusCode,
    error && error.response && error.response.status
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const message = String(error && (error.message || error.errMsg) || '');
  const match = message.match(/(?:status|code)\D{0,4}(\d{3})/i);
  return match ? Number(match[1]) : 0;
}

function normalizeCloudbaseError(error) {
  if (error && /^INTELLIGENCE_[A-Z0-9_]+$/.test(error.code || '')) return error;
  const status = errorStatus(error);
  const code = String(error && (error.code || error.errCode) || '');
  const message = String(error && (error.message || error.errMsg) || '');
  if (status === 429 || /429|rate.?limit|throttl|frequency/i.test(`${code} ${message}`)) {
    return providerError('INTELLIGENCE_RATE_LIMITED', 429);
  }
  if (status >= 500) return providerError('INTELLIGENCE_UPSTREAM_FAILURE', status);
  if (/timeout|timed.?out|abort/i.test(`${code} ${message}`)) {
    return providerError('INTELLIGENCE_TIMEOUT', status);
  }
  if ([401, 403].includes(status) || /unauthorized|forbidden|permission/i.test(`${code} ${message}`)) {
    return providerError('INTELLIGENCE_AUTH_FAILED', status);
  }
  return providerError('INTELLIGENCE_UPSTREAM_FAILURE', status);
}

function cleanJsonText(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function parseStrictJson(text, schema) {
  let value;
  try {
    value = JSON.parse(cleanJsonText(text));
  } catch (error) {
    throw providerError('INTELLIGENCE_OUTPUT_INVALID');
  }
  assertSchema(value, schema);
  return value;
}

function usageFrom(value = {}) {
  return {
    inputTokens: Math.max(0, Number(value.prompt_tokens ?? value.input_tokens) || 0),
    outputTokens: Math.max(0, Number(value.completion_tokens ?? value.output_tokens) || 0),
    reasoningTokens: Math.max(0, Number(
      value.completion_tokens_details && value.completion_tokens_details.reasoning_tokens
    ) || 0),
    totalTokens: Math.max(0, Number(value.total_tokens) || 0)
  };
}

function usageShare(usage, index, size) {
  const result = {};
  for (const key of [
    'inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens',
    'resourcePointsEstimate'
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

function multimodalUserMessage(text, imageUrls) {
  if (!imageUrls.length) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
    ]
  };
}

function createCloudbaseIntelligenceProvider({
  ai,
  budgetService,
  modelGroup = 'cloudbase',
  analysisModel = 'qwen3.5-flash',
  digestModel = 'qwen3.5-plus',
  moderationTextModel = 'qwen3.5-flash',
  moderationImageModel = 'qwen3.5-plus',
  timeoutMs = 60000,
  analysisTimeoutMs = timeoutMs,
  digestTimeoutMs = timeoutMs,
  moderationTimeoutMs = timeoutMs,
  sourcePreviewReviewTimeoutMs = timeoutMs,
  analysisMaxOutputTokens = 1800,
  analysisBatchMaxOutputTokens = 3600,
  digestMaxOutputTokens = 3600,
  columnCaseMaxOutputTokens = 2800,
  sourcePreviewReviewMaxOutputTokens = 300,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  if (!ai || typeof ai.createModel !== 'function' || !budgetService) {
    throw providerError('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
  }
  const modelClient = ai.createModel(modelGroup);
  if (!modelClient || typeof modelClient.generateText !== 'function') {
    throw providerError('INTELLIGENCE_PROVIDER_CONFIG_INVALID');
  }

  async function requestStructured({
    task,
    model,
    instructions,
    payload,
    schema,
    maxOutputTokens,
    imageUrls = [],
    operationTimeoutMs = timeoutMs
  }) {
    const inputText = `${instructions.trim()}\n\n只返回一个符合以下 JSON Schema 的 JSON 对象，不要输出解释或 Markdown：\n${JSON.stringify(schema)}\n\n<untrusted_input>\n${JSON.stringify(payload)}\n</untrusted_input>`;
    const messages = [
      { role: 'system', content: instructions.trim() },
      multimodalUserMessage(inputText, imageUrls.slice(0, 3))
    ];
    let reservation;
    try {
      reservation = await budgetService.reserve({
        task,
        model,
        // Image bytes are accounted for by imageCount. Keeping data URLs out
        // of the budget input prevents conservative base64 byte counting from
        // charging the same image twice while the actual request stays intact.
        input: inputText,
        maxOutputTokens,
        imageCount: imageUrls.slice(0, 3).length
      });
    } catch (error) {
      throw providerError('INTELLIGENCE_BUDGET_UNAVAILABLE');
    }
    if (!reservation || reservation.allowed !== true) {
      throw providerError('INTELLIGENCE_PRIMARY_BUDGET_EXHAUSTED');
    }

    let timeout;
    let requestStarted = false;
    try {
      const request = modelClient.generateText({
        model,
        messages,
        temperature: 0.1,
        max_tokens: maxOutputTokens
      }, { timeout: operationTimeoutMs });
      requestStarted = true;
      const result = await Promise.race([
        request,
        new Promise((resolve, reject) => {
          timeout = setTimeoutImpl(
            () => reject(providerError('INTELLIGENCE_TIMEOUT')),
            operationTimeoutMs
          );
        })
      ]);
      if (!result || result.error) {
        throw normalizeCloudbaseError(result && result.error || new Error('empty result'));
      }
      const value = parseStrictJson(result.text, schema);
      const usage = await budgetService.commit(reservation, usageFrom(result.usage));
      return { value, model, usage };
    } catch (error) {
      const normalized = normalizeCloudbaseError(error);
      const definitelyUnbilled = !requestStarted || [
        'INTELLIGENCE_AUTH_FAILED',
        'INTELLIGENCE_RATE_LIMITED'
      ].includes(normalized.code);
      if (definitelyUnbilled) {
        await budgetService.release(reservation).catch(() => null);
      }
      // Keep the conservative reservation for timeouts, 5xx responses and
      // malformed model output because upstream may already have billed them.
      throw normalized;
    } finally {
      if (timeout) clearTimeoutImpl(timeout);
    }
  }

  async function analyzeItem(item) {
    const response = await requestStructured({
      task: 'analysis', model: analysisModel,
      instructions: ANALYSIS_INSTRUCTIONS, payload: item,
      schema: ANALYSIS_SCHEMA, maxOutputTokens: analysisMaxOutputTokens,
      operationTimeoutMs: analysisTimeoutMs
    });
    return {
      ...normalizeAnalysisResult(response.value),
      provider: 'cloudbase', model: response.model, usage: response.usage
    };
  }

  async function analyzeItems(items) {
    const candidates = (Array.isArray(items) ? items : [])
      .filter((item) => item && typeof item.itemId === 'string')
      .slice(0, 5);
    if (!candidates.length) throw providerError('INTELLIGENCE_BATCH_EMPTY');
    const response = await requestStructured({
      task: 'analysis', model: analysisModel,
      instructions: `${ANALYSIS_INSTRUCTIONS}\n请逐条分析 items，原样返回每条 itemId，不得遗漏或增加条目。`,
      payload: { items: candidates }, schema: BATCH_ANALYSIS_SCHEMA,
      maxOutputTokens: analysisBatchMaxOutputTokens,
      operationTimeoutMs: analysisTimeoutMs
    });
    return normalizeAnalysisBatch(
      response.value,
      candidates.map((item) => item.itemId)
    ).map((result, index) => ({
      ...result,
      provider: 'cloudbase',
      model: response.model,
      usage: usageShare(response.usage, index, candidates.length)
    }));
  }

  async function generateDigest(window, items, previousDigest = null) {
    const candidates = (Array.isArray(items) ? items : []).map(compactDigestItem);
    const response = await requestStructured({
      task: 'digest', model: digestModel,
      instructions: DIGEST_INSTRUCTIONS,
      payload: {
        window,
        previousExecutiveSummary: previousDigest && previousDigest.executiveSummary || '',
        items: candidates
      },
      schema: DIGEST_SCHEMA,
      maxOutputTokens: digestMaxOutputTokens,
      operationTimeoutMs: digestTimeoutMs
    });
    return {
      ...normalizeDigestResult(response.value, candidates.map((item) => item.id)),
      provider: 'cloudbase', model: response.model, usage: response.usage
    };
  }

  async function generateColumnCase(context, items) {
    const candidates = (Array.isArray(items) ? items : []).map(compactDigestItem);
    const response = await requestStructured({
      task: 'column-case', model: digestModel,
      instructions: COLUMN_CASE_INSTRUCTIONS,
      payload: { context, items: candidates },
      schema: COLUMN_CASE_SCHEMA,
      maxOutputTokens: columnCaseMaxOutputTokens,
      operationTimeoutMs: digestTimeoutMs
    });
    return {
      ...normalizeColumnCaseResult(response.value, {
        allowedItemIds: candidates.map((item) => item.id),
        allowedDossierKeys: context && context.allowedDossierKeys,
        allowedLessonIds: context && context.allowedLessonIds
      }),
      provider: 'cloudbase', model: response.model, usage: response.usage
    };
  }

  async function moderateComment({ content = '', imageUrls = [] } = {}) {
    const images = (Array.isArray(imageUrls) ? imageUrls : [])
      .filter((value) => typeof value === 'string' && /^(https:\/\/|data:image\/)/i.test(value))
      .slice(0, 3);
    const response = await requestStructured({
      task: images.length ? 'image-moderation' : 'text-moderation',
      model: images.length ? moderationImageModel : moderationTextModel,
      instructions: COMMENT_MODERATION_INSTRUCTIONS,
      payload: { content: String(content || '').slice(0, 280), imageCount: images.length },
      imageUrls: images,
      schema: COMMENT_MODERATION_SCHEMA,
      maxOutputTokens: 450,
      operationTimeoutMs: moderationTimeoutMs
    });
    return {
      ...normalizeCommentModeration(response.value),
      provider: 'cloudbase', model: response.model, usage: response.usage
    };
  }

  async function moderateProfile({ nickname = '', avatarUrl = '' } = {}) {
    const images = typeof avatarUrl === 'string' && /^(https:\/\/|data:image\/)/i.test(avatarUrl)
      ? [avatarUrl]
      : [];
    const response = await requestStructured({
      task: images.length ? 'image-moderation' : 'text-moderation',
      model: images.length ? moderationImageModel : moderationTextModel,
      instructions: PROFILE_MODERATION_INSTRUCTIONS,
      payload: { nickname: String(nickname || '').slice(0, 24), hasAvatar: images.length === 1 },
      imageUrls: images,
      schema: COMMENT_MODERATION_SCHEMA,
      maxOutputTokens: 450,
      operationTimeoutMs: moderationTimeoutMs
    });
    return {
      ...normalizeCommentModeration(response.value),
      provider: 'cloudbase', model: response.model, usage: response.usage
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
      task: 'source-preview-review',
      model: moderationImageModel,
      instructions: SOURCE_PREVIEW_REVIEW_INSTRUCTIONS,
      payload: { item, rendererQuality, imageCount: images.length },
      imageUrls: images,
      schema: SOURCE_PREVIEW_REVIEW_SCHEMA,
      maxOutputTokens: sourcePreviewReviewMaxOutputTokens,
      operationTimeoutMs: deadlineTimeout(sourcePreviewReviewTimeoutMs, reviewDeadlineAt)
    });
    return {
      ...normalizeSourcePreviewReview(response.value),
      provider: 'cloudbase', model: response.model, usage: response.usage
    };
  }

  return Object.freeze({
    name: 'cloudbase-managed',
    enabled: true,
    model: analysisModel,
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
  providerError,
  errorStatus,
  normalizeCloudbaseError,
  cleanJsonText,
  parseStrictJson,
  usageFrom,
  usageShare,
  deadlineTimeout,
  multimodalUserMessage,
  createCloudbaseIntelligenceProvider
};
