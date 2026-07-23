const cacheClearers = [];

function registerViewerCache(clearer) {
  if (typeof clearer === 'function' && !cacheClearers.includes(clearer)) {
    cacheClearers.push(clearer);
  }
  return clearer;
}

function clearViewerCaches() {
  cacheClearers.slice().forEach((clearer) => {
    try {
      clearer();
    } catch (error) {
      console.warn(
        'Viewer cache cleanup failed',
        error && error.code ? error.code : 'CACHE_CLEAR_FAILED'
      );
    }
  });
}

module.exports = { registerViewerCache, clearViewerCaches };
