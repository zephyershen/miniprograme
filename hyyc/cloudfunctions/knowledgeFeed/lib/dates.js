function toDate(value) {
  if (!value) return null;
  const date = new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

module.exports = { toDate, toIso };
