const { COLUMN_LESSONS } = require('./column-lessons');

const FILE_PREFIX = 'cloud://hyyc-1gi3f5sqc5becabf.6879-hyyc-1gi3f5sqc5becabf-1395663220/ai-column/posters-hd/v2/';

function pad2(value) {
  return String(value).padStart(2, '0');
}

const COLUMN_MEDIA = Object.freeze(COLUMN_LESSONS.map((lesson) => Object.freeze({
  id: lesson.id,
  posters: Object.freeze([1, 2, 3].map((page) => Object.freeze({
    key: `${lesson.id}-${page}`,
    fileId: `${FILE_PREFIX}${pad2(lesson.order)}-${lesson.id}-${pad2(page)}.jpg`,
    alt: `${lesson.title}手绘图文第 ${page} 页`
  })))
})));

function findColumnMedia(lessonId) {
  return COLUMN_MEDIA.find((entry) => entry.id === lessonId) || null;
}

module.exports = { COLUMN_MEDIA, FILE_PREFIX, findColumnMedia };
