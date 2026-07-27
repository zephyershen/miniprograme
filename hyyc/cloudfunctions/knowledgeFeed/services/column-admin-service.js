const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const {
  ENTRY_KINDS,
  ENTRY_ID_PATTERN,
  MEDIA_ID_PATTERN,
  builtInEntry,
  mergeColumnEntries,
  entrySort,
  normalizeEntryContent,
  validatePublishable,
  createEntryId,
  normalizeMutationId,
  clone
} = require('../content/column-entry-contract');
const { sanitizeImagePayload } = require('../lib/user-media-image');

function requireActualAdmin(entitlement) {
  if (!entitlement || !entitlement.viewer || entitlement.viewer.isActualAdmin !== true) {
    throw new AppError('ADMIN_REQUIRED', '只有真实管理员可以管理专栏内容');
  }
  return entitlement;
}

function versionConflict(error) {
  if (error && error.code === 'VERSION_CONFLICT') {
    throw new AppError('VERSION_CONFLICT', '内容已经在其他页面更新，请重新读取后再编辑');
  }
  throw error;
}

function mediaIds(content) {
  return new Set((content && Array.isArray(content.posters) ? content.posters : [])
    .map((poster) => poster.mediaId)
    .filter((id) => MEDIA_ID_PATTERN.test(id || '')));
}

function listSummary(entry) {
  const content = entry.draft || entry.published || {};
  return {
    id: entry.id || entry._id,
    kind: entry.kind,
    origin: entry.origin || 'admin',
    status: entry.status || 'draft',
    version: Number(entry.version) || 0,
    publishedRevision: Number(entry.publishedRevision) || 0,
    title: content.title || '未命名内容',
    subtitle: content.subtitle || '',
    track: content.track || '',
    order: Number(content.order) || 0,
    imageCount: Array.isArray(content.posters) ? content.posters.length : 0,
    draftUpdatedAt: entry.draftUpdatedAt || null,
    publishedAt: entry.publishedAt || null
  };
}

function summarySort(left, right) {
  return entrySort(
    { id: left.id, kind: left.kind, published: left },
    { id: right.id, kind: right.kind, published: right }
  );
}

function createColumnAdminService({
  entryRepository,
  mediaRepository,
  catalogService,
  uploadFile,
  deleteFiles,
  config,
  now = () => Date.now(),
  createMediaId = () => crypto.randomBytes(24).toString('hex')
}) {
  function mutationId(value) {
    const normalized = normalizeMutationId(value);
    if (!normalized) throw new AppError('INVALID_REQUEST', '操作标识无效，请重新打开页面');
    return normalized;
  }

  function requestedEntryId(value) {
    if (typeof value !== 'string' || !ENTRY_ID_PATTERN.test(value)) {
      throw new AppError('INVALID_REQUEST', '内容标识无效，请重新打开页面');
    }
    return value;
  }

  function expectedVersion(value) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new AppError('INVALID_REQUEST', '内容版本无效，请重新读取后再编辑');
    }
    return version;
  }

  async function mergedEntry(id) {
    const override = await entryRepository.get(id);
    return override ? { ...override, id: override._id || id } : builtInEntry(id);
  }

  async function assertMediaOwnership(content) {
    const requested = [...mediaIds(content)];
    if (!requested.length) return [];
    const records = await mediaRepository.getMany(requested);
    const byId = new Map(records.map((record) => [record._id, record]));
    requested.forEach((id) => {
      const record = byId.get(id);
      if (!record
        || record.entryId !== content.id
        || record.status === 'deleted') {
        throw new AppError('INVALID_REQUEST', '图片已失效，请删除后重新上传');
      }
    });
    return records;
  }

  async function reconcileMedia(entry) {
    const draftIds = mediaIds(entry.draft);
    const publishedIds = mediaIds(entry.published);
    const records = await mediaRepository.listForEntry(entry.id || entry._id);
    const currentTime = new Date(now());
    const cleanupAfter = new Date(currentTime.getTime() + config.mediaOrphanTtlMs);
    await Promise.all(records.map((record) => {
      if (record.status === 'deleted') return null;
      const isPublished = publishedIds.has(record._id);
      const isDraft = draftIds.has(record._id);
      return mediaRepository.update(record._id, {
        status: isPublished ? 'published' : isDraft ? 'draft' : 'orphaned',
        cleanupAfter: isPublished || isDraft ? null : cleanupAfter,
        updatedAt: currentTime
      });
    }));
  }

  async function list(entitlement) {
    requireActualAdmin(entitlement);
    const overrides = await entryRepository.listAll();
    return {
      items: mergeColumnEntries(overrides).map(listSummary).sort(summarySort)
    };
  }

  async function get(id, entitlement) {
    requireActualAdmin(entitlement);
    const entry = await mergedEntry(requestedEntryId(id));
    if (!entry) throw new AppError('ITEM_NOT_FOUND', '这篇内容不存在');
    const draft = await catalogService.resolveContent(entry.draft || entry.published, {
      includeReferences: true
    });
    return {
      ...listSummary(entry),
      draft,
      hasPublishedVersion: Boolean(entry.published)
    };
  }

  async function create(input, actor, entitlement) {
    requireActualAdmin(entitlement);
    const kind = ENTRY_KINDS.includes(input && input.kind) ? input.kind : '';
    if (!kind) throw new AppError('INVALID_REQUEST', '请选择内容类型');
    const operationId = mutationId(input.mutationId);
    const id = createEntryId(kind, operationId);
    const existing = (await catalogService.entries()).filter((entry) => entry.kind === kind);
    const order = Math.max(0, ...existing.map((entry) => Number(
      entry.draft && entry.draft.order || entry.published && entry.published.order
    ) || 0)) + 1;
    const draft = normalizeEntryContent(kind, {
      id,
      order,
      title: '',
      subtitle: '',
      sections: {}
    }, id);
    const currentTime = new Date(now());
    const document = await entryRepository.mutate({
      id,
      expectedVersion: 0,
      mutationId: operationId,
      createDocument: {
        _id: id,
        kind,
        origin: 'admin',
        status: 'draft',
        track: draft.track,
        sortOrder: draft.order,
        version: 0,
        publishedRevision: 0,
        draft,
        published: null,
        createdAt: currentTime,
        createdBy: actor.ownerKey
      },
      update: (value) => ({
        ...value,
        draftUpdatedAt: currentTime,
        draftUpdatedBy: actor.ownerKey,
        updatedAt: currentTime
      })
    }).catch(versionConflict);
    return get(document._id, entitlement);
  }

  async function save(input, actor, entitlement) {
    requireActualAdmin(entitlement);
    const id = requestedEntryId(input && input.id);
    const version = expectedVersion(input && input.expectedVersion);
    const base = await mergedEntry(id);
    if (!base) throw new AppError('ITEM_NOT_FOUND', '这篇内容不存在');
    const draft = normalizeEntryContent(base.kind, input.draft, id);
    await assertMediaOwnership(draft);
    const currentTime = new Date(now());
    const document = await entryRepository.mutate({
      id,
      expectedVersion: version,
      mutationId: mutationId(input.mutationId),
      createDocument: {
        ...base,
        _id: id,
        origin: base.origin || 'builtin',
        createdAt: currentTime,
        createdBy: actor.ownerKey
      },
      update: (value) => ({
        ...value,
        kind: base.kind,
        draft,
        track: draft.track,
        sortOrder: draft.order,
        draftUpdatedAt: currentTime,
        draftUpdatedBy: actor.ownerKey,
        updatedAt: currentTime
      })
    }).catch(versionConflict);
    await reconcileMedia(document);
    return get(id, entitlement);
  }

  async function publish(input, actor, entitlement) {
    requireActualAdmin(entitlement);
    const id = requestedEntryId(input && input.id);
    const version = expectedVersion(input && input.expectedVersion);
    const base = await mergedEntry(id);
    if (!base || !base.draft) throw new AppError('ITEM_NOT_FOUND', '这篇草稿不存在');
    const draft = normalizeEntryContent(base.kind, base.draft, id);
    const errors = validatePublishable(draft);
    if (errors.length) throw new AppError('INVALID_REQUEST', errors[0]);
    await assertMediaOwnership(draft);
    const currentTime = new Date(now());
    const document = await entryRepository.mutate({
      id,
      expectedVersion: version,
      mutationId: mutationId(input.mutationId),
      createDocument: {
        ...base,
        _id: id,
        createdAt: currentTime,
        createdBy: actor.ownerKey
      },
      update: (value) => ({
        ...value,
        status: 'published',
        published: clone(draft),
        track: draft.track,
        sortOrder: draft.order,
        publishedRevision: Number(value.publishedRevision || 0) + 1,
        publishedAt: currentTime,
        publishedBy: actor.ownerKey,
        updatedAt: currentTime
      })
    }).catch(versionConflict);
    await reconcileMedia(document);
    return get(id, entitlement);
  }

  async function unpublish(input, actor, entitlement) {
    requireActualAdmin(entitlement);
    const id = requestedEntryId(input && input.id);
    const version = expectedVersion(input && input.expectedVersion);
    const base = await mergedEntry(id);
    if (!base) throw new AppError('ITEM_NOT_FOUND', '这篇内容不存在');
    const currentTime = new Date(now());
    const document = await entryRepository.mutate({
      id,
      expectedVersion: version,
      mutationId: mutationId(input.mutationId),
      createDocument: {
        ...base,
        _id: id,
        createdAt: currentTime,
        createdBy: actor.ownerKey
      },
      update: (value) => ({
        ...value,
        status: 'unpublished',
        unpublishedAt: currentTime,
        unpublishedBy: actor.ownerKey,
        updatedAt: currentTime
      })
    }).catch(versionConflict);
    await reconcileMedia(document);
    return get(id, entitlement);
  }

  async function preview(id, entitlement) {
    requireActualAdmin(entitlement);
    const entry = await mergedEntry(requestedEntryId(id));
    if (!entry || !entry.draft) throw new AppError('ITEM_NOT_FOUND', '这篇草稿不存在');
    return catalogService.resolveContent(entry.draft);
  }

  async function uploadMedia(input, actor, entitlement) {
    requireActualAdmin(entitlement);
    const id = requestedEntryId(input && input.id);
    if (!await mergedEntry(id)) throw new AppError('ITEM_NOT_FOUND', '请先创建草稿再上传图片');
    const sanitized = sanitizeImagePayload(
      input.contentBase64,
      input.extension,
      config.mediaMaxBytes,
      {
        maxDimension: config.mediaMaxDimension,
        maxPixels: config.mediaMaxPixels
      }
    );
    const mediaId = createMediaId();
    if (!MEDIA_ID_PATTERN.test(mediaId)) throw new Error('COLUMN_MEDIA_ID_INVALID');
    const cloudPath = `${config.mediaPathPrefix}${id}/${mediaId}.${sanitized.extension}`;
    const upload = await uploadFile({
      cloudPath,
      fileContent: sanitized.buffer,
      contentType: sanitized.mimeType
    });
    const fileId = upload && (upload.fileID || upload.fileId);
    if (typeof fileId !== 'string' || !fileId.endsWith(`/${cloudPath}`)) {
      throw new AppError('TEMPORARY_FAILURE', '图片上传失败，请重试');
    }
    const currentTime = new Date(now());
    await mediaRepository.create({
      _id: mediaId,
      entryId: id,
      ownerKey: actor.ownerKey,
      fileId,
      cloudPath,
      extension: sanitized.extension,
      mimeType: sanitized.mimeType,
      width: sanitized.width,
      height: sanitized.height,
      bytes: sanitized.buffer.length,
      sha256: sanitized.sha256,
      status: 'staged',
      cleanupAfter: new Date(currentTime.getTime() + config.mediaOrphanTtlMs),
      createdAt: currentTime,
      updatedAt: currentTime
    });
    return { mediaId, key: mediaId, alt: '', fileId };
  }

  async function cleanupExpired() {
    const currentTime = new Date(now());
    const records = await mediaRepository.listExpired(currentTime);
    let deleted = 0;
    let retained = 0;
    for (const record of records) {
      const entry = await mergedEntry(record.entryId);
      const referenced = entry && (
        mediaIds(entry.draft).has(record._id) || mediaIds(entry.published).has(record._id)
      );
      if (referenced) {
        await mediaRepository.update(record._id, {
          status: mediaIds(entry.published).has(record._id) ? 'published' : 'draft',
          cleanupAfter: null,
          updatedAt: currentTime
        });
        retained += 1;
        continue;
      }
      let result;
      try {
        result = await deleteFiles([record.fileId]);
      } catch (error) {
        continue;
      }
      const confirmed = new Set(result && result.deletedFileIds || []);
      if (!confirmed.has(record.fileId)) continue;
      await mediaRepository.remove(record._id);
      deleted += 1;
    }
    return { status: 'complete', scanned: records.length, deleted, retained };
  }

  return {
    list,
    get,
    create,
    save,
    publish,
    unpublish,
    preview,
    uploadMedia,
    cleanupExpired
  };
}

module.exports = {
  requireActualAdmin,
  mediaIds,
  listSummary,
  summarySort,
  createColumnAdminService
};
