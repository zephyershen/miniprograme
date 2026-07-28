const { AppError } = require('../lib/errors');
const { featureEnabled, requireFeature } = require('./feed-entitlement-service');
const { normalizeSearchText } = require('../lib/search-terms');

const CONTENT_SCOPES = Object.freeze(['column', 'briefing']);
const DIGEST_WINDOWS = Object.freeze(['24h', '7d', '30d']);
const DIGEST_LABELS = Object.freeze({
  '24h': '每日简报',
  '7d': '每周简报',
  '30d': '每月简报'
});

function normalizeRequest(input = {}) {
  const query = normalizeSearchText(input.query);
  const length = Array.from(query).length;
  if (length < 2 || length > 50) {
    throw new AppError('INVALID_REQUEST', '请输入 2–50 个字符的关键词');
  }
  const scope = CONTENT_SCOPES.includes(input.scope) ? input.scope : 'column';
  const cursorPrefix = `${scope}:`;
  const offset = typeof input.cursor === 'string' && input.cursor.startsWith(cursorPrefix)
    ? Math.max(0, Math.floor(Number(input.cursor.slice(cursorPrefix.length)) || 0))
    : 0;
  return {
    query,
    scope,
    offset,
    limit: Math.min(20, Math.max(1, Math.floor(Number(input.limit) || 10)))
  };
}

function stringValues(value, output = []) {
  if (typeof value === 'string') {
    if (value.trim()) output.push(value.trim());
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => stringValues(entry, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => stringValues(entry, output));
  }
  return output;
}

function matches(value, query) {
  return stringValues(value).join(' ').toLowerCase().includes(query.toLowerCase());
}

function paged(items, request, scopeLabel) {
  const pageItems = items.slice(request.offset, request.offset + request.limit);
  const nextOffset = request.offset + pageItems.length;
  const hasMore = nextOffset < items.length;
  return {
    items: pageItems,
    resultCount: items.length,
    nextCursor: hasMore ? `${request.scope}:${nextOffset}` : '',
    hasMore,
    scope: request.scope,
    scopeLabel
  };
}

function columnSearchDocument(entry, unlocked) {
  const content = entry && entry.content || {};
  if (!unlocked) return { title: content.title };
  const metadata = {
    title: content.title,
    subtitle: content.subtitle,
    category: content.category,
    categoryLabel: content.categoryLabel,
    track: content.track,
    tags: content.tags
  };
  return { metadata, content };
}

function columnResult(entry, unlocked) {
  const content = entry.content || {};
  const practical = entry.kind === 'practical';
  return {
    id: content.id || entry.id,
    kind: 'column',
    entryType: practical ? 'practical' : 'lesson',
    title: content.title || '',
    summary: unlocked ? content.subtitle || '' : '',
    source: '会员专栏',
    publishedAt: entry.publishedAt || entry.updatedAt || null,
    category: unlocked
      ? content.category || content.track || (practical ? 'practical' : 'course')
      : practical ? 'practical' : 'course',
    categoryLabel: unlocked
      ? content.categoryLabel || (practical ? '应用操作' : '基础知识')
      : practical ? '应用操作' : '基础知识',
    categoryMarker: practical ? 'DO' : 'KN',
    locked: !unlocked
  };
}

function digestSearchDocument(document) {
  return {
    executiveSummary: document.executiveSummary,
    mustKnow: document.mustKnow,
    radar: document.radar,
    followUps: document.followUps,
    sourceIndex: document.sourceIndex
  };
}

function digestResult(document) {
  return {
    id: document._id,
    kind: 'briefing',
    windowKey: document.windowKey,
    title: DIGEST_LABELS[document.windowKey] || '知识简报',
    summary: document.executiveSummary || '',
    source: '知识简报',
    publishedAt: document.generatedAt || document.windowEnd || null,
    category: 'briefing',
    categoryLabel: DIGEST_LABELS[document.windowKey] || '知识简报',
    categoryMarker: 'BR'
  };
}

function createContentSearchService({
  columnCatalogService,
  digestRepository,
  liveDigests = true
}) {
  async function searchColumn(request, entitlement) {
    const unlocked = featureEnabled(entitlement, 'ai_column');
    const entries = await columnCatalogService.publishedEntries();
    const items = entries
      .filter((entry) => matches(columnSearchDocument(entry, unlocked), request.query))
      .map((entry) => columnResult(entry, unlocked));
    return paged(items, request, '会员专栏');
  }

  async function searchBriefing(request, entitlement) {
    requireFeature(entitlement, 'digest_24h', '知识简报搜索为 Pro 会员权益');
    if (!liveDigests) return paged([], request, '知识简报');
    const documents = (await Promise.all(
      DIGEST_WINDOWS.map((windowKey) => digestRepository.latest(windowKey))
    )).filter(Boolean);
    const items = documents
      .filter((document) => matches(digestSearchDocument(document), request.query))
      .map(digestResult);
    return paged(items, request, '知识简报');
  }

  async function search(input, entitlement) {
    const request = normalizeRequest(input);
    return request.scope === 'briefing'
      ? searchBriefing(request, entitlement)
      : searchColumn(request, entitlement);
  }

  return { search };
}

module.exports = {
  CONTENT_SCOPES,
  normalizeRequest,
  stringValues,
  matches,
  columnResult,
  digestResult,
  createContentSearchService
};
