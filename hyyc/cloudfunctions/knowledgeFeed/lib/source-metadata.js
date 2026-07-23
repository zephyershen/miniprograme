const crypto = require('node:crypto');
const {
  normalizeSourceChannelKeys,
  mergeSourceChannelKeys,
  sourceChannelKey
} = require('./source-channels');

const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const SOURCE_METADATA_HASH_PATTERN = /^[a-f0-9]{64}$/;

function own(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function normalizeXHandle(value) {
  const handle = cleanText(value, 16).replace(/^@/, '').slice(0, 15);
  return X_HANDLE_PATTERN.test(handle) ? handle : '';
}

function xHandleFromUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:'
      || !['x.com', 'www.x.com'].includes(parsed.hostname.toLowerCase())) return '';
    const handle = decodeURIComponent(parsed.pathname.split('/').filter(Boolean)[0] || '');
    return normalizeXHandle(handle);
  } catch (error) {
    return '';
  }
}

function normalizeSourceIdentity(value) {
  if (!value || value.platform !== 'x') return null;
  const handle = normalizeXHandle(value.handle);
  const displayName = cleanText(value.displayName, 80);
  if (!handle || !displayName) return null;
  return { platform: 'x', displayName, handle };
}

function normalizeSourceTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const tag = cleanText(entry, 40).replace(/^#+/, '');
    const key = tag.toLocaleLowerCase('zh-CN');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= 8) break;
  }
  return result;
}

function normalizeCloudFileId(value) {
  const fileId = cleanText(value, 500);
  return fileId.startsWith('cloud://') && !/[?#]/.test(fileId) ? fileId : '';
}

function sourceMetadataHash(value = {}) {
  const identity = normalizeSourceIdentity(value.sourceIdentity);
  const tags = normalizeSourceTags(value.sourceTags);
  const sourceChannelKeys = normalizeSourceChannelKeys(value.sourceChannelKeys);
  const avatarFileId = normalizeCloudFileId(value.sourceAvatarFileId);
  if (!identity && !tags.length && !sourceChannelKeys.length && !avatarFileId) return '';
  return crypto.createHash('sha256').update(JSON.stringify({
    sourceIdentity: identity,
    sourceTags: tags,
    sourceChannelKeys,
    sourceAvatarFileId: avatarFileId
  })).digest('hex');
}

function sourceMetadataFields(value = {}) {
  const fields = {};
  const identity = normalizeSourceIdentity(value.sourceIdentity);
  const avatarFileId = normalizeCloudFileId(value.sourceAvatarFileId);
  if (identity) fields.sourceIdentity = identity;
  if (own(value, 'sourceTags') && Array.isArray(value.sourceTags)) {
    fields.sourceTags = normalizeSourceTags(value.sourceTags);
  }
  if (own(value, 'sourceChannelKeys') && Array.isArray(value.sourceChannelKeys)) {
    fields.sourceChannelKeys = normalizeSourceChannelKeys(value.sourceChannelKeys);
    fields.sourceChannelKey = sourceChannelKey(fields.sourceChannelKeys);
  }
  if (avatarFileId) fields.sourceAvatarFileId = avatarFileId;
  const hash = sourceMetadataHash(fields);
  if (hash) fields.sourceMetadataHash = hash;
  return fields;
}

function hasSourceMetadataPatch(value = {}) {
  return Boolean(
    normalizeSourceIdentity(value.sourceIdentity)
    || normalizeCloudFileId(value.sourceAvatarFileId)
    || (own(value, 'sourceTags') && Array.isArray(value.sourceTags))
    || (own(value, 'sourceChannelKeys') && Array.isArray(value.sourceChannelKeys))
    || (typeof value.sourceMetadataHash === 'string'
      && SOURCE_METADATA_HASH_PATTERN.test(value.sourceMetadataHash))
  );
}

function mergeSourceMetadata(current = {}, incoming = {}) {
  const existing = sourceMetadataFields(current);
  if (!hasSourceMetadataPatch(incoming)) return existing;
  const patch = sourceMetadataFields(incoming);
  const merged = {
    ...(existing.sourceIdentity ? { sourceIdentity: existing.sourceIdentity } : {}),
    ...(own(existing, 'sourceTags') ? { sourceTags: existing.sourceTags } : {}),
    ...(own(existing, 'sourceChannelKeys')
      ? { sourceChannelKeys: existing.sourceChannelKeys }
      : {}),
    ...(existing.sourceAvatarFileId
      ? { sourceAvatarFileId: existing.sourceAvatarFileId }
      : {})
  };
  if (patch.sourceIdentity) merged.sourceIdentity = patch.sourceIdentity;
  if (own(incoming, 'sourceTags') && Array.isArray(incoming.sourceTags)) {
    merged.sourceTags = normalizeSourceTags(incoming.sourceTags);
  }
  if (own(incoming, 'sourceChannelKeys') && Array.isArray(incoming.sourceChannelKeys)) {
    merged.sourceChannelKeys = mergeSourceChannelKeys(
      existing.sourceChannelKeys,
      incoming.sourceChannelKeys
    );
  }
  if (patch.sourceAvatarFileId) merged.sourceAvatarFileId = patch.sourceAvatarFileId;
  return sourceMetadataFields(merged);
}

module.exports = {
  X_HANDLE_PATTERN,
  SOURCE_METADATA_HASH_PATTERN,
  normalizeXHandle,
  xHandleFromUrl,
  normalizeSourceIdentity,
  normalizeSourceTags,
  normalizeSourceChannelKeys,
  normalizeCloudFileId,
  sourceMetadataHash,
  sourceMetadataFields,
  hasSourceMetadataPatch,
  mergeSourceMetadata
};
