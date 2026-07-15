const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCardMutationInTransaction } = require('../cloudfunctions/digestStore/lib/card-transaction');

function createFakeTransaction(initialCards) {
  const cards = new Map(initialCards.map((card) => [card._id, { ...card }]));
  const transaction = {
    collection(name) {
      assert.equal(name, 'conclusion_cards');
      return {
        doc(id) {
          return {
            async remove() {
              cards.delete(id);
            },
            async set({ data }) {
              assert.equal(Object.hasOwn(data, '_id'), false);
              cards.set(id, { _id: id, ...data });
            }
          };
        }
      };
    }
  };
  const getDocument = async (_transaction, _collection, id) => cards.get(id) || null;
  return { transaction, getDocument, cards };
}

test('replaces one owned card without changing the total card count', async () => {
  const oldCard = { _id: 'old', ownerKey: 'owner-a' };
  const nextCard = { _id: 'next', ownerKey: 'owner-a' };
  const fake = createFakeTransaction([oldCard]);

  const result = await applyCardMutationInTransaction({
    ...fake,
    ownerKey: 'owner-a',
    replaceCardId: 'old',
    card: nextCard
  });

  assert.deepEqual(result, { replacing: true });
  assert.equal(fake.cards.size, 1);
  assert.equal(fake.cards.has('old'), false);
  assert.deepEqual(fake.cards.get('next'), nextCard);
});

test('checks duplicate and ownership before removing a replacement card', async () => {
  const fake = createFakeTransaction([
    { _id: 'old', ownerKey: 'owner-b' },
    { _id: 'duplicate', ownerKey: 'owner-a' }
  ]);

  await assert.rejects(applyCardMutationInTransaction({
    ...fake,
    ownerKey: 'owner-a',
    replaceCardId: 'old',
    card: { _id: 'new', ownerKey: 'owner-a' }
  }), { code: 'TEMPORARY_FAILURE' });
  assert.equal(fake.cards.has('old'), true);

  await assert.rejects(applyCardMutationInTransaction({
    ...fake,
    ownerKey: 'owner-a',
    replaceCardId: 'old',
    card: { _id: 'duplicate', ownerKey: 'owner-a' }
  }), { code: 'DUPLICATE' });
  assert.equal(fake.cards.has('old'), true);
});
