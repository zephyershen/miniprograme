const { createCollectionEnsurer, isNotFound } = require('./collection-support');
const { itemDocumentId } = require('./feed-item');
const { dayDocumentId, entriesFromDocument } = require('./feed-day-index');
const { analysisInputHash } = require('../policies/feed-curation');

function createFeedAnalysisRepository(db, config) {
  const collection = () => db.collection(config.analysisCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.analysisCollectionName);

  async function get(itemId) {
    await ensureCollection();
    try {
      return (await collection().doc(itemDocumentId(config.provider, itemId)).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function publish(item, analysis, updatedAt = new Date()) {
    await ensureCollection();
    const documentId = itemDocumentId(config.provider, item.id);
    const analysisDocument = {
      provider: config.provider,
      itemId: item.id,
      inputHash: analysis.inputHash,
      status: 'ready',
      qualityTier: analysis.qualityTier,
      reviewMode: 'ai',
      curationScore: analysis.curationScore,
      curationReason: analysis.curationReason || '',
      reasonCodes: analysis.reasonCodes || [],
      companyKeys: analysis.companyKeys || [],
      directionKeys: analysis.directionKeys || [],
      analysisPolicyVersion: analysis.analysisPolicyVersion,
      intelligenceProvider: analysis.intelligenceProvider || '',
      model: analysis.model || '',
      usage: analysis.usage || null,
      analyzedAt: updatedAt,
      updatedAt
    };
    return db.runTransaction(async (transaction) => {
      const itemReference = transaction.collection(config.itemsCollectionName).doc(documentId);
      let current;
      try {
        current = (await itemReference.get()).data;
      } catch (error) {
        if (isNotFound(error)) return { applied: false, reason: 'missing-item' };
        throw error;
      }
      if (current.publicState !== 'active' || analysis.inputHash !== analysisInputHash(current)) {
        return { applied: false, reason: 'stale-analysis' };
      }
      const projection = {
        qualityTier: analysis.qualityTier,
        curationScore: analysis.curationScore,
        curationReason: analysis.curationReason || '',
        analysisPolicyVersion: analysis.analysisPolicyVersion,
        analysisInputHash: analysis.inputHash,
        analysisStatus: 'ready',
        editorialReviewStatus: 'automated',
        analysisUpdatedAt: updatedAt,
        updatedAt
      };
      await transaction.collection(config.analysisCollectionName).doc(documentId)
        .set({ data: analysisDocument });
      await itemReference.update({ data: projection });

      const dayId = dayDocumentId(config.provider, current.publishedDay);
      const dayReference = transaction.collection(config.dayIndexCollectionName).doc(dayId);
      try {
        const day = (await dayReference.get()).data;
        const entries = entriesFromDocument(day).map((entry) => entry.id === item.id
          ? { ...entry, ...projection }
          : entry);
        const persisted = { ...day, entries, updatedAt };
        delete persisted._id;
        await dayReference.set({ data: persisted });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return { applied: true, document: analysisDocument };
    });
  }

  async function countSince(since) {
    await ensureCollection();
    const result = await collection().where({ analyzedAt: db.command.gte(since) }).count();
    return Number(result && result.total) || 0;
  }

  return { ensureCollection, get, publish, countSince };
}

module.exports = { createFeedAnalysisRepository };
