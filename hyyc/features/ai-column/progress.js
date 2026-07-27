function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value, minimum, maximum) {
  const numeric = Math.floor(Number(value) || 0);
  return Math.min(maximum, Math.max(minimum, numeric));
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function progressKey(entryType, entryId) {
  return `${entryType}:${entryId}`;
}

function normalizeProgress(payload) {
  const root = isRecord(payload && payload.data) ? payload.data : payload;
  const rows = Array.isArray(root && root.items) ? root.items : [];
  const unique = new Map();
  rows.forEach((row) => {
    if (!isRecord(row)
      || !['lesson', 'practical'].includes(row.entryType)
      || typeof row.entryId !== 'string'
      || !row.entryId) return;
    const progressPercent = clampInteger(row.progressPercent, 0, 100);
    const item = {
      entryType: row.entryType,
      entryId: row.entryId,
      progressPercent,
      lastPosterIndex: nonNegativeInteger(row.lastPosterIndex),
      completed: row.completed === true || progressPercent >= 100,
      lastReadAt: row.lastReadAt || null,
      completedAt: row.completedAt || null
    };
    const key = progressKey(item.entryType, item.entryId);
    if (!unique.has(key)) unique.set(key, item);
  });
  return [...unique.values()];
}

function progressLabel(item) {
  if (!item || item.progressPercent <= 0) return '';
  return item.completed ? '已完成' : `已读 ${item.progressPercent}%`;
}

function decorateEntry(entry, entryType, progressByKey) {
  const progress = progressByKey.get(progressKey(entryType, entry.id));
  if (!progress) {
    return {
      ...entry,
      progressPercent: 0,
      progressLabel: '',
      completed: false,
      lastPosterIndex: 0
    };
  }
  return {
    ...entry,
    progressPercent: progress.progressPercent,
    progressLabel: progressLabel(progress),
    completed: progress.completed,
    lastPosterIndex: progress.lastPosterIndex
  };
}

function applyColumnProgress(home, payload) {
  const safeHome = isRecord(home) ? home : {};
  const progress = normalizeProgress(payload);
  const progressByKey = new Map(progress.map((item) => [
    progressKey(item.entryType, item.entryId),
    item
  ]));
  const lessons = (Array.isArray(safeHome.lessons) ? safeHome.lessons : [])
    .map((entry) => decorateEntry(entry, 'lesson', progressByKey));
  const practicals = (Array.isArray(safeHome.practicals) ? safeHome.practicals : [])
    .map((entry) => decorateEntry(entry, 'practical', progressByKey));
  const lessonsById = new Map(lessons.map((entry) => [entry.id, entry]));
  const courseGroups = (Array.isArray(safeHome.courseGroups) ? safeHome.courseGroups : [])
    .map((group) => ({
      ...group,
      lessons: (Array.isArray(group.lessons) ? group.lessons : [])
        .map((entry) => lessonsById.get(entry.id) || decorateEntry(entry, 'lesson', progressByKey))
    }));
  const visibleKeys = new Set([
    ...lessons.map((entry) => progressKey('lesson', entry.id)),
    ...practicals.map((entry) => progressKey('practical', entry.id))
  ]);
  const visibleProgress = progress.filter((item) => visibleKeys.has(
    progressKey(item.entryType, item.entryId)
  ));
  const totalCount = visibleKeys.size;
  const completedCount = visibleProgress.filter((item) => item.completed).length;
  const startedCount = visibleProgress.filter((item) => item.progressPercent > 0).length;
  const overallPercent = totalCount
    ? Math.floor(visibleProgress.reduce((sum, item) => sum + item.progressPercent, 0) / totalCount)
    : 0;
  const resumeProgress = visibleProgress.find((item) => !item.completed) || null;
  const resumeEntry = resumeProgress && (
    resumeProgress.entryType === 'lesson'
      ? lessons.find((entry) => entry.id === resumeProgress.entryId)
      : practicals.find((entry) => entry.id === resumeProgress.entryId)
  );
  return {
    ...safeHome,
    lessons,
    courseGroups,
    practicals,
    progressSummary: {
      totalCount,
      startedCount,
      completedCount,
      overallPercent,
      resume: resumeEntry ? {
        id: resumeEntry.id,
        type: resumeProgress.entryType,
        title: resumeEntry.title,
        progressLabel: progressLabel(resumeProgress),
        lastPosterIndex: resumeProgress.lastPosterIndex
      } : null
    }
  };
}

function readingProgressPercent(activePosterIndex, totalPosters) {
  const total = nonNegativeInteger(totalPosters);
  if (!total) return 10;
  const index = Math.min(nonNegativeInteger(activePosterIndex), total - 1);
  return Math.min(65, 15 + Math.floor(((index + 1) / total) * 50));
}

function createProgressMutationId(now = Date.now(), random = Math.random()) {
  const timePart = Math.max(0, Math.floor(Number(now) || 0)).toString(36);
  const randomPart = Math.floor(Math.max(0, Math.min(.999999999, Number(random) || 0)) * 1e9)
    .toString(36)
    .padStart(6, '0');
  return `column_progress_${timePart}_${randomPart}`;
}

module.exports = {
  normalizeProgress,
  progressLabel,
  applyColumnProgress,
  readingProgressPercent,
  createProgressMutationId
};
