const {
  createCollectionEnsurer,
  chunks,
  isNotFound,
  mapWithConcurrency
} = require('./collection-support');
const { storedDocumentId } = require('../lib/stored-feed-item');

function hasVisual(document) {
  return Boolean(document && (
    (typeof document.coverFileId === 'string' && document.coverFileId)
    || (Array.isArray(document.previewFileIds) && document.previewFileIds.length)
  ));
}

function hasListThumbnail(document) {
  return Boolean(document
    && typeof document.listThumbnailFileId === 'string'
    && document.listThumbnailFileId);
}

function needsVisualWork(document) {
  return !hasVisual(document) || !hasListThumbnail(document);
}

function itemDocumentId(provider, itemId) {
  return storedDocumentId(provider, itemId);
}

function cursorSortValue(item, sort) {
  if (sort === 'hot') {
    const value = Number(item && item.score);
    return Number.isFinite(value) ? value : -1;
  }
  if (sort === 'importance') {
    const value = Number(item && item.curationScore);
    return Number.isFinite(value) ? value : -1;
  }
  return null;
}

function encodePageCursor(item, sort) {
  if (!item || typeof item._id !== 'string') return '';
  return Buffer.from(JSON.stringify({
    v: 1,
    sort,
    id: item._id,
    publishedAt: item.publishedAt,
    value: cursorSortValue(item, sort)
  })).toString('base64url');
}

function decodePageCursor(value, sort) {
  if (typeof value !== 'string' || !value || value.length > 1000) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (cursor.v !== 1 || cursor.sort !== sort
      || typeof cursor.id !== 'string'
      || typeof cursor.publishedAt !== 'string') return null;
    if (sort !== 'latest' && !Number.isFinite(Number(cursor.value))) return null;
    return cursor;
  } catch (error) {
    return null;
  }
}

function visualFields(document) {
  const fields = {};
  if (typeof document.coverFileId === 'string' && document.coverFileId) {
    fields.coverFileId = document.coverFileId;
    fields.coverCheckedAt = document.coverCheckedAt || null;
    fields.coverStatus = document.coverStatus || 'ready';
  }
  if (Array.isArray(document.previewFileIds) && document.previewFileIds.length) {
    fields.previewFileIds = document.previewFileIds;
    fields.previewCheckedAt = document.previewCheckedAt || null;
    fields.previewStatus = document.previewStatus || 'ready';
    fields.previewCaptureVersion = document.previewCaptureVersion || 1;
  }
  if (hasListThumbnail(document)) {
    fields.listThumbnailFileId = document.listThumbnailFileId;
    fields.listThumbnailVersion = Math.max(1, Number(document.listThumbnailVersion) || 1);
  }
  return fields;
}

function createFeedItemRepository(db, config) {
  const collection = () => db.collection(config.itemsCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.itemsCollectionName);

  async function metadataByIds(ids) {
    const records = [];
    const command = db.command;
    for (const batch of chunks(ids, 50)) {
      if (!batch.length) continue;
      const response = await collection()
        .where({ _id: command.in(batch) })
        .field({
          _id: true,
          contentHash: true,
          analysisInputHash: true,
          url: true,
          publicState: true,
          visualState: true,
          coverFileId: true,
          previewFileIds: true,
          listThumbnailFileId: true,
          listThumbnailVersion: true
        })
        .limit(batch.length)
        .get();
      records.push(...((response && response.data) || []));
    }
    return new Map(records.map((record) => [record._id, record]));
  }

  async function upsertMany(documents, { mergeVisuals = false } = {}) {
    await ensureCollection();
    const unique = new Map();
    for (const document of (Array.isArray(documents) ? documents : [])) {
      if (document && typeof document._id === 'string') unique.set(document._id, document);
    }
    const values = [...unique.values()];
    const existing = await metadataByIds(values.map((document) => document._id));
    const inserted = values.filter((document) => !existing.has(document._id));
    for (const batch of chunks(inserted, 50)) {
      if (batch.length) await collection().add({ data: batch });
    }

    const updates = values.filter((document) => {
      const current = existing.get(document._id);
      if (!current) return false;
      const incomingVisual = visualFields(document);
      const missingIncomingVisual = (incomingVisual.coverFileId && !current.coverFileId)
        || (incomingVisual.previewFileIds && !(current.previewFileIds || []).length)
        || (incomingVisual.listThumbnailFileId && !current.listThumbnailFileId);
      const missingVisualState = !hasVisual(current) && !current.visualState;
      return current.contentHash !== document.contentHash
        || current.publicState !== document.publicState
        || (mergeVisuals && missingIncomingVisual)
        || missingVisualState;
    });
    await mapWithConcurrency(updates, 8, async (document) => {
      const current = existing.get(document._id) || {};
      const data = { ...document };
      delete data._id;
      delete data.firstStoredAt;
      if (!mergeVisuals) {
        delete data.coverFileId;
        delete data.coverCheckedAt;
        delete data.coverStatus;
        delete data.previewFileIds;
        delete data.previewCheckedAt;
        delete data.previewStatus;
        delete data.previewCaptureVersion;
        delete data.listThumbnailFileId;
        delete data.listThumbnailVersion;
      } else {
        Object.assign(data, visualFields(document));
        if (hasVisual(current) && !hasVisual(document)) data.visualState = 'ready';
      }
      await collection().doc(document._id).update({ data });
    });
    const visualCandidates = values.filter((document) => {
      const current = existing.get(document._id);
      if (hasListThumbnail(document) || hasListThumbnail(current)) return false;
      return !current
        || current.visualState !== 'queued'
        || current.contentHash !== document.contentHash
        || current.url !== document.url
        || needsVisualWork(current);
    });
    const analysisCandidates = values.filter((document) => {
      const current = existing.get(document._id);
      return !current
        || current.analysisInputHash !== document.analysisInputHash
        || current.publicState !== 'active';
    });
    return {
      total: values.length,
      inserted: inserted.length,
      updated: updates.length,
      visualCandidates,
      analysisCandidates
    };
  }

  async function markWithdrawn(itemIds, generation, updatedAt) {
    await ensureCollection();
    const ids = [...new Set(itemIds || [])];
    await mapWithConcurrency(ids, 8, async (itemId) => {
      const documentId = itemDocumentId(config.provider, itemId);
      try {
        await collection().doc(documentId).update({
          data: {
            publicState: 'withdrawn',
            withdrawnAt: updatedAt,
            withdrawnGeneration: generation,
            updatedAt
          }
        });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    });
    return ids.length;
  }

  async function getByItemId(itemId) {
    await ensureCollection();
    try {
      return (await collection().doc(itemDocumentId(config.provider, itemId)).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function getManyByItemIds(itemIds) {
    await ensureCollection();
    const orderedIds = [...new Set((itemIds || []).filter((itemId) => typeof itemId === 'string'))];
    const documents = [];
    for (const batch of chunks(orderedIds.map((itemId) => itemDocumentId(config.provider, itemId)), 50)) {
      if (!batch.length) continue;
      const response = await collection()
        .where({ _id: db.command.in(batch) })
        .limit(batch.length)
        .get();
      documents.push(...((response && response.data) || []));
    }
    const byItemId = new Map(documents.map((document) => [document.id, document]));
    return orderedIds.map((itemId) => byItemId.get(itemId)).filter(Boolean);
  }

  async function listByIdCursor(afterId = '', limit = 100) {
    await ensureCollection();
    const size = Math.max(1, Math.min(500, Number(limit) || 100));
    let query = collection();
    if (afterId) query = query.where({ _id: db.command.gt(afterId) });
    const response = await query.orderBy('_id', 'asc').limit(size).get();
    return (response && response.data) || [];
  }

  async function markVisualQueued(documents, updatedAt) {
    await ensureCollection();
    const values = (Array.isArray(documents) ? documents : []).filter((item) => item && item.id);
    const appliedIds = [];
    await mapWithConcurrency(values, 8, async (item) => {
      const applied = await db.runTransaction(async (transaction) => {
        const reference = transaction.collection(config.itemsCollectionName)
          .doc(itemDocumentId(config.provider, item.id));
        let current;
        try {
          current = (await reference.get()).data;
        } catch (error) {
          if (isNotFound(error)) return false;
          throw error;
        }
        if (current.url !== item.url
          || current.contentHash !== item.contentHash
          || current.publicState !== 'active'
          || hasListThumbnail(current)) return false;
        await reference.update({ data: { visualState: 'queued', visualQueuedAt: updatedAt } });
        return true;
      });
      if (applied) appliedIds.push(item.id);
    });
    return appliedIds;
  }

  async function visualStats(since = null) {
    await ensureCollection();
    const values = [];
    const batchSize = 500;
    while (true) {
      const response = await collection()
        .field({
          _id: true,
          publicState: true,
          publishedAt: true,
          coverFileId: true,
          previewFileIds: true,
          listThumbnailFileId: true,
          visualState: true
        })
        .orderBy('_id', 'asc')
        .skip(values.length)
        .limit(batchSize)
        .get();
      const page = (response && response.data) || [];
      values.push(...page);
      if (page.length < batchSize) break;
    }
    const cutoff = since ? new Date(since).getTime() : Number.NEGATIVE_INFINITY;
    const active = values.filter((item) => item.publicState === 'active'
      && new Date(item.publishedAt).getTime() >= cutoff);
    const withCover = active.filter((item) => typeof item.coverFileId === 'string' && item.coverFileId).length;
    const withPreview = active.filter((item) => Array.isArray(item.previewFileIds) && item.previewFileIds.length).length;
    const withAnyVisual = active.filter(hasVisual).length;
    const withListThumbnail = active.filter(hasListThumbnail).length;
    return {
      total: active.length,
      withCover,
      withPreview,
      withAnyVisual,
      withListThumbnail,
      missing: Math.max(0, active.length - withAnyVisual),
      missingListThumbnails: Math.max(0, active.length - withListThumbnail),
      queued: active.filter((item) => item.visualState === 'queued' && !hasVisual(item)).length
    };
  }

  function buildWhere({
    since,
    channel = 'all',
    topicKeys = [],
    includeWithdrawn = false,
    qualityTier = ''
  }) {
    const where = {};
    const command = db.command;
    if (!includeWithdrawn) where.publicState = 'active';
    if (since) where.publishedAt = command.gte(since);
    if (channel && channel !== 'all') where.channelKey = channel;
    if (topicKeys.length) where.topicKeys = command.all(topicKeys);
    if (qualityTier) where.qualityTier = qualityTier;
    return where;
  }

  function cursorCondition(cursor, sort) {
    if (!cursor) return null;
    const command = db.command;
    if (sort === 'latest') {
      return command.or([
        { publishedAt: command.lt(cursor.publishedAt) },
        { publishedAt: cursor.publishedAt, _id: command.lt(cursor.id) }
      ]);
    }
    const field = sort === 'importance' ? 'curationScore' : 'score';
    return command.or([
      { [field]: command.lt(Number(cursor.value)) },
      { [field]: Number(cursor.value), publishedAt: command.lt(cursor.publishedAt) },
      {
        [field]: Number(cursor.value),
        publishedAt: cursor.publishedAt,
        _id: command.lt(cursor.id)
      }
    ]);
  }

  async function queryPage(options) {
    await ensureCollection();
    const where = buildWhere(options);
    const countResult = options.includeCount === false
      ? null
      : await collection().where(where).count();
    const cursor = decodePageCursor(options.cursor, options.sort);
    const after = cursorCondition(cursor, options.sort);
    let query = collection().where(after ? db.command.and([where, after]) : where);
    if (options.sort === 'hot') {
      query = query.orderBy('score', 'desc').orderBy('publishedAt', 'desc').orderBy('_id', 'desc');
    } else if (options.sort === 'importance') {
      query = query.orderBy('curationScore', 'desc').orderBy('publishedAt', 'desc').orderBy('_id', 'desc');
    } else {
      query = query.orderBy('publishedAt', 'desc').orderBy('_id', 'desc');
    }
    if (!cursor && options.offset) query = query.skip(options.offset);
    const response = await query.limit(options.limit + 1).get();
    const rows = (response && response.data) || [];
    const items = rows.slice(0, options.limit);
    return {
      items,
      ...(countResult ? { resultCount: Number(countResult.total) || 0 } : {}),
      hasMore: rows.length > options.limit,
      nextCursor: rows.length > options.limit
        ? encodePageCursor(items[items.length - 1], options.sort)
        : ''
    };
  }

  async function count(options) {
    await ensureCollection();
    const result = await collection().where(buildWhere(options)).count();
    return Number(result && result.total) || 0;
  }

  async function listFacets(options, limit = config.facetLimit) {
    await ensureCollection();
    const where = buildWhere(options);
    const items = [];
    const batchSize = Math.min(1000, Math.max(1, limit));
    while (items.length < limit) {
      const response = await collection().where(where)
        .field({ _id: true, id: true, publishedAt: true, channelKey: true, topicKeys: true })
        .orderBy('publishedAt', 'desc')
        .skip(items.length)
        .limit(Math.min(batchSize, limit - items.length))
        .get();
      const page = (response && response.data) || [];
      items.push(...page);
      if (page.length < batchSize) break;
    }
    return { items, truncated: items.length >= limit };
  }

  async function hasItems() {
    await ensureCollection();
    const result = await collection().limit(1).get();
    return Boolean(result && result.data && result.data.length);
  }

  async function stats() {
    await ensureCollection();
    const result = await collection().count();
    return { itemCount: Number(result && result.total) || 0 };
  }

  return {
    ensureCollection,
    upsertMany,
    markWithdrawn,
    getByItemId,
    getManyByItemIds,
    listByIdCursor,
    markVisualQueued,
    visualStats,
    queryPage,
    count,
    listFacets,
    hasItems,
    stats
  };
}

module.exports = {
  createFeedItemRepository,
  itemDocumentId,
  encodePageCursor,
  decodePageCursor,
  hasVisual,
  hasListThumbnail,
  needsVisualWork
};
