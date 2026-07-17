function isNotFound(error) {
  return Boolean(error && (
    error.errCode === -1
    || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || '')
  ));
}

function collectionAlreadyExists(error) {
  return Boolean(error && /already exists|exist|DATABASE_COLLECTION_EXIST/i.test(
    `${error.errCode || ''} ${error.code || ''} ${error.message || ''}`
  ));
}

function createCollectionEnsurer(db, collectionName) {
  let ready = null;
  return async function ensureCollection() {
    if (!ready) {
      ready = db.createCollection(collectionName)
        .catch((error) => {
          if (!collectionAlreadyExists(error)) throw error;
        })
        .catch((error) => {
          ready = null;
          throw error;
        });
    }
    await ready;
  };
}

function chunks(values, size) {
  const result = [];
  const width = Math.max(1, Number(size) || 1);
  for (let offset = 0; offset < values.length; offset += width) {
    result.push(values.slice(offset, offset + width));
  }
  return result;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let next = 0;
  async function run() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(values.length, Math.max(1, concurrency)) }, run));
  return results;
}

module.exports = {
  isNotFound,
  createCollectionEnsurer,
  chunks,
  mapWithConcurrency
};
