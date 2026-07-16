const { normalizeAihotResponse } = require('../lib/aihot');

function createAihotSource(config, fetchImpl = fetch) {
  async function fetchPage(cursor = '', etag = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const params = new URLSearchParams({ mode: 'selected', take: String(config.pageSize) });
      if (cursor) params.set('cursor', cursor);
      const headers = {
        accept: 'application/json',
        'user-agent': 'KnowledgePlatform/1.0 (+WeChat Mini Program)'
      };
      if (etag) headers['if-none-match'] = etag;
      return await fetchImpl(`${config.apiRoot}?${params}`, { headers, signal: controller.signal, redirect: 'error' });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadSelected(etag = '') {
    const response = await fetchPage('', etag);
    if (response.status === 304) return { notModified: true, etag, items: [] };
    if (!response.ok) throw new Error(`FEED_SOURCE_${response.status}`);

    const firstPage = await response.json();
    const rawItems = [...(firstPage.items || [])];
    let nextCursor = firstPage.hasNext ? firstPage.nextCursor : '';
    while (nextCursor && rawItems.length < config.maxItems) {
      const nextResponse = await fetchPage(nextCursor);
      if (!nextResponse.ok) throw new Error(`FEED_SOURCE_${nextResponse.status}`);
      const nextPage = await nextResponse.json();
      rawItems.push(...(nextPage.items || []));
      nextCursor = nextPage.hasNext ? nextPage.nextCursor : '';
    }

    const items = normalizeAihotResponse({ items: rawItems }, config.maxItems);
    if (!items.length) throw new Error('FEED_SOURCE_EMPTY');
    return {
      notModified: false,
      etag: response.headers.get('etag') || '',
      items
    };
  }

  return { provider: config.provider, loadSelected };
}

module.exports = { createAihotSource };
