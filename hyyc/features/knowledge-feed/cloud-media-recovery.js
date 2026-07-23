const { knowledgeMediaSession } = require('./cloud-media-session.js');

function readDataPath(value, path) {
  if (!path || typeof path !== 'string') return undefined;
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return segments.reduce((current, segment) => (
    current == null ? undefined : current[segment]
  ), value);
}

function eventMediaDescriptor(event = {}) {
  const dataset = event.currentTarget && event.currentTarget.dataset || {};
  return {
    key: String(dataset.mediaKey || ''),
    fileId: String(dataset.fileId || ''),
    failedUrl: String(dataset.mediaUrl || ''),
    fallbackUrl: String(dataset.mediaFallback || ''),
    path: String(dataset.mediaPath || '')
  };
}

function createPageMediaRecovery(page, {
  session = knowledgeMediaSession,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const attempts = new Map();
  let generation = 0;
  let refreshTimer = null;
  let refreshWatch = null;
  let paused = false;

  function cancelRefreshTimer() {
    if (refreshTimer) clearTimer(refreshTimer);
    refreshTimer = null;
  }

  function scheduleRefresh() {
    cancelRefreshTimer();
    if (paused || !refreshWatch || !refreshWatch.fileIds.length) return;
    const delay = typeof session.refreshDelayForFileIds === 'function'
      ? session.refreshDelayForFileIds(refreshWatch.fileIds)
      : 5 * 60 * 1000;
    refreshTimer = setTimer(refreshTrackedMedia, Math.max(1000, Number(delay) || 1000));
  }

  async function refreshTrackedMedia() {
    refreshTimer = null;
    const watch = refreshWatch;
    if (paused || !watch || !watch.fileIds.length) return false;
    const startGeneration = generation;
    const urls = await session.resolveFileIds(watch.fileIds, { force: true });
    if (paused || generation !== startGeneration || refreshWatch !== watch) return false;
    watch.onResolved(urls);
    scheduleRefresh();
    return true;
  }

  function track(fileIds, onResolved) {
    const values = [...new Set((Array.isArray(fileIds) ? fileIds : []).filter(Boolean))];
    refreshWatch = values.length && typeof onResolved === 'function'
      ? { fileIds: values, onResolved }
      : null;
    scheduleRefresh();
  }

  function pause() {
    paused = true;
    cancelRefreshTimer();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    scheduleRefresh();
  }

  function reset() {
    generation += 1;
    attempts.clear();
    refreshWatch = null;
    cancelRefreshTimer();
  }

  function isCurrent(startGeneration, path, expectedUrl) {
    return generation === startGeneration
      && readDataPath(page && page.data, path) === expectedUrl;
  }

  function write(path, url, callback) {
    if (!page || typeof page.setData !== 'function' || !path) return;
    page.setData({ [path]: url }, callback);
  }

  async function handleError(event) {
    const descriptor = eventMediaDescriptor(event);
    const { key, fileId, failedUrl, fallbackUrl, path } = descriptor;
    if (!key || !fileId || !failedUrl || !path) return false;

    const attemptKey = `${key}|${fileId}`;
    const previous = attempts.get(attemptKey);
    if (previous && previous.pending && previous.failedUrl === failedUrl) return false;
    if (previous && previous.retried) {
      if (readDataPath(page && page.data, path) === failedUrl) write(path, fallbackUrl);
      return false;
    }

    const startGeneration = generation;
    attempts.set(attemptKey, { failedUrl, pending: true, retried: false });
    session.invalidate(fileId);
    const urls = await session.resolveFileIds([fileId], { force: true });
    if (!isCurrent(startGeneration, path, failedUrl)) return false;

    const retryUrl = urls.get(fileId) || '';
    attempts.set(attemptKey, {
      failedUrl,
      retryUrl,
      pending: false,
      retried: true
    });
    if (!retryUrl) {
      write(path, fallbackUrl);
      scheduleRefresh();
      return false;
    }
    if (retryUrl !== failedUrl) {
      write(path, retryUrl);
      scheduleRefresh();
      return true;
    }

    write(path, '', () => {
      if (generation !== startGeneration || readDataPath(page.data, path) !== '') return;
      write(path, retryUrl);
    });
    scheduleRefresh();
    return true;
  }

  return {
    handleError,
    track,
    pause,
    resume,
    reset,
    dispose: reset
  };
}

module.exports = {
  readDataPath,
  eventMediaDescriptor,
  createPageMediaRecovery
};
