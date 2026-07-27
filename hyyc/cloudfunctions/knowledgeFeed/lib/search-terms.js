const SEARCH_TOKEN_VERSION = 1;
const MAX_DOCUMENT_TOKENS = 320;
const MAX_DOCUMENT_TOKEN_BYTES = 900;
const MAX_QUERY_TOKENS = 12;

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function segments(value) {
  return normalizeSearchText(value).match(/[a-z0-9]+|[\u3400-\u9fff]+/g) || [];
}

function latinDocumentTokens(value) {
  if (value.length < 2) return [];
  const tokens = [value];
  for (let length = 2; length <= Math.min(16, value.length); length += 1) {
    tokens.push(value.slice(0, length));
  }
  return tokens.map((token) => `l:${token}`);
}

function hanDocumentTokens(value) {
  if (value.length < 2) return [];
  const tokens = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    tokens.push(`c:${value.slice(index, index + 2)}`);
  }
  return tokens;
}

function fieldValues(item = {}) {
  return [
    item.title,
    item.titleEn,
    item.source,
    item.categoryLabel,
    item.category,
    ...(Array.isArray(item.topicKeys) ? item.topicKeys : []),
    item.summary
  ];
}

function buildSearchTokens(item) {
  const unique = new Set();
  let tokenBytes = 0;
  for (const value of fieldValues(item)) {
    for (const segment of segments(value)) {
      const generated = /^[a-z0-9]+$/.test(segment)
        ? latinDocumentTokens(segment)
        : hanDocumentTokens(segment);
      generated.forEach((token) => {
        if (unique.has(token) || unique.size >= MAX_DOCUMENT_TOKENS) return;
        const nextBytes = tokenBytes + Buffer.byteLength(token, 'utf8') + 1;
        if (nextBytes > MAX_DOCUMENT_TOKEN_BYTES) return;
        unique.add(token);
        tokenBytes = nextBytes;
      });
      if (unique.size >= MAX_DOCUMENT_TOKENS || tokenBytes >= MAX_DOCUMENT_TOKEN_BYTES) break;
    }
    if (unique.size >= MAX_DOCUMENT_TOKENS || tokenBytes >= MAX_DOCUMENT_TOKEN_BYTES) break;
  }
  return [...unique].sort();
}

function querySearchTokens(value) {
  const unique = new Set();
  for (const segment of segments(value)) {
    const generated = /^[a-z0-9]+$/.test(segment)
      ? (segment.length >= 2 ? [`l:${segment}`] : [])
      : hanDocumentTokens(segment);
    generated.forEach((token) => {
      if (unique.size < MAX_QUERY_TOKENS) unique.add(token);
    });
    if (unique.size >= MAX_QUERY_TOKENS) break;
  }
  return [...unique].sort();
}

module.exports = {
  SEARCH_TOKEN_VERSION,
  MAX_DOCUMENT_TOKENS,
  MAX_DOCUMENT_TOKEN_BYTES,
  MAX_QUERY_TOKENS,
  normalizeSearchText,
  buildSearchTokens,
  querySearchTokens
};
