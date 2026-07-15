const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
const { AppError, ok, fail } = require('./lib/errors');
const { normalizePublicHttpsUrl, fetchPublicPage } = require('./lib/url-security');
const { extractArticle } = require('./lib/extract');
const { buildMessages, validateAiOutput } = require('./lib/ai-output');
const { buildFallbackDigest } = require('./lib/fallback');
const { monthKey, dateKey, normalizeUsage, estimateCostCny, assertBudget } = require('./lib/cost');
const { assertQueueCapacity } = require('./lib/limits');
const { hash, digestIds } = require('./lib/identity');

const ENV_ID = 'hyyc-1gi3f5sqc5becabf';
const AI_PROVIDER = process.env.AI_PROVIDER || 'hunyuan-v3';
const MODEL = process.env.AI_MODEL || 'hy3-preview';
const ALLOWED_TOPICS = new Set(['dev_efficiency', 'daily_life', 'english_reading', 'side_project', 'learning_growth']);

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;
const aiApp = tcb.init({ env: ENV_ID, timeout: 60000 });

function isNotFound(error) {
  return error && (error.errCode === -1 || /not exist|not found|DOCUMENT_NOT_FOUND/i.test(error.message || ''));
}

async function getDocument(collection, id) {
  try {
    return (await db.collection(collection).doc(id).get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function ensureState(ownerKey) {
  const current = await getDocument('user_state', ownerKey);
  if (current) return current;
  const [queue, cards] = await Promise.all([
    db.collection('digest_queue').where({ ownerKey }).count(),
    db.collection('conclusion_cards').where({ ownerKey }).count()
  ]);
  const state = {
    ownerKey,
    topics: [],
    pendingCount: queue.total,
    cardCount: cards.total,
    validationStartAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await db.collection('user_state').doc(ownerKey).set({ data: state });
  return state;
}

async function getUsage(ownerKey, month) {
  return getDocument('usage_monthly', `${ownerKey}-${month}`);
}

async function reserveBudget(ownerKey, model) {
  const month = monthKey();
  const id = `${ownerKey}-${month}`;
  const now = new Date();
  const reservedCostCny = await db.runTransaction(async (transaction) => {
    const current = await transactionGet(transaction, 'usage_monthly', id);
    const alreadyReserved = Number((current && current.reservedCostCny) || 0);
    const reserve = assertBudget(Number((current && current.estimatedCostCny) || 0) + alreadyReserved, model);
    if (current) {
      await transaction.collection('usage_monthly').doc(id).update({
        data: {
          reservedCostCny: Number((alreadyReserved + reserve).toFixed(6)),
          model,
          updatedAt: now
        }
      });
    } else {
      await transaction.collection('usage_monthly').doc(id).set({
        data: {
          ownerKey,
          month,
          model,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostCny: 0,
          reservedCostCny: reserve,
          createdAt: now,
          updatedAt: now
        }
      });
    }
    return reserve;
  });
  return { id, ownerKey, month, model, reservedCostCny };
}

async function settleBudget(reservation, usage) {
  const cost = estimateCostCny(reservation.model, usage);
  await db.runTransaction(async (transaction) => {
    const current = await transactionGet(transaction, 'usage_monthly', reservation.id);
    if (!current) throw new AppError('TEMPORARY_FAILURE', 'AI 用量记录不存在，已停止处理');
    await transaction.collection('usage_monthly').doc(reservation.id).update({
      data: {
        inputTokens: command.inc(usage.inputTokens),
        outputTokens: command.inc(usage.outputTokens),
        estimatedCostCny: command.inc(cost),
        reservedCostCny: Math.max(0, Number((Number(current.reservedCostCny || 0) - reservation.reservedCostCny).toFixed(6))),
        model: reservation.model,
        updatedAt: new Date()
      }
    });
  });
  return cost;
}

async function releaseBudget(reservation) {
  await db.runTransaction(async (transaction) => {
    const current = await transactionGet(transaction, 'usage_monthly', reservation.id);
    if (!current) return;
    await transaction.collection('usage_monthly').doc(reservation.id).update({
      data: {
        reservedCostCny: Math.max(0, Number((Number(current.reservedCostCny || 0) - reservation.reservedCostCny).toFixed(6))),
        updatedAt: new Date()
      }
    });
  });
}

async function transactionGet(transaction, collection, id) {
  try {
    return (await transaction.collection(collection).doc(id).get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function incrementDailyAdded(transaction, ownerKey, now) {
  const day = dateKey(now);
  const id = `${ownerKey}-${day}`;
  const current = await transactionGet(transaction, 'daily_stats', id);
  if (current) {
    await transaction.collection('daily_stats').doc(id).update({
      data: { addedCount: command.inc(1), active: true, updatedAt: now }
    });
  } else {
    await transaction.collection('daily_stats').doc(id).set({
      data: {
        ownerKey,
        day,
        addedCount: 1,
        processedCount: 0,
        processedWithin7DaysCount: 0,
        keptCount: 0,
        discardedCount: 0,
        active: true,
        createdAt: now,
        updatedAt: now
      }
    });
  }
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) throw new AppError('TEMPORARY_FAILURE', '无法确认当前微信用户');
    const ownerKey = hash(OPENID);
    const normalizedUrl = normalizePublicHttpsUrl(event.url);
    let { urlHash, queueId, cardId } = digestIds(ownerKey, normalizedUrl);
    const requestId = typeof event.requestId === 'string' ? event.requestId.slice(0, 80) : '';

    const state = await ensureState(ownerKey);
    const topics = (state.topics || []).filter((topic) => ALLOWED_TOPICS.has(topic)).slice(0, 3);
    if (!topics.length) throw new AppError('TEMPORARY_FAILURE', '请先选择至少一个关注方向');
    assertQueueCapacity(state.pendingCount);

    const [existingQueue, existingCard, usage] = await Promise.all([
      getDocument('digest_queue', queueId),
      getDocument('conclusion_cards', cardId),
      getUsage(ownerKey, monthKey())
    ]);
    if (existingQueue || existingCard) throw new AppError('DUPLICATE', '这个链接已经在消化箱或结论卡中');
    assertBudget(Number((usage && usage.estimatedCostCny) || 0) + Number((usage && usage.reservedCostCny) || 0), MODEL);

    const page = await fetchPublicPage(normalizedUrl);
    const finalUrl = normalizePublicHttpsUrl(page.finalUrl);
    const finalUrlHash = hash(finalUrl);
    if (finalUrlHash !== urlHash) {
      ({ urlHash, queueId, cardId } = digestIds(ownerKey, finalUrl));
      const [redirectQueue, redirectCard] = await Promise.all([
        getDocument('digest_queue', queueId),
        getDocument('conclusion_cards', cardId)
      ]);
      if (redirectQueue || redirectCard) throw new AppError('DUPLICATE', '跳转后的文章已经在消化箱或结论卡中');
    }
    const article = extractArticle(page.html, finalUrl);
    const messages = buildMessages({ ...article, topics });
    const model = aiApp.ai().createModel(AI_PROVIDER);
    const reservation = await reserveBudget(ownerKey, MODEL);
    let result;
    let digest;
    let processingMode = 'ai';
    try {
      result = await model.generateText({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 1000,
        messages
      });
    } catch (error) {
      try {
        await releaseBudget(reservation);
      } catch (releaseError) {
        console.error('Failed to release AI budget reservation', releaseError);
      }
      console.warn('CloudBase AI unavailable; using local fallback', {
        code: error && error.code,
        requestId: error && error.requestId
      });
      processingMode = 'local_fallback';
      digest = buildFallbackDigest(article);
    }

    if (result) {
      const usageResult = normalizeUsage(result.usage, {
        inputTokens: 16000,
        outputTokens: 1000
      });
      await settleBudget(reservation, usageResult);
      try {
        digest = validateAiOutput(result.text, article.language);
      } catch (error) {
        console.warn('CloudBase AI returned an unusable digest; using local fallback', {
          code: error && error.code
        });
        processingMode = 'local_fallback';
        digest = buildFallbackDigest(article);
      }
    }
    const now = new Date();
    const sourceHost = new URL(finalUrl).hostname.replace(/^www\./, '');

    const item = {
      _id: queueId,
      ownerKey,
      requestId,
      normalizedUrl: finalUrl,
      urlHash,
      sourceTitle: article.title,
      sourceHost,
      language: article.language,
      processingMode,
      ...digest,
      createdAt: now,
      updatedAt: now
    };

    await db.runTransaction(async (transaction) => {
      const latestState = await transactionGet(transaction, 'user_state', ownerKey);
      const queueDoc = await transactionGet(transaction, 'digest_queue', queueId);
      const cardDoc = await transactionGet(transaction, 'conclusion_cards', cardId);
      if (!latestState) throw new AppError('TEMPORARY_FAILURE', '用户状态不存在，请重试');
      if (queueDoc || cardDoc) throw new AppError('DUPLICATE', '这个链接已经处理过了');
      assertQueueCapacity(latestState.pendingCount);

      const { _id: itemId, ...itemData } = item;
      await transaction.collection('digest_queue').doc(itemId).set({ data: itemData });
      const stateUpdate = {
        pendingCount: command.inc(1),
        updatedAt: now
      };
      if (!latestState.validationStartAt) stateUpdate.validationStartAt = now;
      await transaction.collection('user_state').doc(ownerKey).update({ data: stateUpdate });
      await incrementDailyAdded(transaction, ownerKey, now);
    });

    const publicItem = { ...item };
    delete publicItem.ownerKey;
    delete publicItem.urlHash;
    delete publicItem.requestId;
    return ok({ item: publicItem, pendingCount: Number(state.pendingCount || 0) + 1 });
  } catch (error) {
    return fail(error);
  }
};
