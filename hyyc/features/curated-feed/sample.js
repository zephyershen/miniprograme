const CURATED_SAMPLE = Object.freeze({
  label: '会员示例',
  title: '一次重要更新，应该先回答“改变了什么”',
  summary: '精选不会只按热度排列。它会优先保留一手发布、影响范围明确、能够改变产品或工作方式的内容。',
  reason: '一手发布 · 影响明确',
  source: '示例来源',
  publishedLabel: '示例内容',
  related: Object.freeze([
    { id: 'sample-1', reason: '版本变化 · 值得关注', title: '同一事件的重复报道会先去重，再保留信息最完整的一条' },
    { id: 'sample-2', reason: '开发实践 · 可直接应用', title: '只有真正影响使用方式的工具更新，才会进入精选' },
    { id: 'sample-3', reason: '趋势变化 · 多源确认', title: '单条噪声不会被包装成行业趋势，结论需要来源支撑' }
  ])
});

module.exports = { CURATED_SAMPLE };
