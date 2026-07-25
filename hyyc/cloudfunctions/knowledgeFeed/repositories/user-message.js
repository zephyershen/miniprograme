const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const { writableDocument } = require('../lib/message-event');
const { moderationApproved } = require('../policies/moderation-policy');
const {
  chunks,
  createCollectionEnsurer,
  isNotFound,
  mapWithConcurrency
} = require('./collection-support');
const { runBusyTransaction } = require('./transaction-support');

const COMMENT_DELIVERY_BATCH_SIZE = 20;
const MARK_ALL_CONCURRENCY = 8;

function assertOwnerKey(ownerKey) {
  if (!/^[a-f0-9]{64}$/.test(ownerKey || '')) throw new Error('MESSAGE_OWNER_INVALID');
  return ownerKey;
}

function messageDocumentId(kind, ...parts) {
  return crypto.createHash('sha256')
    .update([kind, ...parts].map((value) => String(value || '')).join(':'))
    .digest('hex');
}

function timestamp(value) {
  const date = value && typeof value.toDate === 'function' ? value.toDate() : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function serverDate(db, fallback) {
  return typeof db.serverDate === 'function' ? db.serverDate() : fallback;
}

async function documentOrNull(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createUserMessageRepository(db, config) {
  const eventsCollectionName = config.messageEventsCollectionName;
  const messagesCollectionName = config.userMessagesCollectionName;
  const commentsCollectionName = config.commentsCollectionName;
  const ensureEvents = createCollectionEnsurer(db, eventsCollectionName);
  const ensureMessages = createCollectionEnsurer(db, messagesCollectionName);
  const ensureComments = createCollectionEnsurer(db, commentsCollectionName);
  const events = () => db.collection(eventsCollectionName);
  const messages = () => db.collection(messagesCollectionName);

  async function listDueEvents(dueAt, limit = config.messageEventBatchSize) {
    await ensureEvents();
    const size = Math.max(1, Math.min(30, Number(limit) || 12));
    const response = await events()
      .where({
        status: db.command.in(['pending', 'retry']),
        nextAttemptAt: db.command.lte(dueAt)
      })
      .orderBy('nextAttemptAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function listStaleEvents(dueAt, limit = config.messageEventBatchSize) {
    await ensureEvents();
    const size = Math.max(1, Math.min(30, Number(limit) || 12));
    const response = await events()
      .where({
        status: 'processing',
        claimExpiresAt: db.command.lte(dueAt)
      })
      .orderBy('claimExpiresAt', 'asc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function claimEvent(eventId, claimedAt, claimId, claimExpiresAt) {
    await ensureEvents();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(eventsCollectionName).doc(eventId);
      const current = await documentOrNull(reference);
      if (!current) return null;
      const due = ['pending', 'retry'].includes(current.status)
        && timestamp(current.nextAttemptAt) <= timestamp(claimedAt);
      const stale = current.status === 'processing'
        && timestamp(current.claimExpiresAt) <= timestamp(claimedAt);
      if (!due && !stale) return null;
      const patch = {
        status: 'processing',
        attemptCount: (Number(current.attemptCount) || 0) + 1,
        claimId,
        claimedAt,
        claimExpiresAt,
        updatedAt: claimedAt
      };
      await reference.update({ data: patch });
      return { _id: eventId, ...current, ...patch };
    });
  }

  async function transitionEvent(eventId, claimId, patch) {
    await ensureEvents();
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(eventsCollectionName).doc(eventId);
      const current = await documentOrNull(reference);
      if (!current || current.status !== 'processing' || current.claimId !== claimId) return null;
      await reference.update({ data: patch });
      return { _id: eventId, ...current, ...patch };
    });
  }

  async function participantOwnerKeys(
    itemId,
    excludedOwnerKey,
    maximum = config.messageParticipantLimit,
    occurredAt = null
  ) {
    await ensureComments();
    const limit = Math.max(1, Math.min(500, Number(maximum) || 200));
    const scanLimit = Math.max(
      limit,
      Math.min(2000, Number(config.messageParticipantScanLimit) || 1000)
    );
    const cutoff = timestamp(occurredAt);
    const owners = new Set();
    let offset = 0;
    while (owners.size < limit && offset < scanLimit) {
      const pageSize = Math.min(100, scanLimit - offset);
      const filters = {
        itemId,
        status: 'active',
        ...(cutoff ? { createdAt: db.command.lte(new Date(cutoff)) } : {})
      };
      const response = await db.collection(commentsCollectionName)
        .where(filters)
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .skip(offset)
        .limit(pageSize)
        .get();
      const documents = (response && response.data) || [];
      documents.forEach((comment) => {
        if (comment
          && /^[a-f0-9]{64}$/.test(comment.authorKey || '')
          && comment.authorKey !== excludedOwnerKey
          && moderationApproved(comment.moderation)) {
          owners.add(comment.authorKey);
        }
      });
      if (documents.length < pageSize) break;
      offset += documents.length;
    }
    return [...owners].slice(0, limit);
  }

  async function upsertDirectMessage(ownerKey, event, message, createdAt) {
    await ensureMessages();
    const safeOwnerKey = assertOwnerKey(ownerKey);
    const id = messageDocumentId('event', event._id, safeOwnerKey);
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(messagesCollectionName).doc(id);
      const current = await documentOrNull(reference);
      if (current) return { _id: id, ...current };
      const eventDate = event.createdAt && typeof event.createdAt.toDate === 'function'
        ? event.createdAt.toDate()
        : new Date(event.createdAt || createdAt);
      const occurredAt = Number.isFinite(eventDate.getTime()) ? eventDate : createdAt;
      const document = {
        _id: id,
        ownerKey: safeOwnerKey,
        type: message.type,
        category: message.category,
        title: message.title,
        body: message.body,
        itemId: message.itemId || '',
        itemTitle: event.itemTitle || '',
        itemThumbnailFileId: event.itemThumbnailFileId || '',
        commentId: event.commentId || '',
        parentCommentId: event.parentCommentId || '',
        replyToCommentId: event.replyToCommentId || '',
        commentPreview: event.commentPreview || '',
        replyToPreview: event.replyToPreview || '',
        rootCommentPreview: event.rootCommentPreview || '',
        actorNickname: event.actorNickname || '',
        actorAvatarFileId: event.actorAvatarFileId || '',
        sourceEventId: event._id,
        unread: true,
        deliveredAt: serverDate(db, createdAt),
        createdAt: occurredAt,
        updatedAt: occurredAt
      };
      await reference.set({ data: writableDocument(document) });
      return document;
    });
  }

  async function upsertCommentThreadMessages(ownerKeys, event, createdAt) {
    await Promise.all([ensureEvents(), ensureMessages()]);
    const safeOwnerKeys = [...new Set((ownerKeys || []).map(assertOwnerKey))];
    const results = [];
    for (const ownerBatch of chunks(safeOwnerKeys, COMMENT_DELIVERY_BATCH_SIZE)) {
      const batchResults = await runBusyTransaction(db, async (transaction) => {
        const eventReference = transaction.collection(eventsCollectionName).doc(event._id);
        const currentEvent = await documentOrNull(eventReference);
        if (!currentEvent
          || currentEvent.status !== 'processing'
          || currentEvent.claimId !== event.claimId) {
          return [];
        }
        const deliveredOwnerKeys = [...new Set(
          Array.isArray(currentEvent.deliveredOwnerKeys)
            ? currentEvent.deliveredOwnerKeys.filter((ownerKey) => (
                /^[a-f0-9]{64}$/.test(ownerKey || '')
              ))
            : []
        )];
        const delivered = new Set(deliveredOwnerKeys);
        const pendingOwnerKeys = ownerBatch.filter((ownerKey) => !delivered.has(ownerKey));
        const written = [];
        for (const safeOwnerKey of pendingOwnerKeys) {
          const id = messageDocumentId('comment-interaction', safeOwnerKey, event._id);
          const reference = transaction.collection(messagesCollectionName).doc(id);
          const current = await documentOrNull(reference);
          const eventDate = event.createdAt && typeof event.createdAt.toDate === 'function'
            ? event.createdAt.toDate()
            : new Date(event.createdAt || createdAt);
          const occurredAt = Number.isFinite(eventDate.getTime()) ? eventDate : createdAt;
          const displayAt = current
            ? new Date(Math.max(timestamp(current.createdAt), timestamp(occurredAt)))
            : occurredAt;
          const document = {
            _id: id,
            ownerKey: safeOwnerKey,
            type: 'comment_received',
            category: 'comments',
            title: event.replyToCommentId
              ? `${event.actorNickname || '一位读者'}回复了评论`
              : `${event.actorNickname || '一位读者'}参与了讨论`,
            body: event.commentPreview || (
              event.itemTitle
                ? `《${String(event.itemTitle).slice(0, 48)}》出现了新的讨论`
                : '你参与过的资讯出现了新的讨论'
            ),
            itemId: event.itemId,
            itemTitle: event.itemTitle || '',
            itemThumbnailFileId: event.itemThumbnailFileId || '',
            commentId: event.commentId || '',
            parentCommentId: event.parentCommentId || '',
            replyToCommentId: event.replyToCommentId || '',
            commentPreview: event.commentPreview || '',
            replyToPreview: event.replyToPreview || '',
            rootCommentPreview: event.rootCommentPreview || '',
            actorNickname: event.actorNickname || '读者',
            actorAvatarFileId: event.actorAvatarFileId || '',
            sourceEventId: event._id,
            lastEventId: event._id,
            lastEventAt: occurredAt,
            unread: true,
            deliveredAt: serverDate(db, createdAt),
            createdAt: displayAt,
            updatedAt: occurredAt
          };
          await reference.set({ data: writableDocument(document) });
          delivered.add(safeOwnerKey);
          written.push(document);
        }
        if (pendingOwnerKeys.length) {
          await eventReference.update({
            data: {
              deliveredOwnerKeys: [...delivered],
              updatedAt: createdAt
            }
          });
        }
        return written;
      });
      results.push(...batchResults);
    }
    return results;
  }

  async function upsertCommentThreadMessage(ownerKey, event, createdAt) {
    const safeOwnerKey = assertOwnerKey(ownerKey);
    const [written] = await upsertCommentThreadMessages([safeOwnerKey], event, createdAt);
    if (written) return written;
    await ensureMessages();
    const id = messageDocumentId('comment-interaction', safeOwnerKey, event._id);
    const current = await documentOrNull(messages().doc(id));
    return current ? { _id: id, ...current } : null;
  }

  async function listOwnerMessages(ownerKey, limit = config.userMessagePageSize) {
    await ensureMessages();
    const size = Math.max(1, Math.min(100, Number(limit) || 50));
    const response = await messages()
      .where({ ownerKey: assertOwnerKey(ownerKey) })
      .orderBy('createdAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function unreadCount(ownerKey) {
    await ensureMessages();
    const query = messages().where({ ownerKey: assertOwnerKey(ownerKey), unread: true });
    if (typeof query.count === 'function') {
      const result = await query.count();
      return Math.max(0, Number(result && result.total) || 0);
    }
    const response = await query.limit(100).get();
    return ((response && response.data) || []).length;
  }

  async function markRead(ownerKey, messageId, expectedVersion, updatedAt) {
    await ensureMessages();
    const safeOwnerKey = assertOwnerKey(ownerKey);
    return runBusyTransaction(db, async (transaction) => {
      const reference = transaction.collection(messagesCollectionName).doc(messageId);
      const current = await documentOrNull(reference);
      if (!current || current.ownerKey !== safeOwnerKey) {
        throw new AppError('MESSAGE_NOT_FOUND', '这条消息不存在');
      }
      if (current.sourceEventId && current.sourceEventId !== expectedVersion) {
        return { _id: messageId, ...current };
      }
      if (current.unread !== true) return { _id: messageId, ...current };
      const patch = { unread: false, readAt: updatedAt, updatedAt };
      await reference.update({ data: patch });
      return { _id: messageId, ...current, ...patch };
    });
  }

  async function markAllRead(ownerKey, readThroughAt) {
    await ensureMessages();
    const safeOwnerKey = assertOwnerKey(ownerKey);
    const startedAt = Date.now();
    const budgetMs = Math.max(
      1000,
      Math.min(20000, Number(config.userMessageMarkAllBudgetMs) || 15000)
    );
    let changed = 0;
    let noProgressBatches = 0;
    while (true) {
      if (Date.now() - startedAt >= budgetMs) break;
      const response = await messages()
        .where({
          ownerKey: safeOwnerKey,
          unread: true,
          deliveredAt: db.command.lt(readThroughAt)
        })
        .limit(100)
        .get();
      const documents = (response && response.data) || [];
      if (!documents.length) break;
      const results = await mapWithConcurrency(
        documents,
        MARK_ALL_CONCURRENCY,
        (message) => (
        runBusyTransaction(db, async (transaction) => {
          const reference = transaction.collection(messagesCollectionName).doc(message._id);
          const current = await documentOrNull(reference);
          if (!current
            || current.ownerKey !== safeOwnerKey
            || current.unread !== true
            || current.sourceEventId !== message.sourceEventId
            || timestamp(current.deliveredAt) >= timestamp(readThroughAt)) {
            return false;
          }
          await reference.update({
            data: { unread: false, readAt: readThroughAt, updatedAt: readThroughAt }
          });
          return true;
        })
        )
      );
      const batchChanged = results.filter(Boolean).length;
      changed += batchChanged;
      noProgressBatches = batchChanged ? 0 : noProgressBatches + 1;
      if (noProgressBatches >= 3) break;
    }
    return changed;
  }

  return {
    listDueEvents,
    listStaleEvents,
    claimEvent,
    markEventDone: transitionEvent,
    markEventRetry: transitionEvent,
    participantOwnerKeys,
    upsertDirectMessage,
    upsertCommentThreadMessages,
    upsertCommentThreadMessage,
    listOwnerMessages,
    unreadCount,
    markRead,
    markAllRead
  };
}

module.exports = { messageDocumentId, createUserMessageRepository };
