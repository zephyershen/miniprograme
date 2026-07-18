function timestamp(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime();
}

function isAtOrAfter(value, cutoff) {
  if (!cutoff) return true;
  const valueTime = timestamp(value);
  const cutoffTime = timestamp(cutoff);
  return Number.isFinite(valueTime) && Number.isFinite(cutoffTime) && valueTime >= cutoffTime;
}

function isNewVisualItem(item, cutoff) {
  return isAtOrAfter(item && (item.firstObservedAt || item.firstStoredAt), cutoff);
}

function isNewVisualJob(job, cutoff) {
  return isAtOrAfter(job && job.eligibleAt, cutoff);
}

module.exports = { timestamp, isAtOrAfter, isNewVisualItem, isNewVisualJob };
