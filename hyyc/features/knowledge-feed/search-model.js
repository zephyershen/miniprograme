const { decorateSourcePresentation } = require('./source-presentation.js');
const { decorateRecommendationHeat } = require('./recommendation-heat.js');

function formatSearchDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function highlightText(value, query) {
  const text = String(value || '');
  const needle = String(query || '').trim();
  if (!text || !needle) return text ? [{ text, highlighted: false }] : [];
  const source = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts = [];
  let offset = 0;
  let index = source.indexOf(target, offset);
  while (index >= 0 && parts.length < 40) {
    if (index > offset) parts.push({ text: text.slice(offset, index), highlighted: false });
    parts.push({
      text: text.slice(index, index + needle.length),
      highlighted: true
    });
    offset = index + needle.length;
    index = source.indexOf(target, offset);
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), highlighted: false });
  return parts;
}

function decorateSearchItem(item = {}, query = '') {
  const searchKind = item.kind || 'feed';
  const decorated = decorateSourcePresentation({
    ...item,
    searchKey: `${searchKind}:${item.id || ''}`,
    publishedLabel: formatSearchDate(item.publishedAt),
    categoryDisplay: item.categoryLabel || item.category || 'AI 资讯',
    listVisualUrl: item.listVisualUrl || '',
    titleParts: highlightText(item.title, query),
    summaryParts: highlightText(item.summary, query)
  });
  return ['column', 'briefing'].includes(item.kind)
    ? decorated
    : decorateRecommendationHeat(decorated);
}

function mergeSearchItems(current = [], incoming = [], query = '') {
  const byId = new Map();
  [...current, ...incoming].forEach((item) => {
    if (!item || !item.id) return;
    const decorated = decorateSearchItem(item, query);
    byId.set(decorated.searchKey, decorated);
  });
  return [...byId.values()];
}

function searchQueryError(value) {
  const length = Array.from(String(value || '').trim()).length;
  if (length < 2) return '至少输入 2 个字符';
  if (length > 50) return '关键词最多 50 个字符';
  return '';
}

function searchFailureState(error = {}) {
  const indexPreparing = error.code === 'SEARCH_UNAVAILABLE';
  const membershipRequired = error.code === 'ENTITLEMENT_REQUIRED';
  return {
    indexPreparing,
    membershipRequired,
    message: indexPreparing
      ? '搜索索引正在准备，请稍后再试'
      : (error.message || '搜索暂时不可用')
  };
}

module.exports = {
  formatSearchDate,
  highlightText,
  decorateSearchItem,
  mergeSearchItems,
  searchQueryError,
  searchFailureState
};
