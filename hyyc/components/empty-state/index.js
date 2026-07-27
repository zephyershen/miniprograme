Component({
  properties: {
    title: { type: String, value: '' },
    copy: { type: String, value: '' },
    actionLabel: { type: String, value: '' }
  },

  methods: {
    handleAction() {
      if (this.data.actionLabel) this.triggerEvent('action');
    }
  }
});
