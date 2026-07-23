const {
  chunks,
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');

function createUserProfileRepository(db, config) {
  const collection = () => db.collection(config.userProfilesCollectionName);
  const ensureCollection = createCollectionEnsurer(db, config.userProfilesCollectionName);

  async function get(ownerKey) {
    await ensureCollection();
    try {
      return (await collection().doc(ownerKey).get()).data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function getMany(ownerKeys) {
    await ensureCollection();
    const keys = [...new Set((ownerKeys || []).filter(Boolean))];
    const profiles = [];
    for (const batch of chunks(keys, 50)) {
      if (!batch.length) continue;
      const response = await collection()
        .where({ _id: db.command.in(batch) })
        .limit(batch.length)
        .get();
      profiles.push(...((response && response.data) || []));
    }
    return profiles;
  }

  async function findByAvatarFileIds(fileIds) {
    await ensureCollection();
    const requested = [...new Set(
      (Array.isArray(fileIds) ? fileIds : [])
        .filter((fileId) => typeof fileId === 'string' && fileId.length <= 700)
    )];
    const profiles = [];
    for (const batch of chunks(requested, 20)) {
      if (!batch.length) continue;
      const response = await collection()
        .where({ avatarFileId: db.command.in(batch) })
        .limit(100)
        .get();
      profiles.push(...((response && response.data) || []));
    }
    return profiles;
  }

  async function save(ownerKey, profile, updatedAt) {
    await ensureCollection();
    const current = await get(ownerKey);
    const document = {
      ownerKey,
      nickname: profile.nickname,
      avatarFileId: profile.avatarFileId,
      moderation: profile.moderation || null,
      createdAt: current && current.createdAt || updatedAt,
      updatedAt
    };
    await collection().doc(ownerKey).set({ data: document });
    return { current, document };
  }

  return { get, getMany, findByAvatarFileIds, save };
}

module.exports = { createUserProfileRepository };
