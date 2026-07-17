const { toDate } = require('../lib/dates');

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function archiveSelectedItem(item) {
  if (!item || !utcDate(item.publishedAt)) return null;
  return {
    id: item.id,
    title: item.title,
    titleEn: item.titleEn || '',
    summary: item.summary || '',
    url: item.url,
    permalink: item.permalink || '',
    source: item.source,
    publishedAt: item.publishedAt,
    category: item.category,
    categoryLabel: item.categoryLabel,
    categoryMarker: item.categoryMarker,
    channelKey: item.channelKey,
    coverTone: item.coverTone,
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : [],
    score: item.score,
    attribution: item.attribution,
    archiveSource: 'selected',
    archiveDate: utcDate(item.publishedAt)
  };
}

function groupByArchiveDate(items) {
  const groups = new Map();
  for (const raw of (Array.isArray(items) ? items : [])) {
    const item = raw && raw.archiveSource === 'daily' ? raw : archiveSelectedItem(raw);
    const date = item && (item.archiveDate || utcDate(item.publishedAt));
    if (!item || !date) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  }
  return groups;
}

function createFeedArchiveService({
  repository,
  archiveRepository,
  source,
  config,
  now = () => Date.now(),
  logger = console
}) {
  function elapsed(value) {
    const date = toDate(value);
    return date ? now() - date.getTime() : Number.POSITIVE_INFINITY;
  }

  async function persistGroups(groups) {
    let itemCount = 0;
    for (const [date, items] of groups) {
      const document = await archiveRepository.upsertDay(date, items, new Date(now()));
      itemCount += document.itemCount;
    }
    return { dayCount: groups.size, itemCount };
  }

  async function archiveCurrent(cache, sourceChanged) {
    const sourceUpdatedAt = toDate(cache.updatedAt || cache.fetchedAt);
    const archiveCheckedAt = toDate(cache.archiveCurrentCheckedAt);
    const sourceAhead = sourceUpdatedAt
      && (!archiveCheckedAt || sourceUpdatedAt.getTime() > archiveCheckedAt.getTime());
    const due = sourceChanged || sourceAhead
      || elapsed(cache.archiveCurrentCheckedAt) >= config.currentRefreshMs;
    if (!due) return { skipped: true };
    const groups = groupByArchiveDate(cache.items);
    const result = await persistGroups(groups);
    await repository.patchSourceState({
      archiveCurrentCheckedAt: new Date(now()),
      archiveLastErrorCode: ''
    });
    return result;
  }

  async function backfillHistory(cache) {
    const storedDates = new Set(Array.isArray(cache.archiveDailyDates) ? cache.archiveDailyDates : []);
    const backfillComplete = Boolean(cache.archiveHistoryCheckedAt)
      && elapsed(cache.archiveHistoryCheckedAt) < config.historyRefreshMs;
    if (backfillComplete) return { skipped: true, storedDates: storedDates.size };

    const availableDates = await source.loadDailyIndex(config.historyIndexTake);
    const retentionCutoff = utcDate(now() - (config.retentionDays * DAY_MS));
    const retainedDates = availableDates.filter((date) => date >= retentionCutoff);
    const missingDates = retainedDates.filter((date) => !storedDates.has(date));
    const batch = missingDates.slice(0, config.historyBatchDays);
    let importedItems = 0;
    for (const date of batch) {
      const daily = await source.loadDaily(date);
      const document = await archiveRepository.upsertDay(date, daily.items, new Date(now()));
      importedItems += document.itemCount;
      storedDates.add(date);
    }

    const remaining = retainedDates.filter((date) => !storedDates.has(date)).length;
    const fields = {
      archiveDailyDates: [...storedDates].sort().slice(-config.retentionDays),
      archiveBackfillRemaining: remaining,
      archiveLastErrorCode: ''
    };
    if (!remaining) fields.archiveHistoryCheckedAt = new Date(now());
    await repository.patchSourceState(fields);
    return {
      attemptedDays: batch.length,
      importedItems,
      remaining,
      availableDays: retainedDates.length
    };
  }

  async function run({ sourceChanged = false } = {}) {
    const cache = await repository.get();
    if (!cache || !Array.isArray(cache.items)) return { status: 'waiting-for-cache' };
    try {
      const current = await archiveCurrent(cache, sourceChanged);
      const latest = await repository.get();
      const history = await backfillHistory(latest || cache);
      const cutoff = utcDate(now() - (config.retentionDays * DAY_MS));
      const deletedDays = await archiveRepository.deleteBefore(cutoff);
      const stats = await archiveRepository.stats();
      await repository.patchSourceState({ archiveStats: stats, archiveLastErrorCode: '' });
      const result = { status: 'ready', current, history, deletedDays, stats };
      logger.info('Knowledge feed archive sync completed', result);
      return result;
    } catch (error) {
      const code = /^FEED_[A-Z0-9_]+$/.test(error && error.message)
        ? error.message
        : 'FEED_ARCHIVE_FAILURE';
      await repository.patchSourceState({ archiveLastErrorCode: code }).catch(() => {});
      logger.warn('Knowledge feed archive sync failed', { code, message: error && error.message });
      return { status: 'failed', errorCode: code };
    }
  }

  return { run };
}

module.exports = {
  createFeedArchiveService,
  archiveSelectedItem,
  groupByArchiveDate,
  utcDate
};
