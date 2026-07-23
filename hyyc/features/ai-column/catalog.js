const COLUMN_SECTIONS = Object.freeze([
  Object.freeze({ key: 'courses', label: '基础课', note: '先把概念讲明白' }),
  Object.freeze({ key: 'practicals', label: '动手课', note: '跟着步骤真正用起来' })
]);

const COLUMN_TRACKS = Object.freeze([
  Object.freeze({ key: 'understand', label: '先把 AI 看明白', note: '知道它会什么，也知道哪里别太相信' }),
  Object.freeze({ key: 'instruct', label: '学会把话说清楚', note: '把模糊想法变成能检查的要求' }),
  Object.freeze({ key: 'work', label: '放进日常工作', note: '从调研、写作到会议和表格' }),
  Object.freeze({ key: 'execute', label: '让 AI 真正做事', note: '看懂工具、Agent 和自动化的边界' })
]);

function trackForOrder(order) {
  if (order <= 6) return 'understand';
  if (order <= 12) return 'instruct';
  if (order <= 18) return 'work';
  return 'execute';
}

const COLUMN_LESSONS = Object.freeze([
  ['model-basics', 1, 'MODEL', '大模型到底是怎么回答问题的'],
  ['context', 2, 'CONTEXT', '聊久了，它为什么会忘'],
  ['hallucination', 3, 'HALLUCINATION', '说得像真的，也可能是错的'],
  ['rag', 4, 'RAG', '让 AI 根据你的资料回答'],
  ['multimodal', 5, 'MULTIMODAL', '让文字、图片和声音一起帮忙'],
  ['release-signal', 6, 'SIGNAL', '模型更新，到底值不值得关注'],
  ['task-first', 7, 'TASK', '先说清要什么，别急着背提示词'],
  ['context-brief', 8, 'BRIEF', '把背景、对象和限制说完整'],
  ['examples', 9, 'EXAMPLE', '给个例子，让 AI 更懂你要什么'],
  ['decompose', 10, 'DECOMPOSE', '复杂任务，拆开一步步做'],
  ['evidence', 11, 'EVIDENCE', '让答案说清依据和不确定的地方'],
  ['acceptance', 12, 'CHECKLIST', '做一张自己的结果检查表'],
  ['research', 13, 'RESEARCH', '用 AI 快速调研，也别被假信息带偏'],
  ['writing', 14, 'WRITING', '用 AI 写作、改写和校对'],
  ['data-table', 15, 'DATA', '让 AI 帮你处理表格和数据'],
  ['meeting', 16, 'MEETING', '把会议整理成能执行的下一步'],
  ['knowledge-base', 17, 'KNOWLEDGE', '把收藏的资料变成真正能用的知识库'],
  ['presentation', 18, 'PRESENTATION', '用 AI 做一份讲得清楚的演示稿'],
  ['tool-call', 19, 'TOOL CALL', '让 AI 调用工具去查、算和执行'],
  ['agent', 20, 'AGENT', '让 Agent 把任务继续做下去'],
  ['skill', 21, 'SKILL', '把好用的方法做成 Skill'],
  ['mcp', 22, 'MCP', '用 MCP 连接外部资料和工具'],
  ['workflow', 23, 'WORKFLOW', '什么任务值得做成自动化'],
  ['security', 24, 'BOUNDARY', '哪些信息不能给 AI，哪些操作不能自动做']
].map(([id, order, term, title]) => Object.freeze({
  id,
  track: trackForOrder(order),
  order: String(order).padStart(2, '0'),
  term,
  title
})));

const COLUMN_PRACTICALS = Object.freeze([
  ['codex-cli-install', 1, '安装', '安装 Codex CLI'],
  ['codex-cli-first-task', 2, '上手', '用 Codex CLI 完成第一个任务'],
  ['claude-code-install', 3, '安装', '安装 Claude Code'],
  ['claude-code-first-task', 4, '上手', '用 Claude Code 完成第一个任务'],
  ['api-key-safety', 5, '安全', '配置 API Key，又不把密钥泄露出去'],
  ['mcp-connect', 6, '连接', '连接第一个 MCP 工具']
].map(([id, order, term, title]) => Object.freeze({
  id,
  order: String(order).padStart(2, '0'),
  term,
  title
})));

const COLUMN_TREND_PREVIEWS = Object.freeze([
  ['writing-docs', '文档与写作'],
  ['search-research', '搜索与研究'],
  ['data-spreadsheets', '表格与数据'],
  ['meetings-knowledge', '会议与知识管理'],
  ['visual-media', '图像与视频'],
  ['agents-automation', 'Agent 与自动化']
].map(([id, title]) => Object.freeze({ id, title })));

module.exports = {
  COLUMN_SECTIONS,
  COLUMN_TRACKS,
  COLUMN_LESSONS,
  COLUMN_PRACTICALS,
  COLUMN_TREND_PREVIEWS
};
