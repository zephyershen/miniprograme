const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const {
  COMMENT_LINK_MESSAGE,
  commentContainsLink
} = require('../policies/comment-content-policy');
const { moderationApproved } = require('../policies/moderation-policy');
const { commentDocumentId } = require('../repositories/feed-engagement');
const { profileView } = require('./user-profile-service');

const DAY_MS = 24 * 60 * 60 * 1000;

function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function canComment(entitlement) {
  return Boolean(entitlement && entitlement.entitlements
    && entitlement.entitlements.comments === true);
}

function normalizeCommentContent(value, maxLength = 280, hasAttachments = false) {
  const content = typeof value === 'string'
    ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';
  if (!content && !hasAttachments) throw new AppError('INVALID_REQUEST', '写点内容或选择图片再发布');
  if (content.length > maxLength) {
    throw new AppError('INVALID_REQUEST', `评论最多 ${maxLength} 个字`);
  }
  if (commentContainsLink(content)) {
    throw new AppError('COMMENT_LINK_NOT_ALLOWED', COMMENT_LINK_MESSAGE);
  }
  return content;
}

function normalizeCommentAttachments(value, config) {
  const values = Array.isArray(value) ? value : [];
  if (values.length > config.commentImageLimit) {
    throw new AppError('INVALID_REQUEST', `每条评论最多 ${config.commentImageLimit} 张图片`);
  }
  return values.map((attachment) => {
    const fileId = attachment && attachment.fileId;
    const stagingPrefix = config.userMediaStagingFileIdPrefix
      || config.commentImageFileIdPrefix;
    if (typeof fileId !== 'string' || !fileId.startsWith(stagingPrefix)
      || fileId.length > 700) {
      throw new AppError('INVALID_REQUEST', '评论图片无效，请重新选择');
    }
    return {
      type: 'image',
      fileId,
      width: Math.max(0, Math.min(10000, Math.floor(Number(attachment.width) || 0))),
      height: Math.max(0, Math.min(10000, Math.floor(Number(attachment.height) || 0)))
    };
  });
}

function normalizeMutationId(value) {
  if (typeof value === 'string' && /^[a-z0-9_-]{8,80}$/i.test(value)) return value;
  return crypto.randomBytes(18).toString('hex');
}

function normalizeReplyCommentId(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^[a-z0-9_-]{8,128}$/i.test(value)) {
    throw new AppError('COMMENT_NOT_FOUND', '要回复的评论不存在或已不可见');
  }
  return value;
}

function commentPreview(comment) {
  const content = typeof (comment && comment.content) === 'string'
    ? comment.content.replace(/\s+/g, ' ').trim()
    : '';
  if (content) return content.slice(0, 100);
  return Array.isArray(comment && comment.attachments) && comment.attachments.length
    ? '[图片]'
    : '这条评论';
}

function commentView(comment, ownerKey, profile = null, options = {}) {
  const createdAt = comment && comment.createdAt;
  const author = profileView(profile);
  const isMine = Boolean(comment && comment.authorKey === ownerKey);
  const reviewPending = Boolean(comment && comment.status === 'pending');
  const privateStatus = ['hidden', 'appealed'].includes(comment && comment.status);
  const appealPending = comment && comment.status === 'appealed';
  return {
    id: comment && (comment.id || comment._id),
    content: comment && comment.content || '',
    attachments: Array.isArray(comment && comment.attachments) ? comment.attachments : [],
    author: {
      nickname: author.nickname || '读者',
      avatarFileId: author.avatarFileId,
      initial: author.initial
    },
    authorLabel: author.nickname || '读者',
    parentCommentId: comment && comment.parentCommentId || '',
    replyToCommentId: comment && comment.replyToCommentId || '',
    replyToNickname: comment && comment.replyToNickname || '',
    replyToPreview: comment && comment.replyToPreview || '',
    isReply: Boolean(comment && comment.parentCommentId),
    isMine,
    isHidden: privateStatus,
    reviewPending,
    appealPending,
    statusLabel: reviewPending
      ? '审核中'
      : (appealPending ? '申诉处理中' : (privateStatus ? '已隐藏' : '')),
    canDelete: isMine || options.isAdmin === true,
    canReply: options.canParticipate === true
      && !reviewPending
      && !privateStatus,
    canReport: !reviewPending && !privateStatus && !isMine,
    canAppeal: privateStatus && !appealPending && isMine && options.isAdmin !== true,
    canRestore: privateStatus && options.isAdmin === true,
    reported: !privateStatus && options.reported === true,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}

function engagementView(item, state, entitlement) {
  return {
    liked: Boolean(state && state.liked),
    favorited: Boolean(state && state.favorited),
    likeCount: count(item && item.likeCount),
    commentCount: count(item && item.commentCount),
    favoriteCount: count(item && item.favoriteCount),
    canComment: canComment(entitlement)
  };
}

function favoriteAvailable(snapshot, entitlement, now) {
  const history = entitlement && entitlement.entitlements && entitlement.entitlements.history;
  if (history && history.mode === 'all') return true;
  const publishedAt = new Date(snapshot && snapshot.publishedAt).getTime();
  const days = history && Number(history.days);
  return Number.isFinite(publishedAt) && Number.isFinite(days)
    && publishedAt >= now - (days * DAY_MS);
}

function createFeedEngagementService({
  repository,
  commentReviewRepository,
  profileRepository,
  itemLoader,
  commentModerationService,
  userMediaService,
  config,
  now = () => Date.now()
}) {
  async function statesFor(actor, itemIds) {
    const documents = await repository.getMany(actor.ownerKey, itemIds);
    return new Map(documents.map((document) => [document.itemId, document]));
  }

  async function decorateItems(items, actor, entitlement) {
    const values = Array.isArray(items) ? items : [];
    const states = await statesFor(actor, values.map((item) => item.id));
    return values.map((item) => ({
      ...item,
      engagement: engagementView(item, states.get(item.id), entitlement)
    }));
  }

  async function decorateFeed(feed, actor, entitlement) {
    return { ...feed, items: await decorateItems(feed && feed.items, actor, entitlement) };
  }

  async function decorateItem(item, actor, entitlement) {
    const [decorated] = await decorateItems([item], actor, entitlement);
    return decorated;
  }

  async function toggleLike(itemId, desiredLiked, actor, entitlement) {
    const item = await itemLoader(itemId, entitlement);
    const state = await repository.toggleLike(actor.ownerKey, item, new Date(now()), desiredLiked);
    return { itemId, engagement: { ...state, canComment: canComment(entitlement) } };
  }

  async function toggleFavorite(itemId, desiredFavorited, actor, entitlement) {
    let item;
    try {
      item = await itemLoader(itemId, entitlement);
    } catch (error) {
      if (!error || error.code !== 'ENTITLEMENT_REQUIRED') throw error;
      const [existing] = await repository.getMany(actor.ownerKey, [itemId]);
      if (!existing || existing.favorited !== true) throw error;
      item = { id: itemId, ...(existing.snapshot || {}) };
    }
    const state = await repository.toggleFavorite(
      actor.ownerKey,
      item,
      new Date(now()),
      desiredFavorited
    );
    return { itemId, engagement: { ...state, canComment: canComment(entitlement) } };
  }

  function requireComments(entitlement) {
    if (!canComment(entitlement)) {
      throw new AppError('ENTITLEMENT_REQUIRED', '评论区仅对会员开放', {
        featureKey: 'comments'
      });
    }
  }

  function isActualAdmin(entitlement) {
    const viewer = entitlement && entitlement.viewer;
    return Boolean(viewer && (viewer.isActualAdmin === true || viewer.role === 'admin'));
  }

  async function listComments(itemId, actor, entitlement) {
    const canParticipate = canComment(entitlement);
    const admin = isActualAdmin(entitlement);
    if (canParticipate) await itemLoader(itemId, entitlement);
    const comments = await repository.listComments(itemId, config.commentPageSize, {
      ownerKey: actor.ownerKey,
      isAdmin: admin,
      includeActive: canParticipate || admin
    });
    const [profiles, states] = await Promise.all([
      profileRepository.getMany(comments.map((comment) => comment.authorKey)),
      repository.getMany(actor.ownerKey, [itemId])
    ]);
    const profileMap = new Map(profiles.map((profile) => [profile.ownerKey || profile._id, profile]));
    const state = states[0] || null;
    const reportedCommentIds = new Set(
      Array.isArray(state && state.reportedCommentIds) ? state.reportedCommentIds : []
    );
    return {
      canParticipate,
      comments: comments.map((comment) => commentView(
        comment,
        actor.ownerKey,
        profileMap.get(comment.authorKey),
        {
          isAdmin: admin,
          canParticipate,
          reported: reportedCommentIds.has(comment._id)
        }
      )),
      viewerProfile: profileView(profileMap.get(actor.ownerKey) || await profileRepository.get(actor.ownerKey))
    };
  }

  async function addComment(itemId, payload, actor, entitlement) {
    requireComments(entitlement);
    await itemLoader(itemId, entitlement);
    const profile = await profileRepository.get(actor.ownerKey);
    const publicProfile = profileView(profile);
    if (!publicProfile.isComplete) {
      throw new AppError('PROFILE_REQUIRED', '先设置头像和昵称，再参与讨论', {
        featureKey: 'profile'
      });
    }
    const mutationId = normalizeMutationId(payload && payload.clientMutationId);
    const commentId = commentDocumentId(actor.ownerKey, itemId, mutationId);
    if (typeof repository.getComment === 'function') {
      const existing = await repository.getComment(commentId, itemId);
      if (existing) {
        const managedFileIds = (existing.comment.attachments || [])
          .map((attachment) => attachment && attachment.fileId)
          .filter((fileId) => userMediaService
            && userMediaService.isOwnedPublishedFileId(fileId));
        if (managedFileIds.length) {
          await userMediaService.bindPublished(actor, 'comment', managedFileIds, {
            kind: 'comment',
            id: commentId,
            itemId
          });
        }
        return {
          comment: commentView(existing.comment, actor.ownerKey, profile, {
            isAdmin: isActualAdmin(entitlement)
          }),
          commentCount: count(existing.commentCount),
          viewerProfile: publicProfile
        };
      }
    }
    const replyToCommentId = normalizeReplyCommentId(payload && payload.replyToCommentId);
    let replyContext = {};
    if (replyToCommentId) {
      const targetResult = await repository.getComment(replyToCommentId, itemId);
      const target = targetResult && targetResult.comment;
      if (!target || target.status !== 'active' || !moderationApproved(target.moderation)) {
        throw new AppError('COMMENT_NOT_FOUND', '要回复的评论不存在或已不可见');
      }
      const rootCommentId = target.parentCommentId || target._id;
      const rootResult = rootCommentId === target._id
        ? targetResult
        : await repository.getComment(rootCommentId, itemId);
      const root = rootResult && rootResult.comment;
      if (!root || root.status !== 'active' || !moderationApproved(root.moderation)) {
        throw new AppError('COMMENT_NOT_FOUND', '这组讨论已经不可见');
      }
      const targetProfile = await profileRepository.get(target.authorKey);
      const targetPublicProfile = profileView(targetProfile);
      replyContext = {
        parentCommentId: root._id,
        replyToCommentId: target._id,
        replyToOwnerKey: target.authorKey,
        threadOwnerKey: root.authorKey,
        replyToNickname: targetPublicProfile.nickname || '读者',
        replyToPreview: commentPreview(target),
        rootCommentPreview: commentPreview(root)
      };
    }
    const attachments = normalizeCommentAttachments(payload && payload.attachments, config);
    let content;
    try {
      content = normalizeCommentContent(
        payload && payload.content,
        config.commentMaxLength,
        attachments.length > 0
      );
    } catch (error) {
      if (
        error
        && error.code === 'COMMENT_LINK_NOT_ALLOWED'
        && userMediaService
        && attachments.length
      ) {
        await userMediaService.discardUnpublished(
          actor,
          'comment',
          attachments.map((attachment) => attachment.fileId)
        ).catch(() => null);
      }
      throw error;
    }
    let reviewAttachments = attachments;
    if (attachments.length) {
      if (!userMediaService) throw new Error('USER_MEDIA_SERVICE_REQUIRED');
      const reviewFileIds = await userMediaService.filesForReview(
        actor,
        'comment',
        attachments.map((attachment) => attachment.fileId)
      );
      reviewAttachments = attachments.map((attachment, index) => ({
        ...attachment,
        fileId: reviewFileIds[index]
      }));
    }
    if (attachments.length) {
      await userMediaService.holdForReview(
        actor,
        'comment',
        attachments.map((attachment) => attachment.fileId),
        config.commentReviewMediaTtlMs
      );
    }
    const reviewRepository = commentReviewRepository || repository;
    let result;
    try {
      if (typeof reviewRepository.enqueue === 'function') {
        result = await reviewRepository.enqueue(
          actor.ownerKey,
          itemId,
          commentId,
          {
            content,
            attachments,
            reviewAttachments,
            reviewRevision: mutationId,
            ...replyContext
          },
          new Date(now())
        );
      } else {
        result = await reviewRepository.addComment(
          actor.ownerKey,
          itemId,
          {
            content,
            attachments,
            reviewAttachments,
            reviewRevision: mutationId,
            ...replyContext,
            moderation: { status: 'pending' }
          },
          new Date(now()),
          commentId
        );
      }
    } catch (error) {
      if (attachments.length) {
        await userMediaService.discardUnpublished(
          actor,
          'comment',
          attachments.map((attachment) => attachment.fileId)
        ).catch(() => null);
      }
      throw error;
    }
    return {
      comment: commentView(result.comment, actor.ownerKey, profile, {
        isAdmin: isActualAdmin(entitlement)
      }),
      commentCount: count(result.commentCount),
      viewerProfile: publicProfile
    };
  }

  async function deleteComment(itemId, commentId, actor, entitlement) {
    const result = await repository.deleteComment(
      actor.ownerKey,
      itemId,
      commentId,
      new Date(now()),
      isActualAdmin(entitlement)
    );
    const attachmentFileIds = (result.comment && result.comment.attachments || [])
      .map((attachment) => attachment && attachment.fileId)
      .filter(Boolean);
    if (userMediaService && attachmentFileIds.length) {
      await userMediaService.deleteOwned(
        { ownerKey: result.comment.authorKey },
        'comment',
        attachmentFileIds
      ).catch(() => null);
    }
    return {
      commentId,
      deleted: true,
      commentCount: count(result.commentCount)
    };
  }

  async function reportComment(itemId, commentId, actor, entitlement) {
    requireComments(entitlement);
    await itemLoader(itemId, entitlement);
    const result = await repository.reportComment(
      actor.ownerKey,
      itemId,
      commentId,
      new Date(now()),
      config.commentReportThreshold,
      config.commentReportLimitPerItem
    );
    return {
      commentId,
      reported: true,
      hidden: result.hidden === true,
      commentCount: count(result.commentCount)
    };
  }

  async function appealComment(itemId, commentId, actor, entitlement) {
    const result = await repository.appealComment(
      actor.ownerKey,
      itemId,
      commentId,
      new Date(now())
    );
    return {
      commentId,
      appealed: true,
      commentCount: count(result.commentCount)
    };
  }

  async function restoreComment(itemId, commentId, actor, entitlement) {
    if (!isActualAdmin(entitlement)) {
      throw new AppError('FORBIDDEN', '只有管理员可以恢复评论');
    }
    const result = await repository.restoreComment(
      actor.ownerKey,
      itemId,
      commentId,
      new Date(now()),
      true
    );
    return {
      commentId,
      restored: true,
      commentCount: count(result.commentCount)
    };
  }

  async function listFavorites(actor, entitlement) {
    const documents = await repository.listFavorites(actor.ownerKey, config.favoriteListLimit);
    const currentTime = now();
    return {
      items: documents.map((document) => ({
        id: document.itemId,
        ...(document.snapshot || {}),
        savedAt: document.favoritedAt instanceof Date
          ? document.favoritedAt.toISOString()
          : document.favoritedAt,
        available: favoriteAvailable(document.snapshot, entitlement, currentTime)
      }))
    };
  }

  return {
    decorateFeed,
    decorateItem,
    toggleLike,
    toggleFavorite,
    listComments,
    addComment,
    deleteComment,
    reportComment,
    appealComment,
    restoreComment,
    listFavorites
  };
}

module.exports = {
  canComment,
  normalizeCommentContent,
  normalizeCommentAttachments,
  normalizeMutationId,
  normalizeReplyCommentId,
  commentPreview,
  commentView,
  engagementView,
  favoriteAvailable,
  createFeedEngagementService
};
