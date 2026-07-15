function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function splitSentences(value) {
  const text = cleanText(value);
  if (!text) return [];
  return (text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
    .map(cleanText)
    .filter((sentence) => sentence.length >= 8);
}

function splitLongUnit(value, maxLength = 88) {
  const text = cleanText(value);
  if (!text || text.length <= maxLength) return text ? [text] : [];
  const clauses = (text.match(/[^，,；;：:]+[，,；;：:]?/g) || []).map(cleanText).filter(Boolean);
  if (clauses.length < 2) return [text];
  const groups = [];
  let current = '';
  for (const clause of clauses) {
    if (current && current.length + clause.length > maxLength) {
      groups.push(current);
      current = clause;
    } else {
      current += clause;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function buildReadingGuide(summary) {
  const text = cleanText(summary);
  if (!text) return { brief: '', keyPoints: [] };

  const sentences = splitSentences(text);
  const units = (sentences.length ? sentences : [text]).flatMap((sentence) => splitLongUnit(sentence));
  const brief = units[0] || text;
  const keyPoints = units.slice(1).map((unit, index) => ({
    indexLabel: String(index + 1).padStart(2, '0'),
    text: unit
  }));

  return { brief, keyPoints };
}

function buildRelatedItems(items, current, limit = 3) {
  if (!current || !Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.id !== current.id)
    .map((item, originalIndex) => ({
      ...item,
      originalIndex,
      relationRank: item.category === current.category ? 0 : item.channelKey === current.channelKey ? 1 : 2
    }))
    .sort((left, right) => {
      if (left.relationRank !== right.relationRank) return left.relationRank - right.relationRank;
      const dateDifference = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
      return Number.isFinite(dateDifference) && dateDifference !== 0
        ? dateDifference
        : left.originalIndex - right.originalIndex;
    })
    .slice(0, limit)
    .map(({ originalIndex, relationRank, ...item }) => item);
}

function getHostname(value) {
  const match = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(cleanText(value));
  if (!match || match[1].includes('@')) return '';
  return match[1].split(':')[0].toLowerCase();
}

function getOriginAction(url, directWebviewHosts = []) {
  const hostname = getHostname(url);
  const canOpen = Boolean(hostname && directWebviewHosts.includes(hostname));
  return {
    hostname,
    canOpen,
    label: canOpen ? '打开原始出处' : '复制原文链接',
    note: canOpen
      ? '将打开原发布页面，实际加载速度取决于来源网站。'
      : '复制后可在浏览器查看；部分境外来源可能访问较慢。'
  };
}

module.exports = {
  buildReadingGuide,
  buildRelatedItems,
  getOriginAction
};
