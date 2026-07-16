function isNotFound(error) {
  return error && (error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || ''));
}

function createFeedCacheRepository(db, config) {
  const document = () => db.collection(config.collectionName).doc(config.documentId);

  async function get() {
    try {
      return (await document().get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function set(data) {
    await document().set({ data });
    return data;
  }

  async function touch(at) {
    await document().update({ data: { fetchedAt: at, updatedAt: at } });
  }

  async function updateItems(items, updatedAt) {
    await document().update({ data: { items, updatedAt } });
  }

  return { get, set, touch, updateItems };
}

module.exports = { createFeedCacheRepository };
