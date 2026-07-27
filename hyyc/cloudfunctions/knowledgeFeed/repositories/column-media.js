const { createCollectionEnsurer, isNotFound } = require('./collection-support');

function createColumnMediaRepository(db, config) {
  const collection = () => db.collection(config.mediaCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.mediaCollectionName);

  async function get(id) {
    await ensureCollection();
    try {
      return (await collection().doc(id).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function create(document) {
    await ensureCollection();
    await collection().doc(document._id).set({
      data: Object.fromEntries(Object.entries(document).filter(([key]) => key !== '_id'))
    });
    return document;
  }

  async function getMany(ids) {
    await ensureCollection();
    const unique = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
    const found = [];
    for (let offset = 0; offset < unique.length; offset += 20) {
      const response = await collection()
        .where({ _id: db.command.in(unique.slice(offset, offset + 20)) })
        .limit(20)
        .get();
      found.push(...((response && response.data) || []));
    }
    return found;
  }

  async function listForEntry(entryId) {
    await ensureCollection();
    const found = [];
    const pageSize = 100;
    let lastId = '';

    while (true) {
      const where = lastId
        ? { entryId, _id: db.command.gt(lastId) }
        : { entryId };
      const response = await collection()
        .where(where)
        .orderBy('_id', 'asc')
        .limit(pageSize)
        .get();
      const page = (response && response.data) || [];
      found.push(...page);
      if (page.length < pageSize) break;
      lastId = page[page.length - 1] && page[page.length - 1]._id;
      if (!lastId) break;
    }

    return found;
  }

  async function update(id, data) {
    await ensureCollection();
    await collection().doc(id).update({ data });
    return get(id);
  }

  async function listExpired(currentTime, limit = config.mediaCleanupBatchSize) {
    await ensureCollection();
    const response = await collection()
      .where({ cleanupAfter: db.command.lte(currentTime) })
      .orderBy('cleanupAfter', 'asc')
      .limit(Math.max(1, Math.min(50, Number(limit) || 20)))
      .get();
    return (response && response.data) || [];
  }

  async function remove(id) {
    await ensureCollection();
    await collection().doc(id).remove();
  }

  return {
    ensureCollection,
    get,
    create,
    getMany,
    listForEntry,
    update,
    listExpired,
    remove
  };
}

module.exports = { createColumnMediaRepository };
