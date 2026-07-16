function createCloudFileDeleter(cloud) {
  return async function deleteCloudFiles(fileIds) {
    if (!Array.isArray(fileIds) || !fileIds.length) return;
    const result = await cloud.deleteFile({ fileList: fileIds });
    const outcomes = result && result.fileList;
    const succeeded = Array.isArray(outcomes)
      && outcomes.length === fileIds.length
      && outcomes.every((entry) => Number(entry && entry.status) === 0);
    if (!succeeded) throw new Error('CLOUD_FILE_DELETE_FAILED');
  };
}

module.exports = { createCloudFileDeleter };
