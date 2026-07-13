---
title: "2026-07-13 别收藏了首版本地实现审计"
type: source
tags: [audit, implementation, test, digest-inbox]
sources: []
last_updated: 2026-07-13
status: confirmed
confidence: high
---

# 2026-07-13 别收藏了首版本地实现审计

## Provenance

- Source path / origin: `D:\miniprogramcode\miniprogram`
- Date observed: 2026-07-13
- Scope: 当前 Git 分支、本地代码、配置、测试和命令可用性
- Status: confirmed locally; cloud/runtime needs-review
- Confidence: high for local facts

## Git 证据

- 仓库根：`D:/miniprogramcode/miniprogram`
- 分支：`codex/rebuild-digest-inbox`
- 基线：`704a88ec1713054f78843a89570ca637ed19b06e`
- 标签：`legacy-hyyc-704a88e`
- 远程：`git@github.com:zephyershen/miniprograme.git`

## 实现证据

- 根配置设置 `miniprogramRoot: "hyyc/"` 和 `cloudfunctionRoot: "hyyc/cloudfunctions/"`。
- `app.json` 只声明 4 个页面，不包含旧定位和隐私权限。
- 活跃云函数目录只有 `digestIngest` 和 `digestStore`。
- 旧业务资源清单和人工清理步骤已写入 `docs/`，未记录数据内容或密钥值。
- 抓取实现包含 HTTPS、端口、DNS/IP、重定向、2MB 和正文长度限制；AI 输出执行结构校验和预算事务预留。
- 2026-07-13 核对 CloudBase 官方模型目录与价格：`hy3-preview` 使用输入长度分档，DeepSeek V4 Flash 存在峰谷价；代码对后者采用较高的高峰价进行保守预算。

## 验证证据

- `npm test`：31 tests, 31 passed, 0 failed。
- `npm run check`：14 JSON files, 29 JavaScript files, 4 pages。
- `git diff --check`：通过。

## 未验证范围

当前机器未发现微信开发者工具 CLI、CloudBase CLI、云登录会话或相关环境凭据。因此没有执行线上资源清空、集合创建、模型目录核对、云函数部署、开发者工具编译或体验版上传。
