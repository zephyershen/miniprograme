function documentNotFound(error) {
  return /not.?found|not exist|DATABASE_DOCUMENT_NOT_EXIST|-502005/i.test(errorText(error));
}

function errorText(error) {
  if (!error) return '';
  return [error.code, error.errCode, error.message, error.errMsg]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join(' ');
}

function collectionAlreadyExists(error) {
  return /duplicate|already exists|collection.*exist|DATABASE_COLLECTION_EXIST|-502001/i.test(
    errorText(error)
  );
}

function updatedCount(result) {
  return Math.max(0, Number(result && result.stats && result.stats.updated) || 0);
}

function createCloudbaseIntelligenceBudgetStore(database, config = {}) {
  if (!database || typeof database.collection !== 'function') {
    throw new Error('INTELLIGENCE_BUDGET_STORE_CONFIG_INVALID');
  }
  const collectionName = config.collectionName || 'knowledge_ai_budget';
  const collection = database.collection(collectionName);
  const command = database.command;

  async function ensureCollection() {
    if (typeof database.createCollection !== 'function') return;
    try {
      await database.createCollection(collectionName);
    } catch (error) {
      if (!collectionAlreadyExists(error)) throw error;
    }
  }

  async function ensure(monthKey) {
    let exists = false;
    try {
      const result = await collection.doc(monthKey).get();
      exists = Array.isArray(result && result.data)
        ? result.data.length > 0
        : Boolean(result && result.data);
    } catch (error) {
      if (!documentNotFound(error)) throw error;
    }
    if (exists) return;
    await ensureCollection();
    try {
      await collection.add({
        data: {
          _id: monthKey,
          monthKey,
          reservedPoints: 0,
          overrunDetected: false,
          updatedAt: new Date()
        }
      });
    } catch (addError) {
      if (!collectionAlreadyExists(addError)) throw addError;
    }
  }

  async function tryReserve(monthKey, requestedPoints, limit, details = {}) {
    await ensure(monthKey);
    const maximumCurrent = Math.max(0, limit - requestedPoints);
    const result = await collection.where({
      _id: monthKey,
      reservedPoints: command.lte(maximumCurrent),
      overrunDetected: command.neq(true)
    }).update({
      data: {
        reservedPoints: command.inc(requestedPoints),
        lastTask: String(details.task || '').slice(0, 40),
        lastModel: String(details.model || '').slice(0, 80),
        updatedAt: new Date()
      }
    });
    return updatedCount(result) === 1;
  }

  async function adjust(monthKey, delta, details = {}) {
    await ensure(monthKey);
    await collection.doc(monthKey).update({
      data: {
        reservedPoints: command.inc(delta),
        lastTask: String(details.task || '').slice(0, 40),
        lastModel: String(details.model || '').slice(0, 80),
        updatedAt: new Date()
      }
    });
  }

  async function markOverrun(monthKey, details = {}) {
    await ensure(monthKey);
    await collection.doc(monthKey).update({
      data: {
        overrunDetected: true,
        overrunAt: new Date(),
        overrunMeasuredPoints: Math.max(0, Number(details.measuredPoints) || 0),
        overrunReservedPoints: Math.max(0, Number(details.reservedPoints) || 0),
        lastTask: String(details.task || '').slice(0, 40),
        lastModel: String(details.model || '').slice(0, 80),
        updatedAt: new Date()
      }
    });
  }

  async function isOverrun(monthKey) {
    await ensure(monthKey);
    const result = await collection.doc(monthKey).get();
    return Boolean(result && result.data && result.data.overrunDetected === true);
  }

  async function used(monthKey) {
    await ensure(monthKey);
    const result = await collection.doc(monthKey).get();
    return Math.max(0, Number(result && result.data && result.data.reservedPoints) || 0);
  }

  return Object.freeze({ tryReserve, adjust, markOverrun, isOverrun, used });
}

module.exports = {
  errorText,
  documentNotFound,
  collectionAlreadyExists,
  updatedCount,
  createCloudbaseIntelligenceBudgetStore
};
