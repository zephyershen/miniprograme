const crypto = require('node:crypto');
const cloud = require('wx-server-sdk');
const { AppError, ok, fail } = require('./lib/errors');
const { validateTopics, validateDecision, assertCardCapacity } = require('./lib/limits');
const { monthKey, dateKey, toIso } = require('./lib/time');
const { applyCardMutationInTransaction } = require('./lib/card-transaction');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isNotFound(error) {
  return error && (error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || ''));
}

function assertId(id, field) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) {
    throw new AppError('TEMPORARY_FAILURE', `${field} 无效`);
  }
  return id;
}

async function getDocument(collection, id) {
  try {
    return (await db.collection(collection).doc(id).get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function transactionGet(transaction, collection, id) {
  try {
    return (await transaction.collection(collection).doc(id).get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function loadOwned(collection, ownerKey, limit = 100) {
  return (await db.collection(collection).where({ ownerKey }).limit(limit).get()).data || [];
}

async function ensureState(ownerKey) {
  const current = await getDocument('user_state', ownerKey);
  if (current) return current;
  const [queue, cards] = await Promise.all([
    loadOwned('digest_queue', ownerKey),
    loadOwned('conclusion_cards', ownerKey)
  ]);
  const state = {
    ownerKey,
    topics: [],
    pendingCount: queue.length,
    cardCount: cards.length,
    validationStartAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await db.collection('user_state').doc(ownerKey).set({ data: state });
  return state;
}

async function reconcileState(ownerKey, state, queue, cards) {
  if (Number(state.pendingCount || 0) === queue.length && Number(state.cardCount || 0) === cards.length) return state;
  const repaired = { ...state, pendingCount: queue.length, cardCount: cards.length, updatedAt: new Date() };
  await db.collection('user_state').doc(ownerKey).update({
    data: { pendingCount: queue.length, cardCount: cards.length, updatedAt: repaired.updatedAt }
  });
  return repaired;
}

function publicQueueItem(item) {
  return {
    _id: item._id,
    normalizedUrl: item.normalizedUrl,
    sourceTitle: item.sourceTitle,
    sourceHost: item.sourceHost,
    language: item.language,
    processingMode: item.processingMode || 'ai',
    summaryZh: item.summaryZh,
    relevanceLevel: item.relevanceLevel,
    relevanceReasonZh: item.relevanceReasonZh,
    keySentences: item.keySentences,
    candidateConclusion: item.candidateConclusion,
    candidateUseWhen: item.candidateUseWhen,
    createdAt: toIso(item.createdAt)
  };
}

function publicCard(card) {
  return {
    _id: card._id,
    sourceUrl: card.sourceUrl,
    sourceTitle: card.sourceTitle,
    sourceHost: card.sourceHost,
    conclusion: card.conclusion,
    useWhen: card.useWhen,
    createdAt: toIso(card.createdAt)
  };
}

function aggregateStats(dailyStats) {
  return dailyStats.reduce((total, day) => ({
    addedCount: total.addedCount + Number(day.addedCount || 0),
    processedCount: total.processedCount + Number(day.processedCount || 0),
    processedWithin7DaysCount: total.processedWithin7DaysCount + Number(day.processedWithin7DaysCount || 0),
    activeDays: total.activeDays + (day.active ? 1 : 0)
  }), { addedCount: 0, processedCount: 0, processedWithin7DaysCount: 0, activeDays: 0 });
}

async function dashboard(ownerKey) {
  let state = await ensureState(ownerKey);
  const [queue, cards, usage, dailyStats] = await Promise.all([
    loadOwned('digest_queue', ownerKey),
    loadOwned('conclusion_cards', ownerKey),
    getDocument('usage_monthly', `${ownerKey}-${monthKey()}`),
    loadOwned('daily_stats', ownerKey)
  ]);
  queue.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  cards.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  state = await reconcileState(ownerKey, state, queue, cards);

  return {
    queue: queue.map(publicQueueItem),
    cards: cards.map(publicCard),
    preferences: { topics: state.topics || [] },
    usage: usage ? {
      month: usage.month,
      model: usage.model,
      inputTokens: Number(usage.inputTokens || 0),
      outputTokens: Number(usage.outputTokens || 0),
      estimatedCostCny: Number(usage.estimatedCostCny || 0)
    } : {
      month: monthKey(),
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostCny: 0
    },
    stats: aggregateStats(dailyStats),
    validationStartAt: toIso(state.validationStartAt)
  };
}

async function savePreferences(ownerKey, input) {
  const topics = validateTopics(input);
  await ensureState(ownerKey);
  await db.collection('user_state').doc(ownerKey).update({ data: { topics, updatedAt: new Date() } });
  return { topics };
}

async function incrementProcessedDay(transaction, ownerKey, now, withinSevenDays, kept) {
  const day = dateKey(now);
  const id = `${ownerKey}-${day}`;
  const current = await transactionGet(transaction, 'daily_stats', id);
  const increments = {
    processedCount: command.inc(1),
    processedWithin7DaysCount: command.inc(withinSevenDays ? 1 : 0),
    keptCount: command.inc(kept ? 1 : 0),
    discardedCount: command.inc(kept ? 0 : 1),
    active: true,
    updatedAt: now
  };
  if (current) {
    await transaction.collection('daily_stats').doc(id).update({ data: increments });
  } else {
    await transaction.collection('daily_stats').doc(id).set({
      data: {
        ownerKey,
        day,
        addedCount: 0,
        processedCount: 1,
        processedWithin7DaysCount: withinSevenDays ? 1 : 0,
        keptCount: kept ? 1 : 0,
        discardedCount: kept ? 0 : 1,
        active: true,
        createdAt: now,
        updatedAt: now
      }
    });
  }
}

async function resolveItem(ownerKey, event) {
  const itemId = assertId(event.itemId, '内容标识');
  const decision = validateDecision(event.decision);
  const queue = await loadOwned('digest_queue', ownerKey);
  const cards = await loadOwned('conclusion_cards', ownerKey);
  let state = await ensureState(ownerKey);
  state = await reconcileState(ownerKey, state, queue, cards);
  if (decision === 'keep') assertCardCapacity(state.cardCount, event.replaceCardId);
  const replaceCardId = event.replaceCardId ? assertId(event.replaceCardId, '替换卡片标识') : null;
  const now = new Date();

  return db.runTransaction(async (transaction) => {
    const latestState = await transactionGet(transaction, 'user_state', ownerKey);
    const item = await transactionGet(transaction, 'digest_queue', itemId);
    if (!latestState || !item || item.ownerKey !== ownerKey) {
      throw new AppError('TEMPORARY_FAILURE', '这条内容不存在或已经处理');
    }

    const createdAt = new Date(item.createdAt && item.createdAt.$date ? item.createdAt.$date : item.createdAt);
    const withinSevenDays = !Number.isNaN(createdAt.getTime()) && now.getTime() - createdAt.getTime() <= 7 * 24 * 60 * 60 * 1000;

    if (decision === 'discard') {
      await transaction.collection('digest_queue').doc(itemId).remove();
      await transaction.collection('user_state').doc(ownerKey).update({
        data: { pendingCount: command.inc(-1), updatedAt: now }
      });
      await incrementProcessedDay(transaction, ownerKey, now, withinSevenDays, false);
      return { decision, pendingCount: Math.max(0, Number(latestState.pendingCount || 1) - 1) };
    }

    assertCardCapacity(latestState.cardCount, replaceCardId);
    const cardId = hash(`${ownerKey}:card:${item.urlHash}`);
    const card = {
      _id: cardId,
      ownerKey,
      urlHash: item.urlHash,
      sourceUrl: item.normalizedUrl,
      sourceTitle: item.sourceTitle,
      sourceHost: item.sourceHost,
      conclusion: item.candidateConclusion,
      useWhen: item.candidateUseWhen,
      createdAt: now,
      updatedAt: now
    };
    const { replacing } = await applyCardMutationInTransaction({
      transaction,
      getDocument: transactionGet,
      ownerKey,
      replaceCardId,
      card
    });
    await transaction.collection('digest_queue').doc(itemId).remove();
    await transaction.collection('user_state').doc(ownerKey).update({
      data: {
        pendingCount: command.inc(-1),
        cardCount: command.inc(replacing ? 0 : 1),
        updatedAt: now
      }
    });
    await incrementProcessedDay(transaction, ownerKey, now, withinSevenDays, true);
    return {
      decision,
      pendingCount: Math.max(0, Number(latestState.pendingCount || 1) - 1),
      card: publicCard(card)
    };
  });
}

async function deleteCard(ownerKey, cardIdInput) {
  const cardId = assertId(cardIdInput, '结论卡标识');
  await ensureState(ownerKey);
  return db.runTransaction(async (transaction) => {
    const card = await transactionGet(transaction, 'conclusion_cards', cardId);
    if (!card || card.ownerKey !== ownerKey) throw new AppError('TEMPORARY_FAILURE', '这张结论卡不存在');
    const state = await transactionGet(transaction, 'user_state', ownerKey);
    await transaction.collection('conclusion_cards').doc(cardId).remove();
    await transaction.collection('user_state').doc(ownerKey).update({
      data: { cardCount: command.inc(-1), updatedAt: new Date() }
    });
    return { cardCount: Math.max(0, Number((state && state.cardCount) || 1) - 1) };
  });
}

async function purgeMyData(ownerKey) {
  await Promise.all([
    db.collection('digest_queue').where({ ownerKey }).remove(),
    db.collection('conclusion_cards').where({ ownerKey }).remove(),
    db.collection('daily_stats').where({ ownerKey }).remove(),
    db.collection('usage_monthly').where({ ownerKey }).remove()
  ]);
  const state = await getDocument('user_state', ownerKey);
  if (state) await db.collection('user_state').doc(ownerKey).remove();
  return { purged: true };
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) throw new AppError('TEMPORARY_FAILURE', '无法确认当前微信用户');
    const ownerKey = hash(OPENID);

    switch (event.action) {
      case 'dashboard':
        return ok(await dashboard(ownerKey));
      case 'savePreferences':
        return ok(await savePreferences(ownerKey, event.topics));
      case 'resolve':
        return ok(await resolveItem(ownerKey, event));
      case 'deleteCard':
        return ok(await deleteCard(ownerKey, event.cardId));
      case 'purgeMyData':
        return ok(await purgeMyData(ownerKey));
      default:
        throw new AppError('TEMPORARY_FAILURE', '不支持的操作');
    }
  } catch (error) {
    return fail(error);
  }
};
