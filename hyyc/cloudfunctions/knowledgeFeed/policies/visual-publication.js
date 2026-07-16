function hasReadyVisual(item) {
  if (!item || typeof item !== 'object') return false;
  if (typeof item.coverFileId === 'string' && item.coverFileId) return true;
  return Array.isArray(item.previewFileIds)
    && item.previewFileIds.some((fileId) => typeof fileId === 'string' && fileId);
}

function publishableItems(items) {
  return (Array.isArray(items) ? items : []).filter(hasReadyVisual);
}

module.exports = { hasReadyVisual, publishableItems };
