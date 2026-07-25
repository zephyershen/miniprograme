const {
  getComments,
  addComment,
  deleteComment: deleteCommentRequest,
  reportComment: reportCommentRequest,
  appealComment: appealCommentRequest,
  restoreComment: restoreCommentRequest
} = require('../../features/engagement/api.js');
const {
  arrangeCommentThreads,
  decorateCommentThreads,
  createOptimisticPendingComment,
  updateOptimisticPendingComment,
  mergeLocalCommentMedia,
  mergeResolvedCommentMedia
} = require('../../features/engagement/model.js');
const {
  chooseCommentImages,
  uploadCommentImages,
  previewLocalImages,
  resolveCommentMedia,
  resolveFreshCommentMedia,
  previewCommentImages
} = require('../../features/engagement/media.js');
const { loadUserProfile, rememberUserProfile } = require('../../features/user-profile/session.js');
const { decorateUserProfile } = require('../../features/user-profile/model.js');
const {
  COMMENT_EMOJIS,
  keyboardDockState
} = require('../../features/engagement/composer-model.js');
const {
  COMMENT_LINK_MESSAGE,
  commentContainsLink
} = require('../../features/engagement/comment-policy.js');

function mutationId() {
  return `comment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeItemId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function confirmAction(options) {
  return new Promise((resolve) => {
    wx.showModal({
      ...options,
      success: (result) => resolve(result && result.confirm === true),
      fail: () => resolve(false)
    });
  });
}

const COMMENT_ACTION_CONFIG = Object.freeze({
  delete: Object.freeze({
    permission: 'canDelete',
    title: '删除评论',
    content: '删除后无法恢复，是否继续？',
    confirmText: '删除',
    confirmColor: '#c53b32',
    success: '已删除',
    failure: '删除失败'
  }),
  report: Object.freeze({
    permission: 'canReport',
    title: '举报评论',
    content: '确认举报这条评论？达到处理标准后将自动隐藏。',
    confirmText: '举报',
    success: '已举报',
    failure: '举报失败'
  }),
  appeal: Object.freeze({
    permission: 'canAppeal',
    title: '申诉评论',
    content: '提交后管理员会复核，期间仅你和管理员可见。',
    confirmText: '提交申诉',
    success: '已提交申诉',
    failure: '申诉失败'
  }),
  restore: Object.freeze({
    permission: 'canRestore',
    title: '恢复评论',
    content: '恢复后，这条评论会重新在评论区公开。',
    confirmText: '恢复',
    success: '已恢复',
    failure: '恢复失败'
  })
});

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    visible: { type: Boolean, value: false },
    itemId: { type: String, value: '' },
    commentCount: { type: Number, value: 0 },
    canParticipateHint: { type: Boolean, value: false },
    focusCommentId: { type: String, value: '' }
  },

  data: {
    commentsLoading: false,
    commentsResolved: false,
    comments: [],
    canParticipate: false,
    commentDraft: '',
    commentDraftImages: [],
    replyTarget: null,
    commentSubmitting: false,
    commentSubmitStatus: '',
    composerExpanded: false,
    commentInputFocus: false,
    keyboardOpen: false,
    sheetStyle: '',
    emojiOpen: false,
    emojiOptions: COMMENT_EMOJIS,
    commentActionBusyId: '',
    scrollIntoCommentId: '',
    viewerProfile: decorateUserProfile(null)
  },

  lifetimes: {
    attached() {
      try {
        const windowInfo = typeof wx.getWindowInfo === 'function'
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
        this.windowHeight = Number(windowInfo && windowInfo.windowHeight) || 0;
      } catch (error) {
        this.windowHeight = 0;
      }
    }
  },

  observers: {
    visible(value) {
      if (value) {
        if (!this.commentsLoaded) this.loadComments();
      } else {
        this.resetComposer();
      }
    },
    itemId(value) {
      const nextItemId = normalizeItemId(value);
      const previousItemId = normalizeItemId(this.commentItemId);
      if (nextItemId === previousItemId) return;
      this.commentItemId = nextItemId;
      this.commentsLoaded = false;
      this.commentLoadedItemId = '';
      this.commentLoadingItemId = '';
      this.commentLoadRequestId = (this.commentLoadRequestId || 0) + 1;
      this.commentMediaRequestId = (this.commentMediaRequestId || 0) + 1;
      this.commentImageRecoveryRequests = new Set();
      this.setData({
        comments: [],
        commentsLoading: false,
        commentsResolved: false,
        canParticipate: this.data.canParticipateHint === true,
        scrollIntoCommentId: ''
      }, () => {
        if (nextItemId && this.data.visible) this.loadComments();
      });
    },
    canParticipateHint(value) {
      if (value !== true) {
        if (this.data.canParticipate) this.setData({ canParticipate: false });
        return;
      }
      if (!this.commentsLoaded && value === true && this.data.canParticipate !== true) {
        this.setData({ canParticipate: true });
      }
    }
  },

  pageLifetimes: {
    async show() {
      if (!this.profileEditorRequested) return;
      this.profileEditorRequested = false;
      try {
        this.setData({ viewerProfile: await loadUserProfile() });
        if (this.data.visible) await this.loadComments(true);
      } catch (error) {
        console.warn('评论身份暂时未刷新', error && error.code ? error.code : error);
      }
    }
  },

  methods: {
    noop() {},

    close() {
      wx.hideKeyboard();
      this.triggerEvent('close');
    },

    resetComposer() {
      wx.hideKeyboard();
      this.commentMutationId = '';
      this.setData({
        commentDraft: '',
        commentDraftImages: [],
        replyTarget: null,
        composerExpanded: false,
        commentInputFocus: false,
        commentSubmitStatus: '',
        keyboardOpen: false,
        sheetStyle: '',
        emojiOpen: false
      });
    },

    async loadComments(force = false) {
      const itemId = normalizeItemId(this.data.itemId);
      if (!itemId) return;
      if (!force && this.commentsLoaded && this.commentLoadedItemId === itemId) return;
      if (!force && this.commentLoadingItemId === itemId) return;

      const requestId = (this.commentLoadRequestId || 0) + 1;
      this.commentLoadRequestId = requestId;
      this.commentLoadingItemId = itemId;
      const showBlockingLoading = !this.commentsLoaded || this.commentLoadedItemId !== itemId;
      if (showBlockingLoading) this.setData({ commentsLoading: true });
      try {
        const result = await getComments(itemId);
        if (requestId !== this.commentLoadRequestId
          || itemId !== normalizeItemId(this.data.itemId)) return;
        this.commentsLoaded = true;
        this.commentLoadedItemId = itemId;
        const comments = decorateCommentThreads(result.comments || []);
        this.setData({
          comments,
          commentsResolved: true,
          canParticipate: result.canParticipate === true,
          viewerProfile: decorateUserProfile(result.viewerProfile),
          ...(this.data.focusCommentId
            ? { scrollIntoCommentId: `comment-${this.data.focusCommentId}` }
            : {})
        });
        this.resolveVisibleCommentMedia(comments);
        rememberUserProfile(result.viewerProfile).then((viewerProfile) => {
          if (requestId === this.commentLoadRequestId
            && itemId === normalizeItemId(this.data.itemId)) {
            this.setData({ viewerProfile });
          }
        }).catch(() => {});
      } catch (error) {
        if (requestId !== this.commentLoadRequestId
          || itemId !== normalizeItemId(this.data.itemId)) return;
        if (error.code === 'ENTITLEMENT_REQUIRED') {
          this.commentsLoaded = false;
          this.commentLoadedItemId = '';
          this.triggerEvent('locked');
        } else {
          wx.showToast({ title: error.message || '评论暂时无法加载', icon: 'none' });
        }
      } finally {
        if (requestId === this.commentLoadRequestId
          && itemId === normalizeItemId(this.data.itemId)) {
          this.commentLoadingItemId = '';
          if (this.data.commentsLoading) this.setData({ commentsLoading: false });
        }
      }
    },

    onCommentInput(event) {
      this.setData({ commentDraft: event.detail.value || '' });
    },

    showMembershipBenefits() {
      this.triggerEvent('locked');
    },

    onCommentFocus() {
      this.setData({
        composerExpanded: true,
        commentInputFocus: true,
        emojiOpen: false
      });
    },

    onCommentBlur() {
      this.setData({ commentInputFocus: false });
    },

    onKeyboardHeightChange(event) {
      const height = event && event.detail && event.detail.height;
      this.setData(keyboardDockState(height, this.windowHeight));
    },

    toggleEmojiPanel() {
      this.setData({
        composerExpanded: true,
        emojiOpen: !this.data.emojiOpen,
        commentInputFocus: false
      });
      wx.hideKeyboard();
    },

    insertEmoji(event) {
      const emoji = event.currentTarget.dataset.emoji || '';
      if (!emoji || this.data.commentDraft.length + emoji.length > 280) return;
      this.setData({ commentDraft: `${this.data.commentDraft}${emoji}` });
    },

    async chooseCommentImages() {
      try {
        const selected = await chooseCommentImages(this.data.commentDraftImages.length);
        this.setData({
          composerExpanded: true,
          commentDraftImages: [...this.data.commentDraftImages, ...selected]
        });
      } catch (error) {
        if (/cancel/i.test(error && (error.errMsg || error.message) || '')) return;
        wx.showToast({ title: error.message || '图片选择失败', icon: 'none' });
      }
    },

    removeCommentImage(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (!Number.isInteger(index)) return;
      this.setData({
        commentDraftImages: this.data.commentDraftImages.filter((image, imageIndex) => imageIndex !== index)
      });
    },

    async previewDraftImage(event) {
      try {
        await previewLocalImages(this.data.commentDraftImages, event.currentTarget.dataset.path);
      } catch (error) {
        wx.showToast({ title: error.message || '图片暂时无法打开', icon: 'none' });
      }
    },

    beginReply(event) {
      const commentId = event.currentTarget.dataset.commentId || '';
      const comment = this.data.comments.find((entry) => entry.id === commentId);
      if (!comment || !comment.canReply || this.data.commentSubmitting) return;
      const preview = String(comment.content || '').replace(/\s+/g, ' ').trim()
        || ((comment.attachments || []).length ? '[图片]' : '这条评论');
      this.setData({
        replyTarget: {
          id: comment.id,
          parentCommentId: comment.parentCommentId || comment.id,
          nickname: comment.author && comment.author.nickname || '读者',
          preview: preview.slice(0, 100)
        },
        composerExpanded: true,
        commentInputFocus: true,
        emojiOpen: false
      });
    },

    cancelReply() {
      if (this.data.commentSubmitting) return;
      this.setData({ replyTarget: null });
    },

    async resolveVisibleCommentMedia(comments) {
      const requestId = (this.commentMediaRequestId || 0) + 1;
      this.commentMediaRequestId = requestId;
      const itemId = this.data.itemId;
      try {
        const resolved = await resolveCommentMedia(comments);
        if (requestId === this.commentMediaRequestId && itemId === this.data.itemId) {
          this.setData({
            comments: mergeResolvedCommentMedia(this.data.comments, resolved)
          });
        }
      } catch (error) {
        // Text and initials are already visible; media resolution is fail-open.
      }
    },

    async previewCommentImage(event) {
      const comment = this.data.comments.find((entry) => entry.id === event.currentTarget.dataset.commentId);
      const attachment = comment && (comment.attachments || [])
        .find((entry) => entry.fileId === event.currentTarget.dataset.fileId);
      if (!comment || !attachment) return;
      try {
        if (attachment.localPath
          && (comment.reviewPending
            || !String(attachment.fileId || '').startsWith('cloud://'))) {
          await previewLocalImages(
            comment.attachments
              .filter((entry) => entry.localPath)
              .map((entry) => ({ tempFilePath: entry.localPath })),
            attachment.localPath
          );
          return;
        }
        const resolvedComment = await previewCommentImages(
          comment,
          event.currentTarget.dataset.fileId
        );
        if (resolvedComment) {
          this.setData({
            comments: mergeResolvedCommentMedia(this.data.comments, [resolvedComment])
          });
        }
      } catch (error) {
        if (attachment.localPath) {
          try {
            await previewLocalImages(
              comment.attachments
                .filter((entry) => entry.localPath)
                .map((entry) => ({ tempFilePath: entry.localPath })),
              attachment.localPath
            );
            return;
          } catch (fallbackError) {
            // Use the original cloud preview error below.
          }
        }
        wx.showToast({ title: error.message || '原图暂时无法打开', icon: 'none' });
      }
    },

    markCommentImageUnavailable(commentId, fileId, attachmentIndex) {
      const comments = this.data.comments.map((comment) => {
        if (!comment || comment.id !== commentId) return comment;
        const attachments = (comment.attachments || []).map((attachment, index) => (
          (fileId && attachment.fileId === fileId) || index === attachmentIndex
            ? { ...attachment, url: '', mediaUnavailable: true }
            : attachment
        ));
        return {
          ...comment,
          attachments,
          attachmentCount: attachments.length,
          attachmentMediaCount: attachments.filter((attachment) => attachment.url).length
        };
      });
      this.setData({ comments });
    },

    async handleCommentImageError(event) {
      const commentId = event.currentTarget.dataset.commentId || '';
      const fileId = event.currentTarget.dataset.fileId || '';
      const attachmentIndex = Number(event.currentTarget.dataset.attachmentIndex);
      const comment = this.data.comments.find((entry) => entry.id === commentId);
      const attachment = comment && (comment.attachments || []).find((entry, index) => (
        (fileId && entry.fileId === fileId) || index === attachmentIndex
      ));
      if (!comment || !attachment) return;

      const recoveryKey = `${commentId}:${fileId || attachmentIndex}`;
      this.commentImageRecoveryRequests = this.commentImageRecoveryRequests || new Set();
      if (this.commentImageRecoveryRequests.has(recoveryKey)) return;
      this.commentImageRecoveryRequests.add(recoveryKey);
      const failedUrl = attachment.url || '';
      const itemId = normalizeItemId(this.data.itemId);
      try {
        const resolvedComment = await resolveFreshCommentMedia(comment);
        if (itemId !== normalizeItemId(this.data.itemId)) return;
        const resolvedAttachment = (resolvedComment.attachments || [])
          .find((entry, index) => (
            (fileId && entry.fileId === fileId) || index === attachmentIndex
          ));
        const refreshedUrl = resolvedAttachment && resolvedAttachment.url || '';
        if (!/^https:\/\//i.test(refreshedUrl) || refreshedUrl === failedUrl) {
          this.markCommentImageUnavailable(commentId, fileId, attachmentIndex);
          return;
        }
        this.setData({
          comments: mergeResolvedCommentMedia(this.data.comments, [resolvedComment])
        });
      } catch (error) {
        if (itemId === normalizeItemId(this.data.itemId)) {
          this.markCommentImageUnavailable(commentId, fileId, attachmentIndex);
        }
      } finally {
        this.commentImageRecoveryRequests.delete(recoveryKey);
      }
    },

    async handleCommentAction(event) {
      const commentId = event.currentTarget.dataset.commentId || '';
      const action = event.currentTarget.dataset.action || '';
      const comment = this.data.comments.find((entry) => entry.id === commentId);
      const actionConfig = COMMENT_ACTION_CONFIG[action];
      if (!comment || !actionConfig || this.data.commentActionBusyId) return;
      if (!comment[actionConfig.permission] || (action === 'report' && comment.reported)) return;
      const confirmed = await confirmAction({
        title: actionConfig.title,
        content: actionConfig.content,
        confirmText: actionConfig.confirmText,
        ...(actionConfig.confirmColor ? { confirmColor: actionConfig.confirmColor } : {})
      });
      if (!confirmed) return;
      this.setData({ commentActionBusyId: commentId });
      try {
        const requests = {
          delete: deleteCommentRequest,
          report: reportCommentRequest,
          appeal: appealCommentRequest,
          restore: restoreCommentRequest
        };
        const result = await requests[action](this.data.itemId, commentId);
        const shouldRemove = action === 'delete' || result.hidden === true;
        if (action === 'appeal' || action === 'restore') {
          await this.loadComments(true);
        } else {
          const comments = shouldRemove
            ? this.data.comments.filter((entry) => entry.id !== commentId)
            : this.data.comments.map((entry) => (
                entry.id === commentId ? { ...entry, reported: true } : entry
              ));
          this.setData({ comments });
        }
        this.triggerEvent('changed', { commentCount: result.commentCount });
        wx.showToast({
          title: actionConfig.success,
          icon: 'success'
        });
      } catch (error) {
        if (error && error.code === 'COMMENT_NOT_FOUND') {
          await this.loadComments(true);
        }
        wx.showToast({
          title: error.message || actionConfig.failure,
          icon: 'none'
        });
      } finally {
        this.setData({ commentActionBusyId: '' });
      }
    },

    openProfileEditor() {
      this.profileEditorRequested = true;
      wx.navigateTo({ url: '/pages/profile-edit/index?from=comments' });
    },

    async submitComment() {
      const content = this.data.commentDraft.trim();
      const draftImages = [...this.data.commentDraftImages];
      const replyTarget = this.data.replyTarget;
      if (!this.data.itemId || (!content && !draftImages.length) || this.data.commentSubmitting) return;
      if (commentContainsLink(content)) {
        wx.showToast({ title: COMMENT_LINK_MESSAGE, icon: 'none' });
        return;
      }
      if (!this.data.viewerProfile.isComplete) {
        this.openProfileEditor();
        return;
      }
      const submissionMutationId = this.commentMutationId || mutationId();
      const optimisticId = `local_${submissionMutationId}`;
      this.commentMutationId = submissionMutationId;
      const optimisticComment = createOptimisticPendingComment({
        id: optimisticId,
        content,
        images: draftImages,
        profile: this.data.viewerProfile,
        replyTarget,
        statusLabel: '提交审核中'
      });
      let draftForRetry = draftImages;
      wx.hideKeyboard();
      this.setData({
        comments: arrangeCommentThreads([optimisticComment, ...this.data.comments]),
        scrollIntoCommentId: `comment-${optimisticId}`,
        commentDraft: '',
        commentDraftImages: [],
        replyTarget: null,
        commentSubmitting: true,
        commentSubmitStatus: '',
        composerExpanded: false,
        commentInputFocus: false,
        keyboardOpen: false,
        sheetStyle: '',
        emojiOpen: false
      });
      try {
        const pendingImages = draftImages.filter((image) => !image.fileId);
        const uploaded = await uploadCommentImages(pendingImages, {
          canvas: {
            component: this,
            canvasId: 'commentMediaCompressor'
          }
        });
        let uploadedIndex = 0;
        const imagesWithFileIds = draftImages.map((image) => {
          if (image.fileId) return image;
          const attachment = uploaded[uploadedIndex];
          uploadedIndex += 1;
          return { ...image, ...attachment };
        });
        draftForRetry = imagesWithFileIds;
        const commentsWithUploadedMedia = updateOptimisticPendingComment(
          this.data.comments,
          optimisticId,
          {
            attachments: createOptimisticPendingComment({
              id: optimisticId,
              images: imagesWithFileIds,
              profile: this.data.viewerProfile
            }).attachments,
            statusLabel: '提交审核中'
          }
        );
        this.setData({ comments: commentsWithUploadedMedia });
        const result = await addComment(this.data.itemId, {
          content,
          attachments: imagesWithFileIds.map((image) => ({
            fileId: image.fileId,
            width: image.width,
            height: image.height
          })),
          ...(replyTarget && replyTarget.id
            ? { replyToCommentId: replyTarget.id }
            : {}),
          clientMutationId: submissionMutationId
        });
        this.commentMutationId = '';
        const localComment = this.data.comments.find((entry) => entry.id === optimisticId)
          || optimisticComment;
        const acceptedComment = mergeLocalCommentMedia(result.comment, localComment);
        const comments = decorateCommentThreads(this.data.comments.map((comment) => (
          comment.id === optimisticId ? acceptedComment : comment
        )));
        this.setData({
          comments,
          scrollIntoCommentId: `comment-${result.comment.id}`
        });
        this.resolveVisibleCommentMedia(comments);
        this.triggerEvent('published', { commentCount: result.commentCount });
        wx.showToast({ title: '已提交，后台审核中', icon: 'none', duration: 2200 });
      } catch (error) {
        const comments = this.data.comments.filter((comment) => comment.id !== optimisticId);
        if (error.code === 'PROFILE_REQUIRED') {
          this.commentMutationId = '';
          this.setData({
            comments,
            commentDraft: content,
            commentDraftImages: draftForRetry,
            replyTarget,
            composerExpanded: true
          });
          this.openProfileEditor();
        } else if (error.code === 'CONTENT_REJECTED') {
          this.commentMutationId = '';
          this.setData({
            comments,
            commentDraft: content,
            commentDraftImages: [],
            replyTarget,
            composerExpanded: true
          });
          wx.showToast({ title: error.message || '评论包含不适合公开的内容', icon: 'none' });
        } else {
          this.setData({
            comments,
            commentDraft: content,
            commentDraftImages: draftForRetry,
            replyTarget,
            composerExpanded: true
          });
          wx.showToast({ title: error.message || '评论发布失败', icon: 'none' });
        }
      } finally {
        this.setData({ commentSubmitting: false, commentSubmitStatus: '' });
      }
    }
  }
});
