# Wiki Log

## [2026-07-13] init | 创建项目 Wiki 并记录重做边界

- Session: local Codex task
- Target pages: `wiki/AGENTS.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/sources/2026-07-13-code-and-repository-audit.md`, `wiki/decisions/2026-07-13-rebuild-product.md`
- Summary: 初始化项目级 Wiki，记录 AppID、云环境、Git 元数据、代码完整性、路径漂移风险和新产品约束。
- Sources: 本地项目文件、Git 命令、本次用户对话。
- Sensitive handling: 未保存 AppSecret、API 密钥、支付私钥、证书、用户数据或其他敏感值。
- Follow-ups: 确定并验证非小游戏、低隐私、纯线上获客的新产品方向；清理旧业务前建立存档点。

## [2026-07-13] rebuild | 实现“别收藏了”首版本地代码

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/`, `wiki/sources/`
- Summary: 将正式仓库确定为内层仓库，记录旧版标签和重建分支；把旧业务审计标记为历史证据，新增“别收藏了”首版决策、当前实现、测试结果和未完成的云端步骤。
- Sources: 当前本地代码、Git 命令、31 个 Node 测试、项目静态检查和本次用户确认的实施方案。
- Sensitive handling: 仅记录 AppID、环境 ID 和环境变量名称；未保存 AppSecret、AI 密钥、支付私钥、证书、用户数据或旧数据库内容。
- Follow-ups: 在有权限的微信开发者工具和 CloudBase 环境中完成资源盘点、确认清理、模型核对、部署、体验版上传与 30 天验证。
