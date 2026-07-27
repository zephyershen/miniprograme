const {
  loadColumnLesson,
  loadColumnPractical,
  loadColumnCase,
  clearColumnCache
} = require('../../features/ai-column/session.js');
const {
  normalizeReader,
  posterLoadWindow,
  posterPreviewUrls
} = require('../../features/ai-column/model.js');
const {
  refreshMembershipAccess,
  membershipCacheScope
} = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');
const { getColumnDraftPreview } = require('../../features/column-admin/api.js');

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
    article: null,
    visualLoading: false,
    activePosterIndex: 0,
    posterLoads: [],
    posterError: '',
    membershipPromptVisible: false,
    membershipPromptFeature: 'ai_column'
  },

  onLoad(options = {}) {
    this.pageDisposed = false;
    this.contentRequestId = 0;
    this.skipNextContentRevalidation = true;
    this.articleType = options.type === 'practical'
      ? 'practical'
      : options.type === 'case' ? 'case' : 'lesson';
    this.articleId = safeDecode(options.id);
    this.adminPreview = options.adminPreview === '1';
    const titles = { lesson: '基础课', practical: '动手课', case: '案例' };
    wx.setNavigationBarTitle({
      title: this.adminPreview ? '草稿预览' : titles[this.articleType]
    });
    this.loadContent();
  },

  onShow() {
    if (this.skipNextContentRevalidation) {
      this.skipNextContentRevalidation = false;
      return;
    }
    return this.loadContent({ force: true, preserveCurrent: true });
  },

  onUnload() {
    this.pageDisposed = true;
    this.contentRequestId = (this.contentRequestId || 0) + 1;
  },

  async resolveProtectedScope({ force = false } = {}) {
    const access = await refreshMembershipAccess({ force });
    const membership = membershipPresentation(access);
    if (this.adminPreview) {
      if (!membership.isActualAdmin) {
        const error = new Error('只有真实管理员可以预览草稿');
        error.code = 'ADMIN_REQUIRED';
        throw error;
      }
      return `admin-draft:${membershipCacheScope(access)}`;
    }
    if (!membership.isPrivileged) {
      clearColumnCache();
      const error = new Error('完整内容属于 Pro 权益');
      error.code = 'ENTITLEMENT_REQUIRED';
      throw error;
    }
    return membershipCacheScope(access);
  },

  async loadContent({ force = false, preserveCurrent = false } = {}) {
    if (!this.articleId) {
      this.setData({ loading: false, error: '没有找到这篇内容' });
      return;
    }
    const requestId = (this.contentRequestId || 0) + 1;
    this.contentRequestId = requestId;
    const currentArticle = preserveCurrent ? this.data.article : null;
    this.setData(currentArticle ? { error: '' } : { loading: true, error: '' });
    try {
      const scope = await this.resolveProtectedScope({ force: true });
      if (this.pageDisposed || requestId !== this.contentRequestId) return false;
      const payload = this.adminPreview
        ? await getColumnDraftPreview(this.articleId)
        : this.articleType === 'practical'
        ? await loadColumnPractical(this.articleId, { force, scope })
        : this.articleType === 'case'
          ? await loadColumnCase(this.articleId, { force, scope })
          : await loadColumnLesson(this.articleId, { force, scope });
      if (this.pageDisposed || requestId !== this.contentRequestId) return false;
      const article = normalizeReader(this.articleType, payload);
      const articleChanged = !currentArticle
        || JSON.stringify(currentArticle) !== JSON.stringify(article);
      const activePosterIndex = currentArticle
        ? Math.min(this.data.activePosterIndex, Math.max(0, article.posters.length - 1))
        : 0;
      this.setData({
        loading: false,
        error: '',
        ...(articleChanged ? {
          article,
          activePosterIndex,
          posterLoads: posterLoadWindow(activePosterIndex, article.posters.length),
          posterError: '',
          visualLoading: article.visual.mode === 'image'
        } : {})
      });
      return true;
    } catch (error) {
      if (this.pageDisposed || requestId !== this.contentRequestId) return false;
      const locked = error && error.code === 'ENTITLEMENT_REQUIRED';
      if (currentArticle && !locked) {
        this.setData({ loading: false, error: '' });
        return false;
      }
      this.setData({
        loading: false,
        article: null,
        error: locked ? '完整内容属于 Pro 权益' : (error.message || '这篇内容暂时无法打开'),
        membershipPromptVisible: locked
      });
      return false;
    }
  },

  retry() {
    this.loadContent({ force: true });
  },

  previewIllustration() {
    const visual = this.data.article && this.data.article.visual;
    if (!visual || visual.mode !== 'image' || !visual.imageUrl) return;
    wx.previewImage({ current: visual.imageUrl, urls: [visual.imageUrl] });
  },

  handleVisualLoad() {
    if (this.data.visualLoading) this.setData({ visualLoading: false });
  },

  handleVisualError() {
    this.setData({ visualLoading: false });
    wx.showToast({ title: '示意图暂时无法加载', icon: 'none' });
  },

  handlePosterChange(event) {
    const article = this.data.article;
    const total = article && Array.isArray(article.posters) ? article.posters.length : 0;
    const activePosterIndex = Number(event.detail && event.detail.current) || 0;
    this.setData({
      activePosterIndex,
      posterLoads: posterLoadWindow(activePosterIndex, total),
      posterError: ''
    });
  },

  handlePosterError(event) {
    const posterKey = event.currentTarget.dataset.key || 'unknown';
    console.error('[ai-column] poster failed to load', posterKey, event.detail && event.detail.errMsg);
    this.setData({ posterError: posterKey });
    wx.showToast({ title: '手绘图加载失败，请重试', icon: 'none' });
  },

  previewPoster(event) {
    const urls = posterPreviewUrls(this.data.article);
    if (!urls.length) {
      wx.showToast({ title: '高清图暂时不可用', icon: 'none' });
      return;
    }
    const requestedIndex = Number(event.currentTarget.dataset.index) || 0;
    const currentIndex = Math.min(Math.max(requestedIndex, 0), urls.length - 1);
    wx.previewImage({
      current: urls[currentIndex],
      urls,
      fail: () => wx.showToast({ title: '高清图加载失败，请重试', icon: 'none' })
    });
  },

  copyCommand(event) {
    const index = Number(event.currentTarget.dataset.index);
    const command = this.data.article && this.data.article.commands[index];
    if (!command || !command.value) return;
    wx.setClipboardData({
      data: command.value,
      success: () => wx.showToast({ title: '命令已复制', icon: 'none' })
    });
  },

  copyPlatformCommand(event) {
    const guideIndex = Number(event.currentTarget.dataset.guideIndex);
    const commandIndex = Number(event.currentTarget.dataset.commandIndex);
    const guides = this.data.article && this.data.article.platformGuides;
    const guide = Array.isArray(guides) ? guides[guideIndex] : null;
    const command = guide && guide.commands[commandIndex];
    if (!command || !command.value) return;
    wx.setClipboardData({
      data: command.value,
      success: () => wx.showToast({ title: '命令已复制', icon: 'none' })
    });
  },

  openRelatedLesson(event) {
    this.openReader('lesson', event.currentTarget.dataset.id);
  },

  openRelatedPractical(event) {
    this.openReader('practical', event.currentTarget.dataset.id);
  },

  openRelatedTrend(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.redirectTo({ url: `/pages/trend-detail/index?id=${encodeURIComponent(id)}` });
  },

  openReader(type, id) {
    if (!id) return;
    wx.redirectTo({ url: `/pages/column-reader/index?type=${type}&id=${encodeURIComponent(id)}` });
  },

  openSource(event) {
    const index = Number(event.currentTarget.dataset.index);
    const source = this.data.article && this.data.article.sources[index];
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
    const article = this.data.article;
    return {
      title: article ? article.title : '知识专栏',
      path: `/pages/column-reader/index?type=${this.articleType}&id=${encodeURIComponent(this.articleId)}`
    };
  }
});
