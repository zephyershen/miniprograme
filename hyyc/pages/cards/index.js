const { loadFavorites, updateFavorite } = require('../../features/engagement/favorites-session.js');
const { decorateFavorites } = require('../../features/engagement/model.js');
const { refreshMembershipAccess } = require('../../features/membership/session.js');
const {
  applyResolvedItemMedia,
  collectItemMediaFileIds,
  knowledgeMediaSession
} = require('../../features/knowledge-feed/cloud-media-session.js');
const {
  createPageMediaRecovery
} = require('../../features/knowledge-feed/cloud-media-recovery.js');

Page({
  data: {
    loading: true,
    favorites: [],
    membershipPromptVisible: false,
    membershipPromptFeature: 'history_30d'
  },

  onShow() {
    if (this.mediaRecovery) this.mediaRecovery.resume();
    this.favoriteLoadRequestId = (this.favoriteLoadRequestId || 0) + 1;
    this.favoriteMediaRequestId = (this.favoriteMediaRequestId || 0) + 1;
    this.setData({ favorites: [], loading: true });
    this.refreshFavoritesPage({ force: true });
  },

  onHide() {
    if (this.mediaRecovery) this.mediaRecovery.pause();
  },

  onLoad() {
    this.pageDisposed = false;
    this.favoriteMediaRequestId = 0;
    this.favoriteLoadRequestId = 0;
    this.mediaRecovery = createPageMediaRecovery(this);
  },

  onUnload() {
    this.pageDisposed = true;
    this.favoriteMediaRequestId = (this.favoriteMediaRequestId || 0) + 1;
    this.favoriteLoadRequestId = (this.favoriteLoadRequestId || 0) + 1;
    if (this.mediaRecovery) this.mediaRecovery.dispose();
  },

  onPullDownRefresh() {
    this.refreshFavoritesPage({ force: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  async refreshFavoritesPage({ force = false } = {}) {
    if (this.pageDisposed) return false;
    try {
      await refreshMembershipAccess({ force });
      if (this.pageDisposed) return false;
      return await this.loadFavorites({ force });
    } catch (error) {
      if (this.pageDisposed) return false;
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '收藏暂时无法加载', icon: 'none' });
      return false;
    }
  },

  async loadFavorites({ force = false } = {}) {
    if (this.pageDisposed) return false;
    const loadRequestId = (this.favoriteLoadRequestId || 0) + 1;
    this.favoriteLoadRequestId = loadRequestId;
    if (!this.favoritesLoaded) this.setData({ loading: true });
    try {
      const favorites = await loadFavorites({ force });
      if (this.pageDisposed || loadRequestId !== this.favoriteLoadRequestId) return false;
      const decorated = decorateFavorites(favorites.items || []);
      const mediaRequestId = (this.favoriteMediaRequestId || 0) + 1;
      this.favoriteMediaRequestId = mediaRequestId;
      if (this.mediaRecovery) this.mediaRecovery.reset();
      this.setData({ favorites: decorated });
      this.resolveFavoriteMedia(decorated, mediaRequestId);
      this.favoritesLoaded = true;
      return true;
    } catch (error) {
      if (this.pageDisposed || loadRequestId !== this.favoriteLoadRequestId) return false;
      wx.showToast({ title: error.message, icon: 'none' });
      return false;
    } finally {
      if (!this.pageDisposed && loadRequestId === this.favoriteLoadRequestId) {
        this.setData({ loading: false });
      }
    }
  },

  openFavorite(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (String(event.currentTarget.dataset.available) !== '1') {
      this.setData({ membershipPromptVisible: true });
      return;
    }
    wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(id)}` });
  },

  async resolveFavoriteMedia(favorites, requestId) {
    const fileIds = (favorites || []).flatMap((item) => (
      collectItemMediaFileIds(item, { includeRelated: false })
    ));
    const resolvedUrls = await knowledgeMediaSession.resolveFileIds(fileIds);
    if (this.pageDisposed || requestId !== this.favoriteMediaRequestId) return false;
    this.setData({
      favorites: (this.data.favorites || []).map((item) => (
        applyResolvedItemMedia(item, resolvedUrls, { includeRelated: false })
      ))
    });
    if (this.mediaRecovery) {
      this.mediaRecovery.track(fileIds, (freshUrls) => {
        if (requestId !== this.favoriteMediaRequestId) return;
        this.setData({
          favorites: (this.data.favorites || []).map((item) => (
            applyResolvedItemMedia(item, freshUrls, { includeRelated: false })
          ))
        });
      });
    }
    return true;
  },

  handleMediaError(event) {
    if (this.mediaRecovery) this.mediaRecovery.handleError(event);
  },

  async removeFavorite(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.favoriteBusy) return;
    this.favoriteBusy = true;
    try {
      await updateFavorite(id, false);
      if (this.pageDisposed) return;
      this.setData({ favorites: this.data.favorites.filter((item) => item.id !== id) });
    } catch (error) {
      if (this.pageDisposed) return;
      wx.showToast({ title: error.message || '取消收藏失败', icon: 'none' });
    } finally {
      this.favoriteBusy = false;
    }
  },

  closeMembershipPrompt() {
    this.setData({ membershipPromptVisible: false });
  },

  openMembershipFromPrompt() {
    this.setData({ membershipPromptVisible: false }, () => {
      wx.switchTab({ url: '/pages/profile/index' });
    });
  }
});
