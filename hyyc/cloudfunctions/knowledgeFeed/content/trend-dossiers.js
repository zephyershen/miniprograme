const TREND_DOSSIERS = Object.freeze([
  {
    key: 'writing-docs', title: '文档与写作', shortTitle: '文档写作',
    summary: '从改写单段文字，走向理解整份材料、保持结构和协同修改。',
    usableNow: ['提纲、改写、校对和多版本表达', '基于明确材料整理结构化文档'],
    unreliableNow: ['未经核验的事实补充', '复杂长文档中跨章节口径完全一致'],
    forWhom: '经常写方案、周报、邮件、制度和内容的人',
    nextWatch: '长文档一致性、引用追踪和多人协作权限'
  },
  {
    key: 'search-research', title: '搜索与研究', shortTitle: '搜索研究',
    summary: '搜索正在从返回链接，变成汇总证据、比较说法并继续追问。',
    usableNow: ['明确问题后的资料初筛', '带来源的对比与线索整理'],
    unreliableNow: ['把二手摘要当成一手证据', '对小众或最新事件给出完整结论'],
    forWhom: '需要做市场、产品、采购或行业调研的人',
    nextWatch: '来源覆盖、引用准确率与付费内容访问边界'
  },
  {
    key: 'data-spreadsheets', title: '表格与数据', shortTitle: '表格数据',
    summary: '自然语言正在降低公式、清洗和可视化门槛，但业务口径仍决定答案。',
    usableNow: ['公式生成、字段清洗和异常初筛', '用自然语言解释常见图表'],
    unreliableNow: ['自动理解公司特有口径', '仅凭相关性推断真实原因'],
    forWhom: '每天处理 Excel、报表或经营指标的人',
    nextWatch: '本地数据权限、可复核计算过程和大表性能'
  },
  {
    key: 'meetings-knowledge', title: '会议与知识管理', shortTitle: '会议知识',
    summary: '录音转写、行动项和知识检索开始连成一条连续工作流。',
    usableNow: ['转写、摘要、行动项草稿', '在规范文档中检索相关片段'],
    unreliableNow: ['嘈杂环境下准确识别人名与否定词', '自动判断谁最终承担责任'],
    forWhom: '会议密集、文档分散或新人培训成本高的团队',
    nextWatch: '权限继承、知识版本和跨会议线索衔接'
  },
  {
    key: 'visual-media', title: '图像与视频', shortTitle: '图像视频',
    summary: '视觉工具从生成单图，走向可编辑素材、连续镜头和真实工作流。',
    usableNow: ['概念草图、版式探索和素材变体', '截图理解与基础视频脚本'],
    unreliableNow: ['长期保持人物与品牌细节一致', '自动处理全部版权与真实性风险'],
    forWhom: '需要做演示、营销素材、短视频或产品原型的人',
    nextWatch: '一致性编辑、来源标识和商用授权'
  },
  {
    key: 'agents-automation', title: 'Agent 与自动化', shortTitle: 'Agent 自动化',
    summary: '模型开始跨工具完成多步任务，价值逐渐从回答问题转向执行流程。',
    usableNow: ['规则清晰、结果可检查的多步任务', '受限权限内的资料收集与草稿生成'],
    unreliableNow: ['长时间无人监督的开放任务', '高风险写入、支付和删除操作'],
    forWhom: '重复流程多、已有标准作业步骤的个人与团队',
    nextWatch: '可靠性、权限隔离、成本上限和失败恢复'
  }
].map((item) => Object.freeze({
  ...item,
  usableNow: Object.freeze(item.usableNow),
  unreliableNow: Object.freeze(item.unreliableNow)
})));

function findDossier(key) {
  return TREND_DOSSIERS.find((item) => item.key === key) || null;
}

module.exports = { TREND_DOSSIERS, findDossier };
