const { createCollectionEnsurer, isNotFound } = require('./collection-support');

function createFeedMigrationRepository(db, config) {
  const collection = () => db.collection(config.migrationCollectionName);
  const document = () => collection().doc(config.migrationDocumentId);
  const ensureCollection = createCollectionEnsurer(db, config.migrationCollectionName);

  async function get() {
    await ensureCollection();
    try {
      return (await document().get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function patch(fields) {
    await ensureCollection();
    const current = await get();
    if (current) await document().update({ data: fields });
    else await document().set({ data: fields });
    return { ...(current || {}), ...fields };
  }

  return { ensureCollection, get, patch };
}

module.exports = { createFeedMigrationRepository };
