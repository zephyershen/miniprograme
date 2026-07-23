const MAX_SOURCE_TAGS = 3;
const DEFAULT_SOURCE_AVATAR_URL = '/assets/brand/product-avatar.png';

function cleanSourceText(value, maxLength = 80) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeSourceTags(values = []) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const tags = [];
  for (const value of values) {
    const cleaned = cleanSourceText(value, 32).replace(/^#+\s*/, '');
    if (!cleaned) continue;
    const label = `#${cleaned}`;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(label);
    if (tags.length === MAX_SOURCE_TAGS) break;
  }
  return tags;
}

function normalizeSourceAuthor(item = {}) {
  const identity = item.sourceIdentity && typeof item.sourceIdentity === 'object'
    ? item.sourceIdentity
    : {};
  const displayName = cleanSourceText(identity.displayName, 64);
  const cleanHandle = cleanSourceText(identity.handle, 64).replace(/^@+/, '');
  const handleLabel = cleanHandle ? `@${cleanHandle}` : '';
  const fallbackLabel = cleanSourceText(item.source, 100);
  const hasIdentity = Boolean(displayName || handleLabel);
  const initialSource = displayName || cleanHandle || fallbackLabel;
  const avatarInitial = Array.from(initialSource.replace(/^@+/, '').trim())[0] || '';
  return {
    platform: cleanSourceText(identity.platform, 24).toLowerCase(),
    displayName: displayName || cleanHandle,
    handleLabel,
    avatarFileId: cleanSourceText(item.sourceAvatarFileId, 500),
    avatarUrl: '',
    fallbackAvatarUrl: DEFAULT_SOURCE_AVATAR_URL,
    avatarInitial: /[a-z]/i.test(avatarInitial) ? avatarInitial.toUpperCase() : avatarInitial,
    fallbackLabel,
    hasIdentity
  };
}

function decorateSourcePresentation(item = {}) {
  return {
    ...item,
    sourceTags: normalizeSourceTags(item.sourceTags),
    sourceAuthor: normalizeSourceAuthor(item)
  };
}

module.exports = {
  MAX_SOURCE_TAGS,
  DEFAULT_SOURCE_AVATAR_URL,
  normalizeSourceTags,
  normalizeSourceAuthor,
  decorateSourcePresentation
};
