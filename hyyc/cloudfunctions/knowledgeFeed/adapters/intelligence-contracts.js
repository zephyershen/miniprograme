const ANALYSIS_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    signals: {
      type: 'object',
      properties: {
        importance: { type: 'number', minimum: 0, maximum: 100 },
        novelty: { type: 'number', minimum: 0, maximum: 100 },
        sourceTrust: { type: 'number', minimum: 0, maximum: 100 },
        evidence: { type: 'number', minimum: 0, maximum: 100 },
        actionability: { type: 'number', minimum: 0, maximum: 100 },
        duplicatePenalty: { type: 'number', minimum: 0, maximum: 100 }
      },
      required: [
        'importance', 'novelty', 'sourceTrust',
        'evidence', 'actionability', 'duplicatePenalty'
      ],
      additionalProperties: false
    },
    noise: { type: 'boolean' },
    duplicate: { type: 'boolean' },
    shortReason: { type: 'string', maxLength: 80 },
    reasonCodes: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      maxItems: 8
    },
    companyKeys: {
      type: 'array',
      items: { type: 'string', maxLength: 80 },
      maxItems: 12
    },
    directionKeys: {
      type: 'array',
      items: { type: 'string', maxLength: 80 },
      maxItems: 12
    }
  },
  required: [
    'signals', 'noise', 'duplicate', 'shortReason',
    'reasonCodes', 'companyKeys', 'directionKeys'
  ],
  additionalProperties: false
});

const BATCH_ANALYSIS_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    analyses: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string', maxLength: 80 },
          ...ANALYSIS_SCHEMA.properties
        },
        required: ['itemId', ...ANALYSIS_SCHEMA.required],
        additionalProperties: false
      }
    }
  },
  required: ['analyses'],
  additionalProperties: false
});

const DIGEST_REFERENCE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 80 },
    copy: { type: 'string', maxLength: 220 },
    sourceItemIds: {
      type: 'array',
      items: { type: 'string', maxLength: 80 },
      minItems: 1,
      maxItems: 3
    },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      maxItems: 6
    }
  },
  required: ['title', 'copy', 'sourceItemIds', 'tags'],
  additionalProperties: false
});

const DIGEST_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    executiveSummary: { type: 'string', maxLength: 300 },
    mustKnow: {
      type: 'array', items: DIGEST_REFERENCE_SCHEMA, minItems: 1, maxItems: 5
    },
    radar: {
      type: 'array', items: DIGEST_REFERENCE_SCHEMA, maxItems: 8
    },
    followUps: {
      type: 'array', items: DIGEST_REFERENCE_SCHEMA, maxItems: 8
    }
  },
  required: ['executiveSummary', 'mustKnow', 'radar', 'followUps'],
  additionalProperties: false
});

const COLUMN_CASE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    publish: { type: 'boolean' },
    reason: { type: 'string', maxLength: 120 },
    title: { type: 'string', maxLength: 80 },
    conclusion: { type: 'string', maxLength: 220 },
    happened: { type: 'string', maxLength: 600 },
    impact: { type: 'string', maxLength: 600 },
    tryNow: {
      type: 'array',
      items: { type: 'string', maxLength: 140 },
      maxItems: 4
    },
    noNeedToWorry: { type: 'string', maxLength: 420 },
    dossierKey: { type: 'string', maxLength: 48 },
    relatedLessonIds: {
      type: 'array',
      items: { type: 'string', maxLength: 48 },
      maxItems: 3
    },
    sourceItemIds: {
      type: 'array',
      items: { type: 'string', maxLength: 80 },
      maxItems: 3
    }
  },
  required: [
    'publish', 'reason', 'title', 'conclusion', 'happened', 'impact',
    'tryNow', 'noNeedToWorry', 'dossierKey', 'relatedLessonIds', 'sourceItemIds'
  ],
  additionalProperties: false
});

const COMMENT_MODERATION_CATEGORIES = Object.freeze([
  'sexual',
  'violence',
  'hate',
  'harassment',
  'self_harm',
  'illegal',
  'privacy',
  'spam',
  'prompt_injection',
  'other'
]);

const COMMENT_MODERATION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['allow', 'reject', 'unsure'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    categories: {
      type: 'array',
      items: { type: 'string', enum: COMMENT_MODERATION_CATEGORIES },
      maxItems: 5
    },
    reason: { type: 'string', maxLength: 80 }
  },
  required: ['verdict', 'confidence', 'categories', 'reason'],
  additionalProperties: false
});

const SOURCE_PREVIEW_REVIEW_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['accept', 'reject', 'retry', 'unsure'] },
    targetMatched: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasonCode: {
      type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Z][A-Z0-9_]{0,63}$'
    }
  },
  required: ['verdict', 'targetMatched', 'confidence', 'reasonCode'],
  additionalProperties: false
});

function schemaError(path, message) {
  const error = new Error('INTELLIGENCE_OUTPUT_SCHEMA_INVALID');
  error.code = 'INTELLIGENCE_OUTPUT_SCHEMA_INVALID';
  error.path = path;
  error.reason = message;
  return error;
}

function assertSchema(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return value;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw schemaError(path, 'enum');
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw schemaError(path, 'object');
    }
    const properties = schema.properties || {};
    for (const key of (schema.required || [])) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw schemaError(`${path}.${key}`, 'required');
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          throw schemaError(`${path}.${key}`, 'additionalProperty');
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        assertSchema(value[key], childSchema, `${path}.${key}`);
      }
    }
    return value;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw schemaError(path, 'array');
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      throw schemaError(path, 'minItems');
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      throw schemaError(path, 'maxItems');
    }
    value.forEach((entry, index) => assertSchema(entry, schema.items, `${path}[${index}]`));
    return value;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw schemaError(path, 'string');
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
      throw schemaError(path, 'minLength');
    }
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
      throw schemaError(path, 'maxLength');
    }
    if (typeof schema.pattern === 'string' && !(new RegExp(schema.pattern)).test(value)) {
      throw schemaError(path, 'pattern');
    }
    return value;
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw schemaError(path, 'number');
    }
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      throw schemaError(path, 'minimum');
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      throw schemaError(path, 'maximum');
    }
    return value;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    throw schemaError(path, 'boolean');
  }
  return value;
}

function boundedScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function safeString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeStrings(values, maxItems, maxLength) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value, maxLength))
    .filter(Boolean))].slice(0, maxItems);
}

function normalizeAnalysisResult(value = {}) {
  const signals = value.signals || {};
  return {
    signals: {
      importance: boundedScore(signals.importance),
      novelty: boundedScore(signals.novelty),
      sourceTrust: boundedScore(signals.sourceTrust),
      evidence: boundedScore(signals.evidence),
      actionability: boundedScore(signals.actionability),
      duplicatePenalty: boundedScore(signals.duplicatePenalty)
    },
    noise: value.noise === true,
    duplicate: value.duplicate === true,
    shortReason: safeString(value.shortReason, 80),
    reasonCodes: safeStrings(value.reasonCodes, 8, 40),
    companyKeys: safeStrings(value.companyKeys, 12, 80),
    directionKeys: safeStrings(value.directionKeys, 12, 80)
  };
}

function normalizeAnalysisBatch(value = {}, allowedItemIds = []) {
  const orderedIds = [...new Set(allowedItemIds)];
  const allowedIds = new Set(orderedIds);
  const byId = new Map();
  for (const entry of (Array.isArray(value.analyses) ? value.analyses : [])) {
    const itemId = safeString(entry && entry.itemId, 80);
    if (!allowedIds.has(itemId) || byId.has(itemId)) continue;
    byId.set(itemId, { itemId, ...normalizeAnalysisResult(entry) });
  }
  if (byId.size !== orderedIds.length) {
    const error = new Error('INTELLIGENCE_BATCH_INVALID');
    error.code = 'INTELLIGENCE_BATCH_INVALID';
    throw error;
  }
  return orderedIds.map((itemId) => byId.get(itemId));
}

function normalizeDigestEntry(value, allowedIds) {
  const sourceItemIds = safeStrings(value && value.sourceItemIds, 3, 80)
    .filter((itemId) => allowedIds.has(itemId));
  if (!sourceItemIds.length) return null;
  const title = safeString(value && value.title, 80);
  const copy = safeString(value && value.copy, 220);
  if (!title || !copy) return null;
  return {
    title,
    copy,
    sourceItemIds,
    tags: safeStrings(value && value.tags, 6, 40)
  };
}

function normalizeDigestEntries(values, allowedIds, maxItems) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeDigestEntry(value, allowedIds))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeDigestResult(value = {}, allowedItemIds = []) {
  const allowedIds = new Set(allowedItemIds);
  const result = {
    executiveSummary: safeString(value.executiveSummary, 300),
    mustKnow: normalizeDigestEntries(value.mustKnow, allowedIds, 5),
    radar: normalizeDigestEntries(value.radar, allowedIds, 8),
    followUps: normalizeDigestEntries(value.followUps, allowedIds, 8)
  };
  if (!result.executiveSummary || !result.mustKnow.length) {
    const error = new Error('INTELLIGENCE_DIGEST_INVALID');
    error.code = 'INTELLIGENCE_DIGEST_INVALID';
    throw error;
  }
  return result;
}

function normalizeColumnCaseResult(
  value = {},
  { allowedItemIds = [], allowedDossierKeys = [], allowedLessonIds = [] } = {}
) {
  const publish = value.publish === true;
  const reason = safeString(value.reason, 120);
  if (!publish) return { publish: false, reason: reason || 'insufficient-evidence' };
  const allowedItems = new Set(allowedItemIds);
  const allowedDossiers = new Set(allowedDossierKeys);
  const allowedLessons = new Set(allowedLessonIds);
  const result = {
    publish: true,
    reason,
    title: safeString(value.title, 80),
    conclusion: safeString(value.conclusion, 220),
    happened: safeString(value.happened, 600),
    impact: safeString(value.impact, 600),
    tryNow: safeStrings(value.tryNow, 4, 140),
    noNeedToWorry: safeString(value.noNeedToWorry, 420),
    dossierKey: safeString(value.dossierKey, 48),
    relatedLessonIds: safeStrings(value.relatedLessonIds, 3, 48)
      .filter((lessonId) => allowedLessons.has(lessonId)),
    sourceItemIds: safeStrings(value.sourceItemIds, 3, 80)
      .filter((itemId) => allowedItems.has(itemId))
  };
  if (!result.title || !result.conclusion || !result.happened || !result.impact
    || !result.tryNow.length || !result.noNeedToWorry
    || !allowedDossiers.has(result.dossierKey) || !result.sourceItemIds.length) {
    const error = new Error('INTELLIGENCE_COLUMN_CASE_INVALID');
    error.code = 'INTELLIGENCE_COLUMN_CASE_INVALID';
    throw error;
  }
  return result;
}

function normalizeCommentModeration(value = {}) {
  const verdicts = new Set(['allow', 'reject', 'unsure']);
  const categories = new Set(COMMENT_MODERATION_CATEGORIES);
  return {
    verdict: verdicts.has(value.verdict) ? value.verdict : 'unsure',
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    categories: safeStrings(value.categories, 5, 40).filter((item) => categories.has(item)),
    reason: safeString(value.reason, 80)
  };
}

function normalizeSourcePreviewReview(value = {}) {
  const verdicts = new Set(['accept', 'reject', 'retry', 'unsure']);
  return {
    verdict: verdicts.has(value.verdict) ? value.verdict : 'unsure',
    targetMatched: value.targetMatched === true,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    reasonCode: safeString(value.reasonCode, 64) || 'UNSPECIFIED'
  };
}

module.exports = {
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
};
