const { mapWithConcurrency } = require('../repositories/collection-support');
const {
  normalizeCloudFileId,
  xHandleFromUrl,
  mergeSourceMetadata
} = require('../lib/source-metadata');

const DEFAULT_AVATAR_CLOUD_PATH_PREFIX = 'knowledge-source-avatars/x/';
const DEFAULT_MEDIA_CLOUD_PATH_PREFIX = 'knowledge-previews/source/aihot-media/';

function hasVisual(item) {
  return Boolean(item && (
    (typeof item.coverFileId === 'string' && item.coverFileId)
    || (Array.isArray(item.previewFileIds) && item.previewFileIds.length)
  ));
}

function createSourceMetadataEnrichmentService({
  adapter,
  profileRepository,
  itemRepository = null,
  cloud,
  cloudPathPrefix = DEFAULT_AVATAR_CLOUD_PATH_PREFIX,
  mediaCloudPathPrefix = DEFAULT_MEDIA_CLOUD_PATH_PREFIX,
  previewCaptureVersion = 1,
  now = () => new Date(),
  logger = console
}) {
  if (!adapter || typeof adapter.loadForItems !== 'function'
    || typeof adapter.downloadAvatar !== 'function') {
    throw new Error('SOURCE_METADATA_ADAPTER_REQUIRED');
  }
  if (!profileRepository || typeof profileRepository.getMany !== 'function'
    || typeof profileRepository.save !== 'function') {
    throw new Error('SOURCE_METADATA_PROFILE_REPOSITORY_REQUIRED');
  }
  if (!cloud || typeof cloud.uploadFile !== 'function') {
    throw new Error('SOURCE_METADATA_CLOUD_REQUIRED');
  }

  async function cachedProfiles(handles) {
    try {
      return await profileRepository.getMany(handles);
    } catch (error) {
      logger.warn('Source profile cache unavailable', { message: error && error.message });
      return new Map();
    }
  }

  async function uploadAvatar(metadata) {
    const downloaded = await adapter.downloadAvatar(metadata.avatarProxyUrl);
    const result = await cloud.uploadFile({
      cloudPath: `${cloudPathPrefix}${metadata.sourceIdentity.handle.toLowerCase()}-${metadata.avatarSourceHash.slice(0, 20)}.${downloaded.extension}`,
      fileContent: downloaded.buffer
    });
    const fileId = normalizeCloudFileId(result && result.fileID);
    if (!fileId) throw new Error('SOURCE_METADATA_AVATAR_UPLOAD_INVALID');
    return fileId;
  }

  async function existingVisuals(items) {
    if (!itemRepository || typeof itemRepository.getManyByItemIds !== 'function') return new Map();
    try {
      const documents = await itemRepository.getManyByItemIds(items.map((item) => item.id));
      return new Map(documents.filter(hasVisual).map((document) => [document.id, document]));
    } catch (error) {
      logger.warn('Existing source visuals could not be checked', { message: error && error.message });
      return new Map();
    }
  }

  async function uploadSourceMedia(itemId, media, index) {
    const downloaded = await adapter.downloadMedia(media.proxyUrl);
    const result = await cloud.uploadFile({
      cloudPath: `${mediaCloudPathPrefix}${itemId}-${String(index + 1).padStart(2, '0')}-${media.sourceHash.slice(0, 20)}.${downloaded.extension}`,
      fileContent: downloaded.buffer
    });
    const fileId = normalizeCloudFileId(result && result.fileID);
    if (!fileId) throw new Error('SOURCE_METADATA_MEDIA_UPLOAD_INVALID');
    return fileId;
  }

  async function resolveSourceMedia(item, metadata, existing) {
    if (hasVisual(item) || hasVisual(existing)
      || !Array.isArray(metadata.sourceMedia) || !metadata.sourceMedia.length
      || typeof adapter.downloadMedia !== 'function') return null;
    const fileIds = [];
    for (let index = 0; index < metadata.sourceMedia.length; index += 1) {
      try {
        fileIds.push(await uploadSourceMedia(item.id, metadata.sourceMedia[index], index));
      } catch (error) {
        logger.warn('Upstream source media could not be cached', {
          itemId: item.id,
          mediaIndex: index,
          message: error && error.message
        });
      }
    }
    if (!fileIds.length) return null;
    return {
      previewFileIds: fileIds,
      previewStatus: 'ready',
      previewCheckedAt: now(),
      previewCaptureVersion: Math.max(1, Number(previewCaptureVersion) || 1)
    };
  }

  async function resolveProfile(metadata, cached) {
    const identity = metadata.sourceIdentity;
    const previous = cached || null;
    let sourceAvatarFileId = normalizeCloudFileId(previous && previous.sourceAvatarFileId);
    let avatarSourceHash = typeof (previous && previous.avatarSourceHash) === 'string'
      ? previous.avatarSourceHash
      : '';
    const avatarChanged = Boolean(metadata.avatarProxyUrl && (
      !sourceAvatarFileId || avatarSourceHash !== metadata.avatarSourceHash
    ));
    if (avatarChanged) {
      try {
        sourceAvatarFileId = await uploadAvatar(metadata);
        avatarSourceHash = metadata.avatarSourceHash;
      } catch (error) {
        logger.warn('Source avatar could not be cached', {
          handle: identity.handle,
          message: error && error.message
        });
      }
    }
    const profile = {
      sourceIdentity: identity,
      avatarSourceHash,
      sourceAvatarFileId
    };
    const profileChanged = !previous
      || !previous.sourceIdentity
      || previous.sourceIdentity.displayName !== identity.displayName
      || previous.sourceIdentity.handle !== identity.handle
      || previous.avatarSourceHash !== avatarSourceHash
      || previous.sourceAvatarFileId !== sourceAvatarFileId;
    if (profileChanged) {
      try {
        await profileRepository.save(profile, now());
      } catch (error) {
        logger.warn('Source profile could not be persisted', {
          handle: identity.handle,
          message: error && error.message
        });
      }
    }
    return profile;
  }

  async function enrichItems(items, { mode = 'all' } = {}) {
    const values = Array.isArray(items) ? items : [];
    if (!values.length) return values;
    let upstream = new Map();
    try {
      upstream = await adapter.loadForItems(values, { mode });
    } catch (error) {
      logger.warn('AI HOT feed metadata enrichment unavailable', {
        mode,
        message: error && error.message
      });
    }
    if (!(upstream instanceof Map)) upstream = new Map();

    const storedVisuals = upstream.size ? await existingVisuals(values) : new Map();

    const byHandle = new Map();
    for (const metadata of upstream.values()) {
      if (!metadata.sourceIdentity) continue;
      const key = metadata.sourceIdentity.handle.toLowerCase();
      if (!byHandle.has(key)) byHandle.set(key, metadata);
    }
    const itemHandles = new Map(values.map((item) => [item.id, xHandleFromUrl(item.url)]));
    const handles = [...new Set([
      ...byHandle.keys(),
      ...itemHandles.values()
    ].filter(Boolean).map((handle) => handle.toLowerCase()))];
    const profiles = await cachedProfiles(handles);
    const resolvedProfiles = new Map(profiles);
    await mapWithConcurrency([...byHandle.entries()], 3, async ([key, metadata]) => {
      resolvedProfiles.set(key, await resolveProfile(metadata, profiles.get(key)));
    });

    const resolvedMedia = new Map();
    await mapWithConcurrency(values, 3, async (item) => {
      const metadata = upstream.get(item.id);
      if (!metadata) return;
      const visual = await resolveSourceMedia(item, metadata, storedVisuals.get(item.id));
      if (visual) resolvedMedia.set(item.id, visual);
    });

    return values.map((item) => {
      const metadata = upstream.get(item.id);
      const handle = metadata && metadata.sourceIdentity
        ? metadata.sourceIdentity.handle.toLowerCase()
        : String(itemHandles.get(item.id) || '').toLowerCase();
      const profile = handle ? resolvedProfiles.get(handle) || null : null;
      if (!metadata && !profile) return item;
      const incoming = {
        ...((metadata && metadata.sourceIdentity)
          ? { sourceIdentity: metadata.sourceIdentity }
          : ((profile && profile.sourceIdentity) ? { sourceIdentity: profile.sourceIdentity } : {})),
        ...((metadata && Array.isArray(metadata.sourceTags))
          ? { sourceTags: metadata.sourceTags }
          : {}),
        ...((metadata && Array.isArray(metadata.sourceChannelKeys))
          ? { sourceChannelKeys: metadata.sourceChannelKeys }
          : {}),
        ...((profile && profile.sourceAvatarFileId)
          ? { sourceAvatarFileId: profile.sourceAvatarFileId }
          : {})
      };
      return {
        ...item,
        ...mergeSourceMetadata(item, incoming),
        ...(resolvedMedia.get(item.id) || {})
      };
    });
  }

  return { enrichItems };
}

module.exports = {
  DEFAULT_AVATAR_CLOUD_PATH_PREFIX,
  DEFAULT_MEDIA_CLOUD_PATH_PREFIX,
  createSourceMetadataEnrichmentService
};
