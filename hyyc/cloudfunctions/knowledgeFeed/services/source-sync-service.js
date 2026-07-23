const { randomUUID } = require('node:crypto');
const { toDate } = require('../lib/dates');
const { isScheduledTrigger } = require('../policies/timer-trigger');
const { visualFileIds: cachedVisualFileIds } = require('../repositories/feed-cache');
const { isNewVisualItem } = require('../policies/new-visuals');
const { sourceMetadataFields } = require('../lib/source-metadata');

function mergeCachedVisuals(items, previous, observedAt = new Date()) {
  const previousById = new Map(((previous && previous.items) || []).map((item) => [item.id, item]));
  return items.map((item) => {
    const cached = previousById.get(item.id);
    const reusable = cached && cached.url === item.url ? cached : null;
    return {
      ...item,
      firstObservedAt: (cached && cached.firstObservedAt)
        || (cached && previous && previous.fetchedAt)
        || observedAt,
      coverFileId: (reusable && reusable.coverFileId) || '',
      coverCheckedAt: (reusable && reusable.coverCheckedAt) || null,
      coverStatus: (reusable && reusable.coverStatus) || '',
      previewFileIds: (reusable && Array.isArray(reusable.previewFileIds) && reusable.previewFileIds) || [],
      previewCheckedAt: (reusable && reusable.previewCheckedAt) || null,
      previewStatus: (reusable && reusable.previewStatus) || '',
      previewCaptureVersion: (reusable && reusable.previewCaptureVersion) || null,
      ...((reusable && reusable.previewQualityAudit)
        ? { previewQualityAudit: reusable.previewQualityAudit }
        : {}),
      ...sourceMetadataFields(reusable || {})
    };
  });
}

function ownedVisualFileIds(document, ownedPrefixes) {
  const owned = (Array.isArray(ownedPrefixes) ? ownedPrefixes : [])
    .filter((prefix) => typeof prefix === 'string' && prefix.startsWith('cloud://'));
  return new Set([...cachedVisualFileIds((document && document.items) || [])]
    .filter((fileId) => owned.some((prefix) => fileId.startsWith(prefix))));
}

function orphanedVisualFileIds(previous, current, ownedPrefixes) {
  const active = ownedVisualFileIds(current, ownedPrefixes);
  return [...ownedVisualFileIds(previous, ownedPrefixes)].filter((fileId) => !active.has(fileId));
}

function itemHasVisual(item) {
  return Boolean(item && (
    (typeof item.coverFileId === 'string' && item.coverFileId)
    || (Array.isArray(item.previewFileIds) && item.previewFileIds.length)
  ));
}

function prepareRefreshedDocument(next, previous, ownedPrefixes) {
  const current = {
    ...(previous || {}),
    ...next,
    items: mergeCachedVisuals(next.items || [], previous, next.fetchedAt || next.updatedAt || new Date())
  };
  const active = ownedVisualFileIds(current, ownedPrefixes);
  const owned = (Array.isArray(ownedPrefixes) ? ownedPrefixes : [])
    .filter((prefix) => typeof prefix === 'string' && prefix.startsWith('cloud://'));
  const pending = new Set(
    ((previous && previous.pendingVisualDeletes) || [])
      .filter((fileId) => typeof fileId === 'string' && owned.some((prefix) => fileId.startsWith(prefix)))
  );
  const claims = new Set(
    ((previous && previous.visualDeleteClaims) || [])
      .filter((fileId) => typeof fileId === 'string' && owned.some((prefix) => fileId.startsWith(prefix)))
  );
  for (const fileId of orphanedVisualFileIds(previous, current, ownedPrefixes)) pending.add(fileId);
  for (const fileId of active) pending.delete(fileId);
  for (const fileId of claims) pending.delete(fileId);
  return { ...current, pendingVisualDeletes: [...pending], visualDeleteClaims: [...claims] };
}

function sourceErrorCode(error) {
  if (Number.isInteger(error && error.status)) return `FEED_SOURCE_${error.status}`;
  if (error && error.name === 'AbortError') return 'FEED_SOURCE_TIMEOUT';
  if (error && /^FEED_[A-Z0-9_]+$/.test(error.message || '')) return error.message;
  return 'FEED_SOURCE_FAILURE';
}

function retryDelay(error, failures, config, random = Math.random) {
  if (Number.isFinite(error && error.retryAfterMs)) {
    return Math.min(config.maxBackoffMs, Math.max(0, error.retryAfterMs));
  }
  if (error && error.status === 429) return config.rateLimitBackoffMs;
  if (error && error.status >= 500) {
    const exponential = Math.min(
      config.maxBackoffMs,
      config.serverErrorBaseBackoffMs * (2 ** Math.max(0, failures - 1))
    );
    return Math.round(exponential * (0.8 + (random() * 0.4)));
  }
  return config.defaultBackoffMs;
}

function isSourceSyncEvent(event, triggerName, triggerSource = process.env.TRIGGER_SRC) {
  return isScheduledTrigger(event, triggerName, triggerSource);
}

function isLeaseLost(error) {
  return Boolean(error && (error.code === 'SOURCE_SYNC_LEASE_LOST'
    || error.message === 'SOURCE_SYNC_LEASE_LOST'));
}

function createSourceSyncService({
  repository,
  source,
  config,
  ownedVisualPrefixes = [],
  now = () => Date.now(),
  random = Math.random,
  createLeaseOwner = randomUUID,
  triggerSource = process.env.TRIGGER_SRC,
  logger = console
}) {
  let pollPromise = null;

  function ageOf(value, currentTime) {
    const date = toDate(value);
    return date ? currentTime - date.getTime() : Number.POSITIVE_INFINITY;
  }

  async function loadAndPersistItems(previous, sourceState, etag, leaseForWrite) {
    const response = await source.loadSelected(etag);
    const checkedAt = new Date(now());
    if (response.notModified && previous) {
      const fields = {
        ...sourceState,
        fetchedAt: checkedAt,
        sourcePollFailures: 0,
        sourceNextPollAt: null,
        sourceLastErrorCode: ''
      };
      const patched = await repository.patchSourceState(fields, leaseForWrite());
      return {
        document: patched,
        notModified: true,
        pendingVisualItemIds: []
      };
    }
    const document = {
      provider: source.provider,
      etag: response.etag,
      fetchedAt: checkedAt,
      items: response.items,
      updatedAt: checkedAt,
      sourceFullSyncedAt: checkedAt,
      sourcePollFailures: 0,
      sourceNextPollAt: null,
      sourceLastErrorCode: '',
      ...sourceState
    };
    const persisted = await repository.replace(
      document,
      (next, latest) => prepareRefreshedDocument(next, latest, ownedVisualPrefixes),
      leaseForWrite()
    );
    const persistedDocument = persisted.document || persisted;
    const incomingIds = new Set(response.items.map((item) => item.id));
    return {
      document: persistedDocument,
      notModified: false,
      pendingVisualItemIds: (persistedDocument.items || [])
        .filter((item) => incomingIds.has(item.id)
          && !itemHasVisual(item)
          && isNewVisualItem(item, config.visualNewItemsAfter))
        .map((item) => item.id)
    };
  }

  async function recordFailure(current, error, lease) {
    const failures = Math.max(0, Number(current && current.sourcePollFailures) || 0) + 1;
    const delay = retryDelay(error, failures, config, random);
    const fields = {
      sourcePollFailures: failures,
      sourceNextPollAt: new Date(now() + delay),
      sourceLastErrorCode: sourceErrorCode(error)
    };
    await repository.patchSourceState(fields, lease);
    logger.warn('Knowledge feed source sync failed', {
      code: fields.sourceLastErrorCode,
      retryInMs: delay
    });
    return {
      status: 'failed',
      changed: false,
      itemsChecked: false,
      errorCode: fields.sourceLastErrorCode,
      nextPollAt: fields.sourceNextPollAt
    };
  }

  async function pollOnce() {
    const currentTime = now();
    const leaseOwner = createLeaseOwner();
    const leaseResult = await repository.acquireSourceSyncLease(
      leaseOwner,
      new Date(currentTime),
      new Date(currentTime + config.leaseMs)
    );
    if (!leaseResult.acquired) {
      const cached = leaseResult.document || null;
      return {
        status: 'busy',
        changed: false,
        itemsChecked: false,
        cacheDocument: cached,
        ...(cached && cached.sourceObservedAllFingerprint ? {
          fingerprintObservation: {
            notModified: true,
            etag: cached.fingerprintEtag || '',
            selected: cached.sourceObservedFingerprint || '',
            all: cached.sourceObservedAllFingerprint
          }
        } : {})
      };
    }
    let current = leaseResult.document;
    let fingerprintObservation = null;
    const lease = () => ({ owner: leaseOwner, now: new Date(now()) });

    try {
      const nextPollAt = current && toDate(current.sourceNextPollAt);
      if (nextPollAt && nextPollAt.getTime() > currentTime) {
        return {
          status: 'backoff',
          changed: false,
          itemsChecked: false,
          nextPollAt
        };
      }

      let fingerprint = await source.loadFingerprint((current && current.fingerprintEtag) || '');
      if (fingerprint.notModified && !(current && current.sourceObservedFingerprint)) {
        fingerprint = await source.loadFingerprint('');
      }

      const checkedAt = new Date(now());
      const observedFingerprint = fingerprint.notModified
        ? current.sourceObservedFingerprint
        : fingerprint.selected;
      const observedAllFingerprint = fingerprint.notModified
        ? current.sourceObservedAllFingerprint
        : fingerprint.all;
      const fingerprintState = {
        fingerprintCheckedAt: checkedAt,
        fingerprintEtag: fingerprint.etag || (current && current.fingerprintEtag) || '',
        sourceObservedFingerprint: observedFingerprint,
        sourceObservedAllFingerprint: observedAllFingerprint
      };
      fingerprintObservation = {
        notModified: Boolean(fingerprint.notModified),
        etag: fingerprintState.fingerprintEtag,
        selected: observedFingerprint || '',
        all: observedAllFingerprint || ''
      };

      const appliedFingerprint = (current && current.sourceAppliedFingerprint) || '';
      const fingerprintChanged = Boolean(observedFingerprint && observedFingerprint !== appliedFingerprint);
      const needsFullRefresh = !current
        || fingerprintChanged
        || ageOf(current.sourceFullSyncedAt || current.fetchedAt, currentTime) >= config.fullRefreshMs;
      const needsItemsValidation = needsFullRefresh
        || ageOf(current && current.fetchedAt, currentTime) >= config.itemsRevalidateMs;

      if (!needsItemsValidation) {
        const successState = {
          sourcePollFailures: 0,
          sourceNextPollAt: null,
          sourceLastErrorCode: ''
        };
        const needsStatePatch = !fingerprint.notModified
          || Number(current && current.sourcePollFailures) > 0
          || Boolean(current && (current.sourceNextPollAt || current.sourceLastErrorCode));
        if (needsStatePatch) {
          current = await repository.patchSourceState({
            ...fingerprintState,
            ...successState
          }, lease());
        }
        return {
          status: fingerprint.notModified ? 'not-modified' : 'unchanged',
          changed: false,
          itemsChecked: false,
          fingerprintCheckedAt: checkedAt,
          fingerprintObservation,
          cacheDocument: current
        };
      }

      current = await repository.patchSourceState(fingerprintState, lease());
      const sourceState = {
        ...fingerprintState,
        sourceAppliedFingerprint: observedFingerprint || appliedFingerprint
      };
      const result = await loadAndPersistItems(
        current,
        sourceState,
        needsFullRefresh ? '' : ((current && current.etag) || ''),
        lease
      );
      return {
        status: result.notModified ? 'validated' : 'updated',
        changed: !result.notModified,
        fingerprintChanged,
        itemsChecked: true,
        updatedAt: result.document.fetchedAt,
        pendingVisualItemIds: result.pendingVisualItemIds,
        fingerprintObservation,
        cacheDocument: result.document
      };
    } catch (error) {
      if (isLeaseLost(error)) {
        return {
          status: 'superseded',
          changed: false,
          itemsChecked: false,
          cacheDocument: current || null,
          ...(fingerprintObservation ? { fingerprintObservation } : {})
        };
      }
      try {
        return {
          ...(await recordFailure(current, error, lease())),
          cacheDocument: current || null,
          ...(fingerprintObservation ? { fingerprintObservation } : {})
        };
      } catch (recordError) {
        if (isLeaseLost(recordError)) {
          return {
            status: 'superseded',
            changed: false,
            itemsChecked: false,
            cacheDocument: current || null,
            ...(fingerprintObservation ? { fingerprintObservation } : {})
          };
        }
        throw recordError;
      }
    } finally {
      try {
        await repository.releaseSourceSyncLease(leaseOwner);
      } catch (error) {
        logger.warn('Knowledge feed source lease could not be released', {
          message: error && error.message
        });
      }
    }
  }

  async function poll() {
    if (!pollPromise) pollPromise = pollOnce().finally(() => { pollPromise = null; });
    return pollPromise;
  }

  async function ensureCache() {
    let current = await repository.get();
    if (current && Array.isArray(current.items) && current.items.length) return current;
    await poll();
    current = await repository.get();
    if (current && Array.isArray(current.items) && current.items.length) return current;
    throw new Error('FEED_SOURCE_UNAVAILABLE');
  }

  async function run(event) {
    if (!isSourceSyncEvent(event, config.triggerName, triggerSource)) {
      throw new Error('SOURCE_SYNC_REQUIRES_TIMER');
    }
    const result = await poll();
    const logResult = { ...result };
    delete logResult.cacheDocument;
    delete logResult.fingerprintObservation;
    logger.info('Knowledge feed source sync completed', logResult);
    return { triggerName: config.triggerName, ...result };
  }

  return { poll, ensureCache, run };
}

module.exports = {
  createSourceSyncService,
  isSourceSyncEvent,
  mergeCachedVisuals,
  orphanedVisualFileIds,
  itemHasVisual,
  prepareRefreshedDocument,
  retryDelay
};
