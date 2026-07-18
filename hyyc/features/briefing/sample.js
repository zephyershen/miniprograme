const BRIEFING_SAMPLE = Object.freeze({
  id: 'fixed-member-sample',
  status: 'sample',
  sample: true,
  title: '一份能直接做判断的简报',
  conclusion: '真正省时间，不是少给几条标题，而是先告诉你：发生了什么、为什么重要、下一步看什么。',
  coverageLabel: '体验示例 · 非本期内容',
  generatedLabel: '展示完整简报结构',
  mustKnow: Object.freeze([
    { index: '01', title: '先指出真正发生变化的地方', why: '不复述发布标题，直接说明会影响谁、影响什么，以及是否需要行动。', tags: ['model'] },
    { index: '02', title: '重复信息只算一件事', why: '合并同一事件，保留信息最完整、最接近原始发布的来源。', tags: ['source'] },
    { index: '03', title: '趋势必须经得起时间验证', why: '跨来源、跨时间仍然成立的信号，才进入趋势判断。', tags: ['trend'] }
  ]),
  trends: Object.freeze([
    { title: '从“发布了什么”转向“能不能用”', copy: '重要性不由声量决定，而由它是否改变真实体验决定。', tags: ['trend'] },
    { title: '工具正在变成完整工作流', copy: '单点能力开始组合成可以直接完成任务的流程。', tags: ['tools'] }
  ]),
  radar: Object.freeze([
    { name: '公司动态', copy: '只追踪会改变产品方向和竞争格局的动作。', tags: ['company'] },
    { name: '模型更新', copy: '只保留影响能力、价格、速度或使用边界的变化。', tags: ['model'] }
  ]),
  reading: Object.freeze([
    { itemId: '', title: '每个重要判断，都能回到原始来源', source: '示例来源', tags: ['source'] }
  ]),
  sourceCount: 8,
  coverageState: 'sample'
});

module.exports = { BRIEFING_SAMPLE };
