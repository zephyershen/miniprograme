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
  submit(){ 
    const workflowEnabled = !!(access && access.features && access.features.taskWorkflow);
    if (!workflowEnabled) {
      toast('当前操作暂未开放');
      return;
    }
    this.setData({ isLoading: true });
    setTimeout(() => {
      this.setData({ isLoading: false });
      toast('已提交'); 
      wx.navigateBack(); 
    }, 1000);
  }
});
