async function finishPullDownRefresh(task) {
  try {
    return await task();
  } finally {
    if (typeof wx !== 'undefined' && typeof wx.stopPullDownRefresh === 'function') {
      try {
        wx.stopPullDownRefresh();
      } catch (_) {
        // Refresh completion is best-effort and must not replace the content result.
      }
    }
  }
}

module.exports = {
  finishPullDownRefresh
};
