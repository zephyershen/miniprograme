const STORAGE_KEY = 'knowledgeSearchHistory.v1';
const MAX_HISTORY = 8;

function normalizedEntry(value) {
  return String(value || '').trim().slice(0, 50);
}

function normalizedHistory(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(normalizedEntry).filter((entry) => {
    const key = entry.toLowerCase();
    if (!entry || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_HISTORY);
}

function loadSearchHistory(storage = wx) {
  try {
    return normalizedHistory(storage.getStorageSync(STORAGE_KEY));
  } catch (error) {
    return [];
  }
}

function saveSearchHistory(entries, storage = wx) {
  const history = normalizedHistory(entries);
  try {
    storage.setStorageSync(STORAGE_KEY, history);
  } catch (error) {
    return history;
  }
  return history;
}

function recordSearchHistory(query, current = [], storage = wx) {
  const entry = normalizedEntry(query);
  if (!entry) return normalizedHistory(current);
  return saveSearchHistory([
    entry,
    ...normalizedHistory(current).filter(
      (value) => value.toLowerCase() !== entry.toLowerCase()
    )
  ], storage);
}

function clearSearchHistory(storage = wx) {
  try {
    storage.removeStorageSync(STORAGE_KEY);
  } catch (error) {
    return [];
  }
  return [];
}

module.exports = {
  STORAGE_KEY,
  MAX_HISTORY,
  normalizedHistory,
  loadSearchHistory,
  recordSearchHistory,
  clearSearchHistory
};
