function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function attributes(tag) {
  const result = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || '');
  }
  return result;
}

function extractCoverUrl(html, pageUrl) {
  const candidates = [];
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = attributes(tag);
    const key = String(attrs.property || attrs.name || '').toLowerCase();
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key) && attrs.content) {
      candidates.push(attrs.content);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate, pageUrl);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.toString();
    } catch (error) {
      // Ignore malformed metadata and continue with the next candidate.
    }
  }
  return '';
}

module.exports = { decodeHtml, extractCoverUrl };
