const CURATED_SAMPLE = Object.freeze({
  label: '精选示例',
  title: '重要更新，先讲清它改变了什么',
  summary: '精选不等于热度榜。我们优先保留一手发布、影响明确，并且会改变产品或工作方式的内容。',
  reason: '一手来源 · 影响明确',
  source: '示例来源',
  publishedLabel: '示例内容',
  related: Object.freeze([
    { id: 'sample-1', reason: '重复报道 · 自动合并', title: '同一件事，只保留信息最完整的一条' },
    { id: 'sample-2', reason: '使用方式 · 真正改变', title: '功能很多，只有影响工作方式的更新才值得打扰你' },
    { id: 'sample-3', reason: '趋势信号 · 多源确认', title: '一个观点不是趋势，持续出现的证据才是' }
  ])
});

module.exports = { CURATED_SAMPLE };
