const { createCollectionEnsurer, isNotFound } = require('./collection-support');
const { assertOwnerKey } = require('./feed-access');

function createMembershipRepository(db, config) {
  const collection = () => db.collection(config.collectionName);
  const ensureCollection = createCollectionEnsurer(db, config.collectionName);

  async function get(ownerKey) {
    await ensureCollection();
    try {
      return (await collection().doc(assertOwnerKey(ownerKey)).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function put(ownerKey, fields) {
    await ensureCollection();
    const document = { ...fields, ownerKey: assertOwnerKey(ownerKey) };
    await collection().doc(ownerKey).set({ data: document });
    return document;
  }

  return { ensureCollection, get, put };
}

module.exports = { createMembershipRepository };
