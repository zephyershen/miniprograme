const { randomUUID } = require('node:crypto');
const { createCollectionEnsurer, isNotFound } = require('./collection-support');

function safeId(value, prefix = '') {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && /^[a-z0-9_-]{3,160}$/i.test(id) && (!prefix || id.startsWith(prefix)) ? id : '';
}

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

async function readReference(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createColumnEditorialRepository(db, config) {
  const cases = () => db.collection(config.casesCollectionName);
  const dossiers = () => db.collection(config.dossiersCollectionName);
  const events = () => db.collection(config.eventsCollectionName);
  const ensureCases = createCollectionEnsurer(db, config.casesCollectionName);
  const ensureDossiers = createCollectionEnsurer(db, config.dossiersCollectionName);
  const ensureEvents = createCollectionEnsurer(db, config.eventsCollectionName);

  async function ensureCollections() {
    await Promise.all([ensureCases(), ensureDossiers(), ensureEvents()]);
  }

  async function getCase(caseId) {
    await ensureCases();
    const id = safeId(caseId, 'column_case_');
    if (!id) return null;
    try {
      return (await cases().doc(id).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function latestCase() {
    const page = await listCases({ limit: 1 });
    return page.items[0] || null;
  }

  async function listCases({ cursor = '', limit = config.casePageSize } = {}) {
    await ensureCases();
    const size = Math.max(1, Math.min(config.caseMaxPageSize, Number(limit) || config.casePageSize));
    const afterId = cursor ? safeId(cursor, 'column_case_') : '';
    if (cursor && !afterId) {
      const error = new Error('INVALID_COLUMN_CASE_CURSOR');
      error.code = 'INVALID_REQUEST';
      throw error;
    }
    const published = [];
    let scanAfter = afterId;
    for (let scan = 0; scan < 5 && published.length < size + 1; scan += 1) {
      const batchSize = Math.min(100, Math.max(20, size + 6));
      let query = cases();
      if (scanAfter) query = cases().where({ _id: db.command.lt(scanAfter) });
      const response = await query.orderBy('_id', 'desc').limit(batchSize).get();
      const rows = (response && response.data) || [];
      published.push(...rows.filter((item) => item && item.status === 'published'));
      if (rows.length < batchSize) break;
      scanAfter = rows[rows.length - 1]._id;
    }
    const items = published.slice(0, size);
    return {
      items,
      hasMore: published.length > size,
      nextCursor: published.length > size && items.length ? items[items.length - 1]._id : ''
    };
  }

  async function claimCase(document, {
    force = false,
    owner = randomUUID(),
    currentTime = new Date(),
    leaseMs = config.generationLeaseMs
  } = {}) {
    await ensureCases();
    const id = safeId(document && document._id, 'column_case_');
    if (!id) throw new Error('COLUMN_CASE_ID_REQUIRED');
    const leaseUntil = new Date(currentTime.getTime() + Math.max(60 * 1000, Number(leaseMs) || 0));
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.casesCollectionName).doc(id);
      const current = await readReference(reference);
      if (current && current.status === 'published' && !force) {
        return { acquired: false, reason: 'published', document: current };
      }
      if (current && current.status === 'skipped' && !force) {
        return { acquired: false, reason: 'skipped', document: current };
      }
      if (current && current.generationLeaseOwner
        && toMillis(current.generationLeaseUntil) > currentTime.getTime()) {
        return { acquired: false, reason: 'leased', document: current };
      }
      const seed = { ...document };
      delete seed._id;
      const fields = {
        ...seed,
        status: current && current.status === 'published' ? 'published' : 'generating',
        generationState: 'running',
        generationLeaseOwner: owner,
        generationLeaseUntil: leaseUntil,
        generationAttemptedAt: currentTime,
        updatedAt: currentTime
      };
      if (current) await reference.update({ data: fields });
      else await reference.set({ data: fields });
      return { acquired: true, owner, document: { ...(current || {}), ...fields, _id: id } };
    });
  }

  function projectionData(document, eventExists, dossierDocument) {
    const event = {
      dossierKey: document.dossierKey,
      caseId: document._id,
      title: document.title || '',
      conclusion: document.conclusion || '',
      publishedAt: document.publishedAt,
      sourceItemIds: document.sourceItemIds || [],
      sources: document.sources || [],
      updatedAt: document.updatedAt
    };
    const currentCount = Math.max(0, Number(dossierDocument && dossierDocument.eventCount) || 0);
    const dossier = {
      key: document.dossierKey,
      latestCaseId: document._id,
      eventCount: currentCount + (eventExists ? 0 : 1),
      updatedAt: document.updatedAt
    };
    return { event, dossier };
  }

  async function publishCaseWithTrend(document, owner) {
    await ensureCollections();
    const caseId = safeId(document && document._id, 'column_case_');
    const eventId = safeId(
      `trend_event_${document && document.dossierKey}_${document && document.periodKey}`,
      'trend_event_'
    );
    const dossierId = safeId(`trend_dossier_${document && document.dossierKey}`, 'trend_dossier_');
    if (!caseId || !eventId || !dossierId || !owner) throw new Error('COLUMN_PUBLICATION_ID_REQUIRED');
    return db.runTransaction(async (transaction) => {
      const caseReference = transaction.collection(config.casesCollectionName).doc(caseId);
      const eventReference = transaction.collection(config.eventsCollectionName).doc(eventId);
      const dossierReference = transaction.collection(config.dossiersCollectionName).doc(dossierId);
      const current = await readReference(caseReference);
      const currentEvent = await readReference(eventReference);
      const currentDossier = await readReference(dossierReference);
      if (!current || current.generationLeaseOwner !== owner) {
        const error = new Error('COLUMN_GENERATION_LEASE_LOST');
        error.code = 'COLUMN_GENERATION_LEASE_LOST';
        throw error;
      }
      const data = {
        ...document,
        status: 'published',
        reviewMode: 'automated',
        generationState: 'complete',
        generationLeaseOwner: '',
        generationLeaseUntil: null
      };
      delete data._id;
      const projection = projectionData({ ...data, _id: caseId }, Boolean(currentEvent), currentDossier);
      await caseReference.set({ data });
      await eventReference.set({ data: projection.event });
      await dossierReference.set({ data: projection.dossier });
      return { ...data, _id: caseId };
    });
  }

  async function ensureTrendProjection(document) {
    await ensureCollections();
    const caseId = safeId(document && document._id, 'column_case_');
    const eventId = safeId(
      `trend_event_${document && document.dossierKey}_${document && document.periodKey}`,
      'trend_event_'
    );
    const dossierId = safeId(`trend_dossier_${document && document.dossierKey}`, 'trend_dossier_');
    if (!caseId || !eventId || !dossierId || document.status !== 'published') return false;
    await db.runTransaction(async (transaction) => {
      const eventReference = transaction.collection(config.eventsCollectionName).doc(eventId);
      const dossierReference = transaction.collection(config.dossiersCollectionName).doc(dossierId);
      const currentEvent = await readReference(eventReference);
      const currentDossier = await readReference(dossierReference);
      const projection = projectionData(document, Boolean(currentEvent), currentDossier);
      await eventReference.set({ data: projection.event });
      await dossierReference.set({ data: projection.dossier });
    });
    return true;
  }

  async function finishGeneration(caseId, owner, state, reason, currentTime = new Date()) {
    await ensureCases();
    const id = safeId(caseId, 'column_case_');
    if (!id || !owner) return false;
    return db.runTransaction(async (transaction) => {
      const reference = transaction.collection(config.casesCollectionName).doc(id);
      const current = await readReference(reference);
      if (!current || current.generationLeaseOwner !== owner) return false;
      const keepPublished = current.status === 'published';
      await reference.update({ data: {
        status: keepPublished ? 'published' : (state === 'skipped' ? 'skipped' : 'retry'),
        generationState: state,
        generationReason: String(reason || '').slice(0, 120),
        generationLeaseOwner: '',
        generationLeaseUntil: null,
        updatedAt: currentTime
      } });
      return true;
    });
  }

  function markCaseSkipped(caseId, owner, reason, currentTime) {
    return finishGeneration(caseId, owner, 'skipped', reason, currentTime);
  }

  function markCaseFailed(caseId, owner, reason, currentTime) {
    return finishGeneration(caseId, owner, 'retry', reason, currentTime);
  }

  async function getDossier(key) {
    await ensureDossiers();
    const id = safeId(`trend_dossier_${key}`, 'trend_dossier_');
    if (!id) return null;
    try {
      return (await dossiers().doc(id).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function listDossiers() {
    await ensureDossiers();
    const response = await dossiers().limit(20).get();
    return (response && response.data) || [];
  }

  async function listEvents(dossierKey) {
    await ensureEvents();
    const prefix = `trend_event_${dossierKey}_`;
    if (!safeId(prefix, 'trend_event_')) return [];
    const response = await events().where({
      _id: db.command.gte(prefix).and(db.command.lt(`${prefix}\uffff`))
    }).orderBy('_id', 'desc').limit(Math.max(1, Number(config.dossierEventLimit) || 100)).get();
    return (response && response.data) || [];
  }

  return {
    ensureCollections,
    getCase,
    latestCase,
    listCases,
    claimCase,
    publishCaseWithTrend,
    ensureTrendProjection,
    markCaseSkipped,
    markCaseFailed,
    getDossier,
    listDossiers,
    listEvents
  };
}

module.exports = { safeId, toMillis, createColumnEditorialRepository };
