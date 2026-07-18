const { COLUMN_TRACKS, COLUMN_LESSONS } = require('./catalog.js');

function validTrack(key) {
  return COLUMN_TRACKS.some((item) => item.key === key) ? key : 'all';
}

function activeTracks(key = 'all') {
  const activeKey = validTrack(key);
  return COLUMN_TRACKS.map((item) => ({ ...item, active: item.key === activeKey }));
}

function lessonPreview(lesson) {
  return {
    id: lesson.id,
    order: lesson.order,
    term: lesson.term,
    title: lesson.title,
    subtitle: lesson.subtitle,
    duration: lesson.duration
  };
}

function lessonPosters(lesson) {
  return lesson.guide.posters.map((poster, index, posters) => ({
    ...poster,
    page: String(index + 1).padStart(2, '0'),
    position: `${index + 1} / ${posters.length}`
  }));
}

function posterLoadWindow(currentIndex = 0, total = 3) {
  const safeTotal = Number.isInteger(total) && total > 0 ? total : 0;
  if (!safeTotal) return [];
  const requestedIndex = Number.isInteger(currentIndex) ? currentIndex : 0;
  const safeIndex = Math.min(Math.max(requestedIndex, 0), safeTotal - 1);
  return Array.from(
    { length: safeTotal },
    (_, index) => index === safeIndex || index === safeIndex + 1
  );
}

function posterPreviewUrls(lesson) {
  if (!lesson || !Array.isArray(lesson.posters)) return [];
  return lesson.posters
    .map((poster) => poster.previewImage || poster.image)
    .filter((url) => typeof url === 'string' && url);
}

function createColumnView({ trackKey = 'all', expandedId = '' } = {}) {
  const activeKey = validTrack(trackKey);
  const lessons = COLUMN_LESSONS
    .filter((item) => activeKey === 'all' || item.track === activeKey)
    .map((item) => ({
      ...item,
      posters: lessonPosters(item),
      expanded: item.id === expandedId
    }));
  return {
    trackKey: activeKey,
    tracks: activeTracks(activeKey),
    lessons,
    previewLessons: COLUMN_LESSONS.slice(0, 4).map(lessonPreview),
    nextLesson: lessons[0] || null
  };
}

function createColumnState() {
  return {
    loading: true,
    error: '',
    locked: false,
    expandedId: '',
    view: createColumnView()
  };
}

module.exports = {
  validTrack,
  activeTracks,
  lessonPreview,
  lessonPosters,
  posterLoadWindow,
  posterPreviewUrls,
  createColumnView,
  createColumnState
};
