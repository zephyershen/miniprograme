function normalizeKey(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function createQueryCache({ ttlMs = 60 * 1000, maxEntries = 8, now = Date.now } = {}) {
  const entries = new Map();
  const entryLimit = Math.max(1, Math.floor(Number(maxEntries) || 1));
  const defaultTtl = Math.max(0, Number(ttlMs) || 0);

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function prune() {
    while (entries.size > entryLimit) {
      const oldestKey = entries.keys().next().value;
      const oldest = entries.get(oldestKey);
      if (oldest && oldest.pending) {
        touch(oldestKey, oldest);
        if ([...entries.values()].every((entry) => entry.pending)) break;
        continue;
      }
      entries.delete(oldestKey);
    }
  }

  function peek(rawKey, { maxAgeMs = defaultTtl, allowStale = false } = {}) {
    const key = normalizeKey(rawKey);
    const entry = entries.get(key);
    if (!entry || !entry.hasValue) return undefined;
    const fresh = now() - entry.cachedAt <= Math.max(0, Number(maxAgeMs) || 0);
    if (!fresh && !allowStale) return undefined;
    touch(key, entry);
    return entry.value;
  }

  function remember(rawKey, value) {
    const key = normalizeKey(rawKey);
    const entry = { value, hasValue: true, cachedAt: now(), pending: null };
    touch(key, entry);
    prune();
    return value;
  }

  function load(rawKey, loader, { force = false, maxAgeMs = defaultTtl } = {}) {
    const key = normalizeKey(rawKey);
    const current = entries.get(key);
    if (current && current.pending) return current.pending;
    if (!force && current && current.hasValue
      && now() - current.cachedAt <= Math.max(0, Number(maxAgeMs) || 0)) {
      touch(key, current);
      return Promise.resolve(current.value);
    }

    const entry = current || { value: undefined, hasValue: false, cachedAt: 0, pending: null };
    const pending = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (entries.get(key) === entry && entry.pending === pending) {
          entry.value = value;
          entry.hasValue = true;
          entry.cachedAt = now();
          entry.pending = null;
          touch(key, entry);
          prune();
        }
        return value;
      })
      .catch((error) => {
        if (entries.get(key) === entry && entry.pending === pending) {
          entry.pending = null;
          if (!entry.hasValue) entries.delete(key);
        }
        throw error;
      });
    entry.pending = pending;
    touch(key, entry);
    prune();
    return pending;
  }

  function invalidate(rawKey) {
    if (rawKey === undefined) {
      entries.clear();
      return;
    }
    entries.delete(normalizeKey(rawKey));
  }

  return {
    load,
    peek,
    remember,
    invalidate,
    size: () => entries.size
  };
}

module.exports = { createQueryCache };
