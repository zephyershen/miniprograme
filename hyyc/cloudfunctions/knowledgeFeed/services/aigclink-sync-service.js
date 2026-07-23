const { randomUUID } = require('node:crypto');
const { toStoredFeedItem, publishedDay } = require('../lib/stored-feed-item');

const DEFAULT_WRITE_BATCH_SIZE = 100;

function storedTime(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function createAigclinkSyncService({
  source,
  itemRepository,
  dayIndexRepository,
  syncStateRepository,
  visualJobRepository,
  config,
  now = () => Date.now(),
  logger = console
}) {
  let active = null;

  function currentSyncVersion(snapshot) {
    return Math.max(0, Number(snapshot && snapshot.aigclinkSyncVersion) || 0);
  }

  function configuredSyncVersion() {
    return Math.max(1, Number(config.syncVersion) || 1);
  }

  function isPollFresh(snapshot, at) {
    return currentSyncVersion(snapshot) === configuredSyncVersion()
      && at - storedTime(snapshot && snapshot.aigclinkPolledAt) < config.pollMs;
  }

  function fullRefreshDue(snapshot, at) {
    return currentSyncVersion(snapshot) !== configuredSyncVersion()
      || !Number.isFinite(storedTime(snapshot && snapshot.aigclinkSyncedAt))
      || at - storedTime(snapshot && snapshot.aigclinkSyncedAt) >= config.fullRefreshMs;
  }

  function leaseLostError() {
    const error = new Error('AIGCLINK_SYNC_LEASE_LOST');
    error.code = 'AIGCLINK_SYNC_LEASE_LOST';
    return error;
  }

  function isLeaseLost(error) {
    const code = error && (error.code || error.message);
    return code === 'AIGCLINK_SYNC_LEASE_LOST' || code === 'ALL_SYNC_LEASE_LOST';
  }

  function inventoryTruncatedError() {
    const error = new Error('AIGCLINK_INVENTORY_TRUNCATED');
    error.code = 'AIGCLINK_INVENTORY_TRUNCATED';
    return error;
  }

  function batches(values, size = DEFAULT_WRITE_BATCH_SIZE) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  }

  async function syncOnce({ force = false } = {}) {
    const startedAt = now();
    const snapshot = await syncStateRepository.get() || {};
    if (!force && isPollFresh(snapshot, startedAt)) {
      return { status: 'unchanged', changed: false };
    }

    const owner = `aigclink:${randomUUID()}`;
    const lease = await syncStateRepository.acquireLease(
      owner,
      new Date(startedAt),
      new Date(startedAt + config.leaseMs)
    );
    if (!lease.acquired) return { status: 'busy', changed: false };

    const guardedPatch = (fields) => syncStateRepository.patch(fields, {
      owner,
      now: new Date(now())
    });
    const renewLease = async () => {
      const renewedAt = new Date(now());
      const result = await syncStateRepository.renewLease(
        owner,
        renewedAt,
        new Date(renewedAt.getTime() + config.leaseMs)
      );
      if (!result || result.renewed !== true) throw leaseLostError();
      return result.document || {};
    };

    try {
      const current = lease.document || {};
      if (!force && isPollFresh(current, startedAt)) {
        return { status: 'unchanged', changed: false };
      }
      const head = typeof source.observeHead === 'function'
        ? await source.observeHead()
        : null;
      await renewLease();
      const needsFullRefresh = force || fullRefreshDue(current, startedAt);
      if (!needsFullRefresh && head
        && head.fingerprint === current.aigclinkHeadFingerprint) {
        const polledAt = new Date(now());
        await guardedPatch({
          aigclinkPolledAt: polledAt,
          aigclinkLatestPublishedAt: head.latestPublishedAt || '',
          aigclinkLastErrorCode: ''
        });
        return { status: 'unchanged', changed: false, polledAt };
      }
      const response = await source.loadItems();
      await renewLease();
      const observedAt = new Date(now());
      const generation = `aigclink_${observedAt.getTime().toString(36)}`;
      const documents = response.items.map((item) => toStoredFeedItem(item, {
        provider: config.provider,
        generation,
        observedAt,
        coverage: 'library',
        archiveSource: 'aigclink'
      }));
      const upstreamIds = new Set(documents.map((document) => document.id));
      let existingActiveIds = [];
      if (typeof itemRepository.listFacets === 'function'
        && typeof itemRepository.markWithdrawn === 'function') {
        const inventoryOptions = {
          sourceChannel: 'openSource',
          topicKeys: [],
          sourceTags: [],
          includeWithdrawn: false
        };
        let inventoryCount = null;
        if (typeof itemRepository.count === 'function') {
          await renewLease();
          inventoryCount = await itemRepository.count(inventoryOptions);
        }
        await renewLease();
        const inventoryLimit = Number.isFinite(inventoryCount)
          ? inventoryCount + 1
          : Math.max(documents.length + 1001, (Number(config.maxItems) || 5000) + 1);
        const existing = await itemRepository.listFacets(inventoryOptions, inventoryLimit);
        if (existing.truncated === true
          || (Number.isFinite(inventoryCount)
            && (existing.items || []).length !== inventoryCount)) {
          throw inventoryTruncatedError();
        }
        existingActiveIds = (existing.items || []).map((item) => item.id).filter(Boolean);
      }
      const upsert = {
        inserted: 0,
        updated: 0,
        insertedVisualCandidates: []
      };
      for (const batch of batches(documents, Math.max(
        1,
        Number(config.writeBatchSize) || DEFAULT_WRITE_BATCH_SIZE
      ))) {
        await renewLease();
        const batchResult = await itemRepository.upsertMany(batch, {
          mergeVisuals: true,
          holdNewItems: false
        });
        upsert.inserted += Number(batchResult.inserted) || 0;
        upsert.updated += Number(batchResult.updated) || 0;
        upsert.insertedVisualCandidates.push(...(
          Array.isArray(batchResult.insertedVisualCandidates)
            ? batchResult.insertedVisualCandidates
            : []
        ));
      }
      let withdrawn = 0;
      if (typeof itemRepository.markWithdrawn === 'function') {
        const missingIds = existingActiveIds.filter((id) => !upstreamIds.has(id));
        for (const batch of batches(missingIds, Math.max(
          1,
          Number(config.writeBatchSize) || DEFAULT_WRITE_BATCH_SIZE
        ))) {
          await renewLease();
          withdrawn += Number(await itemRepository.markWithdrawn(
            batch,
            generation,
            observedAt
          )) || 0;
        }
      }
      let visualJobs = { requested: 0, inserted: 0, reset: 0, retained: 0 };
      const visualCutoff = observedAt.getTime() - Math.max(0, Number(config.visualRecentWindowMs) || 0);
      const recentVisualCandidates = (upsert.insertedVisualCandidates || []).filter((document) => (
        new Date(document.publishedAt).getTime() >= visualCutoff
      ));
      if (visualJobRepository && recentVisualCandidates.length) {
        await renewLease();
        visualJobs = await visualJobRepository.enqueueMany(recentVisualCandidates, observedAt, {
          priorityBoost: config.visualPriorityBoost
        });
        if (typeof itemRepository.markVisualQueued === 'function') {
          await renewLease();
          await itemRepository.markVisualQueued(visualJobs.queuedItems, observedAt);
        }
      }
      const byDay = documents.reduce((groups, document) => {
        const day = publishedDay(document.publishedAt);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(document);
        return groups;
      }, new Map());
      if (config.writeDayIndex !== false) {
        for (const [day, items] of byDay) {
          await renewLease();
          await dayIndexRepository.mergeHistoricalDay(day, items, observedAt, 'source-library');
        }
      }
      await guardedPatch({
        aigclinkSyncedAt: observedAt,
        aigclinkPolledAt: observedAt,
        aigclinkItemCount: documents.length,
        aigclinkHeadFingerprint: head && head.fingerprint || current.aigclinkHeadFingerprint || '',
        aigclinkLatestPublishedAt: head && head.latestPublishedAt
          || (documents[0] && documents[0].publishedAt) || '',
        aigclinkSyncVersion: configuredSyncVersion(),
        aigclinkLastErrorCode: ''
      });
      return {
        status: 'updated',
        changed: upsert.inserted > 0 || upsert.updated > 0,
        itemCount: documents.length,
        inserted: upsert.inserted,
        updated: upsert.updated,
        withdrawn,
        dayCount: config.writeDayIndex === false ? 0 : byDay.size,
        visualJobs: {
          requested: visualJobs.requested,
          inserted: visualJobs.inserted,
          reset: visualJobs.reset,
          retained: visualJobs.retained
        }
      };
    } catch (error) {
      const leaseLost = isLeaseLost(error);
      const errorCode = leaseLost
        ? 'AIGCLINK_SYNC_LEASE_LOST'
        : error && (error.code || error.message) || 'AIGCLINK_SYNC_FAILED';
      if (!leaseLost) {
        await guardedPatch({
          aigclinkLastErrorCode: errorCode,
          aigclinkLastErrorAt: new Date(now())
        }).catch(() => {});
      }
      logger.warn('AIGCLINK source sync failed', { errorCode });
      return {
        status: leaseLost ? 'busy' : 'failed',
        changed: false,
        errorCode
      };
    } finally {
      await syncStateRepository.releaseLease(owner).catch(() => {});
    }
  }

  function run(options) {
    if (!active) active = syncOnce(options).finally(() => { active = null; });
    return active;
  }

  return { run };
}

module.exports = {
  DEFAULT_WRITE_BATCH_SIZE,
  storedTime,
  createAigclinkSyncService
};
