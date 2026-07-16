function isNotFound(error) {
  return error && (error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || ''));
}

function visualFileIds(items) {
  const fileIds = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    if (typeof item.coverFileId === 'string' && item.coverFileId) fileIds.add(item.coverFileId);
    for (const fileId of (Array.isArray(item.previewFileIds) ? item.previewFileIds : [])) {
      if (typeof fileId === 'string' && fileId) fileIds.add(fileId);
    }
  }
  return fileIds;
}

function patchVisualFileIds(fields) {
  return visualFileIds([fields || {}]);
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
    const patchById = new Map(patches.map((entry) => [entry.id, entry]));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(config.documentId);
      const current = (await reference.get()).data;
      const appliedIds = new Set();
      const claimedDeletes = new Set(Array.isArray(current.visualDeleteClaims) ? current.visualDeleteClaims : []);
      const previousVisuals = visualFileIds(current.items);
      const items = (current.items || []).map((item) => {
        const patch = patchById.get(item.id);
        if (!patch || (patch.expectedUrl && patch.expectedUrl !== item.url)) return item;
        if ([...patchVisualFileIds(patch.fields)].some((fileId) => claimedDeletes.has(fileId))) return item;
        appliedIds.add(item.id);
        return { ...item, ...patch.fields };
      });
      const discardedUploads = patches
        .filter((patch) => !appliedIds.has(patch.id))
        .flatMap((patch) => Array.isArray(patch.discardFileIds) ? patch.discardFileIds : []);
      const activeVisuals = visualFileIds(items);
      const replacedVisuals = [...previousVisuals].filter((fileId) => !activeVisuals.has(fileId));
      const pendingVisualDeletes = [...new Set([
        ...(Array.isArray(current.pendingVisualDeletes) ? current.pendingVisualDeletes : []),
        ...(Array.isArray(visualDeletes) ? visualDeletes : []),
        ...discardedUploads,
        ...replacedVisuals
      ])].filter((fileId) => typeof fileId === 'string'
        && fileId
        && !activeVisuals.has(fileId)
        && !claimedDeletes.has(fileId));
      const visualDeleteClaims = [...claimedDeletes];
      await reference.update({ data: { items, pendingVisualDeletes, visualDeleteClaims, updatedAt } });
      return { items, appliedIds: [...appliedIds], pendingVisualDeletes, visualDeleteClaims };
    });
  }

  async function claimVisualDeletes(fileIds, updatedAt) {
    const requested = new Set(Array.isArray(fileIds) ? fileIds : []);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(config.documentId);
      const current = (await reference.get()).data;
      const activeVisuals = visualFileIds(current.items);
      const pending = new Set(Array.isArray(current.pendingVisualDeletes) ? current.pendingVisualDeletes : []);
      const claims = new Set(Array.isArray(current.visualDeleteClaims) ? current.visualDeleteClaims : []);
      const claimed = [...requested].filter((fileId) => (pending.has(fileId) || claims.has(fileId))
        && !activeVisuals.has(fileId));
      for (const fileId of claimed) {
        pending.delete(fileId);
        claims.add(fileId);
      }
      await reference.update({
        data: {
          pendingVisualDeletes: [...pending],
          visualDeleteClaims: [...claims],
          updatedAt
        }
      });
      return claimed;
    });
  }

  async function acknowledgeVisualDeletes(fileIds, updatedAt) {
    const acknowledged = new Set(fileIds);
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.collectionName).doc(config.documentId);
      const current = (await reference.get()).data;
      const pendingVisualDeletes = (current.pendingVisualDeletes || [])
        .filter((fileId) => !acknowledged.has(fileId));
      const visualDeleteClaims = (current.visualDeleteClaims || [])
        .filter((fileId) => !acknowledged.has(fileId));
      await reference.update({ data: { pendingVisualDeletes, visualDeleteClaims, updatedAt } });
      return pendingVisualDeletes;
    });
  }

  return {
    get,
    replace,
    touch,
    patchItems,
    claimVisualDeletes,
    acknowledgeVisualDeletes
  };
}

module.exports = { visualFileIds, createFeedCacheRepository };
