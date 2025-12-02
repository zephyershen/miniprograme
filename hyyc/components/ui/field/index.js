Component({
  properties: {
    label: String,
    error: String,
    // 标签后面的小提示文字，例如「不填默认无限制时间」
    hint: {
      type: String,
      value: ''
    },
    // 是否必填，用于在标题后面展示红色小星号
    required: {
      type: Boolean,
      value: false
    }
  }
});
