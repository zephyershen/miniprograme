---
title: "CloudBase 数据库、存储与函数发布门禁"
type: source
tags: [cloudbase, database, storage, access-control, release]
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# CloudBase 数据库、存储与函数发布门禁

## 范围

本轮只补齐上线控制面，没有修改用户媒体业务服务，也没有执行数据库权限或云存储规则写入。版本化合同位于：

- `docs/cloud-database-rules.json`
- `docs/cloud-storage-rules.json`

运行手册位于 `docs/cloudbase-access-control-runbook.md`。

## 实现

- `scripts/cloudbase-database-rules.js` 支持离线 `dry-run`、只读 `check` 和显式 `apply`。数据库合同列出的 22 个集合都必须回读为 `ADMINONLY`。
- `scripts/cloudbase-storage-rules.js` 使用同一模式，把完整 `CUSTOM` 规则作为一个 JSON 参数提交并在写入后回读。
- `scripts/cloudbase-function-manifest.js` 只读对比线上函数清单与 `cloudbaserc.json`，并逐项回读 runtime、handler、超时、内存、部署状态和定时触发器；清单必须精确为四个正式函数。
- `scripts/cloudbase-retired-functions.js` 只允许计划或删除固定的 `digestIngest` 与 `digestStore`。四个正式函数缺失、出现其他额外函数或缺少精确环境确认时，删除会在写操作前拒绝。
- `apply` 必须提供与目标环境完全一致的 `--confirm-env`，否则在任何写操作前退出；初次读取、只修改漂移资源和最终回读使重复执行保持幂等。
- JSON 通过 Node 参数数组传给 CloudBase CLI，不经 shell 字符串拼接；错误输出按凭据类字段和 URL 查询参数脱敏。
- 函数详情在子进程内解析后只返回字段白名单；`Environment`、`CodeInfo`、函数 ID 和其他原始字段不会进入 stdout 或错误。

## 只读生产回读

2026-07-23 的只读 `check --json` 正确识别出当前生产环境尚未收敛：

- 22 个合同集合中，`knowledge_column_cases`、`knowledge_feed_source_profiles`、`knowledge_trend_dossiers`、`knowledge_trend_events` 和 `knowledge_user_media` 仍为 `PRIVATE`，其余已是 `ADMINONLY`。
- 云存储仍公开读取整个旧 `user-media/` 前缀，并允许资源 owner 直接写入；与“只公开四类知识媒体、禁止客户端直写”的新合同不一致。
- 四个正式函数的 runtime、handler、超时、内存、状态和九个定时触发器与 `cloudbaserc.json` 一致；线上额外保留两个已退休 digest 函数，因此精确 manifest check 按预期失败。退休 plan 只列出这两个允许目标，且无正式函数缺失或未知额外函数。

上述结果是预期发布漂移证据，不代表脚本失败。本轮没有调用 `ModifyResourcePermission` 或 `storage rules update`。

## 验证

- 发布控制专项测试 15/15 通过，其中包括函数详情敏感字段与失败输出不泄露回归。
- 数据库合同静态检查通过：22 个配置集合与合同完全一致。
- 项目检查通过：30 个 JSON、274 个 JavaScript、11 个页面。
- 数据库、存储与函数离线 dry-run，以及退休函数只读 plan 均通过。
- CloudBase CLI 3.6.1 的真实只读数据库、存储、函数清单和白名单详情回读成功；漂移 check 均按合同返回退出码 1。
- 三项 apply 在不提供 `--confirm-env` 时全部退出码 1，且没有发出线上写请求。

## 凭据轮换门禁

本轮形成函数白名单脚本之前，一次人工原始 `fn detail` 只读核对把现有环境变量值带入了本地 Codex 工具输出。普通 Wiki 和仓库没有保存或复述任何值，但这些生产凭据应按已暴露处理：发布前统一轮换受影响的维护、AI、截图、微信应用与支付类密钥，再部署正式函数并只使用白名单脚本回读。

## 尚需发布阶段验证

应先轮换已暴露凭据，再从可复现 SHA 部署四个正式函数并运行函数 check。完成服务端冒烟后，显式执行退休函数 apply；函数清单精确收敛后再执行数据库与存储 apply，最后验证知识媒体正向读取、用户媒体服务端签名读取以及客户端直写负向用例。所有证据只保留白名单配置、规则差异和退出状态，不记录登录凭据、令牌、用户数据或短期签名地址。

## 后续发布结果

发布提交 `1bf9fb8` 已完成上述控制面收敛：22 个合同集合全部
`ADMINONLY`，34 个合同索引全部满足，存储规则禁止客户端用户媒体直写，
四个正式函数配置与九个触发器精确回读，两个旧 digest 函数已退休。GitHub、
截图和隔离媒体生产 canary 通过，微信版本 `1.0.0` 已上传体验版。完整证据见
[生产发布候选部署与微信体验版上传](2026-07-23-production-release-candidate.md)。
凭据值未进入仓库或普通 Wiki；公开发布前的轮换建议仍保留为管理员安全步骤。
