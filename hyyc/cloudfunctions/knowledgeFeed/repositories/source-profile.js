const { createCollectionEnsurer, chunks } = require('./collection-support');
const {
  normalizeXHandle,
  normalizeSourceIdentity,
  normalizeCloudFileId
} = require('../lib/source-metadata');

const DEFAULT_SOURCE_PROFILE_COLLECTION = 'knowledge_feed_source_profiles';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function profileDocumentId(handle) {
  const identity = normalizeSourceIdentity({
    platform: 'x',
    displayName: handle,
    handle
  });
  if (!identity) throw new Error('SOURCE_PROFILE_HANDLE_INVALID');
  return `x_${identity.handle.toLowerCase()}`;
}

function storedSourceProfile(value = {}, updatedAt = new Date()) {
  const sourceIdentity = normalizeSourceIdentity(value.sourceIdentity);
  if (!sourceIdentity) throw new Error('SOURCE_PROFILE_IDENTITY_INVALID');
  const avatarSourceHash = typeof value.avatarSourceHash === 'string'
    && SHA256_PATTERN.test(value.avatarSourceHash)
    ? value.avatarSourceHash
    : '';
  const sourceAvatarFileId = normalizeCloudFileId(value.sourceAvatarFileId);
  return {
    _id: profileDocumentId(sourceIdentity.handle),
    sourceIdentity,
    avatarSourceHash,
    sourceAvatarFileId,
    updatedAt
  };
}

function createSourceProfileRepository(db, config = {}) {
  const collectionName = config.collectionName || DEFAULT_SOURCE_PROFILE_COLLECTION;
  const collection = () => db.collection(collectionName);
  const ensureCollection = createCollectionEnsurer(db, collectionName);

  async function getMany(handles) {
    await ensureCollection();
    const ids = [...new Set((Array.isArray(handles) ? handles : []).map((handle) => {
      try {
        return profileDocumentId(handle);
      } catch (error) {
        return '';
      }
    }).filter(Boolean))];
    const records = [];
    for (const batch of chunks(ids, 50)) {
      if (!batch.length) continue;
      const response = await collection()
        .where({ _id: db.command.in(batch) })
        .limit(batch.length)
        .get();
      records.push(...((response && response.data) || []));
    }
    const profiles = new Map();
    for (const record of records) {
      const identity = normalizeSourceIdentity(record && record.sourceIdentity);
      if (identity) profiles.set(identity.handle.toLowerCase(), { ...record, sourceIdentity: identity });
    }
    return profiles;
  }

  async function get(handle) {
    const normalized = normalizeXHandle(handle).toLowerCase();
    return normalized ? (await getMany([normalized])).get(normalized) || null : null;
  }

  async function save(value, updatedAt = new Date()) {
    await ensureCollection();
    const profile = storedSourceProfile(value, updatedAt);
    const data = { ...profile };
    delete data._id;
    await collection().doc(profile._id).set({ data });
    return profile;
  }

  return { get, getMany, save };
}

module.exports = {
  DEFAULT_SOURCE_PROFILE_COLLECTION,
  profileDocumentId,
  storedSourceProfile,
  createSourceProfileRepository
};
