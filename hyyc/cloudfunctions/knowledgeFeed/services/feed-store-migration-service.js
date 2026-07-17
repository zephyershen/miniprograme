const { randomUUID } = require('node:crypto');
const { toStoredFeedItem } = require('../lib/stored-feed-item');
const { groupEntriesByDay } = require('../repositories/feed-day-index');

function mapStoredItems(items, options, logger) {
  const documents = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    try {
      documents.push(toStoredFeedItem(item, options));
    } catch (error) {
      logger.warn('Knowledge feed migration skipped an invalid item', {
        id: item && item.id,
        message: error && error.message
      });
    }
  }
  return documents;
}

function createFeedStoreMigrationService({
  cacheRepository,
  archiveRepository,
  itemRepository,
  dayIndexRepository,
  migrationRepository,
  config,
  now = () => Date.now(),
  createGeneration = randomUUID,
  logger = console
}) {
  async function importDocuments(documents, updatedAt, coverage) {
    if (!documents.length) return { total: 0, inserted: 0, updated: 0, days: 0 };
    const upsert = await itemRepository.upsertMany(documents, { mergeVisuals: true });
    const groups = groupEntriesByDay(documents);
    for (const [date, entries] of groups) {
      await dayIndexRepository.mergeHistoricalDay(date, entries, updatedAt, coverage);
    }
    return { ...upsert, days: groups.size };
  }

  async function importCache(updatedAt, generation) {
    const cache = await cacheRepository.get();
    const documents = mapStoredItems(cache && cache.items, {
      provider: config.provider,
      generation,
      observedAt: updatedAt,
      coverage: 'selected-current',
      archiveSource: 'selected'
    }, logger);
    return importDocuments(documents, updatedAt, 'selected-current');
  }

  async function run({ restartArchive = false } = {}) {
    const updatedAt = new Date(now());
    const generation = `migration-${createGeneration()}`;
    const current = (await migrationRepository.get()) || {};
    const cache = await importCache(updatedAt, generation);
    const beforeDate = restartArchive ? '' : (current.archiveBeforeDate || '');
    const days = await archiveRepository.listDays(beforeDate, config.migrationDayBatchSize);
    let archiveDocuments = 0;
    let archiveInserted = 0;
    let archiveUpdated = 0;
    for (const day of days) {
      const coverage = (day.items || []).some((item) => item.archiveSource === 'daily')
        ? 'daily-curated'
        : 'selected-archive';
      const documents = mapStoredItems(day.items, {
        provider: config.provider,
        generation,
        observedAt: updatedAt,
        coverage,
        archiveSource: coverage === 'daily-curated' ? 'daily' : 'selected'
      }, logger);
      const result = await importDocuments(documents, updatedAt, coverage);
      archiveDocuments += result.total;
      archiveInserted += result.inserted;
      archiveUpdated += result.updated;
    }
    const complete = days.length < config.migrationDayBatchSize;
    const nextBeforeDate = days.length ? days[days.length - 1].date : beforeDate;
    const progress = await migrationRepository.patch({
      version: 1,
      status: complete ? 'complete' : 'running',
      archiveBeforeDate: nextBeforeDate,
      importedArchiveDays: restartArchive
        ? days.length
        : (Number(current.importedArchiveDays) || 0) + days.length,
      importedDocuments: restartArchive
        ? archiveDocuments
        : (Number(current.importedDocuments) || 0) + archiveDocuments,
      cacheDocumentCount: cache.total,
      updatedAt,
      completedAt: complete ? updatedAt : null
    });
    return {
      status: progress.status,
      cache,
      archive: {
        days: days.length,
        documents: archiveDocuments,
        inserted: archiveInserted,
        updated: archiveUpdated,
        nextBeforeDate
      },
      progress: {
        importedArchiveDays: progress.importedArchiveDays,
        importedDocuments: progress.importedDocuments
      }
    };
  }

  return { run };
}

module.exports = { mapStoredItems, createFeedStoreMigrationService };
