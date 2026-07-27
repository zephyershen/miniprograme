const { createCollectionEnsurer, isNotFound } = require('./collection-support');

function versionError() {
  const error = new Error('COLUMN_ENTRY_VERSION_CONFLICT');
  error.code = 'VERSION_CONFLICT';
  return error;
}

async function readReference(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createColumnEntryRepository(db, config) {
  const collection = () => db.collection(config.entriesCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.entriesCollectionName);

  async function get(id) {
    await ensureCollection();
    try {
      return (await collection().doc(id).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function listAll() {
    await ensureCollection();
    const rows = [];
    let afterId = '';
    for (let page = 0; page < 20; page += 1) {
      let query = collection();
      if (afterId) query = collection().where({ _id: db.command.gt(afterId) });
      const response = await query.orderBy('_id', 'asc').limit(100).get();
      const batch = (response && response.data) || [];
      rows.push(...batch);
      if (batch.length < 100) break;
      afterId = batch[batch.length - 1]._id;
    }
    return rows;
  }

  async function mutate({
    id,
    expectedVersion,
    mutationId,
    createDocument,
    update
  }) {
    await ensureCollection();
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.entriesCollectionName).doc(id);
      const current = await readReference(reference);
      if (current && current.lastMutationId === mutationId) return current;
      if (Number(current && current.version || 0) !== Number(expectedVersion || 0)) {
        throw versionError();
      }
      const base = current || createDocument;
      if (!base) throw versionError();
      const next = update(base);
      const document = {
        ...next,
        _id: id,
        version: Number(base.version || 0) + 1,
        lastMutationId: mutationId
      };
      const data = { ...document };
      delete data._id;
      await reference.set({ data });
      return document;
    });
  }

  return { ensureCollection, get, listAll, mutate };
}

module.exports = { createColumnEntryRepository, versionError };
