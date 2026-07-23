const VERIFIED_AT = '2026-07-21';

const PRACTICAL_TRACKS = Object.freeze([
  Object.freeze({ key: 'codex', label: 'Codex 上手', note: '从安装到完成第一个安全任务' }),
  Object.freeze({ key: 'claude-code', label: 'Claude Code 上手', note: '从安装到完成第一个安全任务' }),
  Object.freeze({ key: 'safe-connect', label: '安全连接', note: '保护密钥，再连接外部工具' })
]);

const PRACTICAL_SUPPORT_NOTICE = Object.freeze({
  title: 'Pro 会员技术支持',
  copy: 'Pro 会员安装或使用遇到问题，可私聊微信获取技术支持；技术支持不另收费。',
  exclusions: '工具订阅、API 调用和云服务等第三方费用不包含在会员权益内。'
});

const SOURCES = Object.freeze({
  codexInstall: Object.freeze({
    title: 'OpenAI Codex CLI 官方安装说明',
    url: 'https://github.com/openai/codex/blob/main/README.md',
    verifiedAt: VERIFIED_AT
  }),
  codexAuth: Object.freeze({
    title: 'OpenAI Codex 身份验证说明',
    url: 'https://learn.chatgpt.com/docs/auth',
    verifiedAt: VERIFIED_AT
  }),
  codexMcp: Object.freeze({
    title: 'OpenAI Codex MCP 官方说明',
    url: 'https://learn.chatgpt.com/docs/extend/mcp',
    verifiedAt: VERIFIED_AT
  }),
  openAiKeySafety: Object.freeze({
    title: 'OpenAI API Key 安全最佳实践',
    url: 'https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety',
    verifiedAt: VERIFIED_AT
  }),
  claudeInstall: Object.freeze({
    title: 'Anthropic Claude Code 官方安装说明',
    url: 'https://code.claude.com/docs/en/installation',
    verifiedAt: VERIFIED_AT
  }),
  claudeMcp: Object.freeze({
    title: 'Anthropic Claude Code MCP 官方说明',
    url: 'https://code.claude.com/docs/en/mcp',
    verifiedAt: VERIFIED_AT
  }),
  claudeKeySafety: Object.freeze({
    title: 'Claude API Key 安全最佳实践',
    url: 'https://support.claude.com/en/articles/9767949-api-key-best-practices-keeping-your-keys-safe-and-secure',
    verifiedAt: VERIFIED_AT
  })
});

function command(label, value, platform) {
  return Object.freeze({ label, command: value, platform });
}

function platformGuide(id, label, terminal, commands, steps) {
  return Object.freeze({
    id,
    label,
    terminal,
    commands: Object.freeze(commands.map((item) => Object.freeze({ ...item }))),
    steps: Object.freeze([...steps])
  });
}

function frozenSections(sections) {
  const value = { ...sections };
  Object.keys(value).forEach((key) => {
    if (Array.isArray(value[key])) value[key] = Object.freeze([...value[key]]);
  });
  return Object.freeze(value);
}

function practical(input) {
  return Object.freeze({
    kind: 'practical',
    verifiedAt: VERIFIED_AT,
    ...input,
    platformGuides: Object.freeze([...(input.platformGuides || [])]),
    commands: Object.freeze((input.commands || []).map((item) => Object.freeze({ ...item }))),
    sources: Object.freeze(input.sources.map((item) => Object.freeze({ ...item }))),
    relatedCourseIds: Object.freeze(input.relatedCourseIds || []),
    sections: frozenSections(input.sections)
  });
}

const PRACTICAL_LESSONS = Object.freeze([
  practical({
    id: 'codex-cli-install',
    track: 'codex',
    order: 1,
    term: 'INSTALL',
    catalogTitle: '安装 Codex CLI',
    title: '安装 Codex CLI',
    subtitle: '选择你的电脑系统，按官方步骤完成安装、验证和登录',
    duration: '约 10 分钟',
    platformGuides: [
      platformGuide('windows', 'Windows', 'PowerShell', [
        command('官方安装', 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', 'PowerShell')
      ], [
        '从开始菜单打开 PowerShell，不要在 CMD 中执行这条命令。',
        '复制并运行官方安装命令，等待命令执行结束。',
        '关闭当前 PowerShell，再重新打开一个窗口，让系统读取新的命令路径。',
        '运行 codex --version；能看到版本号后，再运行 codex 并按浏览器提示登录。'
      ]),
      platformGuide('macos', 'macOS', '终端', [
        command('官方脚本', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', '终端'),
        command('Homebrew 安装', 'brew install --cask codex', '已安装 Homebrew')
      ], [
        '打开“终端”应用。',
        '在官方脚本与 Homebrew 中任选一种安装方式，不要重复安装。',
        '关闭终端并重新打开，然后运行 codex --version 检查版本。',
        '运行 codex，按浏览器提示完成登录。'
      ]),
      platformGuide('linux', 'Linux', '终端', [
        command('官方安装', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', '终端')
      ], [
        '打开你常用的终端。',
        '复制并运行官方安装命令，等待脚本执行结束。',
        '重新打开终端，然后运行 codex --version 检查版本。',
        '运行 codex，按浏览器提示完成登录。'
      ])
    ],
    commands: [
      command('检查版本', 'codex --version', '安装完成后'),
      command('启动并登录', 'codex', '安装完成后'),
      command('查看登录状态', 'codex login status', '安装完成后'),
      command('npm 备选安装', 'npm install -g @openai/codex', '已安装 Node.js')
    ],
    sources: [SOURCES.codexInstall, SOURCES.codexAuth],
    relatedCourseIds: ['tool-call', 'agent', 'security'],
    sections: {
      summary: '本课按 Windows、macOS 和 Linux 分开说明。只需要选择与你电脑一致的一组步骤，安装后完成版本检查和账号登录。',
      prerequisites: [
        '准备一个可用于登录的 ChatGPT 账号。',
        '确认电脑可以访问官方安装地址，并关闭正在占用旧命令路径的终端窗口。'
      ],
      steps: [
        '在“按你的电脑安装”中选择对应系统，只执行这一组官方命令。',
        '安装结束后重新打开终端，运行 codex --version。',
        '运行 codex 并完成登录，再用 codex login status 检查状态。',
        '若公司网络或权限策略阻止官方脚本，可在已安装 Node.js 的电脑上使用 npm 备选安装。'
      ],
      verification: 'codex --version 能显示版本号，codex login status 能显示已登录状态。',
      pitfalls: [
        '把 PowerShell 命令贴进 CMD，或把 macOS、Linux 命令贴进 Windows。',
        '安装后继续使用旧终端，导致系统暂时找不到新命令。',
        '从第三方下载站获取安装包或复制来源不明的脚本。'
      ],
      avoid: '不要执行来源不明的安装脚本；官方命令发生变化时，以本课列出的原始来源为准。',
      takeaway: '完成安装、版本验证和账号登录后，再开始处理真实项目。'
    }
  }),
  practical({
    id: 'codex-cli-first-task',
    track: 'codex',
    order: 2,
    term: 'FIRST TASK',
    catalogTitle: '用 Codex CLI 完成第一个任务',
    title: '让 Codex 完成第一个安全任务',
    subtitle: '先只读检查，再完成一项范围清楚、可以撤回的小改动',
    duration: '约 12 分钟',
    commands: [
      command('查看改动前状态', 'git status', 'Git 项目'),
      command('启动 Codex', 'codex', '项目目录'),
      command('查看具体改动', 'git diff', 'Git 项目')
    ],
    sources: [SOURCES.codexInstall, SOURCES.codexAuth],
    relatedCourseIds: ['task-first', 'acceptance', 'security'],
    sections: {
      summary: '第一次任务只做一项可以检查、可以撤回的小改动。开始前记录项目状态，先让工具只读分析，确认方案后再允许修改。',
      prerequisites: [
        '项目已经使用 Git，或已为准备修改的文件创建备份。',
        '当前目录不包含准备上传给外部服务的密钥、客户数据或生产配置。'
      ],
      steps: [
        '在项目目录运行 git status，记录当前已有改动。',
        '运行 codex，先要求它只阅读并说明项目结构、相关文件和风险，不修改任何内容。',
        '确认分析正确后，只授权一项范围明确的小任务，并写清不能修改的文件。',
        '完成后运行 git diff，逐行检查改动，再执行项目已有的测试或检查命令。'
      ],
      verification: 'git diff 只包含授权范围内的改动，项目原有测试或检查命令通过。',
      pitfalls: [
        '任务范围写成“把整个项目优化一下”，无法有效验收。',
        '没有先记录原有改动，完成后无法区分哪些内容由工具产生。',
        '只看完成说明，不检查文件差异和测试结果。'
      ],
      avoid: '第一次任务不要包含发布、删除数据库、大规模重构、付费或权限变更。',
      takeaway: '先记录状态，再限定范围，最后检查差异和测试结果。'
    }
  }),
  practical({
    id: 'claude-code-install',
    track: 'claude-code',
    order: 3,
    term: 'INSTALL',
    catalogTitle: '安装 Claude Code',
    title: '安装 Claude Code',
    subtitle: '按操作系统选择官方安装方式，再完成版本和健康检查',
    duration: '约 10 分钟',
    platformGuides: [
      platformGuide('windows', 'Windows', 'PowerShell 或 CMD', [
        command('PowerShell 官方安装', 'irm https://claude.ai/install.ps1 | iex', 'PowerShell'),
        command('CMD 官方安装', 'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd', 'CMD'),
        command('winget 官方安装', 'winget install Anthropic.ClaudeCode', 'PowerShell 或 CMD')
      ], [
        '打开 PowerShell，并在两种官方安装方式中任选一种；不要重复安装。',
        '运行所选命令并等待安装结束。',
        '关闭终端后重新打开，运行 claude --version 和 claude doctor。',
        '运行 claude，按浏览器提示完成登录。'
      ]),
      platformGuide('macos', 'macOS', '终端', [
        command('官方脚本', 'curl -fsSL https://claude.ai/install.sh | bash', '终端'),
        command('Homebrew 安装', 'brew install --cask claude-code', '已安装 Homebrew')
      ], [
        '打开“终端”应用。',
        '在官方脚本与 Homebrew 中任选一种安装方式，不要重复安装。',
        '关闭终端后重新打开，运行 claude --version 和 claude doctor。',
        '运行 claude，按浏览器提示完成登录。'
      ]),
      platformGuide('linux-wsl', 'Linux / WSL', '终端', [
        command('官方安装', 'curl -fsSL https://claude.ai/install.sh | bash', 'Linux 或 WSL 终端')
      ], [
        '打开 Linux 终端；WSL 用户需要先进入 WSL 终端。',
        '复制并运行官方安装命令，等待安装结束。',
        '重新打开对应终端，运行 claude --version 和 claude doctor。',
        '运行 claude，按浏览器提示完成登录。'
      ])
    ],
    commands: [
      command('检查版本', 'claude --version', '安装完成后'),
      command('运行健康检查', 'claude doctor', '安装完成后'),
      command('启动并登录', 'claude', '安装完成后')
    ],
    sources: [SOURCES.claudeInstall],
    relatedCourseIds: ['agent', 'tool-call', 'security'],
    sections: {
      summary: '本课按 Windows、macOS、Linux 和 WSL 分开说明。选择与你电脑一致的一组官方步骤，安装后运行版本和健康检查。',
      prerequisites: [
        '准备一个可用的 Claude 套餐账号或 Anthropic Console 账号。',
        'Windows 用户确认自己使用原生 Windows 还是 WSL，并打开对应终端。'
      ],
      steps: [
        '在“按你的电脑安装”中选择对应系统，只执行其中一种官方安装方式。',
        '安装结束后重新打开终端，运行 claude --version。',
        '运行 claude doctor，根据检查结果处理环境问题。',
        '运行 claude，按浏览器提示完成登录。'
      ],
      verification: 'claude --version 能显示版本号，claude doctor 未报告阻止使用的问题。',
      pitfalls: [
        '在原生 Windows 终端中执行 bash 命令，或在 WSL 中执行 PowerShell 命令。',
        '同时运行多种安装方式，导致后续更新和路径判断混乱。',
        '安装完成后没有重开终端，旧会话暂时找不到新命令。'
      ],
      avoid: '不要下载来历不明的安装包，也不要向他人提供账号验证码、密钥或公司内部信息。',
      takeaway: '选对系统和终端，完成版本与健康检查后再登录使用。'
    }
  }),
  practical({
    id: 'claude-code-first-task',
    track: 'claude-code',
    order: 4,
    term: 'FIRST TASK',
    catalogTitle: '用 Claude Code 完成第一个任务',
    title: '让 Claude Code 完成第一个安全任务',
    subtitle: '先只读分析，再把修改范围限制到指定文件',
    duration: '约 12 分钟',
    commands: [
      command('查看改动前状态', 'git status', 'Git 项目'),
      command('启动 Claude Code', 'claude', '项目目录'),
      command('查看具体改动', 'git diff', 'Git 项目')
    ],
    sources: [SOURCES.claudeInstall],
    relatedCourseIds: ['task-first', 'acceptance', 'security'],
    sections: {
      summary: '第一次任务先只读分析，再修改一个指定文件。开始前记录项目状态，完成后检查差异并运行测试。',
      prerequisites: [
        '项目已经使用 Git，或已为准备修改的文件创建备份。',
        '已确认项目目录中没有不应交给外部服务处理的敏感资料。'
      ],
      steps: [
        '运行 git status，记录项目当前状态。',
        '在项目目录运行 claude，先要求它只阅读相关文件并说明方案，不修改内容。',
        '确认方案后，写明允许修改的文件、目标和验收标准。',
        '查看 git diff 并运行项目测试；结果不符合要求时，用版本记录或备份恢复。'
      ],
      verification: '修改只发生在指定文件中，实际差异符合要求，相关测试通过。',
      pitfalls: [
        '只写“帮我修好”，没有给出文件范围和验收标准。',
        '在包含真实客户数据、密钥或生产配置的目录中直接试用。',
        '看到任务完成提示后，没有检查差异和测试结果。'
      ],
      avoid: '第一次任务不要安排发布、删除数据库或大规模重构；高风险操作必须拆开并逐次确认。',
      takeaway: '先只读确认方案，再授权小范围修改，最后由你验收。'
    }
  }),
  practical({
    id: 'api-key-safety',
    track: 'safe-connect',
    order: 5,
    term: 'API KEY',
    catalogTitle: '安全保存 API 密钥',
    title: 'API Key 怎么放才安全？',
    subtitle: '密钥不进聊天、不进代码、不进截图，并设置权限和费用限制',
    duration: '约 10 分钟',
    commands: [],
    sources: [SOURCES.openAiKeySafety, SOURCES.claudeKeySafety],
    relatedCourseIds: ['security', 'mcp', 'tool-call'],
    sections: {
      summary: '拿到 API Key 的人可能以你的身份调用服务并产生费用。密钥必须使用环境变量、平台秘密变量或专用密钥服务保存。',
      prerequisites: [
        '确认密钥对应的项目和用途。',
        '确认服务商后台是否支持权限、额度和费用提醒。'
      ],
      steps: [
        '在服务商官方后台创建用途单一的密钥，并设置可用的最小权限。',
        '把密钥放进系统环境变量、平台秘密变量或专用密钥管理服务。',
        '设置用量上限或费用提醒，并定期查看调用记录。',
        '怀疑泄露时立即撤销旧密钥、创建新密钥，并检查异常调用和账单。'
      ],
      verification: '代码和版本记录中没有完整密钥，调用记录、额度和费用提醒均可查看。',
      pitfalls: [
        '把 .env 文件提交到代码仓库，删除最新提交后却没有清理历史记录。',
        '把完整密钥发给客服、群友或 AI 代为排查。',
        '没有费用提醒，发生异常调用后无法及时发现。'
      ],
      avoid: '技术支持排查不需要你提供完整密钥。Pro 会员技术支持不另收费，但第三方工具、API 和云服务费用不包含在会员权益内。',
      takeaway: '密钥不公开、权限尽量小、费用有提醒，怀疑泄露立即撤销。'
    }
  }),
  practical({
    id: 'mcp-connect',
    track: 'safe-connect',
    order: 6,
    term: 'MCP',
    catalogTitle: '连接第一个外部工具',
    title: '用 MCP 连接外部工具',
    subtitle: '核对来源和权限，再用非敏感资料完成第一次连接测试',
    duration: '约 12 分钟',
    commands: [
      command('查看 Codex 已连接的 MCP', 'codex mcp list', 'Codex CLI'),
      command('查看 Codex MCP 命令帮助', 'codex mcp --help', 'Codex CLI'),
      command('登录支持 OAuth 的 Codex MCP', 'codex mcp login <server>', 'Codex CLI'),
      command('查看 Claude Code MCP 命令帮助', 'claude mcp --help', 'Claude Code')
    ],
    sources: [SOURCES.codexMcp, SOURCES.claudeMcp],
    relatedCourseIds: ['mcp', 'tool-call', 'security'],
    sections: {
      summary: 'MCP 可以让 AI 访问文件、数据库或协作工具。连接前必须确认服务来源、数据去向和读写权限，第一次测试只使用非敏感资料。',
      prerequisites: [
        '准备一个不含客户数据和密钥的测试文件夹或测试账号。',
        '确认连接服务来自官方文档或你明确可信的服务方。'
      ],
      steps: [
        '从官方文档获取连接方法，核对安装命令和服务地址。',
        '查看连接会读取、写入和发送哪些数据，只授权任务必需的最小权限。',
        '使用非敏感测试资料完成一次读取任务，再检查当前连接清单。',
        '任务结束后复查已连接服务；长期不用或权限过大的连接及时删除或撤销。'
      ],
      verification: '连接清单中只有你确认过的服务，测试任务只访问授权范围内的非敏感资料。',
      pitfalls: [
        '直接给整个网盘、代码仓库或数据库写权限。',
        '复制来历不明的 npx 或脚本命令，忽略它会在本机执行代码。',
        '连接后不检查清单，也不知道如何撤销授权。'
      ],
      avoid: '不要用真实客户数据做第一次连接测试；需要管理员权限或大范围写入时，先停止并核对。',
      takeaway: '先验来源，再缩权限，用测试资料验证，并确保授权随时可撤销。'
    }
  })
]);

function publicPracticalLesson(value, { includeCopy = true } = {}) {
  const preview = {
    id: value.id,
    kind: value.kind,
    track: value.track,
    order: value.order,
    term: value.term,
    title: value.catalogTitle || value.title
  };
  return includeCopy ? {
    ...preview,
    subtitle: value.subtitle,
    duration: value.duration,
    verifiedAt: value.verifiedAt
  } : preview;
}

function findPracticalLesson(id) {
  return PRACTICAL_LESSONS.find((item) => item.id === id) || null;
}

module.exports = {
  VERIFIED_AT,
  PRACTICAL_TRACKS,
  PRACTICAL_SUPPORT_NOTICE,
  PRACTICAL_LESSONS,
  publicPracticalLesson,
  findPracticalLesson
};
