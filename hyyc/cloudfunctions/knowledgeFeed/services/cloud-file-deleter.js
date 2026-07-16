function deleteSucceeded(entry) {
  return Boolean(entry)
    && (entry.code === 'SUCCESS' || entry.status === 0 || entry.status === '0');
}

function fileAlreadyAbsent(entry) {
  return Boolean(entry)
    && typeof entry.code === 'string'
    && entry.code.includes('STORAGE_FILE_NONEXIST');
}

function createCloudFileDeleter(cloud) {
  return async function deleteCloudFiles(fileIds) {
    const requested = [...new Set(
      (Array.isArray(fileIds) ? fileIds : [])
        .filter((fileId) => typeof fileId === 'string' && fileId)
    )];
    if (!requested.length) return { deletedFileIds: [], retryFileIds: [], uncertain: false };

    let result;
    try {
      result = await cloud.deleteFile({ fileList: requested });
    } catch (error) {
      return { deletedFileIds: [], retryFileIds: requested, uncertain: true };
    }

    const outcomes = result && result.fileList;
    const outcomeById = new Map(
      (Array.isArray(outcomes) ? outcomes : [])
        .map((entry) => [entry && (entry.fileID || entry.fileId), entry])
        .filter(([fileId]) => typeof fileId === 'string' && fileId)
    );
    const deletedFileIds = [];
    const retryFileIds = [];
    requested.forEach((fileId, index) => {
      const entry = outcomeById.get(fileId)
        || (Array.isArray(outcomes) && outcomes.length === requested.length ? outcomes[index] : null);
      if (deleteSucceeded(entry) || fileAlreadyAbsent(entry)) deletedFileIds.push(fileId);
      else retryFileIds.push(fileId);
    });
    return {
      deletedFileIds,
      retryFileIds,
      uncertain: !Array.isArray(outcomes) || retryFileIds.length > 0
    };
  };
}

module.exports = { deleteSucceeded, fileAlreadyAbsent, createCloudFileDeleter };
