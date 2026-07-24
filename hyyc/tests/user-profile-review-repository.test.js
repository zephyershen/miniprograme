const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUserProfileReviewRepository
} = require('../cloudfunctions/knowledgeFeed/repositories/user-profile-review');

const OWNER = 'a'.repeat(64);
const REVIEWED_AT = new Date('2026-07-24T12:00:00.000Z');

function notFound() {
  const error = new Error('document not found');
  error.errCode = -1;
  return error;
}

function createMemoryDb(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, documents]) => [
    name,
    new Map(Object.entries(documents).map(([id, value]) => [
      id,
      structuredClone(value)
    ]))
  ]));
  let transactionCount = 0;
  const transactionWrites = [];

  function store(target, name) {
    if (!target.has(name)) target.set(name, new Map());
    return target.get(name);
  }

  function collection(target, name, transactional = false) {
    return {
      doc(id) {
        return {
          async get() {
            const value = store(target, name).get(id);
            if (!value) throw notFound();
            return { data: { _id: id, ...structuredClone(value) } };
          },
          async set({ data }) {
            assert.equal(
              Object.hasOwn(data, '_id'),
              false,
              'CloudBase-managed _id must not cross the persistence boundary'
            );
            store(target, name).set(id, structuredClone(data));
            if (transactional) transactionWrites.push({ name, id, operation: 'set' });
          },
          async update({ data }) {
            assert.equal(
              Object.hasOwn(data, '_id'),
              false,
              'CloudBase-managed _id must not cross the persistence boundary'
            );
            const current = store(target, name).get(id);
            if (!current) throw notFound();
            store(target, name).set(id, { ...current, ...structuredClone(data) });
            if (transactional) transactionWrites.push({ name, id, operation: 'update' });
          }
        };
      }
    };
  }

  return {
    stores,
    transactionWrites,
    get transactionCount() {
      return transactionCount;
    },
    async createCollection(name) {
      store(stores, name);
    },
    collection(name) {
      return collection(stores, name);
    },
    async runTransaction(callback) {
      transactionCount += 1;
      const staged = structuredClone(stores);
      const result = await callback({
        collection(name) {
          return collection(staged, name, true);
        }
      });
      stores.clear();
      staged.forEach((documents, name) => stores.set(name, documents));
      return result;
    }
  };
}

test('atomically approves a review returned with _id without persisting managed ids', async () => {
  const review = {
    ownerKey: OWNER,
    revision: 'revision-1',
    status: 'processing',
    nickname: '新昵称',
    requestedAvatarFileId: 'cloud://env/staging/avatar.jpg',
    reviewAvatarFileId: 'cloud://env/review/avatar.jpg',
    avatarChanged: true,
    attemptCount: 6,
    claimId: 'claim-1',
    claimedAt: new Date(REVIEWED_AT.getTime() - 1000),
    claimExpiresAt: new Date(REVIEWED_AT.getTime() + 60000),
    submittedAt: new Date(REVIEWED_AT.getTime() - 60000),
    updatedAt: new Date(REVIEWED_AT.getTime() - 1000)
  };
  const currentProfile = {
    ownerKey: OWNER,
    nickname: '旧昵称',
    avatarFileId: 'cloud://env/published/old.jpg',
    moderation: { status: 'approved' },
    createdAt: new Date(REVIEWED_AT.getTime() - 120000),
    updatedAt: new Date(REVIEWED_AT.getTime() - 120000)
  };
  const db = createMemoryDb({
    reviews: { [OWNER]: review },
    profiles: { [OWNER]: currentProfile },
    events: {}
  });
  const repository = createUserProfileReviewRepository(db, {
    userProfileReviewsCollectionName: 'reviews',
    userProfilesCollectionName: 'profiles',
    messageEventsCollectionName: 'events'
  });

  const result = await repository.approveAndSave(
    OWNER,
    review.revision,
    review.claimId,
    {
      nickname: review.nickname,
      avatarFileId: 'cloud://env/published/new.jpg',
      moderation: { status: 'approved', provider: 'test' }
    },
    REVIEWED_AT
  );

  assert.equal(result.applied, true);
  assert.equal(db.transactionCount, 1);
  assert.deepEqual(
    db.transactionWrites.map(({ name, operation }) => [name, operation]),
    [['profiles', 'set'], ['reviews', 'set'], ['events', 'set']]
  );

  const storedProfile = db.stores.get('profiles').get(OWNER);
  const storedReview = db.stores.get('reviews').get(OWNER);
  const [storedEvent] = db.stores.get('events').values();
  for (const document of [storedProfile, storedReview, storedEvent]) {
    assert.equal(Object.hasOwn(document, '_id'), false);
  }
  assert.equal(storedProfile.nickname, '新昵称');
  assert.equal(storedReview.status, 'approved');
  assert.equal(storedReview.nickname, '');
  assert.equal(storedReview.requestedAvatarFileId, '');
  assert.equal(storedReview.reviewAvatarFileId, '');
  assert.equal(storedReview.failureCode, '');
  assert.equal(storedEvent.type, 'profile_approved');
  assert.equal(storedEvent.status, 'pending');
});
