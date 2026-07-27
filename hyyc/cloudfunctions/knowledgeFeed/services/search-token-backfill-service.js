const { AppError } = require('../lib/errors');
const { SEARCH_TOKEN_VERSION } = require('../lib/search-terms');
const { maintenanceAuthorized } = require('../policies/maintenance-auth');
const { mapWithConcurrency } = require('../repositories/collection-support');

const MAX_DOCUMENT_FAILURES = 5;
const MAX_FAILURE_RECORDS = 50;

function safeErrorCode(error) {
  return error && /^[A-Z0-9_]{3,80}$/.test(error.code || '')
    ? error.code
    : 'SEARCH_TOKEN_WRITE_FAILED';
}

function normalizedFailures(state = {}) {
  return (Array.isArray(state.searchTokenBackfillFailures)
    ? state.searchTokenBackfillFailures
    : [])
    .filter((entry) => entry && typeof entry.documentId === 'string' && entry.documentId)
    .slice(0, MAX_FAILURE_RECORDS)
    .map((entry) => ({
      documentId: entry.documentId,
      attempts: Math.max(1, Math.floor(Number(entry.attempts) || 1)),
      lastErrorCode: /^[A-Z0-9_]{3,80}$/.test(entry.lastErrorCode || '')
        ? entry.lastErrorCode
        : 'SEARCH_TOKEN_WRITE_FAILED',
      lastFailedAt: entry.lastFailedAt || null,
      blocked: entry.blocked === true
    }));
}

function publicState(state = {}) {
  const failures = normalizedFailures(state);
  return {
    version: Number(state.searchTokenBackfillVersion) || 0,
    targetVersion: Number(state.searchTokenBackfillTargetVersion) || SEARCH_TOKEN_VERSION,
    cursor: state.searchTokenBackfillCursor || '',
    scanned: Math.max(0, Number(state.searchTokenBackfillScanned) || 0),
    updated: Math.max(0, Number(state.searchTokenBackfillUpdated) || 0),
    skipped: Math.max(0, Number(state.searchTokenBackfillSkipped) || 0),
    failureCount: Math.max(0, Number(state.searchTokenBackfillFailureCount) || 0),
    pendingFailureCount: failures.filter((entry) => !entry.blocked).length,
    blockedCount: failures.filter((entry) => entry.blocked).length,
    blockedDocumentIds: failures
      .filter((entry) => entry.blocked)
      .map((entry) => entry.documentId),
    lastErrorCode: state.searchTokenBackfillLastErrorCode || '',
    lastFailedAt: state.searchTokenBackfillLastFailedAt || null,
    lastBatchDurationMs:
      Math.max(0, Number(state.searchTokenBackfillLastBatchDurationMs) || 0),
    startedAt: state.searchTokenBackfillStartedAt || null,
    scanCompletedAt: state.searchTokenBackfillScanCompletedAt || null,
    completedAt: state.searchTokenBackfillCompletedAt || null,
    ready: Number(state.searchTokenBackfillVersion) === SEARCH_TOKEN_VERSION
      && Boolean(state.searchTokenBackfillCompletedAt)
  };
}

function mergeFailures(current, outcomes, failedAt) {
  const byId = new Map(current.map((entry) => [entry.documentId, entry]));
  outcomes.forEach((outcome) => {
    if (!outcome || !outcome.documentId) return;
    if (outcome.state !== 'failed') {
      byId.delete(outcome.documentId);
      return;
    }
    const previous = byId.get(outcome.documentId);
    const attempts = Math.max(0, Number(previous && previous.attempts) || 0) + 1;
    byId.set(outcome.documentId, {
      documentId: outcome.documentId,
      attempts,
      lastErrorCode: outcome.errorCode,
      lastFailedAt: failedAt,
      blocked: attempts >= MAX_DOCUMENT_FAILURES
    });
  });
  const values = [...byId.values()];
  if (values.length > MAX_FAILURE_RECORDS) {
    const error = new AppError(
      'SEARCH_BACKFILL_FAILURE_LIMIT',
      '搜索索引异常条目过多，需要人工检查'
    );
    error.failureCount = values.length;
    throw error;
  }
  return values;
}

function createSearchTokenBackfillService({
  itemRepository,
  syncStateRepository,
  maintenanceToken,
  now = () => Date.now(),
  concurrency = 8,
  logger = { warn() {} }
}) {
  function authorize(token) {
    if (!maintenanceAuthorized(token, maintenanceToken)) {
      throw new AppError('AUTH_REQUIRED', '该操作仅供云端维护');
    }
  }

  function batchLimit(value) {
    return Math.max(1, Math.min(200, Number(value) || 100));
  }

  async function attemptDocuments(documentIds) {
    return mapWithConcurrency(
      documentIds,
      Math.max(1, Math.min(12, Number(concurrency) || 8)),
      async (documentId) => {
        try {
          return {
            documentId,
            ...(await itemRepository.backfillSearchTokens(documentId, new Date(now())))
          };
        } catch (error) {
          return {
            documentId,
            state: 'failed',
            errorCode: safeErrorCode(error)
          };
        }
      }
    );
  }

  function batchStats(outcomes) {
    return outcomes.reduce((stats, outcome) => {
      if (outcome && outcome.state === 'updated') stats.updated += 1;
      else if (outcome && outcome.state === 'failed') stats.failed += 1;
      else stats.skipped += 1;
      return stats;
    }, { scanned: outcomes.length, updated: 0, skipped: 0, failed: 0 });
  }

  async function retryBlocked(started, limit, batchStartedAt) {
    const currentFailures = normalizedFailures(started.state);
    const attempted = currentFailures.slice(0, limit);
    if (!attempted.length) {
      const completedAt = new Date(now());
      const completed = await syncStateRepository.completeSearchTokenBackfill(
        SEARCH_TOKEN_VERSION,
        completedAt,
        Math.max(0, now() - batchStartedAt)
      );
      return {
        done: completed.completed,
        advanced: false,
        batch: { scanned: 0, updated: 0, skipped: 0, failed: 0 },
        ...publicState(completed.state)
      };
    }
    const outcomes = await attemptDocuments(attempted.map((entry) => entry.documentId));
    const batch = batchStats(outcomes);
    const failedAt = new Date(now());
    const failures = mergeFailures(currentFailures, outcomes, failedAt);
    const lastFailure = outcomes.find((outcome) => outcome.state === 'failed');
    const recorded = await syncStateRepository.recordSearchTokenBackfillAttempt({
      targetVersion: SEARCH_TOKEN_VERSION,
      expectedCursor: '',
      failures,
      failureCount: batch.failed,
      lastErrorCode: lastFailure ? lastFailure.errorCode : '',
      lastFailedAt: lastFailure ? failedAt : null,
      batchDurationMs: Math.max(0, now() - batchStartedAt),
      attemptedAt: failedAt
    });
    if (failures.length || !recorded.recorded) {
      return {
        done: false,
        advanced: false,
        batch,
        ...publicState(recorded.state)
      };
    }
    const completedAt = new Date(now());
    const completed = await syncStateRepository.completeSearchTokenBackfill(
      SEARCH_TOKEN_VERSION,
      completedAt,
      Math.max(0, now() - batchStartedAt)
    );
    return {
      done: completed.completed,
      advanced: false,
      batch,
      ...publicState(completed.state)
    };
  }

  async function runBatch(limit) {
    const batchStartedAt = now();
    const startedAt = new Date(now());
    const started = await syncStateRepository.beginSearchTokenBackfill(
      SEARCH_TOKEN_VERSION,
      startedAt
    );
    if (started.done) {
      return {
        done: true,
        advanced: false,
        batch: { scanned: 0, updated: 0, skipped: 0, failed: 0 },
        ...publicState(started.state)
      };
    }
    if (started.state.searchTokenBackfillScanCompletedAt) {
      return retryBlocked(started, limit, batchStartedAt);
    }

    const cursor = started.state.searchTokenBackfillCursor || '';
    const documents = await itemRepository.listByIdCursor(cursor, limit);
    const outcomes = await attemptDocuments(documents.map((document) => document._id));
    const batch = batchStats(outcomes);
    const failedAt = new Date(now());
    const lastFailure = outcomes.find((outcome) => outcome.state === 'failed');
    const currentFailures = normalizedFailures(started.state);

    if (batch.failed > Math.max(3, Math.floor(documents.length * 0.2))) {
      await syncStateRepository.recordSearchTokenBackfillAttempt({
        targetVersion: SEARCH_TOKEN_VERSION,
        expectedCursor: cursor,
        failures: currentFailures,
        failureCount: batch.failed,
        lastErrorCode: lastFailure ? lastFailure.errorCode : 'SEARCH_BACKFILL_BATCH_FAILED',
        lastFailedAt: failedAt,
        batchDurationMs: Math.max(0, now() - batchStartedAt),
        attemptedAt: failedAt
      });
      throw new AppError('SEARCH_BACKFILL_BATCH_FAILED', '搜索索引批次暂时失败');
    }

    const failures = mergeFailures(currentFailures, outcomes, failedAt);
    const previousBlocked = new Set(
      currentFailures.filter((entry) => entry.blocked).map((entry) => entry.documentId)
    );
    const newlyBlocked = failures.filter(
      (entry) => entry.blocked && !previousBlocked.has(entry.documentId)
    );
    if (newlyBlocked.length) {
      logger.warn('Search token backfill quarantined persistent document failures', {
        newlyBlockedCount: newlyBlocked.length,
        blockedCount: failures.filter((entry) => entry.blocked).length,
        errorCode: newlyBlocked[0].lastErrorCode
      });
    }
    const unresolvedOnPage = outcomes
      .filter((outcome) => outcome.state === 'failed')
      .some((outcome) => {
        const failure = failures.find((entry) => entry.documentId === outcome.documentId);
        return failure && !failure.blocked;
      });
    if (unresolvedOnPage) {
      const recorded = await syncStateRepository.recordSearchTokenBackfillAttempt({
        targetVersion: SEARCH_TOKEN_VERSION,
        expectedCursor: cursor,
        failures,
        failureCount: batch.failed,
        lastErrorCode: lastFailure ? lastFailure.errorCode : '',
        lastFailedAt: lastFailure ? failedAt : null,
        batchDurationMs: Math.max(0, now() - batchStartedAt),
        attemptedAt: failedAt
      });
      return {
        done: false,
        advanced: false,
        batch,
        ...publicState(recorded.state)
      };
    }

    const scanDone = documents.length < limit;
    const done = scanDone && failures.length === 0;
    const nextCursor = documents.length ? documents[documents.length - 1]._id : cursor;
    const advanced = await syncStateRepository.advanceSearchTokenBackfill({
      targetVersion: SEARCH_TOKEN_VERSION,
      expectedCursor: cursor,
      nextCursor,
      ...batch,
      failureCount: batch.failed,
      failures,
      lastErrorCode: lastFailure ? lastFailure.errorCode : '',
      lastFailedAt: lastFailure ? failedAt : null,
      batchDurationMs: Math.max(0, now() - batchStartedAt),
      scanDone,
      done,
      advancedAt: new Date(now())
    });
    return {
      done: advanced.done,
      advanced: advanced.advanced,
      batch,
      ...publicState(advanced.state)
    };
  }

  async function run(event = {}) {
    authorize(event.token);
    return runBatch(batchLimit(event.limit));
  }

  async function runScheduled(options = {}) {
    return runBatch(batchLimit(options.limit));
  }

  return { run, runScheduled };
}

module.exports = {
  MAX_DOCUMENT_FAILURES,
  safeErrorCode,
  normalizedFailures,
  mergeFailures,
  publicState,
  createSearchTokenBackfillService
};
