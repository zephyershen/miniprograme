---
title: "2026-07-14 云环境清理与首版部署核验"
type: source
tags: [cloudbase, cleanup, deployment, verification, digest-inbox]
sources: [../../docs/cloud-cleanup.md, ../../cloudbaserc.json]
last_updated: 2026-07-14
status: confirmed
confidence: high
---

# 2026-07-14 云环境清理与首版部署核验

## Provenance

- Source path / origin: `D:\miniprogram`、目标 CloudBase 环境的只读清单与部署命令输出
- Date observed: 2026-07-14
- Scope: `hyyc-1gi3f5sqc5becabf` 的旧业务资源清理、新数据结构和两个云函数
- Status: confirmed for cleanup and deployment; end-to-end WeChat/AI flow remains needs-review
- Confidence: high

本页只记录资源名称、数量、状态和错误类别。登录凭据、密钥值、账户余额数值和旧业务数据内容均未写入 Wiki。

## 清理前在线清单

- 旧云函数：41 个，包含 1 个定时触发器及旧业务环境变量配置。
- 旧数据库：24 个集合，共 2,456 条文档。
- 旧对象存储：217 个对象，共 103,658,642 字节（约 98.9 MiB）。
- 旧静态业务站点：`adminportal/` 下 2 个文件。

旧函数配置中出现过支付、身份、对象存储和通知相关的敏感变量名称；核验和清理过程中未读取、输出或保存这些变量的值。

## 已完成清理

- 41 个旧云函数、关联触发器和函数环境变量均已删除。
- 24 个旧集合及其中 2,456 条文档均已删除。
- 217 个旧对象存储文件均已删除；环境级 COS 存储桶保留为空桶。
- 旧静态业务目录 `adminportal/` 已删除。
- 保留 CloudBase 环境、AppID 关联、标准版套餐以及平台所需的 `__auth/*` 和 `cloud-admin/index.html`。

未销毁 CloudBase 环境，也未删除环境级存储桶本体，因为新小程序继续复用该环境。

## 新资源与权限

已创建以下 5 个集合，并将权限核验为 `ADMINONLY`：

- `digest_queue`
- `conclusion_cards`
- `user_state`
- `daily_stats`
- `usage_monthly`

部署后的安全健康检查未写入业务数据；2026-07-14 复核时 5 个集合均为 0 条文档，对象存储为 0 个对象。

## 云函数部署

- 根配置 `cloudbaserc.json` 将函数根目录设为 `hyyc/cloudfunctions`。
- `digestIngest`：Node.js `18.15`、256 MB、60 秒。
- `digestStore`：Node.js `18.15`、256 MB、20 秒。
- 2026-07-14 17:56:50，两函数均显示 `Deployment completed`。

直接从 CLI 以空事件调用两个函数时，云端进程均成功启动，`InvokeResult` 为 0，并按设计返回 `TEMPORARY_FAILURE / 无法确认当前微信用户`。这证明代码入口、运行时和依赖可加载，同时没有伪造 OpenID 或写入测试用户数据。

## 计费状态说明

- 环境为预付费标准版，状态正常，有效期至 2027-01-14。
- “超限按量”已关闭。
- 首次部署因底层 SCF 返回 `AccountInsufficient` 失败；用户使账户恢复正余额后，原部署命令成功。
- 该错误属于创建阶段的账户余额校验，不代表每创建一个函数单独购买；函数运行仍使用环境套餐额度，AI 模型用量另行计量。

## 仍待验证

- 在微信开发者工具或真机上下文中取得真实 OpenID 后，验证 `digestStore.dashboard`。
- 确认当前环境可调用代码默认的 `hy3-preview`，并完成一次受控文章消化流程。
- 编译、预览并上传微信体验版；随后进入 30 天个人验证。

## 后续状态

本页记录的是 2026-07-14 的部署时点快照。真实微信身份、数据库闭环和模型状态已在 2026-07-15 继续验证；当前结论以 [微信端到端验证与运行时修复](2026-07-15-wechat-e2e-and-runtime-fixes.md) 为准。
