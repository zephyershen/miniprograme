Page({
  data: { tid: '', msgs: [], text: '', toView: '', isLoading: true },
  onLoad(q){ this.setData({ tid: q.tid||'' }); this.mockHistory(); },
  mockHistory(){
    this.setData({ isLoading: true });
    setTimeout(() => {
      const msgs=[
        { id:1, text:'你好，我来接这个任务可以吗？', mine:false },
        { id:2, text:'可以的，取快递在3栋柜子。', mine:true }
      ];
      this.setData({ msgs, toView: 'm2', isLoading: false });
    }, 600);
  },
  onInput(e){ this.setData({ text: e.detail.value }); },
  send(){
    if(!this.data.text.trim()) return;
    // 兼容不支持可选链的环境：手动取最后一条消息的 id
    const last = this.data.msgs[this.data.msgs.length - 1];
    const id = ((last && last.id) || 0) + 1;
    const msgs = this.data.msgs.concat({ id, text: this.data.text, mine:true });
    this.setData({ msgs, text:'', toView: 'm'+id });
  }
});
