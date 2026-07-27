const {
  builtInEntry,
  mergeColumnEntries,
  entrySort,
  clone
} = require('../content/column-entry-contract');

function successfulTempUrl(entry) {
  return Boolean(entry)
    && /^https:\/\//i.test(entry.tempFileURL || '')
    && (entry.status === undefined || entry.status === 0 || entry.status === '0'
      || entry.code === 'SUCCESS');
}

function createColumnCatalogService({
  entryRepository,
  mediaRepository,
  getTempFileURL,
  logger = { warn: () => {} }
}) {
  async function entries() {
    let overrides = [];
    try {
      overrides = await entryRepository.listAll();
    } catch (error) {
      logger.warn('Column entry overrides could not be loaded', {
        code: error && error.code || 'TEMPORARY_FAILURE'
      });
    }
    return mergeColumnEntries(overrides).sort(entrySort);
  }

  async function entry(id) {
    let override = null;
    try {
      override = await entryRepository.get(id);
    } catch (error) {
      logger.warn('Column entry override could not be loaded', {
        code: error && error.code || 'TEMPORARY_FAILURE'
      });
    }
    if (override) return { ...clone(override), id: override._id || id };
    return builtInEntry(id);
  }

  async function publishedEntries() {
    return (await entries())
      .filter((value) => value.status === 'published' && value.published)
      .map((value) => ({ ...value, content: clone(value.published) }));
  }

  async function publishedEntry(id, kind = '') {
    const value = await entry(id);
    if (!value
      || value.status !== 'published'
      || !value.published
      || (kind && value.kind !== kind)) return null;
    return { ...value, content: clone(value.published) };
  }

  async function tempUrls(fileIds) {
    const unique = [...new Set((Array.isArray(fileIds) ? fileIds : []).filter(Boolean))];
    if (!unique.length) return new Map();
    const responses = [];
    for (let offset = 0; offset < unique.length; offset += 50) {
      try {
        responses.push(await getTempFileURL({
          fileList: unique.slice(offset, offset + 50)
        }));
      } catch (error) {
        logger.warn('Column media temporary URLs could not be signed', {
          code: error && error.code || 'TEMPORARY_FAILURE'
        });
      }
    }
    return new Map(responses.flatMap((response) => (response && response.fileList) || [])
      .filter(successfulTempUrl)
      .map((file) => [file.fileID || file.fileId, file.tempFileURL]));
  }

  async function resolvePosters(content, { includeReferences = false } = {}) {
    const posters = Array.isArray(content && content.posters) ? content.posters : [];
    const mediaIds = posters.map((poster) => poster.mediaId).filter(Boolean);
    const media = mediaIds.length ? await mediaRepository.getMany(mediaIds) : [];
    const mediaById = new Map(media.map((item) => [item._id, item]));
    const fileIds = posters.map((poster) => {
      if (poster.fileId) return poster.fileId;
      const record = mediaById.get(poster.mediaId);
      return record
        && record.entryId === content.id
        && record.status !== 'deleted'
        ? record.fileId
        : '';
    }).filter(Boolean);
    const urls = await tempUrls(fileIds);
    return posters.map((poster, index) => {
      const record = poster.mediaId ? mediaById.get(poster.mediaId) : null;
      const fileId = poster.fileId || (
        record && record.entryId === content.id && record.status !== 'deleted'
          ? record.fileId
          : ''
      );
      const image = urls.get(fileId) || '';
      if (!image && !includeReferences) return null;
      return {
        key: poster.key || poster.mediaId || `poster-${index + 1}`,
        image: image || '',
        previewImage: image || '',
        alt: poster.alt || `课程讲解图第 ${index + 1} 页`,
        ...(includeReferences && poster.mediaId ? { mediaId: poster.mediaId } : {}),
        ...(includeReferences && poster.fileId ? { fileId: poster.fileId } : {})
      };
    }).filter(Boolean);
  }

  async function resolveContent(content, options = {}) {
    if (!content) return null;
    return {
      ...clone(content),
      posters: await resolvePosters(content, options)
    };
  }

  return {
    entries,
    entry,
    publishedEntries,
    publishedEntry,
    resolvePosters,
    resolveContent
  };
}

module.exports = { successfulTempUrl, createColumnCatalogService };
