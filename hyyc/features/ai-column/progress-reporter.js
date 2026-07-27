const { createProgressMutationId } = require('./progress.js');

function normalizeReport(input) {
  if (!input || !['lesson', 'practical'].includes(input.entryType) || !input.entryId) return null;
  const posterIndex = Number(input.lastPosterIndex);
  return {
    entryType: input.entryType,
    entryId: String(input.entryId),
    progressPercent: Math.min(100, Math.max(5, Math.floor(Number(input.progressPercent) || 5))),
    lastPosterIndex: Number.isFinite(posterIndex) ? Math.max(0, Math.floor(posterIndex)) : 0
  };
}

function createProgressReporter({
  save,
  delayMs = 700,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  mutationId = () => createProgressMutationId()
}) {
  let queued = null;
  let timer = null;
  let running = null;
  let closed = false;

  function mergeQueued(next) {
    if (!queued
      || queued.entryType !== next.entryType
      || queued.entryId !== next.entryId) {
      queued = next;
      return;
    }
    queued = {
      ...next,
      progressPercent: Math.max(queued.progressPercent, next.progressPercent)
    };
  }

  async function drain() {
    if (running) return running;
    running = (async () => {
      while (queued) {
        const item = queued;
        queued = null;
        try {
          await save({ ...item, mutationId: mutationId() });
        } catch (error) {
          // Reading must remain available if progress persistence is temporarily unavailable.
        }
      }
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }

  function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    return drain();
  }

  function report(input, { immediate = false } = {}) {
    if (closed) return Promise.resolve(false);
    const normalized = normalizeReport(input);
    if (!normalized) return Promise.resolve(false);
    mergeQueued(normalized);
    if (immediate) return flush().then(() => true);
    if (timer === null) {
      timer = setTimer(() => {
        timer = null;
        drain();
      }, delayMs);
    }
    return Promise.resolve(true);
  }

  function dispose() {
    closed = true;
    return flush();
  }

  return {
    report,
    flush,
    dispose
  };
}

module.exports = {
  normalizeReport,
  createProgressReporter
};
