const { AppError } = require('./errors');

async function applyCardMutationInTransaction({
  transaction,
  getDocument,
  ownerKey,
  replaceCardId,
  card
}) {
  const existingCard = await getDocument(transaction, 'conclusion_cards', card._id);
  if (existingCard) throw new AppError('DUPLICATE', '这篇文章已经留下过结论卡');

  let replacing = false;
  if (replaceCardId) {
    const oldCard = await getDocument(transaction, 'conclusion_cards', replaceCardId);
    if (!oldCard || oldCard.ownerKey !== ownerKey) {
      throw new AppError('TEMPORARY_FAILURE', '要替换的结论卡不存在');
    }
    await transaction.collection('conclusion_cards').doc(replaceCardId).remove();
    replacing = true;
  }

  await transaction.collection('conclusion_cards').doc(card._id).set({ data: card });
  return { replacing };
}

module.exports = {
  applyCardMutationInTransaction
};
