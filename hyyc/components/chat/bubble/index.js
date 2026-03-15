Component({
  properties: {
    mine: Boolean,
    // 文本消息内容
    text: String,
    // 消息类型：text / image
    type: {
      type: String,
      value: 'text'
    },
    // 图片消息地址（云文件 ID 或 http 链接）
    imageUrl: {
      type: String,
      value: ''
    },
    avatarUrl: {
      type: String,
      value: ''
    },
    avatarClickable: {
      type: Boolean,
      value: false
    }
  },
  methods: {
    onAvatarTap() {
      if (!this.data.avatarClickable) return;
      this.triggerEvent('avatartap');
    },
    // 点击图片放大预览
    onImageTap() {
      const url = this.data.imageUrl;
      if (!url) return;
      // 这里用单张预览，urls 仍然传数组，方便后续扩展为多张
      wx.previewImage({
        current: url,
        urls: [url]
      });
    }
  }
});
