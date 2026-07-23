const { loadTrendDossier, clearColumnCache } = require('../../features/ai-column/session.js');
const { normalizeTrendDossier } = require('../../features/ai-column/model.js');
const {
  refreshMembershipAccess,
  membershipCacheScope
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (error) {
    return value || '';
  }
}

Page({
  data: {
    loading: true,
    error: '',
    dossier: null,
    membershipPromptVisible: false,
    membershipPromptFeature: 'ai_column'
  },

  onLoad(options = {}) {
    this.pageDisposed = false;
    this.dossierRequestId = 0;
    this.skipNextDossierRevalidation = true;
    this.dossierId = safeDecode(options.id);
    this.loadDossier();
  },

  onShow() {
    if (this.skipNextDossierRevalidation) {
      this.skipNextDossierRevalidation = false;
      return;
    }
    return this.loadDossier({ force: true });
  },

  onUnload() {
    this.pageDisposed = true;
    this.dossierRequestId = (this.dossierRequestId || 0) + 1;
  },

  async resolveProtectedScope({ force = false } = {}) {
    const access = await refreshMembershipAccess({ force });
    const membership = membershipPresentation(access);
    if (!membership.isPrivileged) {
      clearColumnCache();
      const error = new Error('完整档案属于 Pro 权益');
      error.code = 'ENTITLEMENT_REQUIRED';
      throw error;
    }
    return membershipCacheScope(access);
  },

  async loadDossier({ force = false } = {}) {
    if (!this.dossierId) {
      this.setData({ loading: false, error: '没有找到这份趋势档案' });
      return;
    }
    const requestId = (this.dossierRequestId || 0) + 1;
    this.dossierRequestId = requestId;
    this.setData({ loading: true, error: '' });
    try {
      const scope = await this.resolveProtectedScope({ force: true });
      if (this.pageDisposed || requestId !== this.dossierRequestId) return false;
      const payload = await loadTrendDossier(this.dossierId, { force, scope });
      if (this.pageDisposed || requestId !== this.dossierRequestId) return false;
      this.setData({ loading: false, dossier: normalizeTrendDossier(payload) });
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.dossierRequestId) return false;
      const locked = error && error.code === 'ENTITLEMENT_REQUIRED';
      this.setData({
        loading: false,
        dossier: null,
        error: locked ? '完整档案属于 Pro 权益' : (error.message || '这份档案暂时无法打开'),
        membershipPromptVisible: locked
      });
      return false;
    }
  },

  retry() {
    this.loadDossier({ force: true });
  },

  previewIllustration() {
    const visual = this.data.dossier && this.data.dossier.visual;
    if (!visual || visual.mode !== 'image' || !visual.imageUrl) return;
    wx.previewImage({ current: visual.imageUrl, urls: [visual.imageUrl] });
  },

  openLesson(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/column-reader/index?type=lesson&id=${encodeURIComponent(id)}` });
  },

  openCase(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/column-reader/index?type=case&id=${encodeURIComponent(id)}` });
  },

  openSource(event) {
    const index = Number(event.currentTarget.dataset.index);
    const source = this.data.dossier && this.data.dossier.sources[index];
    if (!source) return;
    if (source.itemId) {
      wx.navigateTo({ url: `/pages/feed-detail/index?id=${encodeURIComponent(source.itemId)}` });
      return;
    }
    if (source.url) {
      wx.setClipboardData({
        data: source.url,
        success: () => wx.showToast({ title: '来源链接已复制', icon: 'none' })
      });
    }
  },

  closeMembershipPrompt() {
    this.setData({ membershipPromptVisible: false });
  },

  openMembershipFromPrompt() {
    this.setData({ membershipPromptVisible: false }, () => {
      wx.switchTab({ url: '/pages/profile/index' });
    });
  },

  onShareAppMessage() {
    const dossier = this.data.dossier;
    return {
      title: dossier ? dossier.title : '趋势档案',
      path: `/pages/trend-detail/index?id=${encodeURIComponent(this.dossierId)}`
    };
  }
});
