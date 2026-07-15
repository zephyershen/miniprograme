function limitCharacters(value, max) {
  return Array.from(String(value || '').trim()).slice(0, max).join('');
}

function extractSentences(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const matches = normalized.match(/[^.!?。！？]+[.!?。！？]?/g) || [];
  return matches
    .map((sentence) => sentence.trim())
    .filter((sentence) => Array.from(sentence).length >= 20);
}

function buildFallbackDigest(article) {
  const sentences = extractSentences(article.text);
  const keySentences = (sentences.length ? sentences : [article.title])
    .slice(0, 3)
    .map((source) => ({ source: limitCharacters(source, 240), translationZh: '' }));
  const summarySource = sentences.slice(0, 2).join(' ') || article.title;

  return {
    summaryZh: limitCharacters(`AI 暂不可用，临时摘录：${summarySource}`, 120),
    relevanceLevel: 'low',
    relevanceReasonZh: 'AI 额度暂不可用，尚未完成个性化相关性判断。',
    keySentences,
    candidateConclusion: limitCharacters(`临时结论：${article.title}`, 60),
    candidateUseWhen: '仅供临时浏览；AI 恢复后建议重新核对。'
  };
}

module.exports = {
  limitCharacters,
  extractSentences,
  buildFallbackDigest
};
