const {
  getColumnEntry,
  saveColumnDraft,
  publishColumnDraft,
  unpublishColumnEntry
} = require('../../features/column-admin/api.js');
const {
  editableForm,
  draftFromForm,
  entryStatus,
  tracksForKind
} = require('../../features/column-admin/model.js');
const { uploadColumnImage } = require('../../features/column-admin/media.js');
const { clearColumnCache } = require('../../features/ai-column/session.js');

function safeDecode(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (error) {
    return value || '';
  }
}

function chooseImages() {
  return new Promise((resolve, reject) => wx.chooseMedia({
    count: 9,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    success: (result) => resolve((result && result.tempFiles) || []),
    fail: (error) => {
      if (/cancel/i.test(error && error.errMsg || '')) resolve([]);
      else reject(error);
    }
  }));
}

function confirmUnpublish() {
  return new Promise((resolve) => wx.showModal({
    title: '下架这篇内容？',
    content: '会员目录和已分享的详情入口都会停止展示，草稿与最后发布版本仍会保留。',
    confirmText: '确认下架',
    confirmColor: '#c23b32',
    success: (result) => resolve(Boolean(result && result.confirm)),
    fail: () => resolve(false)
  }));
}

Page({
  data: {
    loading: true,
    busy: false,
    busyAction: '',
    uploading: false,
    uploadProgress: '',
    error: '',
    entry: null,
    statusView: entryStatus('draft'),
    tracks: [],
    trackIndex: 0,
    form: null
  },

  onLoad(options = {}) {
    this.entryId = safeDecode(options.id);
    this.loadEntry();
  },

  async loadEntry() {
    if (!this.entryId) {
      this.setData({ loading: false, error: '没有找到这篇草稿' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      this.applyEntry(await getColumnEntry(this.entryId));
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '草稿暂时无法读取'
      });
    }
  },

  applyEntry(entry) {
    const form = editableForm(entry);
    const tracks = tracksForKind(form.kind);
    const trackIndex = Math.max(0, tracks.findIndex((track) => track.key === form.track));
    if (!form.track && tracks[trackIndex]) form.track = tracks[trackIndex].key;
    this.setData({
      loading: false,
      error: '',
      entry,
      form,
      tracks,
      trackIndex,
      statusView: entryStatus(entry.status)
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value || '' });
  },

  onTrackChange(event) {
    const trackIndex = Number(event.detail.value) || 0;
    const track = this.data.tracks[trackIndex];
    if (!track) return;
    this.setData({ trackIndex, 'form.track': track.key });
  },

  addPlatform() {
    const platforms = [...(this.data.form.platforms || []), {
      id: `platform-${Date.now().toString(36)}`,
      label: '',
      terminal: '',
      commandsText: '',
      stepsText: ''
    }];
    this.setData({ 'form.platforms': platforms });
  },

  removePlatform(event) {
    const index = Number(event.currentTarget.dataset.index);
    const platforms = [...(this.data.form.platforms || [])];
    if (!Number.isInteger(index) || !platforms[index]) return;
    platforms.splice(index, 1);
    this.setData({ 'form.platforms': platforms });
  },

  onPlatformInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    if (!Number.isInteger(index) || !field) return;
    this.setData({ [`form.platforms[${index}].${field}`]: event.detail.value || '' });
  },

  async addImages() {
    if (this.data.uploading || this.data.busy) return;
    try {
      const selected = await chooseImages();
      if (!selected.length) return;
      this.setData({ uploading: true });
      const posters = [...(this.data.form.posters || [])];
      for (let index = 0; index < selected.length; index += 1) {
        this.setData({ uploadProgress: `正在处理 ${index + 1} / ${selected.length}` });
        const uploaded = await uploadColumnImage(
          this.entryId,
          selected[index].tempFilePath,
          {
            canvas: {
              component: this,
              canvasId: 'columnMediaCompressor'
            }
          }
        );
        posters.push({
          ...uploaded,
          alt: `${this.data.form.title || '课程'}讲解图第 ${posters.length + 1} 页`
        });
        this.setData({ 'form.posters': posters });
      }
      wx.showToast({ title: `已添加 ${selected.length} 张图片`, icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '图片上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: false, uploadProgress: '' });
    }
  },

  onPosterAltInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ [`form.posters[${index}].alt`]: event.detail.value || '' });
  },

  movePoster(event) {
    const index = Number(event.currentTarget.dataset.index);
    const direction = Number(event.currentTarget.dataset.direction);
    const target = index + direction;
    const posters = [...(this.data.form.posters || [])];
    if (!posters[index] || target < 0 || target >= posters.length) return;
    [posters[index], posters[target]] = [posters[target], posters[index]];
    this.setData({ 'form.posters': posters });
  },

  removePoster(event) {
    const index = Number(event.currentTarget.dataset.index);
    const posters = [...(this.data.form.posters || [])];
    if (!posters[index]) return;
    posters.splice(index, 1);
    this.setData({ 'form.posters': posters });
  },

  async persistDraft() {
    const entry = await saveColumnDraft(
      this.entryId,
      this.data.entry.version,
      draftFromForm(this.data.form)
    );
    this.applyEntry(entry);
    return entry;
  },

  async saveDraft() {
    if (this.data.busy || this.data.uploading) return;
    this.setData({ busy: true, busyAction: 'save' });
    try {
      await this.persistDraft();
      wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '草稿保存失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, busyAction: '' });
    }
  },

  async previewDraft() {
    if (this.data.busy || this.data.uploading) return;
    this.setData({ busy: true, busyAction: 'preview' });
    try {
      await this.persistDraft();
      wx.navigateTo({
        url: `/pages/column-reader/index?type=${this.data.form.kind === 'practical' ? 'practical' : 'lesson'}&id=${encodeURIComponent(this.entryId)}&adminPreview=1`
      });
    } catch (error) {
      wx.showToast({ title: error.message || '草稿预览失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, busyAction: '' });
    }
  },

  async publishDraft() {
    if (this.data.busy || this.data.uploading) return;
    this.setData({ busy: true, busyAction: 'publish' });
    try {
      const saved = await this.persistDraft();
      const published = await publishColumnDraft(this.entryId, saved.version);
      clearColumnCache();
      this.applyEntry(published);
      wx.showToast({ title: '已发布', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '发布失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, busyAction: '' });
    }
  },

  async unpublishEntry() {
    if (this.data.busy || this.data.uploading || this.data.entry.status !== 'published') return;
    if (!await confirmUnpublish()) return;
    this.setData({ busy: true, busyAction: 'unpublish' });
    try {
      const entry = await unpublishColumnEntry(this.entryId, this.data.entry.version);
      clearColumnCache();
      this.applyEntry(entry);
      wx.showToast({ title: '已下架', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '下架失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, busyAction: '' });
    }
  }
});
