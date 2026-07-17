function createVisualCleanupService({
  repository,
  deleteFiles,
  ownedVisualPrefixes = [],
  now = () => new Date(),
  logger = console
}) {
  const owned = (Array.isArray(ownedVisualPrefixes) ? ownedVisualPrefixes : [])
    .filter((prefix) => typeof prefix === 'string' && prefix.startsWith('cloud://'));

  function isOwned(fileId) {
    return typeof fileId === 'string' && owned.some((prefix) => fileId.startsWith(prefix));
  }

  async function run() {
    if (typeof deleteFiles !== 'function') return { attempted: 0, deleted: 0, retry: 0 };
    const current = await repository.get();
    const candidates = [...new Set([
      ...(Array.isArray(current && current.pendingVisualDeletes) ? current.pendingVisualDeletes : []),
      ...(Array.isArray(current && current.visualDeleteClaims) ? current.visualDeleteClaims : [])
    ])].filter(isOwned);
    let attempted = 0;
    let deleted = 0;
    for (let offset = 0; offset < candidates.length; offset += 50) {
      const batch = candidates.slice(offset, offset + 50);
      try {
        const claimed = await repository.claimVisualDeletes(batch, now());
        if (!claimed.length) continue;
        attempted += claimed.length;
        const outcome = await deleteFiles(claimed);
        const deletedFileIds = Array.isArray(outcome && outcome.deletedFileIds)
          ? outcome.deletedFileIds.filter((fileId) => claimed.includes(fileId))
          : [];
        if (deletedFileIds.length) {
          await repository.acknowledgeVisualDeletes(deletedFileIds, now());
          deleted += deletedFileIds.length;
        }
        if (claimed.length > deletedFileIds.length) {
          logger.warn('Some unused feed visuals remain claimed for retry', {
            retryCount: claimed.length - deletedFileIds.length
          });
        }
      } catch (error) {
        logger.warn('Unused feed visuals could not be deleted', { message: error && error.message });
        break;
      }
    }
    return { attempted, deleted, retry: Math.max(0, attempted - deleted) };
  }

  return { run };
}

module.exports = { createVisualCleanupService };
