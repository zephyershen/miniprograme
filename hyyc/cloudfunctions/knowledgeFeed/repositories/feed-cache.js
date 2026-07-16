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

  async function replace(data, prepareDocument = (next) => next) {
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(config.documentId);
      let current = null;
      try {
        current = (await reference.get()).data;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      const next = prepareDocument(data, current);
      await reference.set({ data: next });
      return { document: next, previous: current };
    });
  }

  async function touch(at) {
    await document().update({ data: { fetchedAt: at, updatedAt: at } });
  }

  async function patchItems(patches, updatedAt, visualDeletes = []) {
    const patchById = new Map(patches.map((entry) => [entry.id, entry.fields]));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(config.documentId);
      const current = (await reference.get()).data;
      const items = (current.items || []).map((item) => {
        const fields = patchById.get(item.id);
        return fields ? { ...item, ...fields } : item;
      });
      const activeVisuals = new Set();
      for (const item of items) {
        if (typeof item.coverFileId === 'string' && item.coverFileId) activeVisuals.add(item.coverFileId);
        for (const fileId of (Array.isArray(item.previewFileIds) ? item.previewFileIds : [])) {
          if (typeof fileId === 'string' && fileId) activeVisuals.add(fileId);
        }
      }
      const pendingVisualDeletes = [...new Set([
        ...(Array.isArray(current.pendingVisualDeletes) ? current.pendingVisualDeletes : []),
        ...(Array.isArray(visualDeletes) ? visualDeletes : [])
      ])].filter((fileId) => typeof fileId === 'string' && fileId && !activeVisuals.has(fileId));
      await reference.update({ data: { items, pendingVisualDeletes, updatedAt } });
      return items;
    });
  }

  async function acknowledgeVisualDeletes(fileIds, updatedAt) {
    const acknowledged = new Set(fileIds);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(config.documentId);
      const current = (await reference.get()).data;
      const pendingVisualDeletes = (current.pendingVisualDeletes || [])
        .filter((fileId) => !acknowledged.has(fileId));
      await reference.update({ data: { pendingVisualDeletes, updatedAt } });
      return pendingVisualDeletes;
    });
  }

  return { get, replace, touch, patchItems, acknowledgeVisualDeletes };
}

module.exports = { createFeedCacheRepository };
