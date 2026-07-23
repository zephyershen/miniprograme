---
title: "CloudBase 四并发截图与 24 课手绘图 v2 上线证据"
type: source
tags: [cloudbase, scf, source-preview, queue, ai-column, oil-visual, media]
date: 2026-07-22
last_updated: 2026-07-22
status: confirmed
confidence: high
---

# CloudBase 四并发截图与 24 课手绘图 v2 上线证据

## 范围

- 移除视觉调度器“一轮只取一条”的吞吐限制，在不让单个 2GB 实例运行多个 Chromium 的前提下提高 CloudBase 截图吞吐。
- 校验、压缩、上传并接入用户生成的 24 课 × 3 页手绘图。

## 截图容量与实现证据

- 生产 `sourcePreviewWorker` 日志显示，近期两次完整 X 精确目标捕获分别约 12.9 秒和 13.4 秒，缩略图约 1 秒；实例内存通常约 300–450MB，没有接近 2048MB 上限。主要耗时来自页面、媒体和目标稳定等待，而不是内存不足。
- 2GB 是每个 SCF 实例的内存，不是整条截图队列共享的 2GB。普通事件函数继续保持一次调用只拥有一个 Chromium；调度器通过并行调用让 CloudBase 启动多个隔离实例。
- `knowledgeFeed` 现在每批最多同时调用 4 个 `sourcePreviewWorker`，单轮最多扫描 40 条并有界处理 38 条；fresh live 队列超过 2 条时先消化实时任务，回落后恢复 live/repair 与 fresh/recovery 的加权公平轮转。
- X/Twitter 精确 status 使用 110 秒启动预算，保留 90 秒函数超时和缩略图余量；可能进入 210 秒 AI 复核的普通网页仍使用 282 秒保守预算。全局租约继续防止两个调度周期重复认领同一批任务。
- 生产部署后同一秒出现 4 个独立 `sourcePreviewWorker` 调用；一轮 162.8 秒内尝试 13 条、成功发布 8 条，5 条质量或目标失败进入重试，没有发布错误截图。同步状态记录 `visualWorkerLastConcurrency=4`、`visualWorkerTargetWaiting=2`。
- 2026-07-22 08:36（Asia/Shanghai）生产数据库复核：`pending=0`、fresh live `=0`、`leased=2` 正在处理；最新待处理已经低于目标。另有 114 条历史 `retry` 按退避收口，它们不是“新资讯仍在等待首次截图”。
- “最多等待 2 条”是实时 fresh 队列的排空目标，不是对任意突发流量和外站故障的绝对承诺。历史 `retry`/`blocked` 仍按退避和诊断生命周期保留，不与最新待处理数量混为一谈。

## 课程图片证据

- 源目录 `D:\files\miniprogram\AI专栏24课手绘图_oil-visual_20260721` 共 72 个 PNG，严格对应 24 课 × 3 页；全部为 1086×1448、可解码、无重复哈希、页码连续。
- 发布副本转换为 quality 90、4:4:4、渐进式 JPEG，保留原分辨率和中文小字；总量由 207,874,886 bytes 降为 36,782,296 bytes，单张 375,273–689,330 bytes。
- 72/72 文件已上传到受保护路径 `ai-column/posters-hd/v2/`，云端清单从 `01-model-basics-01.jpg` 连续到 `24-security-03.jpg`。
- `ai-column-media.js` 直接从 24 节 `COLUMN_LESSONS` 生成映射，避免课程 ID、顺序和图片表分叉；每个会员课程详情只签发本课 3 张图。兼容旧客户端的 72 张一次性返回会按 50 + 22 两批请求临时 HTTPS 地址。
- 原始 PNG 继续保存在用户素材目录，优化后的发布副本保存在 `D:\miniprogram\output\ai-column-posters-v2` 和 Cloud Storage；图片未打入小程序客户端包，免费目录不会拿到受保护 URL。

## 部署与验证

- `knowledgeFeed` 已部署到 `hyyc-1gi3f5sqc5becabf`；Cloud Storage 上传结果为 72 成功、0 失败，线上目录复核为 72 个对象。
- 新增四并发执行、fresh live 排空、精确 X 启动预算、24×3 映射和 50 张批量签名回归。
- 全量 Node 测试 413/413 通过；项目检查覆盖 35 个 JSON、261 个 JavaScript 文件和 11 个页面。

## 敏感信息处理

本页不记录 CloudBase 凭据、代理令牌、服务器密码、OpenID、支付凭据或环境变量实际值。
