const RELEVANCE = {
  high: { label: '很相关', tone: 'high' },
  medium: { label: '可能有用', tone: 'medium' },
  low: { label: '关系较弱', tone: 'low' },
  none: { label: '目前无关', tone: 'none' }
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function relevanceMeta(level) {
  return RELEVANCE[level] || RELEVANCE.none;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toFixed(number >= 1 ? 2 : 3);
}

module.exports = {
  formatDate,
  relevanceMeta,
  formatMoney
};
