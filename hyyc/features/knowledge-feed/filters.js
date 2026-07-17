const TIME_WINDOWS = Object.freeze({
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
});

function hasTopic(item, key) {
  return key === 'all' || (Array.isArray(item.topicKeys) && item.topicKeys.includes(key));
}

function filterFeedItems(items, filters, now = Date.now()) {
  const showAll = filters.time === 'all';
  const windowMs = TIME_WINDOWS[filters.time] || TIME_WINDOWS['7d'];
  const threshold = now - windowMs;
  return (items || []).filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();
    const withinTime = Number.isFinite(publishedAt) && (showAll || publishedAt >= threshold);
    return withinTime && hasTopic(item, filters.company) && hasTopic(item, filters.direction);
  });
}

function optionLabel(options, key, fallback) {
  const option = options.find((entry) => entry.key === key);
  return option ? option.label : fallback;
}

function filterSummary(filters, options) {
  const parts = [optionLabel(options.time, filters.time, '近 7 天')];
  if (filters.company !== 'all') parts.push(optionLabel(options.company, filters.company, '全部公司'));
  if (filters.direction !== 'all') parts.push(optionLabel(options.direction, filters.direction, '全部方向'));
  if (parts.length === 1) parts.push('全部主题');
  return parts.join(' · ');
}

function filterOptionsWithCounts(options, items, filters, now = Date.now()) {
  return Object.fromEntries(Object.entries(options).map(([group, entries]) => [
    group,
    entries.map((entry) => {
      const candidate = { ...filters, [group]: entry.key };
      const count = filterFeedItems(items, candidate, now).length;
      return { ...entry, count, active: filters[group] === entry.key, disabled: count === 0 && filters[group] !== entry.key };
    })
  ]));
}

module.exports = { filterFeedItems, filterSummary, filterOptionsWithCounts };
