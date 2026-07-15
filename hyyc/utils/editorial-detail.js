function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function clipText(value, maxLength) {
  const text = cleanText(value);
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).replace(/[，、；：,.!?。！？\s]+$/g, '')}…`;
}

function splitSentences(value) {
  const text = cleanText(value);
  if (!text) return [];
  return (text.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
    .map(cleanText)
    .filter((sentence) => sentence.length >= 8);
}

function splitClauses(value) {
  return cleanText(value)
    .split(/[，,；;：:]/)
    .map(cleanText)
    .filter((clause) => clause.length >= 10);
}

function normalizedKey(value) {
  return cleanText(value).replace(/[\s，、；：,.!?。！？“”"'（）()\-—]/g, '').slice(0, 48);
}

function buildReadingGuide(summary) {
  const text = cleanText(summary);
  if (!text) return { brief: '', keyPoints: [] };

  const sentences = splitSentences(text);
  const brief = clipText(sentences[0] || text, 56);
  const candidates = [...sentences.slice(1), ...splitClauses(text)];
  const seen = new Set([normalizedKey(brief)]);
  const keyPoints = [];

  for (const candidate of candidates) {
    const point = clipText(candidate, 58);
    const key = normalizedKey(point);
    if (!key || seen.has(key) || keyPoints.some((entry) => key.includes(normalizedKey(entry.text)))) continue;
    seen.add(key);
    keyPoints.push({ indexLabel: String(keyPoints.length + 1).padStart(2, '0'), text: point });
    if (keyPoints.length === 3) break;
  }

  return { brief, keyPoints };
}

function buildRelatedItems(items, current, limit = 3) {
  if (!current || !Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.id !== current.id && item.coverFileId)
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
