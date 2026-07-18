const { LESSON_POSTERS } = require('./assets.js');

const COLUMN_TRACKS = Object.freeze([
  { key: 'all', label: '学习路线' },
  { key: 'concept', label: '核心概念' },
  { key: 'practice', label: '工作方式' }
]);

const BASE_COLUMN_LESSONS = Object.freeze([
  Object.freeze({
    id: 'agent',
    order: '01',
    track: 'concept',
    term: 'AGENT',
    title: '什么是 Agent？',
    subtitle: '不只回答问题，而是围绕目标持续行动',
    duration: '6 分钟',
    definition: 'Agent 是能理解目标、制定步骤、调用工具，并根据结果继续行动的 AI 系统。',
    example: '你让它“整理竞品并给出结论”，它会自己搜索、读取、比较和写作，而不是只回复一句建议。',
    takeaway: '判断它是不是 Agent：看它能不能在多步任务里做决定，并使用外部工具完成目标。'
  }),
  Object.freeze({
    id: 'skill',
    order: '02',
    track: 'concept',
    term: 'SKILL',
    title: '什么是 Skill？',
    subtitle: '把一次好做法，变成可重复使用的能力',
    duration: '4 分钟',
    definition: 'Skill 是围绕特定任务整理好的说明、规则和资源，让 Agent 每次都按同一套高质量方法执行。',
    example: '“写旅行攻略”可以是一项 Skill：先确认受众，再组织路线、费用、注意事项，最后按固定版式输出。',
    takeaway: 'Skill 解决的是“这类任务应该怎么做好”，让能力可复用、可维护，也更稳定。'
  }),
  Object.freeze({
    id: 'mcp',
    order: '03',
    track: 'concept',
    term: 'MCP',
    title: '什么是 MCP？',
    subtitle: '让 AI 用统一方式连接工具与数据',
    duration: '5 分钟',
    definition: 'MCP 是一种开放协议，让 AI 应用用统一方式发现并调用外部工具、文件和业务数据。',
    example: '它像 AI 世界的通用接口：同一个 Agent 可以通过不同 MCP 服务连接日历、代码仓库或知识库。',
    takeaway: 'MCP 解决“怎么连接”，Skill 解决“怎么做好”，Agent 负责“为了目标怎么行动”。'
  }),
  Object.freeze({
    id: 'tool-call',
    order: '04',
    track: 'practice',
    term: 'TOOL CALL',
    title: 'AI 为什么要调用工具？',
    subtitle: '模型会思考，工具让它能查、算、写和执行',
    duration: '4 分钟',
    definition: '工具调用是模型按约定格式请求外部能力，再读取执行结果并继续完成任务。',
    example: '查实时天气、读取数据库、运行代码或创建日程，都不能只靠模型记忆，需要交给对应工具。',
    takeaway: '模型决定何时用工具，程序决定工具能做什么；权限与结果校验始终要在系统侧完成。'
  }),
  Object.freeze({
    id: 'rag',
    order: '05',
    track: 'practice',
    term: 'RAG',
    title: '什么是 RAG？',
    subtitle: '先找到可信资料，再让模型组织答案',
    duration: '5 分钟',
    definition: 'RAG 是“检索增强生成”：回答前先从知识库找相关内容，再把证据与问题一起交给模型。',
    example: '企业问答不会要求模型背下所有制度，而是先检索最新制度原文，再基于命中的段落作答。',
    takeaway: 'RAG 能补充最新和私有知识，但检索质量、来源引用和权限隔离决定最终可靠性。'
  }),
  Object.freeze({
    id: 'context',
    order: '06',
    track: 'concept',
    term: 'CONTEXT',
    title: '什么是上下文？',
    subtitle: '模型此刻真正看得到的信息',
    duration: '4 分钟',
    definition: '上下文是一次任务中交给模型的指令、对话、文件片段、工具结果和其他可见信息。',
    example: '同一句“继续优化”，如果上下文里有上一版文案，模型知道改什么；没有，它只能猜。',
    takeaway: '上下文越多不一定越好。保留目标、约束和关键证据，删掉噪声，通常会得到更稳定的结果。'
  })
]);

const LESSON_GUIDES = Object.freeze({
  agent: Object.freeze({
    posters: LESSON_POSTERS.agent,
    mechanismTitle: 'Agent 的行动循环',
    flow: Object.freeze(['目标', '计划', '工具', '行动', '观察']),
    checks: Object.freeze(['会不会自己拆分多步任务', '会不会选择并使用外部工具', '会不会根据结果继续调整']),
    mistake: '会聊天，不等于就是 Agent。关键是能否围绕目标持续行动。'
  }),
  skill: Object.freeze({
    posters: LESSON_POSTERS.skill,
    mechanismTitle: '从一次做好，到次次做好',
    flow: Object.freeze(['任务', '方法', '规则', '资源', '稳定复用']),
    checks: Object.freeze(['是否只服务一类明确任务', '是否写清步骤、规则和资源', '换一个 Agent 还能否照着做好']),
    mistake: '一句提示词不一定是 Skill。可复用、可维护、结果稳定才是重点。'
  }),
  mcp: Object.freeze({
    posters: LESSON_POSTERS.mcp,
    mechanismTitle: '一套协议，连接多种能力',
    flow: Object.freeze(['AI 应用', '统一协议', 'MCP 服务', '工具与数据']),
    checks: Object.freeze(['是否用统一方式描述可用能力', '是否由服务端暴露工具或资源', '是否保留权限和调用边界']),
    mistake: 'MCP 负责怎么连接；Skill 负责怎么把一类任务做好。'
  }),
  'tool-call': Object.freeze({
    posters: LESSON_POSTERS['tool-call'],
    mechanismTitle: '思考交给模型，执行交给工具',
    flow: Object.freeze(['模型判断', '结构化请求', '工具执行', '结果返回', '系统校验']),
    checks: Object.freeze(['工具能力是否定义清楚', '参数是否经过约束和校验', '高风险动作是否需要授权']),
    mistake: '工具返回了结果，不代表结果一定正确；权限和校验必须留在系统侧。'
  }),
  rag: Object.freeze({
    posters: LESSON_POSTERS.rag,
    mechanismTitle: '先找证据，再组织答案',
    flow: Object.freeze(['提出问题', '检索资料', '筛选证据', '结合回答', '标注来源']),
    checks: Object.freeze(['检索是否命中真正相关的内容', '答案能否回到原文核对', '私有资料是否按权限隔离']),
    mistake: '接上知识库不等于可靠。检索质量和引用链路决定答案上限。'
  }),
  context: Object.freeze({
    posters: LESSON_POSTERS.context,
    mechanismTitle: '模型只根据眼前的信息工作',
    flow: Object.freeze(['目标', '指令', '对话', '文件片段', '工具结果']),
    checks: Object.freeze(['目标和约束是否仍然可见', '关键证据是否完整且没有冲突', '是否删掉重复、过期和无关信息']),
    mistake: '上下文不是越多越好。噪声越多，模型越难抓住真正重要的事。'
  })
});

const COLUMN_LESSONS = Object.freeze(BASE_COLUMN_LESSONS.map((lesson) => Object.freeze({
  ...lesson,
  guide: LESSON_GUIDES[lesson.id]
})));

module.exports = { COLUMN_TRACKS, COLUMN_LESSONS, LESSON_GUIDES };
