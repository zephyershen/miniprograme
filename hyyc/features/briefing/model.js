const WINDOW_OPTIONS = Object.freeze([
  { key: '24h', label: '24 小时' },
  { key: '7d', label: '7 天' },
  { key: '30d', label: '30 天' }
]);

const TOPIC_FILTERS = Object.freeze([
  { key: 'all', label: '全部' },
  { key: 'company', label: '公司动态' },
  { key: 'model', label: '模型更新' },
  { key: 'tools', label: '开发工具' },
  { key: 'trend', label: '趋势变化' }
]);

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstSourceId(item) {
  if (item && item.itemId) return item.itemId;
  return safeArray(item && item.sourceItemIds)[0] || '';
}

function normalizeReference(item = {}, index = 0) {
  return {
    ...item,
    index: item.index || String(index + 1).padStart(2, '0'),
    itemId: firstSourceId(item),
    title: item.title || item.name || '',
    why: item.why || item.impact || item.copy || '',
    copy: item.copy || item.why || item.impact || '',
    source: item.source || item.sourceName || ''
  };
}

function formatBriefDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  if (!includeTime) return datePart;
  return `${datePart} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function uniqueReading(items) {
  const seen = new Set();
  return items.map(normalizeReference).filter((item) => {
    const key = item.itemId || `${item.title}|${item.source}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasTopic(item, topic) {
  const tags = safeArray(item && (item.tags || item.topicKeys));
  return topic === 'all' || tags.includes(topic) || tags.some((tag) => tag.startsWith(`${topic}:`));
}

function filterBriefing(briefing, topic = 'all') {
  return {
    ...briefing,
    mustKnow: safeArray(briefing.mustKnow).filter((item) => hasTopic(item, topic)),
    trends: safeArray(briefing.trends).filter((item) => hasTopic(item, topic)),
    radar: safeArray(briefing.radar).filter((item) => hasTopic(item, topic)),
    reading: safeArray(briefing.reading).filter((item) => hasTopic(item, topic))
  };
}

function normalizeBriefing(raw = {}) {
  const coverage = raw.coverage && typeof raw.coverage === 'object' ? raw.coverage : {};
  const windowStartLabel = formatBriefDate(raw.windowStart);
  const windowEndLabel = formatBriefDate(raw.windowEnd);
  const fallbackCoverage = windowStartLabel && windowEndLabel
    ? `覆盖 ${windowStartLabel}—${windowEndLabel}`
    : '';
  const followUps = safeArray(raw.followUps);
  const sourceIndex = safeArray(raw.sourceIndex);
  return {
    id: raw.id || raw.digestId || '',
    status: raw.status || 'pending',
    sample: raw.sample === true,
    title: raw.title || '本期简报',
    conclusion: raw.conclusion || raw.executiveSummary || '',
    coverageLabel: raw.coverageLabel || fallbackCoverage,
    generatedLabel: raw.generatedLabel || (formatBriefDate(raw.generatedAt, true)
      ? `生成于 ${formatBriefDate(raw.generatedAt, true)}`
      : ''),
    mustKnow: safeArray(raw.mustKnow).map(normalizeReference),
    trends: safeArray(raw.trends).map(normalizeReference),
    radar: safeArray(raw.radar).map(normalizeReference),
    reading: uniqueReading(safeArray(raw.reading).length
      ? safeArray(raw.reading)
      : followUps.concat(sourceIndex)),
    sourceCount: Number(raw.sourceCount) || sourceIndex.length,
    coverageState: raw.coverageState || coverage.state || 'partial',
    coverageRatio: Number(coverage.ratio) || 0
  };
}

function createBriefingState() {
  return {
    loading: true,
    error: '',
    locked: false,
    providerPending: false,
    windowKey: '24h',
    windowOptions: WINDOW_OPTIONS.map((item) => ({ ...item, active: item.key === '24h' })),
    topicKey: 'all',
    topicOptions: TOPIC_FILTERS.map((item) => ({ ...item, active: item.key === 'all' })),
    briefing: normalizeBriefing()
  };
}

module.exports = {
  WINDOW_OPTIONS,
  TOPIC_FILTERS,
  normalizeBriefing,
  filterBriefing,
  createBriefingState
};
