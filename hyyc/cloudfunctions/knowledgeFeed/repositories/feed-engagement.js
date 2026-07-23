const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const { storedDocumentId } = require('../lib/stored-feed-item');
const { moderationApproved } = require('../policies/moderation-policy');
const {
  chunks,
  createCollectionEnsurer,
  isNotFound
} = require('./collection-support');
const {
  isTransactionBusy,
  runBusyTransaction
} = require('./transaction-support');

function assertOwnerKey(ownerKey) {
  if (!/^[a-f0-9]{64}$/.test(ownerKey || '')) throw new Error('ENGAGEMENT_OWNER_INVALID');
  return ownerKey;
}

function assertItemId(itemId) {
  if (!/^[a-z0-9_-]{8,80}$/i.test(itemId || '')) {
    throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
  }
  return itemId;
}

function engagementDocumentId(ownerKey, itemId) {
  return crypto.createHash('sha256')
    .update(`${assertOwnerKey(ownerKey)}:${assertItemId(itemId)}`)
    .digest('hex');
}

function commentDocumentId(ownerKey, itemId, mutationId) {
  return crypto.createHash('sha256')
    .update(`${assertOwnerKey(ownerKey)}:${assertItemId(itemId)}:${mutationId}`)
    .digest('hex');
}

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function publiclyVisibleComment(document) {
  return Boolean(document && document.status === 'active'
    && moderationApproved(document.moderation));
}

function writableDocument(document) {
  const writable = { ...(document || {}) };
  delete writable._id;
  return writable;
}

async function documentOrNull(reference) {
  try {
    return (await reference.get()).data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function createFeedEngagementRepository(db, config) {
  const engagements = () => db.collection(config.userEngagementsCollectionName);
  const comments = () => db.collection(config.commentsCollectionName);
  const ensureEngagements = createCollectionEnsurer(db, config.userEngagementsCollectionName);
  const ensureComments = createCollectionEnsurer(db, config.commentsCollectionName);

  async function getMany(ownerKey, itemIds) {
    await ensureEngagements();
    const ids = [...new Set((itemIds || []).filter(Boolean))]
      .map((itemId) => engagementDocumentId(ownerKey, itemId));
    const documents = [];
    for (const batch of chunks(ids, 50)) {
      if (!batch.length) continue;
      const response = await engagements()
        .where({ _id: db.command.in(batch) })
        .limit(batch.length)
        .get();
      documents.push(...((response && response.data) || []));
    }
    return documents;
  }

  async function setLike(ownerKey, item, updatedAt, desiredLiked) {
    await Promise.all([ensureEngagements(), config.ensureItems ? config.ensureItems() : null]);
    const itemId = assertItemId(item && item.id);
    return runBusyTransaction(db, async (transaction) => {
      const engagementReference = transaction.collection(config.userEngagementsCollectionName)
        .doc(engagementDocumentId(ownerKey, itemId));
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, itemId));
      // CloudBase transactions are more reliable when reads happen in a stable sequence.
      const currentEngagement = await documentOrNull(engagementReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      const wasLiked = Boolean(currentEngagement && currentEngagement.liked);
      const liked = typeof desiredLiked === 'boolean' ? desiredLiked : !wasLiked;
      const likeCount = Math.max(0, count(currentItem.likeCount) + (liked === wasLiked ? 0 : (liked ? 1 : -1)));
      const baseScore = Number.isFinite(Number(currentItem.baseScore))
        ? Number(currentItem.baseScore)
        : Math.max(0, (Number(currentItem.score) || 0) - count(currentItem.likeCount));
      await engagementReference.set({
        data: {
          ...writableDocument(currentEngagement),
          ownerKey: assertOwnerKey(ownerKey),
          itemId,
          liked,
          likedAt: liked ? (currentEngagement && currentEngagement.likedAt || updatedAt) : null,
          createdAt: currentEngagement && currentEngagement.createdAt || updatedAt,
          updatedAt
        }
      });
      if (liked !== wasLiked) {
        await itemReference.update({
          data: { baseScore, likeCount, score: baseScore + likeCount, engagementUpdatedAt: updatedAt }
        });
      }
      return {
        liked,
        favorited: Boolean(currentEngagement && currentEngagement.favorited),
        likeCount,
        commentCount: count(currentItem.commentCount),
        favoriteCount: count(currentItem.favoriteCount)
      };
    });
  }

  async function setFavorite(ownerKey, item, updatedAt, desiredFavorited) {
    await Promise.all([ensureEngagements(), config.ensureItems ? config.ensureItems() : null]);
    const itemId = assertItemId(item && item.id);
    return runBusyTransaction(db, async (transaction) => {
      const engagementReference = transaction.collection(config.userEngagementsCollectionName)
        .doc(engagementDocumentId(ownerKey, itemId));
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, itemId));
      const currentEngagement = await documentOrNull(engagementReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      const wasFavorited = Boolean(currentEngagement && currentEngagement.favorited);
      const favorited = typeof desiredFavorited === 'boolean' ? desiredFavorited : !wasFavorited;
      const favoriteCount = Math.max(0, count(currentItem.favoriteCount)
        + (favorited === wasFavorited ? 0 : (favorited ? 1 : -1)));
      const snapshot = favorited
        ? {
            title: item.title || '',
            source: item.source || '',
            publishedAt: item.publishedAt || null,
            categoryLabel: item.categoryLabel || '',
            listVisualFileId: item.listVisualFileId || ''
          }
        : (currentEngagement && currentEngagement.snapshot || {});
      await engagementReference.set({
        data: {
          ...writableDocument(currentEngagement),
          ownerKey: assertOwnerKey(ownerKey),
          itemId,
          liked: Boolean(currentEngagement && currentEngagement.liked),
          favorited,
          favoritedAt: favorited ? (currentEngagement && currentEngagement.favoritedAt || updatedAt) : null,
          snapshot,
          createdAt: currentEngagement && currentEngagement.createdAt || updatedAt,
          updatedAt
        }
      });
      if (favorited !== wasFavorited) {
        await itemReference.update({ data: { favoriteCount, engagementUpdatedAt: updatedAt } });
      }
      return {
        liked: Boolean(currentEngagement && currentEngagement.liked),
        favorited,
        likeCount: count(currentItem.likeCount),
        commentCount: count(currentItem.commentCount),
        favoriteCount
      };
    });
  }

  async function listFavorites(ownerKey, limit = config.favoriteListLimit) {
    await ensureEngagements();
    const size = Math.max(1, Math.min(100, Number(limit) || 100));
    const response = await engagements()
      .where({
        ownerKey: assertOwnerKey(ownerKey),
        favorited: true
      })
      .orderBy('favoritedAt', 'desc')
      .limit(size)
      .get();
    return (response && response.data) || [];
  }

  async function listComments(itemId, limit = config.commentPageSize) {
    await ensureComments();
    const size = Math.max(1, Math.min(50, Number(limit) || 30));
    const safeItemId = assertItemId(itemId);
    const visible = [];
    const batchSize = 100;
    let offset = 0;
    while (visible.length < size) {
      const response = await comments()
        .where({ itemId: safeItemId, status: 'active' })
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .skip(offset)
        .limit(batchSize)
        .get();
      const documents = (response && response.data) || [];
      visible.push(...documents.filter(publiclyVisibleComment));
      if (documents.length < batchSize) break;
      offset += documents.length;
    }
    return visible.slice(0, size);
  }

  async function getComment(commentId, itemId) {
    await Promise.all([ensureComments(), config.ensureItems ? config.ensureItems() : null]);
    const [comment, item] = await Promise.all([
      documentOrNull(comments().doc(commentId)),
      documentOrNull(
        db.collection(config.itemsCollectionName).doc(storedDocumentId(
          config.provider,
          assertItemId(itemId)
        ))
      )
    ]);
    if (!comment || comment.itemId !== itemId) return null;
    return {
      comment: { _id: commentId, ...comment },
      commentCount: count(item && item.commentCount)
    };
  }

  async function findByAttachmentFileIds(fileIds) {
    await ensureComments();
    const requested = [...new Set(
      (Array.isArray(fileIds) ? fileIds : [])
        .filter((fileId) => typeof fileId === 'string' && fileId.length <= 700)
    )];
    const matches = [];
    for (const batch of chunks(requested, 20)) {
      if (!batch.length) continue;
      const response = await comments()
        .where({
          attachments: db.command.elemMatch({
            type: 'image',
            fileId: db.command.in(batch)
          })
        })
        .limit(100)
        .get();
      matches.push(...((response && response.data) || []));
    }
    return matches;
  }

  async function addComment(ownerKey, itemId, input, createdAt, commentId) {
    await Promise.all([ensureComments(), config.ensureItems ? config.ensureItems() : null]);
    return runBusyTransaction(db, async (transaction) => {
      const safeItemId = assertItemId(itemId);
      const commentReference = transaction.collection(config.commentsCollectionName).doc(commentId);
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, safeItemId));
      const existingComment = await documentOrNull(commentReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      if (existingComment) {
        return { comment: { _id: commentId, ...existingComment }, commentCount: count(currentItem.commentCount) };
      }
      const commentCount = count(currentItem.commentCount) + 1;
      const comment = {
        _id: commentId,
        itemId: safeItemId,
        authorKey: assertOwnerKey(ownerKey),
        content: input.content,
        attachments: input.attachments,
        moderation: input.moderation,
        status: 'active',
        createdAt,
        updatedAt: createdAt
      };
      await commentReference.set({ data: writableDocument(comment) });
      await itemReference.update({ data: { commentCount, engagementUpdatedAt: createdAt } });
      return { comment, commentCount };
    });
  }

  return {
    getMany,
    toggleLike: setLike,
    toggleFavorite: setFavorite,
    listFavorites,
    listComments,
    getComment,
    findByAttachmentFileIds,
    addComment
  };
}

module.exports = {
  engagementDocumentId,
  commentDocumentId,
  publiclyVisibleComment,
  isTransactionBusy,
  runBusyTransaction,
  createFeedEngagementRepository
};
