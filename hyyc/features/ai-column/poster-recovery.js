function createPosterRecovery({
  reload,
  remount,
  onFailure,
  isDisposed = () => false
} = {}) {
  const attemptedKeys = new Set();
  const pendingByKey = new Map();
  let sharedReload = null;
  let disposed = false;

  function reloadOnce() {
    if (!sharedReload) {
      sharedReload = Promise.resolve()
        .then(() => reload())
        .then((result) => result !== false)
        .catch(() => false)
        .finally(() => {
          sharedReload = null;
        });
    }
    return sharedReload;
  }

  function fail(key) {
    if (!disposed && !isDisposed() && typeof onFailure === 'function') onFailure(key);
    return false;
  }

  async function recoverOnce({ key, index }) {
    const reloaded = await reloadOnce();
    if (!reloaded || disposed || isDisposed()) return fail(key);
    const remounted = await remount(index);
    return remounted === false ? fail(key) : true;
  }

  function recover({ key, index } = {}) {
    const stableKey = String(key || '');
    const posterIndex = Number(index);
    if (!stableKey || !Number.isInteger(posterIndex) || posterIndex < 0) {
      return Promise.resolve(fail(stableKey));
    }
    if (pendingByKey.has(stableKey)) return pendingByKey.get(stableKey);
    if (attemptedKeys.has(stableKey)) return Promise.resolve(fail(stableKey));

    attemptedKeys.add(stableKey);
    const pending = recoverOnce({ key: stableKey, index: posterIndex })
      .finally(() => pendingByKey.delete(stableKey));
    pendingByKey.set(stableKey, pending);
    return pending;
  }

  return {
    recover,
    reset() {
      attemptedKeys.clear();
    },
    dispose() {
      disposed = true;
      attemptedKeys.clear();
      pendingByKey.clear();
    }
  };
}

module.exports = {
  createPosterRecovery
};
