const { createCollectionEnsurer, isNotFound } = require('./collection-support');

function assertOwnerKey(ownerKey) {
  if (!/^[a-f0-9]{64}$/.test(ownerKey || '')) throw new Error('ACCESS_OWNER_INVALID');
  return ownerKey;
}

function createFeedAccessRepository(db, config) {
  const collection = () => db.collection(config.accessCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.accessCollectionName);

  async function get(ownerKey) {
    await ensureCollection();
    try {
      return (await collection().doc(assertOwnerKey(ownerKey)).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function grant(ownerKey, fields) {
    await ensureCollection();
    const data = { ...fields, ownerKey: assertOwnerKey(ownerKey) };
    await collection().doc(ownerKey).set({ data });
    return data;
  }

  async function setPreviewRole(ownerKey, previewRole, updatedAt = new Date()) {
    await ensureCollection();
    await collection().doc(assertOwnerKey(ownerKey)).update({
      data: { previewRole, previewUpdatedAt: updatedAt }
    });
    return { previewRole, previewUpdatedAt: updatedAt };
  }

  return { ensureCollection, get, grant, setPreviewRole };
}

module.exports = { createFeedAccessRepository, assertOwnerKey };
