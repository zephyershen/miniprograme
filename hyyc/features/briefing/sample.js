const BRIEFING_SAMPLE = Object.freeze({
  id: 'fixed-member-sample',
  status: 'sample',
  sample: true,
  title: '这一期，值得你知道的事',
  conclusion: '别只看发布标题。先确认到底发生了什么，再回到原始来源核对关键细节。',
  coverageLabel: '体验示例 · 非本期内容',
  generatedLabel: '展示完整简报结构',
  mustKnow: Object.freeze([
    { index: '01', title: '先说清到底变了什么', why: '不照搬发布标题，而是直接说明已经确认了什么、信息来自哪里、还有哪些没有确认。', tags: ['model'] },
    { index: '02', title: '同一件事，不重复占你的时间', why: '相同消息合在一起，只留下信息最完整、最接近原始发布的来源。', tags: ['source'] },
    { index: '03', title: '别把一时热闹当成长期趋势', why: '一个变化经过不同来源和一段时间的验证后，才值得当成趋势看。', tags: ['trend'] }
  ]),
  radar: Object.freeze([
    { name: '公司在做什么', copy: '只看那些会改变产品方向或市场竞争的动作。', tags: ['company'] },
    { name: '模型哪里变了', copy: '只留下会影响能力、价格、速度或使用范围的变化。', tags: ['model'] }
  ]),
  reading: Object.freeze([
    { itemId: '', title: '想核对时，可以回到原始来源', source: '示例来源', tags: ['source'] }
  ]),
  sourceCount: 8
});

module.exports = { BRIEFING_SAMPLE };
