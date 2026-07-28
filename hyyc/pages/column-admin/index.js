const {
  listColumnEntries,
  getColumnEntry,
  createColumnDraft,
  saveColumnDraft
} = require('../../features/column-admin/api.js');
const {
  decorateEntryList,
  nextEntryOrder,
  columnAdminLoadError
} = require('../../features/column-admin/model.js');
const { refreshMembershipAccess } = require('../../features/membership/session.js');
const { membershipPresentation } = require('../../features/membership/presentation.js');

Page({
  data: {
    loading: true,
    creating: '',
    movingId: '',
    error: null,
    activeKind: 'course',
    statusFilter: 'all',
    statusFilters: [
      { key: 'all', label: '全部' },
      { key: 'published', label: '已发布' },
      { key: 'draft', label: '草稿' },
      { key: 'unpublished', label: '已下架' }
    ],
    query: '',
    source: { items: [] },
    items: [],
    courseCount: 0,
    practicalCount: 0
  },

  onShow() {
    this.loadEntries();
  },

  onPullDownRefresh() {
    this.loadEntries().finally(() => wx.stopPullDownRefresh());
  },

  async loadEntries() {
    this.setData({ loading: true, error: null });
    try {
      const access = await refreshMembershipAccess({ force: true });
      if (!membershipPresentation(access).isActualAdmin) {
        throw new Error('只有真实管理员可以管理专栏内容');
      }
      const source = await listColumnEntries();
      const all = source && Array.isArray(source.items) ? source.items : [];
      this.setData({
        loading: false,
        source,
        courseCount: all.filter((item) => item.kind === 'course').length,
        practicalCount: all.filter((item) => item.kind === 'practical').length,
        items: decorateEntryList(source, this.data.activeKind, {
          status: this.data.statusFilter,
          query: this.data.query
        })
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: columnAdminLoadError(error)
      });
    }
  },

  selectKind(event) {
    const activeKind = event.currentTarget.dataset.kind;
    if (!['course', 'practical'].includes(activeKind) || activeKind === this.data.activeKind) return;
    this.setData({ activeKind }, () => this.applyFilters());
  },

  applyFilters() {
    this.setData({
      items: decorateEntryList(this.data.source, this.data.activeKind, {
        status: this.data.statusFilter,
        query: this.data.query
      })
    });
  },

  onQueryInput(event) {
    this.setData({ query: event.detail.value || '' }, () => this.applyFilters());
  },

  clearQuery() {
    this.setData({ query: '' }, () => this.applyFilters());
  },

  selectStatus(event) {
    const statusFilter = event.currentTarget.dataset.status;
    if (!['all', 'published', 'draft', 'unpublished'].includes(statusFilter)
      || statusFilter === this.data.statusFilter) return;
    this.setData({ statusFilter }, () => this.applyFilters());
  },

  async createEntry(event) {
    const kind = event.currentTarget.dataset.kind;
    if (this.data.creating || !['course', 'practical'].includes(kind)) return;
    this.setData({ creating: kind });
    try {
      const entry = await createColumnDraft(kind);
      wx.navigateTo({
        url: `/pages/column-editor/index?id=${encodeURIComponent(entry.id)}`
      });
    } catch (error) {
      wx.showToast({ title: error.message || '草稿创建失败', icon: 'none' });
    } finally {
      this.setData({ creating: '' });
    }
  },

  openEntry(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/column-editor/index?id=${encodeURIComponent(id)}` });
  },

  async moveEntry(event) {
    const id = event.currentTarget.dataset.id;
    const direction = Number(event.currentTarget.dataset.direction);
    const index = this.data.items.findIndex((item) => item.id === id);
    const targetIndex = index + direction;
    if (!id || this.data.movingId || index < 0 || targetIndex < 0
      || targetIndex >= this.data.items.length) return;
    const current = this.data.items[index];
    const before = this.data.items[targetIndex];
    if (current.track !== before.track) return;
    const nextOrder = nextEntryOrder(this.data.items, index, direction);
    if (!Number.isFinite(nextOrder)) return;
    this.setData({ movingId: id });
    try {
      const entry = await getColumnEntry(id);
      const draft = { ...entry.draft, order: nextOrder };
      await saveColumnDraft(id, entry.version, draft);
      await this.loadEntries();
      wx.showToast({
        title: entry.status === 'published' ? '排序已存入草稿，发布后生效' : '排序已保存',
        icon: 'none'
      });
    } catch (error) {
      wx.showToast({ title: error.message || '排序保存失败', icon: 'none' });
    } finally {
      this.setData({ movingId: '' });
    }
  }
});
