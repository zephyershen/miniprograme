const { AppError } = require('../lib/errors');
const { featureEnabled } = require('./feed-entitlement-service');
const { normalizeSearchText } = require('../lib/search-terms');

const CURSOR_PREFIX = 'all:';
const CURSOR_VERSION = 1;
const FEED_SCOPES = Object.freeze(['firstParty', 'news', 'x', 'openSource']);
const BASE_SCOPES = Object.freeze([...FEED_SCOPES, 'column']);

function normalizeGlobalSearchRequest(input = {}) {
  const query = normalizeSearchText(input.query);
  const length = Array.from(query).length;
  if (length < 2 || length > 50) {
    throw new AppError('INVALID_REQUEST', '请输入 2–50 个字符的关键词');
  }
  return {
    query,
    limit: Math.min(20, Math.max(1, Math.floor(Number(input.limit) || 10))),
    cursor: decodeCursor(input.cursor)
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  return Buffer.from(normalized + (padding ? '='.repeat(4 - padding) : ''), 'base64')
    .toString('utf8');
}

function encodeCursor(scopes) {
  return `${CURSOR_PREFIX}${encodeBase64Url(JSON.stringify({
    version: CURSOR_VERSION,
    scopes
  }))}`;
}

function decodeCursor(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 4000 || !value.startsWith(CURSOR_PREFIX)) {
    throw new AppError('INVALID_REQUEST', '搜索分页参数无效');
  }
  try {
    const decoded = JSON.parse(decodeBase64Url(value.slice(CURSOR_PREFIX.length)));
    if (decoded.version !== CURSOR_VERSION || !decoded.scopes || typeof decoded.scopes !== 'object') {
      throw new Error('INVALID_CURSOR');
    }
    return decoded.scopes;
  } catch (error) {
    throw new AppError('INVALID_REQUEST', '搜索分页参数无效');
  }
}

function accessibleScopes(entitlement) {
  return featureEnabled(entitlement, 'digest_24h')
    ? [...BASE_SCOPES, 'briefing']
    : [...BASE_SCOPES];
}

function sortResults(items = []) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left && left.publishedAt).getTime();
    const rightTime = new Date(right && right.publishedAt).getTime();
    const timeOrder = (Number.isFinite(rightTime) ? rightTime : 0)
      - (Number.isFinite(leftTime) ? leftTime : 0);
    if (timeOrder) return timeOrder;
    const leftKey = `${left && left.kind || 'feed'}:${left && left.id || ''}`;
    const rightKey = `${right && right.kind || 'feed'}:${right && right.id || ''}`;
    return leftKey.localeCompare(rightKey);
  });
}

function createGlobalSearchService({ searchFeed, searchContent }) {
  if (typeof searchFeed !== 'function' || typeof searchContent !== 'function') {
    throw new Error('Global search requires feed and content search handlers');
  }

  async function search(input, context = {}) {
    const request = normalizeGlobalSearchRequest(input);
    const scopes = accessibleScopes(context.entitlement);
    const firstPage = request.cursor === null;
    const previous = request.cursor || {};
    const pendingScopes = scopes.filter((scope) => !(previous[scope] && previous[scope].done));
    const perScopeLimit = Math.max(
      1,
      Math.ceil(request.limit / Math.max(1, pendingScopes.length))
    );

    const pages = await Promise.all(pendingScopes.map(async (scope) => {
      const cursor = previous[scope] && previous[scope].cursor || '';
      const page = FEED_SCOPES.includes(scope)
        ? await searchFeed({
          query: request.query,
          scope,
          cursor,
          limit: perScopeLimit
        }, context)
        : await searchContent({
          query: request.query,
          scope,
          cursor,
          limit: perScopeLimit
        }, context);
      return { scope, page };
    }));

    const nextState = {};
    scopes.forEach((scope) => {
      const pageEntry = pages.find((entry) => entry.scope === scope);
      if (!pageEntry) {
        nextState[scope] = previous[scope] || { cursor: '', done: true };
        return;
      }
      nextState[scope] = {
        cursor: pageEntry.page.nextCursor || '',
        done: pageEntry.page.hasMore !== true
      };
    });
    const hasMore = scopes.some((scope) => nextState[scope].done !== true);
    const result = {
      query: request.query,
      scope: 'all',
      scopeLabel: '全部可访问内容',
      items: sortResults(pages.flatMap(({ page }) => page.items || [])),
      nextCursor: hasMore ? encodeCursor(nextState) : '',
      hasMore,
      viewer: context.entitlement && context.entitlement.viewer,
      entitlements: context.entitlement && context.entitlement.entitlements,
      access: context.entitlement && context.entitlement.access
    };
    if (firstPage) {
      result.resultCount = pages.reduce(
        (total, { page }) => total + Math.max(0, Number(page.resultCount) || 0),
        0
      );
    }
    return result;
  }

  return { search };
}

module.exports = {
  CURSOR_PREFIX,
  FEED_SCOPES,
  BASE_SCOPES,
  normalizeGlobalSearchRequest,
  encodeCursor,
  decodeCursor,
  accessibleScopes,
  sortResults,
  createGlobalSearchService
};
