const crypto = require('node:crypto');
const {
  xHandleFromUrl,
  normalizeSourceIdentity,
  normalizeSourceTags
} = require('../lib/source-metadata');
const {
  inferSourceChannelKeys,
  mergeSourceChannelKeys
} = require('../lib/source-channels');

const ITEM_ID_PATTERN = /^[a-z0-9_-]{8,80}$/i;
const AVATAR_IMAGE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});
const MEDIA_IMAGE_TYPES = AVATAR_IMAGE_TYPES;

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedInteger(value, fallback, maximum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function enrichmentError(code, status = null) {
  const error = new Error(code);
  if (Number.isInteger(status)) error.status = status;
  return error;
}

function strictFeedRoot(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw enrichmentError('FEED_ENRICHMENT_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.pathname !== '/api/public/feed') {
    throw enrichmentError('FEED_ENRICHMENT_URL_INVALID');
  }
  return parsed;
}

function normalizedAvatarProxy(value, feedRoot) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 2000) {
    throw enrichmentError('FEED_ENRICHMENT_AVATAR_INVALID');
  }
  let proxy;
  try {
    proxy = new URL(value, feedRoot.origin);
  } catch (error) {
    throw enrichmentError('FEED_ENRICHMENT_AVATAR_INVALID');
  }
  if (proxy.protocol !== 'https:' || proxy.origin !== feedRoot.origin
    || proxy.pathname !== '/api/img-proxy' || proxy.username || proxy.password
    || proxy.searchParams.get('mode') !== 'avatar') {
    throw enrichmentError('FEED_ENRICHMENT_AVATAR_INVALID');
  }
  let source;
  try {
    source = new URL(proxy.searchParams.get('u') || '');
  } catch (error) {
    throw enrichmentError('FEED_ENRICHMENT_AVATAR_INVALID');
  }
  if (source.protocol !== 'https:' || source.hostname.toLowerCase() !== 'pbs.twimg.com'
    || source.username || source.password || source.port) {
    throw enrichmentError('FEED_ENRICHMENT_AVATAR_HOST_INVALID');
  }
  return {
    proxyUrl: proxy.toString(),
    sourceHash: crypto.createHash('sha256').update(source.toString()).digest('hex')
  };
}

function normalizedMediaProxy(value, feedRoot) {
  if (typeof value !== 'string' || !value || value.length > 3000) {
    throw enrichmentError('FEED_ENRICHMENT_MEDIA_INVALID');
  }
  let proxy;
  try {
    proxy = new URL(value, feedRoot.origin);
  } catch (error) {
    throw enrichmentError('FEED_ENRICHMENT_MEDIA_INVALID');
  }
  if (proxy.protocol !== 'https:' || proxy.origin !== feedRoot.origin
    || proxy.pathname !== '/api/img-proxy' || proxy.username || proxy.password
    || proxy.searchParams.get('mode') !== 'full') {
    throw enrichmentError('FEED_ENRICHMENT_MEDIA_INVALID');
  }
  let source;
  try {
    source = new URL(proxy.searchParams.get('u') || '');
  } catch (error) {
    throw enrichmentError('FEED_ENRICHMENT_MEDIA_INVALID');
  }
  if (source.protocol !== 'https:' || source.hostname.toLowerCase() !== 'pbs.twimg.com'
    || source.username || source.password || source.port) {
    throw enrichmentError('FEED_ENRICHMENT_MEDIA_HOST_INVALID');
  }
  return {
    proxyUrl: proxy.toString(),
    sourceHash: crypto.createHash('sha256').update(source.toString()).digest('hex')
  };
}

function normalizeAihotFeedEnrichment(raw, expectedItem, feedRoot) {
  if (!plainObject(raw) || !ITEM_ID_PATTERN.test(raw.id || '') || raw.id !== expectedItem.id) {
    throw enrichmentError('FEED_ENRICHMENT_ITEM_INVALID');
  }
  if (!Array.isArray(raw.aiTags) || raw.aiTags.length > 20
    || raw.aiTags.some((entry) => !plainObject(entry) || typeof entry.tag !== 'string')) {
    throw enrichmentError('FEED_ENRICHMENT_TAGS_INVALID');
  }
  const sourceTags = normalizeSourceTags(raw.aiTags.map((entry) => entry.tag));
  const expectedHandle = xHandleFromUrl(expectedItem.url);
  let sourceIdentity = null;
  if (raw.xDisplay !== null && raw.xDisplay !== undefined) {
    if (!plainObject(raw.xDisplay)
      || typeof raw.xDisplay.authorName !== 'string'
      || typeof raw.xDisplay.screenName !== 'string') {
      throw enrichmentError('FEED_ENRICHMENT_IDENTITY_INVALID');
    }
    sourceIdentity = normalizeSourceIdentity({
      platform: 'x',
      displayName: raw.xDisplay.authorName,
      handle: raw.xDisplay.screenName
    });
    if (!sourceIdentity || !expectedHandle
      || sourceIdentity.handle.toLowerCase() !== expectedHandle.toLowerCase()) {
      throw enrichmentError('FEED_ENRICHMENT_IDENTITY_MISMATCH');
    }
  }
  const avatar = normalizedAvatarProxy(raw.xAvatarProxied, feedRoot);
  if (avatar && !sourceIdentity) throw enrichmentError('FEED_ENRICHMENT_AVATAR_WITHOUT_IDENTITY');
  if (raw.xMediaProxied !== null && raw.xMediaProxied !== undefined
    && !Array.isArray(raw.xMediaProxied)) {
    throw enrichmentError('FEED_ENRICHMENT_MEDIA_INVALID');
  }
  const sourceMedia = (Array.isArray(raw.xMediaProxied) ? raw.xMediaProxied : [])
    .filter((entry) => plainObject(entry) && entry.type === 'photo')
    .map((entry) => {
      const media = normalizedMediaProxy(entry.fullSrc || entry.src, feedRoot);
      const width = boundedInteger(entry.width, 0, 10000);
      const height = boundedInteger(entry.height, 0, 10000);
      return {
        proxyUrl: media.proxyUrl,
        sourceHash: media.sourceHash,
        type: 'photo',
        ...(width ? { width } : {}),
        ...(height ? { height } : {})
      };
    });
  return {
    id: raw.id,
    sourceTags,
    sourceChannelKeys: mergeSourceChannelKeys(
      expectedItem.sourceChannelKeys,
      inferSourceChannelKeys(raw)
    ),
    ...(sourceIdentity ? { sourceIdentity } : {}),
    ...(avatar ? {
      avatarProxyUrl: avatar.proxyUrl,
      avatarSourceHash: avatar.sourceHash
    } : {}),
    ...(sourceMedia.length ? { sourceMedia } : {})
  };
}

function createAihotFeedEnrichmentAdapter(config = {}, fetchImpl = fetch) {
  const feedRoot = strictFeedRoot(config.feedRoot || config.apiRoot);
  const timeoutMs = boundedInteger(config.timeoutMs, 5000, 15000);
  const avatarTimeoutMs = boundedInteger(config.avatarTimeoutMs, 5000, 15000);
  const mediaTimeoutMs = boundedInteger(config.mediaTimeoutMs, 8000, 20000);
  const maxPages = boundedInteger(config.maxPages, 3, 10);
  const firstPartyMaxPages = boundedInteger(config.firstPartyMaxPages, 25, 60);
  const maxItemsPerPage = boundedInteger(config.maxItemsPerPage, 100, 200);
  const maxResponseBytes = boundedInteger(config.maxResponseBytes, 512 * 1024, 2 * 1024 * 1024);
  const maxAvatarBytes = boundedInteger(config.maxAvatarBytes, 256 * 1024, 1024 * 1024);
  const maxMediaBytes = boundedInteger(config.maxMediaBytes, 2.5 * 1024 * 1024, 5 * 1024 * 1024);

  async function request(url, requestTimeoutMs, accept) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetchImpl(url, {
        headers: {
          accept,
          'user-agent': 'KnowledgePlatform/1.0 (+WeChat Mini Program)'
        },
        signal: controller.signal,
        redirect: 'error'
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(response) {
    if (typeof response.text !== 'function') return response.json();
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw enrichmentError('FEED_ENRICHMENT_RESPONSE_TOO_LARGE');
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw enrichmentError('FEED_ENRICHMENT_RESPONSE_INVALID');
    }
  }

  function pageUrl(mode, cursor = null, channel = '') {
    if (!['selected', 'all'].includes(mode)) throw enrichmentError('FEED_ENRICHMENT_MODE_INVALID');
    const url = new URL(feedRoot.toString());
    url.searchParams.set('mode', mode);
    if (channel) url.searchParams.set('channel', channel);
    if (cursor) {
      url.searchParams.set('cursorAt', String(cursor.at));
      url.searchParams.set('cursorId', cursor.id);
    }
    return url.toString();
  }

  async function loadForItems(items, { mode = 'all' } = {}) {
    const expected = new Map();
    for (const item of (Array.isArray(items) ? items : [])) {
      if (item && ITEM_ID_PATTERN.test(item.id || '') && typeof item.url === 'string') {
        expected.set(item.id, {
          id: item.id,
          url: item.url,
          sourceChannelKeys: inferSourceChannelKeys(item)
        });
      }
    }
    if (!expected.size) return new Map();
    const result = new Map();
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
      const response = await request(pageUrl(mode, cursor), timeoutMs, 'application/json');
      if (!response.ok) throw enrichmentError(`FEED_ENRICHMENT_${response.status}`, response.status);
      const payload = await readJson(response);
      if (!plainObject(payload) || !Array.isArray(payload.items)
        || payload.items.length > maxItemsPerPage) {
        throw enrichmentError('FEED_ENRICHMENT_RESPONSE_INVALID');
      }
      for (const raw of payload.items) {
        if (!plainObject(raw) || !expected.has(raw.id) || result.has(raw.id)) continue;
        result.set(raw.id, normalizeAihotFeedEnrichment(raw, expected.get(raw.id), feedRoot));
      }
      if (result.size >= expected.size || payload.hasNext !== true) break;
      const next = payload.nextCursor;
      if (!plainObject(next) || !Number.isFinite(Number(next.at))
        || !ITEM_ID_PATTERN.test(next.id || '')) {
        throw enrichmentError('FEED_ENRICHMENT_CURSOR_INVALID');
      }
      const key = `${Number(next.at)}:${next.id}`;
      if (seenCursors.has(key)) throw enrichmentError('FEED_ENRICHMENT_CURSOR_LOOP');
      seenCursors.add(key);
      cursor = { at: Number(next.at), id: next.id };
    }

    const membershipSeenCursors = new Set();
    const membershipPageLimit = mode === 'all' ? firstPartyMaxPages : maxPages;
    cursor = null;
    for (let page = 0; page < membershipPageLimit; page += 1) {
      const response = await request(
        pageUrl(mode, cursor, 'firstParty'),
        timeoutMs,
        'application/json'
      );
      if (!response.ok) throw enrichmentError(`FEED_ENRICHMENT_${response.status}`, response.status);
      const payload = await readJson(response);
      if (!plainObject(payload) || !Array.isArray(payload.items)
        || payload.items.length > maxItemsPerPage) {
        throw enrichmentError('FEED_ENRICHMENT_RESPONSE_INVALID');
      }
      for (const raw of payload.items) {
        if (!plainObject(raw) || !expected.has(raw.id)) continue;
        const current = result.get(raw.id) || { id: raw.id };
        result.set(raw.id, {
          ...current,
          sourceChannelKeys: mergeSourceChannelKeys(
            expected.get(raw.id).sourceChannelKeys,
            current.sourceChannelKeys,
            ['firstParty']
          )
        });
      }
      if (payload.hasNext !== true) break;
      const next = payload.nextCursor;
      if (!plainObject(next) || !Number.isFinite(Number(next.at))
        || !ITEM_ID_PATTERN.test(next.id || '')) {
        throw enrichmentError('FEED_ENRICHMENT_CURSOR_INVALID');
      }
      const key = `${Number(next.at)}:${next.id}`;
      if (membershipSeenCursors.has(key)) throw enrichmentError('FEED_ENRICHMENT_CURSOR_LOOP');
      membershipSeenCursors.add(key);
      cursor = { at: Number(next.at), id: next.id };
    }
    return result;
  }

  async function downloadAvatar(proxyUrl) {
    const avatar = normalizedAvatarProxy(proxyUrl, feedRoot);
    if (!avatar) throw enrichmentError('FEED_ENRICHMENT_AVATAR_INVALID');
    const response = await request(
      avatar.proxyUrl,
      avatarTimeoutMs,
      'image/jpeg,image/png,image/webp'
    );
    if (!response.ok) throw enrichmentError(`FEED_ENRICHMENT_AVATAR_${response.status}`, response.status);
    const contentLength = Number(response.headers && response.headers.get
      ? response.headers.get('content-length')
      : 0);
    if (Number.isFinite(contentLength) && contentLength > maxAvatarBytes) {
      throw enrichmentError('FEED_ENRICHMENT_AVATAR_TOO_LARGE');
    }
    const contentType = String(response.headers && response.headers.get
      ? response.headers.get('content-type')
      : '').split(';')[0].trim().toLowerCase();
    const extension = AVATAR_IMAGE_TYPES[contentType];
    if (!extension || typeof response.arrayBuffer !== 'function') {
      throw enrichmentError('FEED_ENRICHMENT_AVATAR_TYPE_INVALID');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxAvatarBytes) {
      throw enrichmentError('FEED_ENRICHMENT_AVATAR_TOO_LARGE');
    }
    return { buffer, contentType, extension, sourceHash: avatar.sourceHash };
  }

  async function downloadMedia(proxyUrl) {
    const media = normalizedMediaProxy(proxyUrl, feedRoot);
    const response = await request(
      media.proxyUrl,
      mediaTimeoutMs,
      'image/jpeg,image/png,image/webp'
    );
    if (!response.ok) throw enrichmentError(`FEED_ENRICHMENT_MEDIA_${response.status}`, response.status);
    const contentLength = Number(response.headers && response.headers.get
      ? response.headers.get('content-length')
      : 0);
    if (Number.isFinite(contentLength) && contentLength > maxMediaBytes) {
      throw enrichmentError('FEED_ENRICHMENT_MEDIA_TOO_LARGE');
    }
    const contentType = String(response.headers && response.headers.get
      ? response.headers.get('content-type')
      : '').split(';')[0].trim().toLowerCase();
    const extension = MEDIA_IMAGE_TYPES[contentType];
    if (!extension || typeof response.arrayBuffer !== 'function') {
      throw enrichmentError('FEED_ENRICHMENT_MEDIA_TYPE_INVALID');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxMediaBytes) {
      throw enrichmentError('FEED_ENRICHMENT_MEDIA_TOO_LARGE');
    }
    return { buffer, contentType, extension, sourceHash: media.sourceHash };
  }

  return { loadForItems, downloadAvatar, downloadMedia };
}

module.exports = {
  ITEM_ID_PATTERN,
  AVATAR_IMAGE_TYPES,
  xHandleFromUrl,
  normalizedAvatarProxy,
  normalizedMediaProxy,
  normalizeAihotFeedEnrichment,
  createAihotFeedEnrichmentAdapter
};
