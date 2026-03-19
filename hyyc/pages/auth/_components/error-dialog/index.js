Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    message: { type: String, value: '出错了，请稍后重试' },
    confirmText: { type: String, value: '确定' }
  },
  methods: {
    onConfirm() {
      this.triggerEvent('confirm');
    }
  }
});
