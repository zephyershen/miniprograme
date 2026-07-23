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

function assertCommentId(commentId) {
  if (!/^[a-z0-9_-]{8,128}$/i.test(commentId || '')) {
    throw new AppError('COMMENT_NOT_FOUND', '这条评论不存在或已不可见');
  }
  return commentId;
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

function newestComments(comments) {
  return [...comments].sort((left, right) => {
    const timeDifference = new Date(right && right.createdAt).getTime()
      - new Date(left && left.createdAt).getTime();
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
    return String(right && (right._id || right.id) || '')
      .localeCompare(String(left && (left._id || left.id) || ''));
  });
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

  async function listComments(itemId, limit = config.commentPageSize, access = {}) {
    await ensureComments();
    const size = Math.max(1, Math.min(50, Number(limit) || 30));
    const safeItemId = assertItemId(itemId);
    const batchSize = 100;
    async function listStatus(
      status,
      accept,
      scanLimit = Number.MAX_SAFE_INTEGER,
      exactFilters = {}
    ) {
      const accepted = [];
      let offset = 0;
      while (accepted.length < size && offset < scanLimit) {
        const response = await comments()
          .where({ itemId: safeItemId, status, ...exactFilters })
          .orderBy('createdAt', 'desc')
          .orderBy('_id', 'desc')
          .skip(offset)
          .limit(Math.min(batchSize, scanLimit - offset))
          .get();
        const documents = (response && response.data) || [];
        accepted.push(...documents.filter(accept));
        if (documents.length < batchSize) break;
        offset += documents.length;
      }
      return accepted.slice(0, size);
    }
    const ownerKey = /^[a-f0-9]{64}$/.test(access.ownerKey || '')
      ? access.ownerKey
      : '';
    const isAdmin = access.isAdmin === true;
    const visible = access.includeActive === false
      ? []
      : await listStatus('active', publiclyVisibleComment);
    if (!ownerKey && !isAdmin) return visible;
    const canReadPrivate = (comment) => moderationApproved(comment && comment.moderation);
    const scanLimit = Math.max(
      batchSize,
      Math.min(2000, Number(config.commentGovernanceScanLimit) || 500)
    );
    const privateScanLimit = isAdmin ? scanLimit : Number.MAX_SAFE_INTEGER;
    const exactAuthorFilter = isAdmin ? {} : { authorKey: ownerKey };
    const privateComments = newestComments([
      ...await listStatus('hidden', canReadPrivate, privateScanLimit, exactAuthorFilter),
      ...await listStatus('appealed', canReadPrivate, privateScanLimit, exactAuthorFilter)
    ]).slice(0, size);
    const privateIds = new Set(privateComments.map((comment) => comment._id));
    const remaining = Math.max(0, size - privateComments.length);
    return newestComments([
      ...privateComments,
      ...visible.filter((comment) => !privateIds.has(comment._id)).slice(0, remaining)
    ]);
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

  async function deleteComment(ownerKey, itemId, commentId, deletedAt, isAdmin = false) {
    await Promise.all([ensureComments(), config.ensureItems ? config.ensureItems() : null]);
    return runBusyTransaction(db, async (transaction) => {
      const safeItemId = assertItemId(itemId);
      const safeCommentId = assertCommentId(commentId);
      const commentReference = transaction.collection(config.commentsCollectionName)
        .doc(safeCommentId);
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, safeItemId));
      const currentComment = await documentOrNull(commentReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentComment || currentComment.itemId !== safeItemId) {
        throw new AppError('COMMENT_NOT_FOUND', '这条评论不存在或已不可见');
      }
      if (currentComment.authorKey !== assertOwnerKey(ownerKey) && isAdmin !== true) {
        throw new AppError('FORBIDDEN', '你不能删除这条评论');
      }
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      const wasVisible = publiclyVisibleComment(currentComment);
      const commentCount = Math.max(0, count(currentItem.commentCount) - (wasVisible ? 1 : 0));
      const comment = currentComment.status === 'deleted'
        ? currentComment
        : {
            ...currentComment,
            status: 'deleted',
            deletedAt,
            deletedByRole: currentComment.authorKey === ownerKey ? 'author' : 'admin',
            updatedAt: deletedAt
          };
      if (currentComment.status !== 'deleted') {
        await commentReference.update({
          data: {
            status: comment.status,
            deletedAt: comment.deletedAt,
            deletedByRole: comment.deletedByRole,
            updatedAt: comment.updatedAt
          }
        });
      }
      if (wasVisible) {
        await itemReference.update({
          data: { commentCount, engagementUpdatedAt: deletedAt }
        });
      }
      return { comment: { _id: safeCommentId, ...comment }, commentCount, deleted: true };
    });
  }

  async function reportComment(
    ownerKey,
    itemId,
    commentId,
    reportedAt,
    threshold = config.commentReportThreshold,
    maximum = config.commentReportLimitPerItem
  ) {
    await Promise.all([
      ensureEngagements(),
      ensureComments(),
      config.ensureItems ? config.ensureItems() : null
    ]);
    return runBusyTransaction(db, async (transaction) => {
      const safeOwnerKey = assertOwnerKey(ownerKey);
      const safeItemId = assertItemId(itemId);
      const safeCommentId = assertCommentId(commentId);
      const engagementReference = transaction.collection(config.userEngagementsCollectionName)
        .doc(engagementDocumentId(safeOwnerKey, safeItemId));
      const commentReference = transaction.collection(config.commentsCollectionName)
        .doc(safeCommentId);
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, safeItemId));
      const currentEngagement = await documentOrNull(engagementReference);
      const currentComment = await documentOrNull(commentReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentComment || currentComment.itemId !== safeItemId) {
        throw new AppError('COMMENT_NOT_FOUND', '这条评论不存在或已不可见');
      }
      if (currentComment.authorKey === safeOwnerKey) {
        throw new AppError('INVALID_REQUEST', '不能举报自己的评论');
      }
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      const reportedCommentIds = [...new Set(
        Array.isArray(currentEngagement && currentEngagement.reportedCommentIds)
          ? currentEngagement.reportedCommentIds.filter((id) => typeof id === 'string')
          : []
      )];
      if (reportedCommentIds.includes(safeCommentId)) {
        return {
          reported: true,
          hidden: !publiclyVisibleComment(currentComment),
          commentCount: count(currentItem.commentCount)
        };
      }
      const safeMaximum = Math.max(1, Math.min(1000, Math.floor(Number(maximum) || 100)));
      if (reportedCommentIds.length >= safeMaximum) {
        throw new AppError(
          'REPORT_LIMIT_REACHED',
          '你在这条资讯下的举报次数已达上限'
        );
      }
      if (!publiclyVisibleComment(currentComment)) {
        throw new AppError('COMMENT_NOT_FOUND', '这条评论不存在或已不可见');
      }
      reportedCommentIds.push(safeCommentId);
      const reportCount = count(currentComment.reportCount) + 1;
      const safeThreshold = Math.max(1, Math.floor(Number(threshold) || 3));
      const hidden = reportCount >= safeThreshold;
      const commentCount = Math.max(
        0,
        count(currentItem.commentCount) - (hidden ? 1 : 0)
      );
      await engagementReference.set({
        data: {
          ...writableDocument(currentEngagement),
          ownerKey: safeOwnerKey,
          itemId: safeItemId,
          liked: Boolean(currentEngagement && currentEngagement.liked),
          favorited: Boolean(currentEngagement && currentEngagement.favorited),
          reportedCommentIds,
          createdAt: currentEngagement && currentEngagement.createdAt || reportedAt,
          updatedAt: reportedAt
        }
      });
      await commentReference.update({
        data: {
          reportCount,
          lastReportedAt: reportedAt,
          ...(hidden ? {
            status: 'hidden',
            hiddenAt: reportedAt,
            hiddenReason: 'report-threshold',
            appealStatus: 'available',
            appealResolution: null,
            appealResolvedAt: null
          } : {}),
          updatedAt: reportedAt
        }
      });
      if (hidden) {
        await itemReference.update({
          data: { commentCount, engagementUpdatedAt: reportedAt }
        });
      }
      return { reported: true, hidden, commentCount };
    });
  }

  async function appealComment(ownerKey, itemId, commentId, appealedAt) {
    await Promise.all([ensureComments(), config.ensureItems ? config.ensureItems() : null]);
    return runBusyTransaction(db, async (transaction) => {
      const safeOwnerKey = assertOwnerKey(ownerKey);
      const safeItemId = assertItemId(itemId);
      const safeCommentId = assertCommentId(commentId);
      const commentReference = transaction.collection(config.commentsCollectionName)
        .doc(safeCommentId);
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, safeItemId));
      const currentComment = await documentOrNull(commentReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentComment || currentComment.itemId !== safeItemId) {
        throw new AppError('COMMENT_NOT_FOUND', '这条评论不存在或已不可见');
      }
      if (currentComment.authorKey !== safeOwnerKey) {
        throw new AppError('FORBIDDEN', '你不能申诉这条评论');
      }
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      if (currentComment.status === 'appealed') {
        return {
          appealed: true,
          commentCount: count(currentItem.commentCount)
        };
      }
      if (currentComment.status !== 'hidden'
        || !moderationApproved(currentComment.moderation)) {
        throw new AppError('INVALID_REQUEST', '这条评论当前不能申诉');
      }
      await commentReference.update({
        data: {
          status: 'appealed',
          appealedAt,
          appealStatus: 'pending',
          updatedAt: appealedAt
        }
      });
      return {
        appealed: true,
        commentCount: count(currentItem.commentCount)
      };
    });
  }

  async function restoreComment(ownerKey, itemId, commentId, restoredAt, isAdmin = false) {
    if (isAdmin !== true) throw new AppError('FORBIDDEN', '只有管理员可以恢复评论');
    assertOwnerKey(ownerKey);
    await Promise.all([ensureComments(), config.ensureItems ? config.ensureItems() : null]);
    return runBusyTransaction(db, async (transaction) => {
      const safeItemId = assertItemId(itemId);
      const safeCommentId = assertCommentId(commentId);
      const commentReference = transaction.collection(config.commentsCollectionName)
        .doc(safeCommentId);
      const itemReference = transaction.collection(config.itemsCollectionName)
        .doc(storedDocumentId(config.provider, safeItemId));
      const currentComment = await documentOrNull(commentReference);
      const currentItem = await documentOrNull(itemReference);
      if (!currentComment || currentComment.itemId !== safeItemId) {
        throw new AppError('COMMENT_NOT_FOUND', '这条评论不存在或已不可见');
      }
      if (!currentItem || currentItem.publicState !== 'active') {
        throw new AppError('ITEM_NOT_FOUND', '这条资讯不存在');
      }
      if (publiclyVisibleComment(currentComment) && currentComment.restoredAt) {
        return {
          restored: true,
          commentCount: count(currentItem.commentCount)
        };
      }
      if (!['hidden', 'appealed'].includes(currentComment.status)
        || !moderationApproved(currentComment.moderation)) {
        throw new AppError('INVALID_REQUEST', '这条评论当前不能恢复');
      }
      const commentCount = count(currentItem.commentCount) + 1;
      await commentReference.update({
        data: {
          status: 'active',
          reportCount: 0,
          lastReportedAt: null,
          hiddenAt: null,
          hiddenReason: null,
          appealStatus: 'resolved',
          appealResolution: 'restored',
          appealResolvedAt: restoredAt,
          restoredAt,
          restoredByRole: 'admin',
          updatedAt: restoredAt
        }
      });
      await itemReference.update({
        data: { commentCount, engagementUpdatedAt: restoredAt }
      });
      return { restored: true, commentCount };
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
    addComment,
    deleteComment,
    reportComment,
    appealComment,
    restoreComment
  };
}

module.exports = {
  engagementDocumentId,
  commentDocumentId,
  assertCommentId,
  publiclyVisibleComment,
  isTransactionBusy,
  runBusyTransaction,
  createFeedEngagementRepository
};
