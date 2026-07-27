const crypto = require('node:crypto');
const {
  COLUMN_TRACKS,
  COLUMN_LESSONS
} = require('./column-lessons');
const {
  PRACTICAL_TRACKS,
  PRACTICAL_LESSONS
} = require('./practical-lessons');
const { findColumnMedia } = require('./ai-column-media');

const ENTRY_KINDS = Object.freeze(['course', 'practical']);
const BUILTIN_MEDIA_PREFIX = 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/ai-column/posters-hd/v2/';
const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const MEDIA_ID_PATTERN = /^[a-f0-9]{48}$/;
const MUTATION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,79}$/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function textList(value, maximum = 1000) {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, maximum))
    .filter(Boolean);
}

function positiveOrder(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(999999, number) : fallback;
}

function normalizeCommand(value, index) {
  const item = value && typeof value === 'object' ? value : {};
  const command = text(item.command || item.value, 4000);
  if (!command) return null;
  return {
    id: text(item.id, 64) || `command-${index + 1}`,
    label: text(item.label || item.title, 120) || `命令 ${index + 1}`,
    command,
    platform: text(item.platform, 120)
  };
}

function normalizePlatformGuide(value, index) {
  const item = value && typeof value === 'object' ? value : {};
  const commands = (Array.isArray(item.commands) ? item.commands : [])
    .map(normalizeCommand)
    .filter(Boolean);
  const steps = textList(item.steps, 1000);
  if (!commands.length && !steps.length) return null;
  return {
    id: text(item.id, 64) || `platform-${index + 1}`,
    label: text(item.label || item.title, 120) || `平台 ${index + 1}`,
    terminal: text(item.terminal, 120),
    commands,
    steps
  };
}

function normalizeSource(value, index) {
  const item = value && typeof value === 'object' ? value : {};
  const title = text(item.title || item.label, 200);
  const url = text(item.url, 2048);
  const itemId = text(item.itemId, 80);
  if (!title && !url && !itemId) return null;
  return {
    id: text(item.id, 64) || `source-${index + 1}`,
    title: title || '查看原始来源',
    url: /^https:\/\//i.test(url) ? url : '',
    itemId: ENTRY_ID_PATTERN.test(itemId) ? itemId : '',
    verifiedAt: text(item.verifiedAt, 40)
  };
}

function normalizePoster(value, index) {
  const item = value && typeof value === 'object' ? value : {};
  const mediaId = text(item.mediaId, 48);
  const fileId = text(item.fileId, 1024);
  if (!MEDIA_ID_PATTERN.test(mediaId)
    && !(fileId && fileId.startsWith(BUILTIN_MEDIA_PREFIX))) return null;
  return {
    key: text(item.key, 80) || mediaId || `builtin-${index + 1}`,
    ...(MEDIA_ID_PATTERN.test(mediaId) ? { mediaId } : {}),
    ...(fileId.startsWith(BUILTIN_MEDIA_PREFIX) ? { fileId } : {}),
    alt: text(item.alt, 240) || `课程讲解图第 ${index + 1} 页`
  };
}

function normalizeCommon(kind, input, id) {
  const item = input && typeof input === 'object' ? input : {};
  return {
    id,
    kind,
    track: text(item.track, 64),
    order: positiveOrder(item.order),
    term: text(item.term, 40),
    tags: [...new Set(textList(item.tags, 40))].slice(0, 20),
    title: text(item.title, 100),
    subtitle: text(item.subtitle, 240),
    duration: text(item.duration, 80),
    posters: (Array.isArray(item.posters) ? item.posters : [])
      .map(normalizePoster)
      .filter(Boolean),
    relatedCourseIds: textList(
      item.relatedCourseIds || item.relatedLessonIds,
      80
    ).filter((value) => ENTRY_ID_PATTERN.test(value)),
    relatedPracticalIds: textList(item.relatedPracticalIds, 80)
      .filter((value) => ENTRY_ID_PATTERN.test(value))
  };
}

function normalizeCourse(input, id) {
  const common = normalizeCommon('course', input, id);
  const sections = input && input.sections && typeof input.sections === 'object'
    ? input.sections
    : {};
  return {
    ...common,
    track: common.track || COLUMN_TRACKS[0].key,
    term: common.term || 'KNOWLEDGE',
    visual: { mode: 'none', nodes: [] },
    sections: {
      summary: text(sections.summary, 5000),
      scenario: text(sections.scenario, 5000),
      steps: textList(sections.steps, 1000),
      pitfalls: textList(sections.pitfalls, 1000),
      avoid: text(sections.avoid, 5000),
      takeaway: text(sections.takeaway, 5000)
    }
  };
}

function normalizePractical(input, id) {
  const common = normalizeCommon('practical', input, id);
  const sections = input && input.sections && typeof input.sections === 'object'
    ? input.sections
    : {};
  return {
    ...common,
    track: common.track || PRACTICAL_TRACKS[0].key,
    term: common.term || 'PRACTICAL',
    catalogTitle: common.title,
    goal: text(input && input.goal, 5000),
    verifiedAt: text(input && input.verifiedAt, 40),
    platformGuides: (Array.isArray(input && input.platformGuides)
      ? input.platformGuides
      : []).map(normalizePlatformGuide).filter(Boolean),
    commands: (Array.isArray(input && input.commands) ? input.commands : [])
      .map(normalizeCommand)
      .filter(Boolean),
    sources: (Array.isArray(input && input.sources) ? input.sources : [])
      .map(normalizeSource)
      .filter(Boolean),
    sections: {
      prerequisites: textList(sections.prerequisites, 1000),
      steps: textList(sections.steps, 1000),
      verification: textList(sections.verification, 1000),
      troubleshooting: textList(sections.troubleshooting, 1000),
      pitfalls: textList(sections.pitfalls, 1000),
      avoid: text(sections.avoid, 5000),
      takeaway: text(sections.takeaway, 5000)
    }
  };
}

function normalizeEntryContent(kindValue, input, idValue) {
  const kind = ENTRY_KINDS.includes(kindValue) ? kindValue : '';
  const id = text(idValue || (input && input.id), 80);
  if (!kind || !ENTRY_ID_PATTERN.test(id)) throw new Error('COLUMN_ENTRY_ID_INVALID');
  return kind === 'course'
    ? normalizeCourse(input, id)
    : normalizePractical(input, id);
}

function validatePublishable(content) {
  const errors = [];
  if (!content || !ENTRY_KINDS.includes(content.kind)) errors.push('内容类型不正确');
  if (!content || !text(content.title, 100)) errors.push('请填写标题');
  if (!content || !text(content.subtitle, 240)) errors.push('请填写副标题');
  if (!content || !positiveOrder(content.order, 0)) errors.push('请设置正确的排序');
  if (content && content.kind === 'course') {
    if (!COLUMN_TRACKS.some((track) => track.key === content.track)) errors.push('请选择基础课分类');
    if (!text(content.sections && content.sections.summary, 5000)) errors.push('请填写一句话说明');
  }
  if (content && content.kind === 'practical') {
    if (!PRACTICAL_TRACKS.some((track) => track.key === content.track)) errors.push('请选择动手课分类');
    if (!text(content.goal, 5000)) errors.push('请填写这次要完成什么');
    const hasSteps = textList(content.sections && content.sections.steps).length
      || (content.platformGuides || []).some((guide) => guide.steps.length || guide.commands.length);
    if (!hasSteps) errors.push('请至少填写一条操作步骤');
  }
  return errors;
}

function builtInContent(value) {
  const content = clone(value);
  if (value.kind === 'course') {
    const media = findColumnMedia(value.id);
    content.posters = clone(media && media.posters || []);
    content.relatedCourseIds = [];
    content.relatedPracticalIds = [];
  } else {
    content.posters = [];
    content.relatedPracticalIds = [];
  }
  return normalizeEntryContent(value.kind, content, value.id);
}

const BUILTIN_ENTRIES = Object.freeze([
  ...COLUMN_LESSONS.map((value) => Object.freeze({
    id: value.id,
    kind: 'course',
    origin: 'builtin',
    version: 0,
    status: 'published',
    publishedRevision: 0,
    draft: builtInContent(value),
    published: builtInContent(value)
  })),
  ...PRACTICAL_LESSONS.map((value) => Object.freeze({
    id: value.id,
    kind: 'practical',
    origin: 'builtin',
    version: 0,
    status: 'published',
    publishedRevision: 0,
    draft: builtInContent(value),
    published: builtInContent(value)
  }))
]);

const BUILTIN_ENTRY_MAP = new Map(BUILTIN_ENTRIES.map((entry) => [entry.id, entry]));

function builtInEntry(id) {
  const entry = BUILTIN_ENTRY_MAP.get(id);
  return entry ? clone(entry) : null;
}

function mergeColumnEntries(overrides = []) {
  const merged = new Map(BUILTIN_ENTRIES.map((entry) => [entry.id, clone(entry)]));
  (Array.isArray(overrides) ? overrides : []).forEach((entry) => {
    if (!entry || !ENTRY_ID_PATTERN.test(entry._id || entry.id || '')) return;
    const id = entry._id || entry.id;
    merged.set(id, { ...clone(entry), id });
  });
  return [...merged.values()];
}

function entrySort(left, right) {
  const kindOrder = { course: 0, practical: 1 };
  const content = (entry) => entry.published || entry.draft || {};
  const trackOrder = (entry) => {
    const tracks = entry.kind === 'practical' ? PRACTICAL_TRACKS : COLUMN_TRACKS;
    const index = tracks.findIndex((track) => track.key === content(entry).track);
    return index < 0 ? tracks.length : index;
  };
  return (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
    || trackOrder(left) - trackOrder(right)
    || positiveOrder(
      left.published && left.published.order || left.draft && left.draft.order,
      999999
    ) - positiveOrder(
      right.published && right.published.order || right.draft && right.draft.order,
      999999
    )
    || String(left.id).localeCompare(String(right.id));
}

function createEntryId(kind, mutationId = '') {
  const prefix = kind === 'practical' ? 'practical' : 'course';
  const suffix = mutationId
    ? crypto.createHash('sha256').update(mutationId).digest('hex').slice(0, 24)
    : crypto.randomBytes(12).toString('hex');
  return `${prefix}_${suffix}`;
}

function normalizeMutationId(value) {
  const mutationId = text(value, 80);
  return MUTATION_ID_PATTERN.test(mutationId) ? mutationId : '';
}

module.exports = {
  ENTRY_KINDS,
  ENTRY_ID_PATTERN,
  MEDIA_ID_PATTERN,
  BUILTIN_MEDIA_PREFIX,
  BUILTIN_ENTRIES,
  builtInEntry,
  mergeColumnEntries,
  entrySort,
  normalizeEntryContent,
  validatePublishable,
  createEntryId,
  normalizeMutationId,
  clone
};
