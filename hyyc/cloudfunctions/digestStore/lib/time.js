function timeZoneParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function monthKey(date = new Date()) {
  const parts = timeZoneParts(date);
  return `${parts.year}-${parts.month}`;
}

function dateKey(date = new Date()) {
  const parts = timeZoneParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = {
  monthKey,
  dateKey,
  toIso
};
