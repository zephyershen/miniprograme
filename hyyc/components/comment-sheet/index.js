const { getComments, addComment } = require('../../features/engagement/api.js');
const { decorateComments } = require('../../features/engagement/model.js');
const {
  chooseCommentImages,
  uploadCommentImages,
  previewLocalImages,
  resolveCommentMedia,
  previewCommentImages
} = require('../../features/engagement/media.js');
const { loadUserProfile, rememberUserProfile } = require('../../features/user-profile/session.js');
const { decorateUserProfile } = require('../../features/user-profile/model.js');
const {
  COMMENT_EMOJIS,
  keyboardDockState
} = require('../../features/engagement/composer-model.js');

function mutationId() {
  return `comment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    visible: { type: Boolean, value: false },
    itemId: { type: String, value: '' },
    commentCount: { type: Number, value: 0 }
  },

  data: {
    commentsLoading: false,
    comments: [],
    commentDraft: '',
    commentDraftImages: [],
    commentSubmitting: false,
    commentSubmitStatus: '',
    composerExpanded: false,
    commentInputFocus: false,
    keyboardOpen: false,
    sheetStyle: '',
    emojiOpen: false,
    emojiOptions: COMMENT_EMOJIS,
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
    itemId() {
      this.commentsLoaded = false;
      this.commentMediaRequestId = (this.commentMediaRequestId || 0) + 1;
      this.setData({ comments: [] });
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
        composerExpanded: false,
        commentInputFocus: false,
        commentSubmitStatus: '',
        keyboardOpen: false,
        sheetStyle: '',
        emojiOpen: false
      });
    },

    async loadComments(force = false) {
      if (!this.data.itemId || this.data.commentsLoading || (this.commentsLoaded && !force)) return;
      this.setData({ commentsLoading: true });
      try {
        const result = await getComments(this.data.itemId);
        this.commentsLoaded = true;
        const comments = decorateComments(result.comments || []);
        this.setData({
          comments,
          viewerProfile: decorateUserProfile(result.viewerProfile)
        });
        this.resolveVisibleCommentMedia(comments);
        rememberUserProfile(result.viewerProfile).then((viewerProfile) => {
          if (this.data.itemId) this.setData({ viewerProfile });
        }).catch(() => {});
      } catch (error) {
        if (error.code === 'ENTITLEMENT_REQUIRED') {
          this.triggerEvent('locked');
        } else {
          wx.showToast({ title: error.message || '评论暂时无法加载', icon: 'none' });
        }
      } finally {
        this.setData({ commentsLoading: false });
      }
    },

    onCommentInput(event) {
      this.setData({ commentDraft: event.detail.value || '' });
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

    previewDraftImage(event) {
      previewLocalImages(this.data.commentDraftImages, event.currentTarget.dataset.path);
    },

    async resolveVisibleCommentMedia(comments) {
      const requestId = (this.commentMediaRequestId || 0) + 1;
      this.commentMediaRequestId = requestId;
      const itemId = this.data.itemId;
      try {
        const resolved = await resolveCommentMedia(comments);
        if (requestId === this.commentMediaRequestId && itemId === this.data.itemId) {
          this.setData({ comments: resolved });
        }
      } catch (error) {
        // Text and initials are already visible; media resolution is fail-open.
      }
    },

    async previewCommentImage(event) {
      const comment = this.data.comments.find((entry) => entry.id === event.currentTarget.dataset.commentId);
      try {
        await previewCommentImages(comment, event.currentTarget.dataset.fileId);
      } catch (error) {
        wx.showToast({ title: error.message || '原图暂时无法打开', icon: 'none' });
      }
    },

    openProfileEditor() {
      this.profileEditorRequested = true;
      wx.navigateTo({ url: '/pages/profile-edit/index?from=comments' });
    },

    async submitComment() {
      const content = this.data.commentDraft.trim();
      const draftImages = this.data.commentDraftImages;
      if (!this.data.itemId || (!content && !draftImages.length) || this.data.commentSubmitting) return;
      if (!this.data.viewerProfile.isComplete) {
        this.openProfileEditor();
        return;
      }
      this.setData({
        commentSubmitting: true,
        commentSubmitStatus: draftImages.some((image) => !image.fileId) ? '正在上传图片…' : '正在发布…'
      });
      try {
        const pendingImages = draftImages.filter((image) => !image.fileId);
        const uploaded = await uploadCommentImages(pendingImages);
        let uploadedIndex = 0;
        const imagesWithFileIds = draftImages.map((image) => {
          if (image.fileId) return image;
          const attachment = uploaded[uploadedIndex];
          uploadedIndex += 1;
          return { ...image, ...attachment };
        });
        this.setData({ commentDraftImages: imagesWithFileIds });
      this.setData({ commentSubmitStatus: '正在发布…' });
        this.commentMutationId = this.commentMutationId || mutationId();
        const result = await addComment(this.data.itemId, {
          content,
          attachments: imagesWithFileIds.map((image) => ({
            fileId: image.fileId,
            width: image.width,
            height: image.height
          })),
          clientMutationId: this.commentMutationId
        });
        this.commentMutationId = '';
        const comments = decorateComments([result.comment, ...this.data.comments]);
        this.setData({ comments });
        this.resolveVisibleCommentMedia(comments);
        this.resetComposer();
        this.triggerEvent('published', { commentCount: result.commentCount });
        wx.showToast({ title: '已发布', icon: 'success' });
      } catch (error) {
        if (error.code === 'PROFILE_REQUIRED') {
          this.openProfileEditor();
        } else if (error.code === 'CONTENT_REJECTED') {
          this.commentMutationId = '';
          this.setData({ commentDraftImages: [] });
          wx.showToast({ title: error.message || '评论包含不适合公开的内容', icon: 'none' });
        } else {
          wx.showToast({ title: error.message || '评论发布失败', icon: 'none' });
        }
      } finally {
        this.setData({ commentSubmitting: false, commentSubmitStatus: '' });
      }
    }
  }
});
