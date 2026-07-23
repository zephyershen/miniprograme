const {
  createCollectionEnsurer,
  chunks,
  isNotFound,
  mapWithConcurrency
} = require('./collection-support');
const { storedDocumentId } = require('../lib/stored-feed-item');
const {
  sourceMetadataFields,
  sourceMetadataHash,
  hasSourceMetadataPatch,
  mergeSourceMetadata
} = require('../lib/source-metadata');

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

function withInitialVisualPublicationState(document, { holdWithoutVisuals = true } = {}) {
  const ready = hasVisual(document);
  const held = holdWithoutVisuals && !ready;
  return {
    ...document,
    visualPublicationHeld: held,
    visualPublicationReleasedAt: held ? null : (document.firstStoredAt || document.updatedAt || null),
    visualPublicationReleaseReason: ready ? 'visual-ready' : (held ? '' : 'source-backfill')
  };
}

function storedTime(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function itemDocumentId(provider, itemId) {
  return storedDocumentId(provider, itemId);
}

function engagementCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
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
    if (document.previewQualityAudit && typeof document.previewQualityAudit === 'object') {
      fields.previewQualityAudit = document.previewQualityAudit;
    }
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
          listThumbnailVersion: true,
          baseScore: true,
          score: true,
          likeCount: true,
          commentCount: true,
          favoriteCount: true,
          sourceIdentity: true,
          sourceTags: true,
          sourceChannelKeys: true,
          sourceChannelKey: true,
          sourceAvatarFileId: true,
          sourceMetadataHash: true
        })
        .limit(batch.length)
        .get();
      records.push(...((response && response.data) || []));
    }
    return new Map(records.map((record) => [record._id, record]));
  }

  async function upsertMany(documents, { mergeVisuals = false, holdNewItems = true } = {}) {
    await ensureCollection();
    const unique = new Map();
    for (const document of (Array.isArray(documents) ? documents : [])) {
      if (document && typeof document._id === 'string') unique.set(document._id, document);
    }
    const values = [...unique.values()];
    const existing = await metadataByIds(values.map((document) => document._id));
    const inserted = values.filter((document) => !existing.has(document._id));
    const initialDocuments = inserted.map((document) => withInitialVisualPublicationState(document, {
      holdWithoutVisuals: holdNewItems
    }));
    for (const batch of chunks(initialDocuments, 50)) {
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
      const mergedMetadata = hasSourceMetadataPatch(document)
        ? mergeSourceMetadata(current, document)
        : null;
      const currentMetadataHash = current.sourceMetadataHash
        || sourceMetadataHash(sourceMetadataFields(current));
      const metadataChanged = Boolean(mergedMetadata
        && (mergedMetadata.sourceMetadataHash || '') !== currentMetadataHash);
      return current.contentHash !== document.contentHash
        || current.publicState !== document.publicState
        || metadataChanged
        || (mergeVisuals && missingIncomingVisual)
        || missingVisualState;
    });
    await mapWithConcurrency(updates, 8, async (document) => {
      const current = existing.get(document._id) || {};
      const data = { ...document };
      if (current.analysisInputHash !== document.analysisInputHash) {
        data.qualityTier = 'standard';
        data.analysisStatus = 'pending';
        data.analysisPolicyVersion = 0;
        data.editorialReviewStatus = 'pending';
      }
      const baseScore = Number.isFinite(Number(document.baseScore))
        ? Number(document.baseScore)
        : (Number.isFinite(Number(document.score)) ? Number(document.score) : 0);
      const likeCount = engagementCount(current.likeCount);
      delete data._id;
      delete data.firstStoredAt;
      delete data.visualPublicationHeld;
      delete data.visualPublicationReleasedAt;
      delete data.visualPublicationReleaseReason;
      delete data.sourceIdentity;
      delete data.sourceTags;
      delete data.sourceChannelKeys;
      delete data.sourceChannelKey;
      delete data.sourceAvatarFileId;
      delete data.sourceMetadataHash;
      if (hasSourceMetadataPatch(document)) {
        Object.assign(data, mergeSourceMetadata(current, document));
      }
      data.baseScore = baseScore;
      data.likeCount = likeCount;
      data.commentCount = engagementCount(current.commentCount);
      data.favoriteCount = engagementCount(current.favoriteCount);
      data.score = baseScore + likeCount;
      if (!mergeVisuals) {
        delete data.coverFileId;
        delete data.coverCheckedAt;
        delete data.coverStatus;
        delete data.previewFileIds;
        delete data.previewCheckedAt;
        delete data.previewStatus;
        delete data.previewCaptureVersion;
        delete data.previewQualityAudit;
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
    const insertedIds = new Set(inserted.map((document) => document._id));
    const insertedVisualCandidates = visualCandidates
      .filter((document) => insertedIds.has(document._id));
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
      insertedVisualCandidates,
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

  async function releaseExpiredVisualPublicationHolds(cutoff, releasedAt = new Date()) {
    await ensureCollection();
    const cutoffDate = cutoff instanceof Date ? cutoff : new Date(cutoff);
    const releaseDate = releasedAt instanceof Date ? releasedAt : new Date(releasedAt);
    if (Number.isNaN(cutoffDate.getTime()) || Number.isNaN(releaseDate.getTime())) return [];

    // Held rows are transient and few. Query only the marker so this rollout
    // does not depend on a new compound index, then evaluate the existing
    // immutable firstStoredAt timestamp in-process.
    const response = await collection().where({ visualPublicationHeld: true })
      .field({ _id: true, publicState: true, firstStoredAt: true })
      .limit(500)
      .get();
    const documents = ((response && response.data) || []).filter((document) => (
      document.publicState === 'active'
      && storedTime(document.firstStoredAt) <= cutoffDate.getTime()
    ));
    await mapWithConcurrency(documents, 8, async (document) => {
      await collection().doc(document._id).update({
        data: {
          visualPublicationHeld: false,
          visualPublicationReleasedAt: releaseDate,
          visualPublicationReleaseReason: 'grace-expired',
          updatedAt: releaseDate
        }
      });
    });
    const releasedIds = documents.map((document) => document._id);
    return releasedIds;
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
    until,
    sourceChannel = 'all',
    contentChannel = '',
    topicKeys = [],
    sourceTags = [],
    includeWithdrawn = false,
    qualityTier = '',
    excludeVisualPublicationHolds = false
  }) {
    const where = {};
    const command = db.command;
    if (!includeWithdrawn) where.publicState = 'active';
    if (since && until) where.publishedAt = command.gte(since).and(command.lt(until));
    else if (since) where.publishedAt = command.gte(since);
    else if (until) where.publishedAt = command.lt(until);
    if (sourceChannel && sourceChannel !== 'all') {
      where.sourceChannelKey = sourceChannel;
    }
    if (contentChannel) where.channelKey = contentChannel;
    if (topicKeys.length) where.topicKeys = command.all(topicKeys);
    if (sourceTags.length) where.sourceTags = command.all(sourceTags);
    if (qualityTier) where.qualityTier = qualityTier;
    if (excludeVisualPublicationHolds) {
      // $ne also includes documents created before this rollout, so existing
      // text-only news remains public without a migration.
      where.visualPublicationHeld = command.neq(true);
    }
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

  async function latestCursor(options) {
    const page = await queryPage({
      ...options,
      sort: 'latest',
      offset: 0,
      cursor: '',
      limit: 1,
      includeCount: false
    });
    return encodePageCursor(page.items && page.items[0], 'latest');
  }

  async function countAfterCursor(options, cursorValue) {
    await ensureCollection();
    const cursor = decodePageCursor(cursorValue, 'latest');
    if (!cursor) return null;
    const command = db.command;
    const newer = command.or([
      { publishedAt: command.gt(cursor.publishedAt) },
      { publishedAt: cursor.publishedAt, _id: command.gt(cursor.id) }
    ]);
    const result = await collection()
      .where(command.and([buildWhere(options), newer]))
      .count();
    return Number(result && result.total) || 0;
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
        .field({
          _id: true,
          id: true,
          publishedAt: true,
          channelKey: true,
          sourceChannelKeys: true,
          sourceChannelKey: true,
          topicKeys: true,
          sourceTags: true,
          qualityTier: true
        })
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

  async function analysisCoverage(since = null, until = null) {
    await ensureCollection();
    const where = buildWhere({ since, until });
    const [totalResult, readyResult] = await Promise.all([
      collection().where(where).count(),
      collection().where({ ...where, analysisStatus: 'ready' }).count()
    ]);
    const total = Number(totalResult && totalResult.total) || 0;
    const ready = Number(readyResult && readyResult.total) || 0;
    return {
      total,
      ready,
      ratio: total ? Math.round((ready / total) * 10000) / 10000 : 0,
      truncated: false
    };
  }

  return {
    ensureCollection,
    upsertMany,
    markWithdrawn,
    getByItemId,
    getManyByItemIds,
    listByIdCursor,
    markVisualQueued,
    releaseExpiredVisualPublicationHolds,
    visualStats,
    queryPage,
    latestCursor,
    countAfterCursor,
    count,
    listFacets,
    hasItems,
    stats,
    analysisCoverage
  };
}

module.exports = {
  createFeedItemRepository,
  itemDocumentId,
  encodePageCursor,
  decodePageCursor,
  hasVisual,
  hasListThumbnail,
  needsVisualWork,
  withInitialVisualPublicationState
};
