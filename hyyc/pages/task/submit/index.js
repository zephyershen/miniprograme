const { toast } = require('../../../utils/ui');
const access = require('../../../config/access');
Page({
  data: { tid: '', note: '', images: [], isLoading: false },
  onLoad(q){
    const tid = (q && q.tid) || '';
    this.setData({ tid });
    const workflowEnabled = !!(access && access.features && access.features.taskWorkflow);
    if (!workflowEnabled) {
      // 有 tid 就直接回到聊天页，避免用户卡在“提交验收”
      if (tid) {
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/chat/room/index?tid=' + tid });
        }, 250);
      } else {
        setTimeout(() => wx.navigateBack(), 250);
      }
    }
  },
  onNote(e){ this.setData({ note: e.detail.value }); },
  choose(){ wx.chooseImage({ count: 3, success: ({tempFilePaths})=> this.setData({ images: this.data.images.concat(tempFilePaths) }) }); },
  cancel(){ wx.navigateBack(); },
  async submit(){ 
    const workflowEnabled = !!(access && access.features && access.features.taskWorkflow);
    if (!workflowEnabled) {
      toast('当前操作暂未开放');
      return;
    }
    const tid = this.data.tid || '';
    if (!tid) {
      toast('缺少任务 ID');
      return;
    }

    const note = String(this.data.note || '').trim();
    const images = Array.isArray(this.data.images) ? this.data.images.filter(Boolean) : [];
    if (!note && !images.length) {
      toast('请填写完成说明或上传至少 1 张凭证');
      return;
    }

    const me = wx.getStorageSync('hyyc_user') || {};

    this.setData({ isLoading: true });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const tempImages = images.slice();
      const uploadTasks = tempImages.map((p, idx) => {
        if (typeof p === 'string' && p.indexOf('cloud://') === 0) return Promise.resolve(p);
        return wx.cloud.uploadFile({
          cloudPath: `task_submit/${tid}/${me.id || 'anonymous'}/${Date.now()}_${idx}.jpg`,
          filePath: p
        }).then(res => res.fileID);
      });
      const fileIDs = await Promise.all(uploadTasks);

      const r = await wx.cloud.callFunction({
        name: 'taskSubmit',
        data: {
          taskId: tid,
          note,
          images: fileIDs
        }
      });
      const ret = r && r.result ? r.result : null;

      wx.hideLoading();
      this.setData({ isLoading: false });

      if (!ret || !ret.ok) {
        const msg = (ret && ret.code === 'NOT_WORKER')
          ? '你不是该任务的接单人，不能提交'
          : ((ret && ret.msg) || '提交失败');
        toast(msg);
        return;
      }

      toast('已提交');
      wx.redirectTo({ url: '/pages/task/detail/index?id=' + tid });
    } catch (err) {
      console.error('提交验收失败', err);
      wx.hideLoading();
      this.setData({ isLoading: false });
      toast('提交失败');
    }
  }
});
