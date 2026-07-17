const DAY_MS = 24 * 60 * 60 * 1000;
const FREE_WINDOW_DAYS = 7;

function withinDays(item, days, now = Date.now()) {
  const publishedAt = new Date(item && item.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return false;
  return publishedAt >= now - (Math.max(1, Number(days) || 1) * DAY_MS);
}

function freeItemVisible(item, now = Date.now()) {
  return withinDays(item, FREE_WINDOW_DAYS, now);
}

module.exports = { DAY_MS, FREE_WINDOW_DAYS, withinDays, freeItemVisible };
