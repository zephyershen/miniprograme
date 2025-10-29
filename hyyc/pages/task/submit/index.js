const { toast } = require('../../../utils/ui');
Page({
  data: { tid: '', note: '', images: [] },
  onLoad(q){ this.setData({ tid: q.tid||'' }); },
  onNote(e){ this.setData({ note: e.detail.value }); },
  choose(){ wx.chooseImage({ count: 3, success: ({tempFilePaths})=> this.setData({ images: this.data.images.concat(tempFilePaths) }) }); },
  cancel(){ wx.navigateBack(); },
  submit(){ toast('已提交（演示）'); wx.navigateBack(); }
});

