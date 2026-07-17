const { normalizeAihotResponse, normalizeAihotDaily } = require('../lib/aihot');

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function responseHeader(response, name) {
  const headers = response && response.headers;
  return headers && typeof headers.get === 'function' ? headers.get(name) : '';
}

function sourceHttpError(response) {
  const error = new Error(`FEED_SOURCE_${response.status}`);
  error.status = response.status;
  error.retryAfterMs = parseRetryAfter(responseHeader(response, 'retry-after'));
  return error;
}

function createAihotSource(config, fetchImpl = fetch) {
  function assertMode(mode) {
    if (!['selected', 'all'].includes(mode)) throw new Error('FEED_SOURCE_MODE_INVALID');
    return mode;
  }

  async function request(url, etag = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const headers = {
        accept: 'application/json',
        'user-agent': 'KnowledgePlatform/1.0 (+WeChat Mini Program)'
      };
      if (etag) headers['if-none-match'] = etag;
      return await fetchImpl(url, { headers, signal: controller.signal, redirect: 'error' });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchPage(mode, cursor = '', etag = '') {
    const params = new URLSearchParams({ mode: assertMode(mode), take: String(config.pageSize) });
    if (cursor) params.set('cursor', cursor);
    return request(`${config.apiRoot}?${params}`, etag);
  }

  async function loadFingerprint(etag = '') {
    const response = await request(config.fingerprintRoot, etag);
    if (response.status === 304) {
      return { notModified: true, etag: responseHeader(response, 'etag') || etag };
    }
    if (!response.ok) throw sourceHttpError(response);
    const payload = await response.json();
    if (!payload || typeof payload.selected !== 'string' || !payload.selected
      || typeof payload.all !== 'string' || !payload.all) {
      throw new Error('FEED_FINGERPRINT_INVALID');
    }
    return {
      notModified: false,
      etag: responseHeader(response, 'etag'),
      selected: payload.selected,
      all: payload.all
    };
  }

  async function loadMode(mode, etag = '', maximum = config.maxItems) {
    const boundedMaximum = Math.max(config.pageSize, Number(maximum) || config.maxItems);
    const response = await fetchPage(mode, '', etag);
    if (response.status === 304) return { notModified: true, etag, items: [] };
    if (!response.ok) throw sourceHttpError(response);

    const firstPage = await response.json();
    const rawItems = [...(firstPage.items || [])];
    let nextCursor = firstPage.hasNext ? firstPage.nextCursor : '';
    const seenCursors = new Set();
    while (nextCursor && rawItems.length < boundedMaximum) {
      if (seenCursors.has(nextCursor)) throw new Error('FEED_SOURCE_CURSOR_LOOP');
      seenCursors.add(nextCursor);
      const nextResponse = await fetchPage(mode, nextCursor);
      if (!nextResponse.ok) throw sourceHttpError(nextResponse);
      const nextPage = await nextResponse.json();
      rawItems.push(...(nextPage.items || []));
      nextCursor = nextPage.hasNext ? nextPage.nextCursor : '';
    }

    const items = normalizeAihotResponse({ items: rawItems }, boundedMaximum);
    if (!items.length) throw new Error('FEED_SOURCE_EMPTY');
    return {
      notModified: false,
      etag: responseHeader(response, 'etag'),
      items,
      truncated: Boolean(nextCursor),
      mode
    };
  }

  async function loadSelected(etag = '') {
    return loadMode('selected', etag, config.maxItems);
  }

  async function loadAll(etag = '') {
    const result = await loadMode('all', etag, config.allMaxItems || config.maxItems);
    if (result.truncated) throw new Error('FEED_SOURCE_TRUNCATED');
    return result;
  }

  async function loadDailyIndex(take = 90) {
    const boundedTake = Math.max(1, Math.min(180, Number(take) || 90));
    const response = await request(`${config.dailyIndexRoot}?take=${boundedTake}`);
    if (!response.ok) throw sourceHttpError(response);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.items)) throw new Error('FEED_DAILY_INDEX_INVALID');
    const dates = payload.items
      .map((entry) => entry && entry.date)
      .filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
    return [...new Set(dates)];
  }

  async function loadDaily(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('FEED_DAILY_DATE_INVALID');
    }
    const response = await request(`${config.dailyRoot}/${date}`);
    if (!response.ok) throw sourceHttpError(response);
    const normalized = normalizeAihotDaily(await response.json());
    if (normalized.date !== date || !normalized.items.length) throw new Error('FEED_DAILY_INVALID');
    return normalized;
  }

  return {
    provider: config.provider,
    loadFingerprint,
    loadMode,
    loadSelected,
    loadAll,
    loadDailyIndex,
    loadDaily
  };
}

module.exports = { createAihotSource, parseRetryAfter };
