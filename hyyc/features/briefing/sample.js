const BRIEFING_SAMPLE = Object.freeze({
  id: 'fixed-member-sample',
  status: 'sample',
  sample: true,
  title: '会员简报示例',
  conclusion: '真正省时间的简报，不是把几十条标题再抄一遍，而是先告诉你什么发生了变化。',
  coverageLabel: '固定示例 · 不代表本期内容',
  generatedLabel: '用于展示简报结构',
  mustKnow: Object.freeze([
    { index: '01', title: '重要版本发生变化', why: '说明变化会影响哪些用户、产品或工作方式，而不是只复述发布标题。', tags: ['model'] },
    { index: '02', title: '同一事件出现多个来源', why: '合并重复信息，并保留可以交叉核对的出处。', tags: ['source'] },
    { index: '03', title: '行业讨论出现持续趋势', why: '只有跨来源、跨时间仍然成立的信号，才会进入趋势部分。', tags: ['trend'] }
  ]),
  trends: Object.freeze([
    { title: '从发布数量转向实际可用性', copy: '关注点从“又发布了什么”转向“是否真的改变使用体验”。', tags: ['trend'] },
    { title: '开发工具更强调完整工作流', copy: '单点能力逐渐组合成可以直接完成任务的流程。', tags: ['tools'] }
  ]),
  radar: Object.freeze([
    { name: '公司动态', copy: '重大产品、模型和组织变化会在这里汇总。', tags: ['company'] },
    { name: '模型更新', copy: '只保留影响能力、价格、速度或使用边界的变化。', tags: ['model'] }
  ]),
  reading: Object.freeze([
    { itemId: '', title: '值得继续读的来源会附在结论后面', source: '示例来源', tags: ['source'] }
  ]),
  sourceCount: 8,
  coverageState: 'sample'
});

module.exports = { BRIEFING_SAMPLE };
