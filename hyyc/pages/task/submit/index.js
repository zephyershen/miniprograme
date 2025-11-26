const { toast } = require('../../../utils/ui');
Page({
  data: { tid: '', note: '', images: [], isLoading: false },
  onLoad(q){ this.setData({ tid: q.tid||'' }); },
  onNote(e){ this.setData({ note: e.detail.value }); },
  choose(){ wx.chooseImage({ count: 3, success: ({tempFilePaths})=> this.setData({ images: this.data.images.concat(tempFilePaths) }) }); },
  cancel(){ wx.navigateBack(); },
  submit(){ 
    this.setData({ isLoading: true });
    setTimeout(() => {
      this.setData({ isLoading: false });
      toast('已提交（演示）'); 
      wx.navigateBack(); 
    }, 1000);
  }
});

