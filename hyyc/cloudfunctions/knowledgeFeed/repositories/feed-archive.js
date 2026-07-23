function isNotFound(error) {
  return error && (error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || ''));
}

function collectionAlreadyExists(error) {
  return Boolean(error && /already exists|exist|DATABASE_COLLECTION_EXIST/i.test(
    `${error.errCode || ''} ${error.code || ''} ${error.message || ''}`
  ));
}

function dayDocumentId(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('ARCHIVE_DATE_INVALID');
  }
  return `day_${date.replace(/-/g, '_')}`;
}

function archivePriority(item) {
  return item && item.archiveSource === 'selected' ? 2 : 1;
}

function mergeArchiveItems(currentItems, incomingItems) {
  const merged = new Map();
  for (const item of (Array.isArray(currentItems) ? currentItems : [])) {
    if (item && typeof item.id === 'string') merged.set(item.id, item);
  }
  for (const item of (Array.isArray(incomingItems) ? incomingItems : [])) {
    if (!item || typeof item.id !== 'string') continue;
    const current = merged.get(item.id);
    if (!current || archivePriority(item) >= archivePriority(current)) merged.set(item.id, item);
  }
  return [...merged.values()].sort((left, right) => {
    const time = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
    return time || String(left.id).localeCompare(String(right.id));
  });
}

function createFeedArchiveRepository(db, config) {
  let collectionReady = null;

  async function ensureCollection() {
    if (!collectionReady) {
      collectionReady = db.createCollection(config.collectionName)
        .catch((error) => {
          if (!collectionAlreadyExists(error)) throw error;
        })
        .catch((error) => {
          collectionReady = null;
          throw error;
        });
    }
    await collectionReady;
  }

  async function upsertDay(date, items, updatedAt = new Date()) {
    await ensureCollection();
    const documentId = dayDocumentId(date);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(documentId);
      let current = null;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const mergedItems = mergeArchiveItems(current && current.items, items);
      const data = {
        date,
        provider: 'aihot',
        items: mergedItems,
        itemCount: mergedItems.length,
        updatedAt
      };
      await reference.set({ data });
      return data;
    });
  }

  async function deleteBefore(cutoffDate) {
    await ensureCollection();
    const command = db.command;
    const response = await db.collection(config.collectionName)
      .where({ date: command.lt(cutoffDate) })
      .field({ _id: true, date: true, itemCount: true })
      .limit(100)
      .get();
    const documents = Array.isArray(response && response.data) ? response.data : [];
    for (const document of documents) {
      if (document && document._id) {
        await db.collection(config.collectionName).doc(document._id).remove();
      }
    }
    return documents.length;
  }

  async function stats() {
    await ensureCollection();
    const response = await db.collection(config.collectionName)
      .field({ date: true, itemCount: true })
      .orderBy('date', 'desc')
      .limit(Math.min(100, config.retentionDays))
      .get();
    const documents = Array.isArray(response && response.data) ? response.data : [];
    return {
      dayCount: documents.length,
      itemCount: documents.reduce((total, document) => total + (Number(document.itemCount) || 0), 0),
      newestDate: documents[0] ? documents[0].date : '',
      oldestDate: documents.length ? documents[documents.length - 1].date : ''
    };
  }

  async function listDays(beforeDate = '', limit = config.historyBatchDays || 5) {
    await ensureCollection();
    const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 5));
    let query = db.collection(config.collectionName);
    if (beforeDate) query = query.where({ date: db.command.lt(beforeDate) });
    const response = await query.orderBy('date', 'desc').limit(boundedLimit).get();
    return Array.isArray(response && response.data) ? response.data : [];
  }

  return { ensureCollection, upsertDay, deleteBefore, stats, listDays };
}

module.exports = {
  createFeedArchiveRepository,
  dayDocumentId,
  mergeArchiveItems
};
