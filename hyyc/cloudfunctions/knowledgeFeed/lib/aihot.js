const CATEGORY_META = Object.freeze({
  'ai-models': { label: '模型更新', marker: 'MODEL', channelKey: 'ai', tone: 'cobalt' },
  'ai-products': { label: 'AI 产品', marker: 'PRODUCT', channelKey: 'ai', tone: 'cobalt' },
  industry: { label: '产业动态', marker: 'INDUSTRY', channelKey: 'tech', tone: 'cobalt' },
  paper: { label: '论文研究', marker: 'PAPER', channelKey: 'ai', tone: 'cyan' },
  tip: { label: '方法实践', marker: 'PRACTICE', channelKey: 'ai', tone: 'lime' }
});

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
}

function validHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : '';
  } catch (error) {
    return '';
  }
}

function normalizePublishedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanSourceLabel(value) {
  const source = cleanText(value, 120);
  if (!source) return '原发布方';
  return source
    .replace(/^(?:X|公众号|微信|网站)\s*[：:]\s*/i, '')
    .replace(/\s*[：:]\s*AI\s*[（(]\s*RSS\s*[）)]\s*$/i, '')
    .replace(/\s*[：:]\s*(?:Newsroom|Research|Blog|新闻|研究)\s*[（(][^）)]*[）)]\s*$/i, '')
    .replace(/\s*[（(]\s*RSS\s*[）)]\s*$/i, '')
    .replace(/\s*热门\s*[（(][^）)]*翻译[^）)]*[）)]\s*$/i, '')
    .trim() || '原发布方';
}

function normalizeAihotItem(input = {}) {
  const id = cleanText(input.id, 80);
  const title = cleanText(input.title, 240);
  const url = validHttpsUrl(input.url);
  const permalink = validHttpsUrl(input.permalink);
  if (!/^[a-z0-9_-]{8,80}$/i.test(id) || !title || !url || !permalink) return null;

  const category = Object.prototype.hasOwnProperty.call(CATEGORY_META, input.category)
    ? input.category
    : 'ai-products';
  const meta = CATEGORY_META[category];
  const score = Number(input.score);

  return {
    id,
    title,
    titleEn: cleanText(input.title_en, 240),
    summary: cleanText(input.summary, 1200),
    url,
    permalink,
    source: cleanSourceLabel(input.source),
    publishedAt: normalizePublishedAt(input.publishedAt),
    category,
    categoryLabel: meta.label,
    categoryMarker: meta.marker,
    channelKey: meta.channelKey,
    coverTone: meta.tone,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    attribution: {
      source: 'AI HOT',
      canonical: validHttpsUrl(input.attribution && input.attribution.canonical) || permalink
    }
  };
}

function normalizeAihotResponse(payload, limit = 20) {
  if (!payload || !Array.isArray(payload.items)) return [];
  const seen = new Set();
  return payload.items.slice(0, limit * 2).reduce((items, raw) => {
    const item = normalizeAihotItem(raw);
    if (!item || seen.has(item.id) || items.length >= limit) return items;
    seen.add(item.id);
    items.push(item);
    return items;
  }, []);
}

module.exports = { CATEGORY_META, cleanSourceLabel, normalizeAihotItem, normalizeAihotResponse };
