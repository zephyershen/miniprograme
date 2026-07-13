---
title: "别收藏了小程序项目总览"
type: overview
tags: [overview, miniprogram, wechat, digest-inbox]
sources: [sources/2026-07-13-digest-inbox-implementation.md]
last_updated: 2026-07-13
status: confirmed
confidence: high
---

# 别收藏了小程序项目总览

## 一句话说明

这是一个帮助用户消化已经看到的公开 AI 文章、而不是继续提供资讯流的微信小程序：粘贴链接后得到相关性、短摘要和关键句，再明确选择丢弃或保留结论卡。

## 事实健康表

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| AppID、云环境 ID、Git 历史和远程地址已保留 | confirmed | 项目配置、应用入口、Git 命令 |
| 旧社区、商品、任务、聊天、实名、定位、钱包、支付和图片审核代码已从活跃树移除 | confirmed | 当前文件树与暂存差异 |
| 4 个页面、2 个云函数及本地测试已实现 | confirmed | 代码与 31 个 Node 测试 |
| 微信开发者工具编译、真机预览和体验版上传 | needs-review | 当前机器未发现开发者工具 CLI |
| 旧云资源清空、新集合创建、模型启用及云函数部署 | needs-review | 当前机器无 CloudBase 登录会话或可用 CLI |

## 仓库与身份

- 唯一正式仓库：`D:\miniprogramcode\miniprogram`
- 当前分支：`codex/rebuild-digest-inbox`
- 重建基线提交：`704a88ec1713054f78843a89570ca637ed19b06e`
- 旧版本标签：`legacy-hyyc-704a88e`
- 远程：`git@github.com:zephyershen/miniprograme.git`
- AppID：`wxcb0f641838abf6e6`
- 云环境 ID：`hyyc-1gi3f5sqc5becabf`
- 唯一项目配置：仓库根部 `project.config.json`，小程序根为 `hyyc/`

外层 `D:\miniprogramcode\.git` 属于提交 `5b31689` 的旧仓库元数据。它计划归档为 `.git-legacy-5b31689`，但当前 Codex 桌面工作区占用导致 Windows 拒绝重命名。该目录不是正式仓库。

## 首版闭环

1. 用户首次选择 1–3 个关注方向。
2. 用户主动读取剪贴板或手动输入公开 HTTPS 文章链接。
3. `digestIngest` 校验 URL、阻止 SSRF、限制抓取大小、抽取正文并调用一次 AI。
4. 用户查看相关性、中文摘要和 1–3 条关键句；英文文章同时显示译文。
5. 用户必须丢弃或保留结论；卡片满 20 张时必须显式选择替换对象。

不提供资讯流、任意网页全文、自动剪贴板监听、支付、广告、会员、登录页、定位、推送、全文翻译或公开运营能力。

## 代码与数据

- 页面：`pages/inbox/index`、`pages/digest/index`、`pages/cards/index`、`pages/settings/index`
- 云函数：`hyyc/cloudfunctions/digestIngest`、`hyyc/cloudfunctions/digestStore`
- 集合：`digest_queue`、`conclusion_cards`、`user_state`、`daily_stats`、`usage_monthly`
- 身份只取自云函数上下文；数据库使用 OpenID 的 SHA-256 派生值，不保存原始 OpenID。
- 原始正文只在函数内存中参与一次处理，不写数据库或云存储。
- 不保存昵称、手机号、位置、实名资料、支付信息或全文。

## 安全与成本

- 只接受默认 443 端口的 HTTPS；拒绝凭据、内网、保留 IP 和微信公众平台文章。
- DNS 解析后绑定已校验的公网 IP 建立 HTTPS 连接，并在每次重定向后重新校验。
- 最多 3 次重定向、响应最大 2MB、正文最多 12,000 字符。
- 默认模型 `hy3-preview`；可用环境变量 `AI_MODEL` 切换为部署时确认可用的准确模型名。
- AI 调用前以事务预留预算，结算实际 Token 成本；每月 10 元硬上限。

## 本地验证

- `npm test`：31/31 通过。
- `npm run check`：14 个 JSON、29 个 JavaScript、4 个页面通过结构与语法检查。
- `git diff --check`：通过。

## 尚未完成的外部操作

1. 在有权限的云控制台导出不含数据和密钥值的资源清单，并人工确认后清空旧资源。
2. 创建新集合、核对权限规则，确认并启用当前环境实际可用的 CloudBase 模型名称。
3. 在微信开发者工具中编译，部署两个 Node.js 18 云函数并完成真机验证。
4. 上传体验版并按 [30 天验证方案](../docs/experience-validation.md) 记录结果。

## 已被替代的旧结论

- “正式 Git 根是 `D:\miniprogramcode`、当前分支为 `my-work`”是 2026-07-13 早期审计结论，现已被正式内层仓库和新分支替代。
- “产品方向未确定”已被 [“别收藏了”首版决策](decisions/2026-07-13-digest-inbox-v1.md) 替代。
- 旧项目的 18 个页面和 19 个云函数仅保留在 Git 标签与历史中，不再是当前架构。
