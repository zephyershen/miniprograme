const crypto = require('node:crypto');
const {
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');

function assertOwnerKey(ownerKey) {
  if (!/^[a-f0-9]{64}$/.test(ownerKey || '')) throw new Error('COLUMN_PROGRESS_OWNER_INVALID');
  return ownerKey;
}

function assertEntryId(entryId) {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(entryId || '')) {
    throw new Error('COLUMN_PROGRESS_ENTRY_INVALID');
  }
  return entryId;
}

function assertEntryType(entryType) {
  if (!['lesson', 'practical'].includes(entryType)) {
    throw new Error('COLUMN_PROGRESS_TYPE_INVALID');
  }
  return entryType;
}

function progressDocumentId(ownerKey, entryType, entryId) {
  return crypto.createHash('sha256')
    .update(`${assertOwnerKey(ownerKey)}:${assertEntryType(entryType)}:${assertEntryId(entryId)}`)
    .digest('hex');
}

async function documentOrNull(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createColumnProgressRepository(db, config) {
  const collection = () => db.collection(config.progressCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.progressCollectionName);

  async function list(ownerKey) {
    await ensureCollection();
    const safeOwnerKey = assertOwnerKey(ownerKey);
    const rows = [];
    while (true) {
      const response = await collection()
        .where({ ownerKey: safeOwnerKey })
        .orderBy('lastReadAt', 'desc')
        .orderBy('_id', 'desc')
        .skip(rows.length)
        .limit(100)
        .get();
      const batch = (response && response.data) || [];
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
  }

  async function save(ownerKey, input, updatedAt) {
    await ensureCollection();
    const safeOwnerKey = assertOwnerKey(ownerKey);
    const entryType = assertEntryType(input.entryType);
    const entryId = assertEntryId(input.entryId);
    const posterIndex = Number(input.lastPosterIndex);
    const id = progressDocumentId(safeOwnerKey, entryType, entryId);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.progressCollectionName).doc(id);
      const current = await documentOrNull(reference);
      if (current && current.lastMutationId === input.mutationId) return current;
      const requestedPercent = Math.min(100, Math.max(5, Math.floor(Number(input.progressPercent) || 5)));
      const progressPercent = Math.max(
        Math.floor(Number(current && current.progressPercent) || 0),
        requestedPercent
      );
      const completed = progressPercent >= 100 || Boolean(current && current.completedAt);
      const document = {
        ownerKey: safeOwnerKey,
        entryId,
        entryType,
        progressPercent,
        lastPosterIndex: Number.isFinite(posterIndex) ? Math.max(0, Math.floor(posterIndex)) : 0,
        publishedRevision: Math.max(
          0,
          Math.floor(Number(input.publishedRevision) || 0)
        ),
        createdAt: current && current.createdAt || updatedAt,
        lastReadAt: updatedAt,
        completedAt: completed ? (current && current.completedAt || updatedAt) : null,
        lastMutationId: input.mutationId
      };
      await reference.set({ data: document });
      return { _id: id, ...document };
    });
  }

  return {
    ensureCollection,
    list,
    save
  };
}

module.exports = {
  assertOwnerKey,
  assertEntryId,
  assertEntryType,
  progressDocumentId,
  createColumnProgressRepository
};
