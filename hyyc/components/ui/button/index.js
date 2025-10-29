Component({
  properties: {
    type: { type: String, value: 'primary' }, // primary/outline/ghost/danger
    size: { type: String, value: 'base' }, // base/sm
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false }
  },
  data: { typeClass: 'btn-primary', sizeClass: '' },
  methods: {
    onTap() {
      if (this.properties.loading || this.properties.disabled) return;
      this.triggerEvent('tap');
    }
  },
  observers: {
    'type,size': function(type,size){
      const map = { primary:'btn-primary', outline:'btn-outline', ghost:'btn-ghost', danger:'btn-danger' };
      const sm = size==='sm' ? 'btn-sm' : '';
      this.setData({ typeClass: map[type]||'btn-primary', sizeClass: sm });
    }
  }
});

