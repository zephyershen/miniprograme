const patches = new Map();
const { registerViewerCache } = require('../runtime/viewer-cache-registry.js');

function viewerScope() {
  try {
    const { membershipCacheScope } = require('../membership/session.js');
    return membershipCacheScope();
  } catch (error) {
    return 'unresolved';
  }
}

function patchKey(itemId) {
  return `${viewerScope()}:${itemId}`;
}

function rememberEngagement(itemId, engagement) {
  if (typeof itemId === 'string' && itemId && engagement) {
    patches.set(patchKey(itemId), { ...engagement });
  }
}

function engagementPatch(itemId) {
  return patches.get(patchKey(itemId)) || null;
}

function applyRememberedEngagement(items = []) {
  let changed = false;
  const values = items.map((item) => {
    const engagement = item && patches.get(patchKey(item.id));
    if (!engagement) return item;
    changed = true;
    return { ...item, engagement: { ...engagement } };
  });
  return { changed, items: values };
}

function clearEngagement() {
  patches.clear();
}

registerViewerCache(clearEngagement);

module.exports = {
  rememberEngagement,
  engagementPatch,
  applyRememberedEngagement,
  clearEngagement
};
