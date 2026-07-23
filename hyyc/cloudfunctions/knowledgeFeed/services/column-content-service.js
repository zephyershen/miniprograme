const { AppError } = require('../lib/errors');
const { featureEnabled, requireFeature } = require('./feed-entitlement-service');
const { COLUMN_MEDIA, findColumnMedia } = require('../content/ai-column-media');
const {
  COLUMN_TRACKS,
  COLUMN_LESSONS,
  publicLesson,
  findLesson
} = require('../content/column-lessons');
const {
  PRACTICAL_TRACKS,
  PRACTICAL_SUPPORT_NOTICE,
  PRACTICAL_LESSONS,
  publicPracticalLesson,
  findPracticalLesson
} = require('../content/practical-lessons');
const { TREND_DOSSIERS, findDossier } = require('../content/trend-dossiers');

const DOSSIER_LESSONS = Object.freeze({
  'writing-docs': ['writing', 'task-first', 'examples', 'acceptance'],
  'search-research': ['research', 'rag', 'evidence', 'release-signal'],
  'data-spreadsheets': ['data-table', 'evidence', 'acceptance'],
  'meetings-knowledge': ['meeting', 'knowledge-base', 'context'],
  'visual-media': ['presentation', 'multimodal', 'examples'],
  'agents-automation': ['tool-call', 'agent', 'skill', 'mcp', 'workflow', 'security']
});

function lessonRelations(lesson) {
  const sameTrack = COLUMN_LESSONS.filter((item) => item.track === lesson.track);
  const position = sameTrack.findIndex((item) => item.id === lesson.id);
  const relatedLessonIds = sameTrack.slice(position + 1, position + 3).map((item) => item.id);
  const dossier = Object.entries(DOSSIER_LESSONS)
    .find(([, lessonIds]) => lessonIds.includes(lesson.id));
  return {
    relatedLessonIds,
    dossiers: dossier ? [dossier[0]] : []
  };
}

function casePreview(document) {
  if (!document) return null;
  return {
    id: document._id,
    title: document.title || '',
    conclusion: document.conclusion || '',
    dossierKey: document.dossierKey || '',
    publishedAt: document.publishedAt || null,
    sourceCount: Array.isArray(document.sources) ? document.sources.length : 0
  };
}

function caseTitlePreview(document) {
  if (!document) return null;
  return { id: document._id, title: document.title || '' };
}

function publicCase(document) {
  if (!document) return null;
  return {
    ...casePreview(document),
    happened: document.happened || '',
    impact: document.impact || '',
    tryNow: Array.isArray(document.tryNow) ? document.tryNow : [],
    noNeedToWorry: document.noNeedToWorry || '',
    relatedLessonIds: Array.isArray(document.relatedLessonIds)
      ? document.relatedLessonIds : [],
    sourceItemIds: Array.isArray(document.sourceItemIds) ? document.sourceItemIds : [],
    sources: Array.isArray(document.sources) ? document.sources.map((source) => ({
      itemId: source.itemId,
      title: source.title || '',
      source: source.source || '',
      publishedAt: source.publishedAt || null
    })) : []
  };
}

function createColumnContentService({ repository, getTempFileURL }) {
  async function tempFileUrls(fileIds) {
    const requested = [...new Set((Array.isArray(fileIds) ? fileIds : []).filter(Boolean))];
    if (!requested.length) return new Map();
    try {
      const batches = [];
      for (let offset = 0; offset < requested.length; offset += 50) {
        batches.push(requested.slice(offset, offset + 50));
      }
      const responses = await Promise.all(batches.map((fileList) => getTempFileURL({ fileList })));
      return new Map(responses.flatMap((response) => (response && response.fileList) || [])
        .filter((file) => file && Number(file.status) === 0 && /^https:\/\//i.test(file.tempFileURL || ''))
        .map((file) => [file.fileID || file.fileId, file.tempFileURL]));
    } catch (error) {
      return new Map();
    }
  }

  async function lessonMedia(lesson) {
    const media = findColumnMedia(lesson.id);
    const posters = media ? media.posters : [];
    const urls = await tempFileUrls([
      lesson.illustrationFileId,
      ...posters.map((poster) => poster.fileId)
    ]);
    return {
      illustrationUrl: urls.get(lesson.illustrationFileId) || '',
      posters: posters.map((poster) => ({
        key: poster.key,
        image: urls.get(poster.fileId) || '',
        previewImage: urls.get(poster.fileId) || '',
        alt: poster.alt
      })).filter((poster) => poster.image)
    };
  }

  async function home(entitlement) {
    const unlocked = featureEnabled(entitlement, 'ai_column');
    return {
      contractVersion: 4,
      access: {
        locked: !unlocked,
        featureKey: 'ai_column'
      },
      courseTracks: COLUMN_TRACKS.map((track) => (unlocked
        ? { ...track }
        : { key: track.key, label: track.label })),
      practicalTracks: PRACTICAL_TRACKS.map((track) => (unlocked
        ? { ...track }
        : { key: track.key, label: track.label })),
      courses: COLUMN_LESSONS.map((value) => publicLesson(value, { includeCopy: unlocked })),
      practicals: PRACTICAL_LESSONS.map((value) => publicPracticalLesson(value, {
        includeCopy: unlocked
      })),
      featuredCourseId: COLUMN_LESSONS[0].id,
      featuredPracticalId: PRACTICAL_LESSONS[0].id,
      practicalSupport: { ...PRACTICAL_SUPPORT_NOTICE }
    };
  }

  async function lesson(lessonId, entitlement) {
    requireFeature(entitlement, 'ai_column', '本节内容需要 Pro 会员');
    const value = findLesson(lessonId);
    if (!value) throw new AppError('ITEM_NOT_FOUND', '这节课程不存在');
    const media = await lessonMedia(value);
    return {
      ...value,
      ...lessonRelations(value),
      visual: { ...value.visual, nodes: [...value.visual.nodes] },
      sections: {
        ...value.sections,
        steps: [...value.sections.steps],
        pitfalls: [...value.sections.pitfalls]
      },
      ...media
    };
  }

  async function practical(practicalId, entitlement) {
    requireFeature(entitlement, 'ai_column', '本节实操需要 Pro 会员');
    const value = findPracticalLesson(practicalId);
    if (!value) throw new AppError('ITEM_NOT_FOUND', '这节实操不存在');
    return {
      ...value,
      platformGuides: value.platformGuides.map((guide) => ({
        ...guide,
        commands: guide.commands.map((item) => ({ ...item })),
        steps: [...guide.steps]
      })),
      commands: value.commands.map((item) => ({ ...item })),
      sources: value.sources.map((item) => ({ ...item })),
      relatedCourseIds: [...value.relatedCourseIds],
      sections: Object.fromEntries(Object.entries(value.sections).map(([key, entry]) => [
        key,
        Array.isArray(entry) ? [...entry] : entry
      ])),
      support: { ...PRACTICAL_SUPPORT_NOTICE }
    };
  }

  async function listCases(input, entitlement) {
    requireFeature(entitlement, 'ai_column', '本周案例需要 Pro 会员');
    const page = await repository.listCases(input || {});
    return {
      ...page,
      items: page.items.map(casePreview)
    };
  }

  async function getCase(caseId, entitlement) {
    requireFeature(entitlement, 'ai_column', '本周案例需要 Pro 会员');
    const value = await repository.getCase(caseId);
    if (!value || value.status !== 'published') {
      throw new AppError('ITEM_NOT_FOUND', '这篇案例不存在');
    }
    return publicCase(value);
  }

  async function trendDossier(key, entitlement) {
    requireFeature(entitlement, 'ai_column', '趋势档案需要 Pro 会员');
    const base = findDossier(key);
    if (!base) throw new AppError('ITEM_NOT_FOUND', '这份趋势档案不存在');
    const [stored, timeline] = await Promise.all([
      repository.getDossier(key),
      repository.listEvents(key)
    ]);
    return {
      ...base,
      usableNow: [...base.usableNow],
      unreliableNow: [...base.unreliableNow],
      updatedAt: stored && stored.updatedAt || null,
      eventCount: Math.max(timeline.length, Number(stored && stored.eventCount) || 0),
      timeline: timeline.map((event) => ({
        id: event._id,
        caseId: event.caseId,
        title: event.title || '',
        conclusion: event.conclusion || '',
        publishedAt: event.publishedAt || null,
        sources: Array.isArray(event.sources) ? event.sources : []
      })),
      relatedLessonIds: (DOSSIER_LESSONS[key] || []).slice(0, 4)
    };
  }

  // Compatibility for previously published clients. The redesigned client no
  // longer calls this action; it loads one protected article at a time.
  async function get(entitlement) {
    requireFeature(entitlement, 'ai_column', '此专栏需要 Pro 会员');
    const fileIds = COLUMN_MEDIA.flatMap((entry) => entry.posters.map((poster) => poster.fileId));
    const files = await tempFileUrls(fileIds);
    return {
      lessons: COLUMN_MEDIA.map((entry) => ({
        id: entry.id,
        posters: entry.posters.map((poster) => {
          const url = files.get(poster.fileId) || '';
          if (!url) throw new AppError('TEMPORARY_FAILURE', '专栏暂时无法加载，请稍后重试');
          return { key: poster.key, image: url, previewImage: url, alt: poster.alt };
        })
      }))
    };
  }

  return { home, lesson, practical, listCases, getCase, trendDossier, get };
}

module.exports = {
  DOSSIER_LESSONS,
  lessonRelations,
  caseTitlePreview,
  casePreview,
  publicCase,
  createColumnContentService
};
