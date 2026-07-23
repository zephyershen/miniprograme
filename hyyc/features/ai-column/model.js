const {
  COLUMN_SECTIONS,
  COLUMN_TRACKS,
  COLUMN_LESSONS,
  COLUMN_PRACTICALS,
  COLUMN_TREND_PREVIEWS
} = require('./catalog.js');

const COLUMN_READER_CONTRACT_VERSION = 4;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function firstValue(source, keys, fallback = '') {
  if (!isRecord(source)) return fallback;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return fallback;
}

function firstArray(source, keys) {
  const value = firstValue(source, keys, []);
  return Array.isArray(value) ? value : [];
}

function unwrap(payload, keys) {
  const root = isRecord(payload && payload.data) ? payload.data : payload;
  if (!isRecord(root)) return {};
  for (const key of keys) {
    if (isRecord(root[key])) return root[key];
  }
  return root;
}

function formatUpdated(value, fallback = '持续更新') {
  if (!value) return fallback;
  if (typeof value === 'string' && /更新|本周|持续|刚刚/.test(value) && Number.isNaN(new Date(value).getTime())) {
    return value;
  }
  const date = new Date(value && value.$date ? value.$date : value);
  if (Number.isNaN(date.getTime())) return text(value, fallback);
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} 更新`;
}

function sectionTabs(activeKey = 'courses') {
  const safeKey = COLUMN_SECTIONS.some((item) => item.key === activeKey) ? activeKey : 'courses';
  return COLUMN_SECTIONS.map((item) => ({ ...item, active: item.key === safeKey }));
}

function normalizeId(item, kind, index) {
  return text(firstValue(item, ['id', `${kind}Id`, `${kind}Key`, 'dossierKey', 'slug', 'key']), `${kind}-${index + 1}`);
}

function formatLessonOrder(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return String(numeric).padStart(2, '0');
  return text(value, fallback);
}

function normalizeLessonSummary(item, index = 0, { titleOnly = false } = {}) {
  const source = isRecord(item) ? item : {};
  const base = COLUMN_LESSONS.find((lesson) => lesson.id === normalizeId(source, 'lesson', index))
    || COLUMN_LESSONS[index]
    || {};
  return {
    id: normalizeId(source, 'lesson', index),
    track: text(firstValue(source, ['track', 'trackKey']), base.track || 'understand'),
    order: formatLessonOrder(
      firstValue(source, ['order', 'indexLabel']),
      base.order || String(index + 1).padStart(2, '0')
    ),
    eyebrow: text(firstValue(source, ['term', 'eyebrow', 'category']), base.term || '课程'),
    title: text(source.title, base.title || '未命名课程'),
    subtitle: titleOnly ? '' : text(firstValue(source, ['subtitle', 'summary', 'description']), base.subtitle || ''),
    duration: titleOnly ? '' : text(firstValue(source, ['duration', 'readTime', 'readingTime']), base.duration || ''),
    updatedLabel: titleOnly ? '' : formatUpdated(firstValue(source, ['updatedLabel', 'updatedAt', 'publishedAt'], base.updatedAt), '')
  };
}

function normalizePracticalSummary(item, index = 0, { titleOnly = false } = {}) {
  const source = isRecord(item) ? item : {};
  const id = normalizeId(source, 'practical', index);
  const base = COLUMN_PRACTICALS.find((practical) => practical.id === id)
    || COLUMN_PRACTICALS[index]
    || {};
  return {
    id,
    order: formatLessonOrder(
      firstValue(source, ['order', 'indexLabel']),
      base.order || String(index + 1).padStart(2, '0')
    ),
    eyebrow: text(firstValue(source, ['term', 'eyebrow', 'category']), base.term || '动手课'),
    title: text(source.title, base.title || '未命名动手课'),
    subtitle: titleOnly ? '' : text(firstValue(source, ['subtitle', 'summary', 'description']), base.subtitle || ''),
    duration: titleOnly ? '' : text(firstValue(source, ['duration', 'readTime', 'readingTime']), base.duration || ''),
    updatedLabel: titleOnly ? '' : formatUpdated(firstValue(source, ['updatedLabel', 'updatedAt', 'publishedAt'], base.updatedAt), '')
  };
}

function normalizeCaseSummary(item, index = 0, { titleOnly = false } = {}) {
  const source = isRecord(item) ? item : {};
  return {
    id: normalizeId(source, 'case', index),
    eyebrow: text(firstValue(source, ['eyebrow', 'category', 'topic']), '本周案例'),
    title: text(source.title, '本周案例'),
    subtitle: titleOnly ? '' : text(firstValue(source, ['subtitle', 'summary', 'conclusion', 'description']), ''),
    updatedLabel: titleOnly ? '' : formatUpdated(firstValue(source, ['updatedLabel', 'updatedAt', 'publishedAt']), ''),
    sourceCount: titleOnly ? 0 : Math.max(0, Number(firstValue(source, ['sourceCount', 'evidenceCount'], 0)) || 0),
    lessonId: text(firstValue(source, ['lessonId', 'relatedLessonId'])),
    trendId: text(firstValue(source, ['trendId', 'relatedTrendId', 'dossierKey']))
  };
}

function normalizeTrendSummary(item, index = 0, { titleOnly = false } = {}) {
  const source = isRecord(item) ? item : {};
  return {
    id: normalizeId(source, 'trend', index),
    eyebrow: text(firstValue(source, ['eyebrow', 'category', 'topic']), '趋势档案'),
    title: text(source.title, '趋势档案'),
    subtitle: titleOnly ? '' : text(firstValue(source, ['subtitle', 'summary', 'currentState', 'description']), ''),
    updatedLabel: titleOnly ? '' : formatUpdated(firstValue(source, ['updatedLabel', 'updatedAt', 'publishedAt']), ''),
    statusLabel: titleOnly ? '' : text(firstValue(source, ['statusLabel', 'status', 'stage']), '持续观察')
  };
}

function normalizeTrack(item, index = 0) {
  const source = isRecord(item) ? item : {};
  const base = COLUMN_TRACKS[index] || {};
  return {
    key: text(firstValue(source, ['key', 'id', 'trackKey']), base.key || `track-${index + 1}`),
    label: text(firstValue(source, ['label', 'title']), base.label || '课程分组'),
    note: text(firstValue(source, ['note', 'summary', 'description']), base.note || '')
  };
}

function groupLessons(lessons, tracks = COLUMN_TRACKS) {
  const safeLessons = Array.isArray(lessons) ? lessons : [];
  return (Array.isArray(tracks) ? tracks : COLUMN_TRACKS).map(normalizeTrack).map((track) => ({
    ...track,
    lessons: safeLessons.filter((lesson) => lesson.track === track.key)
  })).filter((track) => track.lessons.length);
}

function previewColumnHome() {
  const lessons = COLUMN_LESSONS.map((item, index) => normalizeLessonSummary(item, index, { titleOnly: true }));
  const practicals = COLUMN_PRACTICALS
    .map((item, index) => normalizePracticalSummary(item, index, { titleOnly: true }));
  return {
    contractVersion: 0,
    updatedLabel: '',
    lessons,
    courseGroups: groupLessons(lessons),
    practicals
  };
}

function normalizeColumnHome(payload, { preview = false } = {}) {
  if (preview) return previewColumnHome();
  const source = unwrap(payload, ['home', 'columnHome']);
  const lessonItems = firstArray(source, ['lessons', 'courses', 'lessonPreviews']);
  const practicalItems = firstArray(source, ['practicals', 'handsOn', 'practiceLessons', 'practicalPreviews']);
  const trackItems = firstArray(source, ['tracks', 'courseTracks']);
  const titleOnly = Boolean(source.access && source.access.locked === true);
  const lessons = (lessonItems.length ? lessonItems : COLUMN_LESSONS)
    .map((item, index) => normalizeLessonSummary(item, index, { titleOnly }));
  const practicals = (practicalItems.length ? practicalItems : COLUMN_PRACTICALS)
    .map((item, index) => normalizePracticalSummary(item, index, { titleOnly }));
  return {
    contractVersion: Math.max(0, Number(firstValue(source, ['contractVersion'], 0)) || 0),
    updatedLabel: titleOnly ? '' : formatUpdated(firstValue(source, ['updatedLabel', 'updatedAt']), '本周更新'),
    lessons,
    courseGroups: groupLessons(lessons, trackItems.length ? trackItems : COLUMN_TRACKS),
    practicals
  };
}

function hasReadableColumnContract(home) {
  return Boolean(home) && Number(home.contractVersion) >= COLUMN_READER_CONTRACT_VERSION;
}

function normalizeColumnCases(payload) {
  const source = unwrap(payload, ['page', 'casePage']);
  const items = firstArray(source, ['items', 'cases', 'weeklyCases']).map(normalizeCaseSummary);
  const nextCursor = firstValue(source, ['nextCursor', 'cursorAfter'], null);
  const explicitHasMore = firstValue(source, ['hasMore'], null);
  return {
    items,
    nextCursor,
    hasMore: typeof explicitHasMore === 'boolean' ? explicitHasMore : Boolean(nextCursor)
  };
}

function mergeCasePages(current = [], incoming = []) {
  const merged = new Map();
  [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]
    .forEach((item) => {
      if (item && item.id) merged.set(item.id, item);
    });
  return [...merged.values()];
}

function contentContainers(source) {
  const root = isRecord(source) ? source : {};
  return [root, root.content, root.body, root.detail, root.sections].filter(isRecord);
}

function valueFromContent(source, keys) {
  for (const container of contentContainers(source)) {
    for (const key of keys) {
      if (container[key] !== undefined && container[key] !== null && container[key] !== '') {
        return container[key];
      }
    }
    const sections = Array.isArray(container.sections) ? container.sections : [];
    const match = sections.find((section) => {
      const identity = text(firstValue(section, ['key', 'type', 'label', 'title'])).toLowerCase();
      return keys.some((key) => identity === String(key).toLowerCase());
    });
    if (match) return firstValue(match, ['body', 'copy', 'text', 'items', 'points'], match);
  }
  return undefined;
}

function normalizeContentValue(value) {
  if (Array.isArray(value)) {
    return {
      body: '',
      items: value.map((item) => text(isRecord(item) ? firstValue(item, ['text', 'copy', 'title', 'label']) : item)).filter(Boolean)
    };
  }
  if (isRecord(value)) {
    const nestedItems = firstArray(value, ['items', 'steps', 'points', 'list']);
    return {
      body: text(firstValue(value, ['body', 'copy', 'text', 'summary', 'description'])),
      items: nestedItems.map((item) => text(isRecord(item) ? firstValue(item, ['text', 'copy', 'title', 'label']) : item)).filter(Boolean)
    };
  }
  return { body: text(value), items: [] };
}

function contentSection(source, key, label, aliases, tone = 'plain') {
  const content = normalizeContentValue(valueFromContent(source, aliases));
  if (!content.body && !content.items.length) return null;
  return { key, label, tone, ...content };
}

function normalizeLinks(value, kind) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const primitiveId = isRecord(item) ? '' : text(item);
    const source = isRecord(item) ? item : { id: primitiveId };
    const id = normalizeId(source, kind, index);
    const lesson = kind === 'lesson' ? COLUMN_LESSONS.find((entry) => entry.id === id) : null;
    const practical = kind === 'practical' ? COLUMN_PRACTICALS.find((entry) => entry.id === id) : null;
    const trend = kind === 'trend' ? COLUMN_TREND_PREVIEWS.find((entry) => entry.id === id) : null;
    return {
      id,
      itemId: text(firstValue(source, ['itemId', 'feedItemId']), kind === 'source' ? primitiveId : ''),
      title: text(
        firstValue(source, ['title', 'name']),
        (lesson && lesson.title)
          || (practical && practical.title)
          || (trend && trend.title)
          || (kind === 'source' ? '查看相关资讯' : '继续阅读')
      ),
      subtitle: text(
        firstValue(source, ['subtitle', 'summary', 'source', 'description']),
        (lesson && lesson.subtitle) || (practical && practical.subtitle) || (trend && trend.subtitle) || ''
      ),
      url: text(firstValue(source, ['url', 'sourceUrl'])),
      updatedLabel: formatUpdated(firstValue(source, ['updatedLabel', 'updatedAt', 'publishedAt']), '')
    };
  }).filter((item) => item.title);
}

function normalizeCommands(value) {
  return (Array.isArray(value) ? value : []).map((entry, index) => {
    const source = isRecord(entry) ? entry : { command: entry };
    return {
      id: text(firstValue(source, ['id', 'key']), `command-${index + 1}`),
      label: text(firstValue(source, ['label', 'title']), `命令 ${index + 1}`),
      value: text(firstValue(source, ['command', 'value', 'copy', 'text'])),
      platform: text(firstValue(source, ['platform', 'environment', 'system']))
    };
  }).filter((item) => item.value);
}

function normalizePlatformGuides(value) {
  return (Array.isArray(value) ? value : []).map((entry, index) => {
    const source = isRecord(entry) ? entry : {};
    const label = text(firstValue(source, ['label', 'title', 'platform']), `系统 ${index + 1}`);
    return {
      id: text(firstValue(source, ['id', 'key']), `platform-${index + 1}`),
      label,
      terminal: text(firstValue(source, ['terminal', 'shell', 'environment'])),
      commands: normalizeCommands(firstArray(source, ['commands', 'commandList'])),
      steps: firstArray(source, ['steps', 'instructions']).map((item) => text(
        isRecord(item) ? firstValue(item, ['text', 'copy', 'title', 'label']) : item
      )).filter(Boolean)
    };
  }).filter((guide) => guide.commands.length || guide.steps.length);
}

function normalizeVisual(source, fallbackTitle) {
  const content = contentContainers(source);
  let illustration = content
    .map((item) => firstValue(item, ['illustrationUrl', 'illustrationFileId', 'imageUrl', 'illustration']))
    .find(Boolean);
  const illustrationObject = isRecord(illustration) ? illustration : {};
  const imageUrl = text(isRecord(illustration)
    ? firstValue(illustrationObject, ['url', 'fileId', 'src', 'image'])
    : illustration);
  const visual = content.map((item) => firstValue(item, ['visual', 'diagram', 'blueprint'], null))
    .find(isRecord) || {};
  const nodes = firstArray(visual, ['nodes', 'points', 'items']).map((node, index) => {
    const item = isRecord(node) ? node : { label: node };
    return {
      id: text(firstValue(item, ['id', 'key']), `node-${index + 1}`),
      label: text(firstValue(item, ['label', 'title', 'name', 'text']), `节点 ${index + 1}`),
      note: text(firstValue(item, ['note', 'copy', 'description']))
    };
  });
  const connections = firstArray(visual, ['connections', 'links', 'edges']).map((link, index) => {
    const item = isRecord(link) ? link : { label: link };
    const from = text(firstValue(item, ['from', 'source']));
    const to = text(firstValue(item, ['to', 'target']));
    return {
      id: text(firstValue(item, ['id', 'key']), `link-${index + 1}`),
      label: text(firstValue(item, ['label', 'text']), from && to ? `${from} → ${to}` : ''),
      from,
      to
    };
  }).filter((item) => item.label || (item.from && item.to));
  return {
    mode: imageUrl ? 'image' : nodes.length ? 'blueprint' : 'none',
    imageUrl,
    alt: text(firstValue(illustrationObject, ['alt', 'title']), `${fallbackTitle}示意图`),
    center: text(firstValue(visual, ['center', 'centerWord', 'core', 'title', 'label']), fallbackTitle),
    note: text(firstValue(visual, ['note', 'copy', 'description', 'caption'])),
    nodes,
    connections
  };
}

function normalizePosters(source) {
  const posters = valueFromContent(source, ['posters', 'handdrawnPosters', 'posterGallery']);
  return (Array.isArray(posters) ? posters : []).slice(0, 3).map((poster, index, items) => {
    const item = isRecord(poster) ? poster : { image: poster };
    const image = text(firstValue(item, ['image', 'imageUrl', 'src', 'url']));
    return {
      key: text(firstValue(item, ['key', 'id']), `poster-${index + 1}`),
      image,
      previewImage: text(firstValue(item, ['previewImage', 'previewImageUrl', 'hdImage']), image),
      alt: text(firstValue(item, ['alt', 'title']), `手绘知识讲解第 ${index + 1} 页`),
      page: String(index + 1).padStart(2, '0'),
      position: `${index + 1} / ${items.length}`
    };
  }).filter((poster) => poster.image);
}

function posterLoadWindow(currentIndex = 0, total = 0) {
  const safeTotal = Number.isInteger(total) && total > 0 ? total : 0;
  if (!safeTotal) return [];
  const requestedIndex = Number.isInteger(currentIndex) ? currentIndex : 0;
  const safeIndex = Math.min(Math.max(requestedIndex, 0), safeTotal - 1);
  return Array.from(
    { length: safeTotal },
    (_, index) => index === safeIndex
  );
}

function posterPreviewUrls(article) {
  if (!article || !Array.isArray(article.posters)) return [];
  return article.posters
    .map((poster) => poster.previewImage || poster.image)
    .filter(Boolean);
}

function normalizeLessonDetail(payload) {
  const source = unwrap(payload, ['lesson', 'columnLesson']);
  const summary = normalizeLessonSummary(source);
  return {
    kind: 'lesson',
    eyebrow: summary.eyebrow,
    title: summary.title,
    subtitle: summary.subtitle,
    metaLabel: [summary.duration, summary.updatedLabel].filter(Boolean).join(' · '),
    leadLabel: '一句话',
    lead: text(valueFromContent(source, ['oneSentence', 'oneLiner', 'summary', 'definition', '一句话']), summary.subtitle),
    // The protected hand-drawn gallery is the explanatory visual for basic
    // lessons. Suppress the old generated blueprint because it repeats the
    // prose without adding information.
    visual: normalizeVisual({}, summary.title),
    posters: normalizePosters(source),
    platformGuides: [],
    commands: [],
    sections: [
      contentSection(source, 'scenario', '举个例子', ['workplaceScenario', 'scenario', 'example', '职场场景', '例子']),
      contentSection(source, 'steps', '照着做', ['steps', 'howTo', 'copySteps', '照着做'], 'steps'),
      contentSection(source, 'pitfalls', '容易踩坑', ['pitfalls', 'commonMistakes', '踩坑'], 'warning'),
      contentSection(source, 'avoid', '这些情况先别交给 AI', ['avoid', 'avoidWhen', 'dontUseWhen', 'dontUse', 'notFor', '不要用'], 'muted'),
      contentSection(source, 'conclusion', '记住这一句', ['conclusion', 'takeaway', '结论'], 'conclusion')
    ].filter(Boolean),
    relatedLessons: normalizeLinks(valueFromContent(source, ['relatedLessons', 'lessons', 'relatedLessonIds']), 'lesson'),
    relatedPracticals: normalizeLinks(
      valueFromContent(source, ['relatedPracticals', 'practicals', 'relatedPracticalIds']),
      'practical'
    ),
    relatedTrends: [],
    sources: normalizeLinks(valueFromContent(source, ['sources', 'evidence', 'references']), 'source')
  };
}

function normalizePracticalDetail(payload) {
  const source = unwrap(payload, ['practical', 'columnPractical']);
  const summary = normalizePracticalSummary(source);
  return {
    kind: 'practical',
    eyebrow: summary.eyebrow,
    title: summary.title,
    subtitle: summary.subtitle,
    metaLabel: [summary.duration, summary.updatedLabel].filter(Boolean).join(' · '),
    leadLabel: '这次要做什么',
    lead: text(
      valueFromContent(source, ['goal', 'outcome', 'oneSentence', 'summary', 'intro', '这次要做什么']),
      summary.subtitle
    ),
    // Hands-on lessons are procedural. Ignore legacy overview diagrams so old
    // cached payloads cannot bring the decorative blueprint back.
    visual: normalizeVisual({}, summary.title),
    posters: normalizePosters(source),
    platformGuides: normalizePlatformGuides(valueFromContent(
      source,
      ['platformGuides', 'installationGuides', 'systemGuides']
    )),
    commands: normalizeCommands(valueFromContent(source, ['commands', 'commandList'])),
    sections: [
      contentSection(source, 'prepare', '开始前准备', ['prerequisites', 'requirements', 'prepare', 'beforeStart', '准备']),
      contentSection(source, 'steps', '跟着做', ['steps', 'commands', 'howTo', 'guide', '照着做'], 'steps'),
      contentSection(source, 'check', '怎么确认成功', ['verification', 'successCheck', 'check', 'acceptance', '验收'], 'conclusion'),
      contentSection(source, 'troubleshooting', '卡住了先看这里', ['troubleshooting', 'commonErrors', 'pitfalls', 'errors', '排错'], 'warning'),
      contentSection(source, 'avoid', '这些情况先别交给 AI', ['avoid', 'avoidWhen', 'dontUseWhen', 'dontUse', 'notFor', '不要用'], 'muted'),
      contentSection(source, 'conclusion', '记住这一句', ['conclusion', 'takeaway', 'remember', '结论'], 'conclusion')
    ].filter(Boolean),
    relatedLessons: normalizeLinks(
      valueFromContent(source, ['relatedLessons', 'lessons', 'relatedLessonIds', 'relatedCourseIds']),
      'lesson'
    ),
    relatedPracticals: normalizeLinks(
      valueFromContent(source, ['relatedPracticals', 'practicals', 'relatedPracticalIds']),
      'practical'
    ),
    relatedTrends: [],
    sources: normalizeLinks(valueFromContent(source, ['sources', 'evidence', 'references']), 'source')
  };
}

function normalizeCaseDetail(payload) {
  const source = unwrap(payload, ['case', 'columnCase']);
  const summary = normalizeCaseSummary(source);
  const lessonLinks = valueFromContent(source, ['relatedLessons', 'lessons', 'relatedLessonIds']);
  const trendLinks = valueFromContent(source, ['relatedTrends', 'trends', 'dossiers'])
    || (text(firstValue(source, ['dossierKey', 'trendId'])) ? [text(firstValue(source, ['dossierKey', 'trendId']))] : []);
  const sourceLinks = valueFromContent(source, ['sources', 'evidence', 'references', 'sourceItemIds']);
  return {
    kind: 'case',
    eyebrow: summary.eyebrow,
    title: summary.title,
    subtitle: summary.subtitle,
    metaLabel: summary.updatedLabel,
    leadLabel: '结论',
    lead: text(valueFromContent(source, ['conclusion', 'summary', '结论']), summary.subtitle),
    visual: normalizeVisual(source, summary.title),
    posters: [],
    platformGuides: [],
    commands: [],
    sections: [
      contentSection(source, 'happened', '发生了什么', ['whatHappened', 'happened', '发生了什么']),
      contentSection(source, 'meaning', '对你意味着什么', ['whatItMeans', 'meaning', 'impact', '对你意味着什么']),
      contentSection(source, 'try', '可以试什么', ['tryNow', 'whatToTry', 'tryNext', 'actions', '可以试什么'], 'steps'),
      contentSection(source, 'calm', '不必焦虑什么', ['noNeedToWorry', 'dontWorry', 'notAnxiety', 'calmDown', '不必焦虑什么'], 'muted')
    ].filter(Boolean),
    relatedLessons: normalizeLinks(lessonLinks, 'lesson'),
    relatedPracticals: [],
    relatedTrends: normalizeLinks(trendLinks, 'trend'),
    sources: normalizeLinks(sourceLinks, 'source')
  };
}

function normalizeTimeline(value) {
  return (Array.isArray(value) ? value : []).map((entry, index) => {
    const item = isRecord(entry) ? entry : { copy: entry };
    const rawDate = firstValue(item, ['dateLabel', 'date', 'time', 'period', 'publishedAt']);
    const date = new Date(rawDate && rawDate.$date ? rawDate.$date : rawDate);
    return {
      id: text(firstValue(item, ['id', 'key']), `timeline-${index + 1}`),
      caseId: text(firstValue(item, ['caseId', 'relatedCaseId'])),
      dateLabel: Number.isNaN(date.getTime())
        ? text(rawDate, `节点 ${index + 1}`)
        : `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`,
      title: text(firstValue(item, ['title', 'label', 'event'])),
      copy: text(firstValue(item, ['copy', 'description', 'summary', 'text', 'conclusion'])),
      sources: firstArray(item, ['sources', 'evidence', 'references'])
    };
  }).filter((item) => item.title || item.copy);
}

function uniqueLinks(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.itemId || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTrendDossier(payload) {
  const source = unwrap(payload, ['trend', 'dossier', 'trendDossier']);
  const summary = normalizeTrendSummary(source);
  const timeline = normalizeTimeline(valueFromContent(source, ['timeline', 'events', '时间线']));
  const explicitCases = normalizeLinks(valueFromContent(source, ['relatedCases', 'cases']), 'case');
  const timelineCases = normalizeLinks(
    timeline.filter((item) => item.caseId).map((item) => ({ id: item.caseId, title: item.title, subtitle: item.copy })),
    'case'
  );
  const explicitSources = normalizeLinks(valueFromContent(source, ['sources', 'evidence', 'references']), 'source');
  const timelineSources = normalizeLinks(
    timeline.reduce((items, item) => items.concat(item.sources), []),
    'source'
  );
  return {
    id: summary.id,
    eyebrow: summary.eyebrow,
    title: summary.title,
    subtitle: summary.subtitle,
    metaLabel: `${summary.statusLabel} · ${summary.updatedLabel}`,
    leadLabel: '现状',
    lead: text(valueFromContent(source, ['currentState', 'current', 'statusSummary', '现状']), summary.subtitle),
    visual: normalizeVisual(source, summary.title),
    sections: [
      contentSection(source, 'available', '已经可用', ['usableNow', 'availableNow', 'available', '已可用'], 'steps'),
      contentSection(source, 'unreliable', '仍不可靠', ['unreliableNow', 'stillUnreliable', 'unreliable', '仍不可靠'], 'warning'),
      contentSection(source, 'audience', '适合谁', ['forWhom', 'whoFor', 'bestFor', 'suitableFor', 'audience', '适合谁']),
      contentSection(source, 'next', '下一观察点', ['nextWatch', 'nextObservation', '下一观察点'], 'conclusion')
    ].filter(Boolean),
    timeline,
    relatedLessons: normalizeLinks(valueFromContent(source, ['relatedLessons', 'lessons', 'relatedLessonIds']), 'lesson'),
    relatedCases: uniqueLinks([...explicitCases, ...timelineCases]),
    sources: uniqueLinks([...explicitSources, ...timelineSources])
  };
}

function normalizeReader(type, payload) {
  if (type === 'practical') return normalizePracticalDetail(payload);
  return type === 'case' ? normalizeCaseDetail(payload) : normalizeLessonDetail(payload);
}

module.exports = {
  COLUMN_READER_CONTRACT_VERSION,
  sectionTabs,
  formatUpdated,
  normalizeLessonSummary,
  normalizePracticalSummary,
  normalizeCommands,
  normalizePlatformGuides,
  normalizeTrack,
  groupLessons,
  normalizeCaseSummary,
  normalizeTrendSummary,
  previewColumnHome,
  normalizeColumnHome,
  hasReadableColumnContract,
  normalizeColumnCases,
  mergeCasePages,
  normalizeVisual,
  normalizePosters,
  posterLoadWindow,
  posterPreviewUrls,
  normalizeLessonDetail,
  normalizePracticalDetail,
  normalizeCaseDetail,
  normalizeTrendDossier,
  normalizeReader
};
