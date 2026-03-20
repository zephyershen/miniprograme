Component({
  properties: {
    show: { type: Boolean, value: false },
    text: { type: String, value: '正在加载' }
  },
  data: {
    spokes: Array.from({ length: 12 }, (_, index) => ({
      id: index,
      className: `spoke-${index + 1}`,
    })),
  }
});
