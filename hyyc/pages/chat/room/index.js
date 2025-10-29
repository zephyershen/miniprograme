Page({
  data: { tid: '', msgs: [], text: '', toView: '' },
  onLoad(q){ this.setData({ tid: q.tid||'' }); this.mockHistory(); },
  mockHistory(){
    const msgs=[
      { id:1, text:'你好，我来接这个任务可以吗？', mine:false },
      { id:2, text:'可以的，取快递在3栋柜子。', mine:true }
    ];
    this.setData({ msgs, toView: 'm2' });
  },
  onInput(e){ this.setData({ text: e.detail.value }); },
  send(){
    if(!this.data.text.trim()) return;
    const id = (this.data.msgs.slice(-1)[0]?.id||0)+1;
    const msgs = this.data.msgs.concat({ id, text: this.data.text, mine:true });
    this.setData({ msgs, text:'', toView: 'm'+id });
  }
});

