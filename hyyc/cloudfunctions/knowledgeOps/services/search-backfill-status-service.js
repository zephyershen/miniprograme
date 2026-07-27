const SEARCH_TOKEN_VERSION = 1;
const MAX_FAILURE_RECORDS = 50;

function safeFailures(state = {}) {
  return (Array.isArray(state.searchTokenBackfillFailures)
    ? state.searchTokenBackfillFailures
    : [])
    .filter((entry) => entry && typeof entry.documentId === 'string' && entry.documentId)
    .slice(0, MAX_FAILURE_RECORDS)
    .map((entry) => ({
      documentId: entry.documentId,
      attempts: Math.max(1, Math.floor(Number(entry.attempts) || 1)),
      errorCode: /^[A-Z0-9_]{3,80}$/.test(entry.lastErrorCode || '')
        ? entry.lastErrorCode
        : 'SEARCH_TOKEN_WRITE_FAILED',
      failedAt: entry.lastFailedAt || null,
      blocked: entry.blocked === true
    }));
}

function projectSearchBackfillState(state = {}) {
  const failures = safeFailures(state);
  const targetVersion = Number(state.searchTokenBackfillTargetVersion)
    || SEARCH_TOKEN_VERSION;
  const version = Number(state.searchTokenBackfillVersion) || 0;
  const ready = version === targetVersion
    && Boolean(state.searchTokenBackfillCompletedAt);
  const scanComplete = Boolean(state.searchTokenBackfillScanCompletedAt);
  let phase = 'not_started';
  if (failures.some((entry) => entry.blocked)) phase = 'blocked';
  else if (ready) phase = 'ready';
  else if (scanComplete) phase = 'retrying';
  else if (state.searchTokenBackfillStartedAt) phase = 'scanning';

  return {
    phase,
    ready,
    version,
    targetVersion,
    cursor: state.searchTokenBackfillCursor || '',
    scanned: Math.max(0, Number(state.searchTokenBackfillScanned) || 0),
    updated: Math.max(0, Number(state.searchTokenBackfillUpdated) || 0),
    skipped: Math.max(0, Number(state.searchTokenBackfillSkipped) || 0),
    failureCount: Math.max(0, Number(state.searchTokenBackfillFailureCount) || 0),
    pendingFailureCount: failures.filter((entry) => !entry.blocked).length,
    blockedCount: failures.filter((entry) => entry.blocked).length,
    failures,
    lastErrorCode: /^[A-Z0-9_]{3,80}$/.test(state.searchTokenBackfillLastErrorCode || '')
      ? state.searchTokenBackfillLastErrorCode
      : '',
    lastFailedAt: state.searchTokenBackfillLastFailedAt || null,
    lastBatchDurationMs:
      Math.max(0, Math.floor(Number(state.searchTokenBackfillLastBatchDurationMs) || 0)),
    startedAt: state.searchTokenBackfillStartedAt || null,
    updatedAt: state.searchTokenBackfillUpdatedAt || null,
    scanCompletedAt: state.searchTokenBackfillScanCompletedAt || null,
    completedAt: state.searchTokenBackfillCompletedAt || null
  };
}

function isNotFound(error) {
  const code = String(error && (error.code || error.errCode) || '');
  const message = String(error && (error.message || error.errMsg) || '');
  return code.includes('DOCUMENT_NOT_EXIST')
    || code === '-1'
    || /not\s*exist|not\s*found/i.test(message);
}

function createSearchBackfillStatusService({
  db,
  collectionName,
  documentId
}) {
  async function get() {
    try {
      const result = await db.collection(collectionName).doc(documentId).get();
      return projectSearchBackfillState(result && result.data || {});
    } catch (error) {
      if (isNotFound(error)) return projectSearchBackfillState();
      throw error;
    }
  }

  return { get };
}

module.exports = {
  projectSearchBackfillState,
  createSearchBackfillStatusService
};
