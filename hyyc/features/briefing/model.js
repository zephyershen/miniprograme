const WINDOW_OPTIONS = Object.freeze([
  { key: '24h', label: '日报', description: '前一自然日' },
  { key: '7d', label: '周报', description: '上一自然周' },
  { key: '30d', label: '月报', description: '上一自然月' }
]);

const TOPIC_FILTERS = Object.freeze([
  { key: 'all', label: '全部' },
  { key: 'company', label: '公司动态' },
  { key: 'model', label: '模型更新' },
  { key: 'tools', label: '开发工具' },
  { key: 'trend', label: '趋势变化' }
]);

const TOPIC_KEYS = Object.freeze(TOPIC_FILTERS.slice(1).map((item) => item.key));
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const TOPIC_EMPTY_TITLES = Object.freeze({
  all: '本期暂无可展示内容',
  company: '本期暂无公司动态',
  model: '本期暂无模型更新',
  tools: '本期暂无开发工具动态',
  trend: '本期暂无明确趋势变化'
});

const TOPIC_ALIASES = Object.freeze({
  company: Object.freeze(['company', 'companies', '公司', '公司动态', '企业', '厂商']),
  model: Object.freeze(['model', 'models', '模型', '模型更新', '大模型', 'agi']),
  tools: Object.freeze(['tool', 'tools', '开发工具', '工具', '开发者工具']),
  trend: Object.freeze(['trend', 'trends', '趋势', '趋势变化', '行业趋势'])
});

const TOPIC_TERMS = Object.freeze({
  company: Object.freeze([
    'openai', 'anthropic', 'google', 'deepmind', 'microsoft', 'meta', 'nvidia',
    'xai', 'alibaba', 'qwen', '通义', '阿里', 'kimi', '月之暗面', 'deepseek',
    '腾讯', '百度', '字节', '智谱', 'minimax', '面壁', '阶跃星辰', '苹果', 'apple'
  ]),
  model: Object.freeze([
    'model', 'models', '模型', '大模型', '多模态', '推理模型', 'agi', 'gpt',
    'claude', 'gemini', 'qwen', '通义', 'kimi', 'deepseek', 'llama', 'glm',
    'grok', 'mistral', 'minimax', '参数量', '上下文', '开源权重'
  ]),
  tools: Object.freeze([
    'tool', 'tools', '开发工具', '工具链', 'sdk', 'api', 'mcp', 'ide', 'cursor',
    'copilot', 'codex', 'github', '工作流', '编程', '编码', '代码助手', 'agent'
  ]),
  trend: Object.freeze([
    'trend', 'trends', '趋势', '格局', '生态', '监管', '治理', '安全', '融资',
    '投资', '增长', '变化', '行业', '商业化', '价格战', '开源', 'open-source'
  ])
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstSourceId(item) {
  if (item && item.itemId) return item.itemId;
  return safeArray(item && item.sourceItemIds)[0] || '';
}

function normalizedSignal(value) {
  return String(value || '').trim().toLowerCase();
}

function containsTerm(text, term) {
  const normalizedTerm = normalizedSignal(term);
  if (!normalizedTerm) return false;
  if (/^[a-z0-9-]+$/.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(normalizedTerm);
}

function normalizeTopicKeys(item = {}, defaultTopicKeys = []) {
  item = item && typeof item === 'object' ? item : {};
  const keys = new Set(safeArray(defaultTopicKeys).filter((key) => TOPIC_KEYS.includes(key)));
  const explicitSignals = safeArray(item.topicKeys).concat(safeArray(item.tags))
    .map(normalizedSignal)
    .filter(Boolean);

  explicitSignals.forEach((signal) => {
    TOPIC_KEYS.forEach((key) => {
      if (signal === key || signal.startsWith(`${key}:`) || TOPIC_ALIASES[key].includes(signal)) {
        keys.add(key);
      }
    });
  });

  const text = explicitSignals.concat([
    item.title,
    item.name,
    item.why,
    item.impact,
    item.copy,
    item.source,
    item.sourceName
  ]).map(normalizedSignal).filter(Boolean).join(' | ');

  TOPIC_KEYS.forEach((key) => {
    if (TOPIC_TERMS[key].some((term) => containsTerm(text, term))) keys.add(key);
  });

  return TOPIC_KEYS.filter((key) => keys.has(key));
}

function normalizeReference(item = {}, index = 0, defaultTopicKeys = []) {
  item = item && typeof item === 'object' ? item : {};
  return {
    ...item,
    index: item.index || String(index + 1).padStart(2, '0'),
    itemId: firstSourceId(item),
    title: item.title || item.name || '',
    name: item.name || item.title || '',
    why: item.why || item.impact || item.copy || '',
    copy: item.copy || item.why || item.impact || '',
    source: item.source || item.sourceName || '',
    topicKeys: normalizeTopicKeys(item, defaultTopicKeys)
  };
}

function formatBriefDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shanghaiDate = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const datePart = `${String(shanghaiDate.getUTCMonth() + 1).padStart(2, '0')}.${String(shanghaiDate.getUTCDate()).padStart(2, '0')}`;
  if (!includeTime) return datePart;
  return `${datePart} ${String(shanghaiDate.getUTCHours()).padStart(2, '0')}:${String(shanghaiDate.getUTCMinutes()).padStart(2, '0')}`;
}

function formatCoverageLabel(windowStart, windowEnd) {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return '';
  const startLabel = formatBriefDate(start);
  const inclusiveEndLabel = formatBriefDate(new Date(end.getTime() - 1));
  if (!startLabel || !inclusiveEndLabel) return '';
  return startLabel === inclusiveEndLabel
    ? `覆盖 ${startLabel}`
    : `覆盖 ${startLabel}—${inclusiveEndLabel}`;
}

function uniqueReading(items) {
  const seen = new Set();
  return items.map((item, index) => normalizeReference(item, index)).filter((item) => {
    const key = item.itemId || `${item.title}|${item.source}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasTopic(item, topic) {
  if (topic === 'all') return true;
  return normalizeTopicKeys(item).includes(topic);
}

function formatMustKnowTitle(count) {
  return count > 0 ? `先看这${count}件事` : '本期暂无核心事项';
}

function filterBriefing(briefing, topic = 'all') {
  const filter = TOPIC_FILTERS.find((item) => item.key === topic) || TOPIC_FILTERS[0];
  const filtered = {
    ...briefing,
    mustKnow: safeArray(briefing && briefing.mustKnow).filter((item) => hasTopic(item, filter.key)),
    radar: safeArray(briefing && briefing.radar).filter((item) => hasTopic(item, filter.key)),
    reading: safeArray(briefing && briefing.reading).filter((item) => hasTopic(item, filter.key))
  };
  const topicEmpty = ['mustKnow', 'radar', 'reading']
    .every((section) => filtered[section].length === 0)
    && !(filter.key === 'all' && filtered.conclusion);
  return {
    ...filtered,
    mustKnowCount: filtered.mustKnow.length,
    mustKnowTitle: formatMustKnowTitle(filtered.mustKnow.length),
    topicKey: filter.key,
    topicLabel: filter.label,
    topicEmpty,
    topicEmptyTitle: TOPIC_EMPTY_TITLES[filter.key],
    topicEmptyCopy: filter.key === 'all'
      ? '下一期发布后会在这里呈现重点与来源。'
      : '切换到“全部”，查看本期其他值得关注的变化。'
  };
}

function normalizeBriefing(raw = {}) {
  const fallbackCoverage = formatCoverageLabel(raw.windowStart, raw.windowEnd);
  const followUps = safeArray(raw.followUps);
  const sourceIndex = safeArray(raw.sourceIndex);
  const normalized = {
    id: raw.id || raw.digestId || '',
    status: raw.status || 'pending',
    sample: raw.sample === true,
    title: raw.title || '本期简报',
    conclusion: raw.conclusion || raw.executiveSummary || '',
    coverageLabel: raw.coverageLabel || fallbackCoverage,
    generatedLabel: raw.generatedLabel || (formatBriefDate(raw.generatedAt, true)
      ? `更新于 ${formatBriefDate(raw.generatedAt, true)}`
      : ''),
    mustKnow: safeArray(raw.mustKnow).map((item, index) => normalizeReference(item, index)),
    radar: safeArray(raw.radar).map((item, index) => {
      const reference = normalizeReference(item, index);
      return reference.topicKeys.length
        ? reference
        : { ...reference, topicKeys: ['company'] };
    }),
    reading: uniqueReading(safeArray(raw.reading).length
      ? safeArray(raw.reading)
      : followUps.concat(sourceIndex)),
    sourceCount: Number(raw.sourceCount) || sourceIndex.length
  };
  return filterBriefing(normalized, 'all');
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
  normalizeTopicKeys,
  formatCoverageLabel,
  normalizeBriefing,
  filterBriefing,
  createBriefingState
};
