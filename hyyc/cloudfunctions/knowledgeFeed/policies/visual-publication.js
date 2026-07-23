function hasReadyVisual(item) {
  if (!item || typeof item !== 'object') return false;
  if (typeof item.coverFileId === 'string' && item.coverFileId) return true;
  return Array.isArray(item.previewFileIds)
    && item.previewFileIds.some((fileId) => typeof fileId === 'string' && fileId);
}

const FAILED_VISUAL_STATES = Object.freeze(new Set(['retry', 'failed', 'blocked', 'stale']));

function toMillis(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function visualFailureRecorded(item) {
  return Boolean(item && (
    FAILED_VISUAL_STATES.has(String(item.visualState || '').toLowerCase())
    || FAILED_VISUAL_STATES.has(String(item.previewStatus || '').toLowerCase())
  ));
}

function visualPublicationVisible(item, currentTime, graceMs) {
  if (!item || typeof item !== 'object') return false;
  if (hasReadyVisual(item) || visualFailureRecorded(item)) return true;
  if (item.visualPublicationHeld === false) return true;

  // Item-store documents explicitly opt new rows into the short hold. Legacy
  // selected-cache rows use firstObservedAt because they predate that field.
  const explicitlyHeld = item.visualPublicationHeld === true;
  const legacyHeld = item.visualPublicationHeld === undefined
    && !item.firstStoredAt
    && Boolean(item.firstObservedAt);
  if (!explicitlyHeld && !legacyHeld) return true;

  const observedAt = toMillis(item.firstStoredAt || item.firstObservedAt);
  const now = toMillis(currentTime);
  const wait = Math.max(0, Number(graceMs) || 0);
  if (!Number.isFinite(observedAt) || !Number.isFinite(now) || wait === 0) return true;
  return now - observedAt >= wait;
}

module.exports = {
  FAILED_VISUAL_STATES,
  hasReadyVisual,
  toMillis,
  visualFailureRecorded,
  visualPublicationVisible
};
