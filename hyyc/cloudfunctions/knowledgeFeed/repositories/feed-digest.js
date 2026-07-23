const { createCollectionEnsurer, isNotFound } = require('./collection-support');

const WINDOW_KEYS = new Set(['24h', '7d', '30d']);

function assertWindowKey(windowKey) {
  if (!WINDOW_KEYS.has(windowKey)) throw new Error('DIGEST_WINDOW_INVALID');
  return windowKey;
}

function createFeedDigestRepository(db, config) {
  const collection = () => db.collection(config.digestsCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.digestsCollectionName);

  async function get(digestId) {
    await ensureCollection();
    if (typeof digestId !== 'string' || !/^[a-z0-9_-]{8,120}$/i.test(digestId)) return null;
    try {
      return (await collection().doc(digestId).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function latest(windowKey) {
    await ensureCollection();
    const response = await collection().where({
      windowKey: assertWindowKey(windowKey), status: 'published'
    }).orderBy('generatedAt', 'desc').limit(1).get();
    return response && response.data && response.data[0] || null;
  }

  async function publish(document) {
    await ensureCollection();
    assertWindowKey(document && document.windowKey);
    if (!document || typeof document._id !== 'string') throw new Error('DIGEST_ID_REQUIRED');
    const data = { ...document, status: 'published', reviewMode: 'ai' };
    delete data._id;
    await collection().doc(document._id).set({ data });
    return { ...data, _id: document._id };
  }

  return { ensureCollection, get, latest, publish };
}

module.exports = { WINDOW_KEYS, assertWindowKey, createFeedDigestRepository };
