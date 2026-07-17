const { createCollectionEnsurer, isNotFound } = require('./collection-support');
const { publishedDay } = require('../lib/stored-feed-item');
const { qualityTier } = require('../policies/feed-quality');

function dayDocumentId(provider, date) {
  if (!/^[a-z0-9_-]{2,24}$/i.test(provider || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new Error('FEED_DAY_ID_INVALID');
  }
  return `${provider}_${date.replace(/-/g, '_')}`;
}

function indexEntry(item) {
  const analysisVersion = Math.max(0, Number(item.analysisPolicyVersion) || 0);
  const entry = {
    id: item.id,
    publishedAt: item.publishedAt,
    channelKey: item.channelKey || 'ai',
    topicKeys: Array.isArray(item.topicKeys) ? item.topicKeys : [],
    score: item.score === undefined ? null : item.score,
    qualityTier: analysisVersion > 0 ? qualityTier(item) : 'standard'
  };
  if (Number.isFinite(Number(item.curationScore))) entry.curationScore = Number(item.curationScore);
  if (typeof item.curationReason === 'string' && item.curationReason) {
    entry.curationReason = item.curationReason;
  }
  if (analysisVersion > 0) {
    entry.analysisPolicyVersion = analysisVersion;
  }
  return entry;
}

function normalizeEntries(values) {
  const entries = new Map();
  for (const value of (Array.isArray(values) ? values : [])) {
    if (!value || typeof value.id !== 'string') continue;
    entries.set(value.id, indexEntry(value));
  }
  return [...entries.values()].sort((left, right) => {
    const time = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    return time || left.id.localeCompare(right.id);
  });
}

function entriesFromDocument(document) {
  if (Array.isArray(document && document.entries)) return normalizeEntries(document.entries);
  return ((document && document.itemIds) || []).map((id) => ({
    id,
    publishedAt: `${document.date}T00:00:00.000Z`,
    channelKey: 'ai',
    topicKeys: [],
    score: null,
    qualityTier: 'standard'
  }));
}

function groupEntriesByDay(items) {
  const groups = new Map();
  for (const item of (Array.isArray(items) ? items : [])) {
    const date = item && (item.publishedDay || publishedDay(item.publishedAt));
    if (!date || !item.id) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(indexEntry(item));
  }
  return groups;
}

function coverageFromDocuments(documents) {
  const values = Array.isArray(documents) ? documents : [];
  let completeFrom = '';
  for (const document of values) {
    if (!document || document.coverage !== 'all') break;
    completeFrom = document.date || completeFrom;
  }
  return {
    completeFrom,
    partialDayCount: values.filter((document) => document && document.coverage !== 'all').length
  };
}

function createFeedDayIndexRepository(db, config) {
  const collection = () => db.collection(config.dayIndexCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.dayIndexCollectionName);

  async function listRange(sinceDate, untilDate = '9999-12-31') {
    await ensureCollection();
    const command = db.command;
    const documents = [];
    const batchSize = 100;
    while (true) {
      const response = await collection()
        .where({
          _id: command
            .gte(dayDocumentId(config.provider, sinceDate))
            .and(command.lte(dayDocumentId(config.provider, untilDate)))
        })
        .orderBy('_id', 'desc')
        .skip(documents.length)
        .limit(batchSize)
        .get();
      const page = (response && response.data) || [];
      documents.push(...page);
      if (page.length < batchSize) return documents;
    }
  }

  async function replaceCurrentWindow(items, generation, updatedAt, sinceDate) {
    await ensureCollection();
    const groups = groupEntriesByDay(items);
    const previous = await listRange(sinceDate);
    const previousIds = new Set(previous.flatMap((document) => entriesFromDocument(document).map((entry) => entry.id)));
    const currentIds = new Set([...groups.values()].flat().map((entry) => entry.id));
    const dates = new Set([...previous.map((document) => document.date), ...groups.keys()]);
    for (const date of dates) {
      const entries = normalizeEntries(groups.get(date) || []);
      await collection().doc(dayDocumentId(config.provider, date)).set({
        data: {
          provider: config.provider,
          date,
          entries,
          itemIds: entries.map((entry) => entry.id),
          itemCount: entries.length,
          generation,
          coverage: 'all',
          updatedAt
        }
      });
    }
    return {
      removedItemIds: [...previousIds].filter((itemId) => !currentIds.has(itemId)),
      dayCount: groups.size,
      itemCount: currentIds.size
    };
  }

  async function mergeHistoricalDay(date, items, updatedAt, coverage = 'daily-curated') {
    await ensureCollection();
    const documentId = dayDocumentId(config.provider, date);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.dayIndexCollectionName).doc(documentId);
      let current = null;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const merged = normalizeEntries([
        ...entriesFromDocument(current),
        ...(items || [])
      ]);
      const persisted = { ...(current || {}) };
      delete persisted._id;
      const data = {
        ...persisted,
        provider: config.provider,
        date,
        entries: merged,
        itemIds: merged.map((entry) => entry.id),
        itemCount: merged.length,
        coverage: current && current.coverage === 'all' ? 'all' : coverage,
        updatedAt
      };
      await reference.set({ data });
      return data;
    });
  }

  async function stats() {
    const documents = await listRange('0000-01-01');
    const coverage = coverageFromDocuments(documents);
    return {
      dayCount: documents.length,
      itemCount: documents.reduce((total, document) => total + (Number(document.itemCount) || 0), 0),
      newestDate: documents[0] ? documents[0].date : '',
      oldestDate: documents.length ? documents[documents.length - 1].date : '',
      ...coverage
    };
  }

  return {
    ensureCollection,
    listRange,
    replaceCurrentWindow,
    mergeHistoricalDay,
    stats
  };
}

module.exports = {
  createFeedDayIndexRepository,
  dayDocumentId,
  indexEntry,
  entriesFromDocument,
  groupEntriesByDay,
  coverageFromDocuments
};
