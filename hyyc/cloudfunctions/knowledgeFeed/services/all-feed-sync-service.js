const { randomUUID } = require('node:crypto');
const { toDate } = require('../lib/dates');
const {
  toStoredFeedItem,
  visualFields,
  publishedDay
} = require('../lib/stored-feed-item');

const DAY_MS = 24 * 60 * 60 * 1000;

function ageOf(value, now) {
  const date = toDate(value);
  return date ? now - date.getTime() : Number.POSITIVE_INFINITY;
}

function allSyncErrorCode(error) {
  if (error && (error.code === 'ALL_SYNC_LEASE_LOST' || error.message === 'ALL_SYNC_LEASE_LOST')) {
    return 'ALL_SYNC_LEASE_LOST';
  }
  if (Number.isInteger(error && error.status)) return `FEED_SOURCE_${error.status}`;
  if (error && error.name === 'AbortError') return 'FEED_SOURCE_TIMEOUT';
  if (error && /^FEED_[A-Z0-9_]+$/.test(error.message || '')) return error.message;
  return 'FEED_ALL_SYNC_FAILURE';
}

function cachedVisuals(cache) {
  return new Map(((cache && cache.items) || []).map((item) => [item.id, visualFields(item)]));
}

function observedAllFingerprint(fingerprint, state = {}) {
  if (fingerprint && typeof fingerprint.all === 'string' && fingerprint.all) {
    return fingerprint.all;
  }
  return state.allObservedFingerprint || '';
}

function allSyncPlan(state, fingerprint, currentTime, config, force = false) {
  const observedFingerprint = observedAllFingerprint(fingerprint, state);
  const fingerprintChanged = Boolean(observedFingerprint
    && observedFingerprint !== state.allAppliedFingerprint);
  const needsFullRefresh = force
    || fingerprintChanged
    || ageOf(state.allFullSyncedAt || state.allItemsSyncedAt, currentTime) >= config.fullRefreshMs;
  const needsItemsValidation = needsFullRefresh
    || ageOf(state.allItemsCheckedAt || state.allItemsSyncedAt, currentTime) >= config.itemsRevalidateMs;
  return { observedFingerprint, fingerprintChanged, needsFullRefresh, needsItemsValidation };
}

function createAllFeedSyncService({
  source,
  cacheRepository,
  itemRepository,
  visualJobRepository,
  analysisJobRepository = null,
  dayIndexRepository,
  syncStateRepository,
  config,
  now = () => Date.now(),
  createGeneration = randomUUID,
  logger = console
}) {
  let active = null;

  async function syncOnce({
    force = false,
    fingerprintObservation = null,
    legacyCache = null
  } = {}) {
    const startedAt = now();
    const snapshot = typeof syncStateRepository.get === 'function'
      ? (await syncStateRepository.get() || {})
      : {};
    let fingerprint = fingerprintObservation;
    try {
      if (!fingerprint) fingerprint = await source.loadFingerprint(snapshot.allFingerprintEtag || '');
      if (fingerprint.notModified && !observedAllFingerprint(fingerprint, snapshot)) {
        fingerprint = await source.loadFingerprint('');
      }
    } catch (error) {
      const errorCode = allSyncErrorCode(error);
      logger.warn('Knowledge feed all-items fingerprint check failed', {
        errorCode,
        message: error && error.message
      });
      return { status: 'failed', changed: false, itemsChecked: false, errorCode };
    }

    const initialPlan = allSyncPlan(snapshot, fingerprint, startedAt, config, force);
    if (!initialPlan.needsItemsValidation) {
      return {
        status: fingerprint.notModified ? 'not-modified' : 'unchanged',
        changed: false,
        itemsChecked: false,
        fingerprintChanged: initialPlan.fingerprintChanged
      };
    }

    const leaseOwner = createGeneration();
    const lease = await syncStateRepository.acquireLease(
      leaseOwner,
      new Date(startedAt),
      new Date(startedAt + config.syncLeaseMs)
    );
    if (!lease.acquired) return { status: 'busy', changed: false, itemsChecked: false };
    let state = lease.document || {};
    const leaseForWrite = () => ({ owner: leaseOwner, now: new Date(now()) });
    try {
      const checkedAt = new Date(now());
      const plan = allSyncPlan(state, fingerprint, startedAt, config, force);
      const {
        observedFingerprint,
        fingerprintChanged,
        needsFullRefresh,
        needsItemsValidation
      } = plan;

      if (!needsItemsValidation) {
        return {
          status: fingerprint.notModified ? 'not-modified' : 'unchanged',
          changed: false,
          itemsChecked: false,
          fingerprintChanged
        };
      }

      const response = await source.loadAll(needsFullRefresh ? '' : (state.allItemsEtag || ''));
      const itemsCheckedAt = new Date(now());
      if (response.notModified) {
        await syncStateRepository.patch({
          allFingerprintEtag: fingerprint.etag || state.allFingerprintEtag || '',
          allObservedFingerprint: observedFingerprint || '',
          allFingerprintCheckedAt: checkedAt,
          allItemsCheckedAt: itemsCheckedAt,
          allAppliedFingerprint: observedFingerprint || state.allAppliedFingerprint || '',
          allLastErrorCode: ''
        }, leaseForWrite());
        return {
          status: 'validated',
          changed: false,
          itemsChecked: true,
          fingerprintChanged
        };
      }

      const generation = createGeneration();
      await syncStateRepository.patch({
        leaseUntil: new Date(now() + config.syncLeaseMs)
      }, leaseForWrite());
      const legacy = legacyCache || (cacheRepository
        ? await cacheRepository.get().catch(() => null)
        : null);
      const visuals = cachedVisuals(legacy);
      const documents = response.items.map((item) => toStoredFeedItem({
        ...item,
        ...(visuals.get(item.id) || {})
      }, {
        provider: config.provider,
        generation,
        observedAt: itemsCheckedAt,
        coverage: 'all',
        archiveSource: item.selected ? 'selected' : 'all'
      }));
      const upsert = await itemRepository.upsertMany(documents, { mergeVisuals: true });
      let analysisJobs = { requested: 0, inserted: 0, retained: 0 };
      if (analysisJobRepository && upsert.analysisCandidates && upsert.analysisCandidates.length) {
        analysisJobs = await analysisJobRepository.enqueueMany(
          upsert.analysisCandidates,
          itemsCheckedAt,
          { priority: 1000 }
        );
      }
      let visualJobs = { requested: 0, inserted: 0, reset: 0, retained: 0 };
      const visualCandidates = config.visualNewItemsOnly
        ? upsert.insertedVisualCandidates
        : upsert.visualCandidates;
      if (visualJobRepository && visualCandidates && visualCandidates.length) {
        visualJobs = await visualJobRepository.enqueueMany(visualCandidates, itemsCheckedAt, {
          priorityBoost: Math.max(0, Number(config.visualPriorityBoost) || 1000)
        });
        if (typeof itemRepository.markVisualQueued === 'function') {
          await itemRepository.markVisualQueued(visualJobs.queuedItems, itemsCheckedAt);
        }
      }
      const cutoffDate = publishedDay(startedAt - (config.freeWindowDays * DAY_MS));
      const dayIndex = await dayIndexRepository.replaceCurrentWindow(
        documents,
        generation,
        itemsCheckedAt,
        cutoffDate
      );
      const withdrawnCount = await itemRepository.markWithdrawn(
        dayIndex.removedItemIds,
        generation,
        itemsCheckedAt
      );
      const nextState = {
        allFingerprintEtag: fingerprint.etag || state.allFingerprintEtag || '',
        allObservedFingerprint: observedFingerprint || '',
        allFingerprintCheckedAt: checkedAt,
        allItemsEtag: response.etag || '',
        allAppliedFingerprint: observedFingerprint || '',
        allItemsCheckedAt: itemsCheckedAt,
        allItemsSyncedAt: itemsCheckedAt,
        allGeneration: generation,
        allItemCount: documents.length,
        allLastErrorCode: ''
      };
      if (needsFullRefresh) nextState.allFullSyncedAt = itemsCheckedAt;
      await syncStateRepository.patch(nextState, leaseForWrite());
      return {
        status: 'updated',
        changed: true,
        itemsChecked: true,
        fingerprintChanged,
        generation,
        itemCount: documents.length,
        inserted: upsert.inserted,
        updated: upsert.updated,
        visualJobs: {
          requested: visualJobs.requested,
          inserted: visualJobs.inserted,
          reset: visualJobs.reset,
          retained: visualJobs.retained
        },
        analysisJobs,
        withdrawn: withdrawnCount,
        dayCount: dayIndex.dayCount
      };
    } catch (error) {
      const errorCode = allSyncErrorCode(error);
      if (errorCode !== 'ALL_SYNC_LEASE_LOST') {
        await syncStateRepository.patch({
          allLastErrorCode: errorCode,
          allLastErrorAt: new Date(now())
        }, leaseForWrite()).catch(() => {});
      }
      logger.warn('Knowledge feed all-items sync failed', {
        errorCode,
        message: error && error.message
      });
      if (errorCode === 'ALL_SYNC_LEASE_LOST') {
        return { status: 'superseded', changed: false, itemsChecked: false };
      }
      return { status: 'failed', changed: false, itemsChecked: false, errorCode };
    } finally {
      await syncStateRepository.releaseLease(leaseOwner).catch(() => {});
    }
  }

  function run(options) {
    if (!active) active = syncOnce(options).finally(() => { active = null; });
    return active;
  }

  return { run };
}

module.exports = {
  ageOf,
  allSyncErrorCode,
  cachedVisuals,
  observedAllFingerprint,
  allSyncPlan,
  createAllFeedSyncService
};
