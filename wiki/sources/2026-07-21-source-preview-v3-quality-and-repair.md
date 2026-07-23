---
title: "原文截图 v3 质量闸门与历史坏图修复"
type: source
tags: [source-preview, playwright, cloudbase-ai, repair, production]
date: 2026-07-21
last_updated: 2026-07-21
status: confirmed
confidence: high
---

# 原文截图 v3 质量闸门与历史坏图修复

## 问题与根因

- X 等单页应用在失败时仍可能返回 HTTP 200；旧渲染器只验证响应状态，正文定位超时后还会回退到整页截图，因此会把 “Something went wrong” 等错误壳保存成资讯图片。
- 既有大模型只参与资讯文字分析、简报和评论/资料审核，没有进入“浏览器截图 → 上传 → 发布”链路，错误截图此前没有视觉复核。
- 生产云存储复核到 51 份与用户样本字节完全相同的 X 错误页；另有纯白、纯黑、空白边框、浏览器加载失败和无正文占位页。按精确文件身份归并后共有 64 条修复候选，其中 47 条仍为 active，17 条已下线。

## v3 质量链路

- 渲染器发布 `captureVersion=3` 和严格 `quality` 证明。页面进入、裁切前和裁切后都会复核；识别 HTTP 200 错误壳、登录墙、浏览器挑战、空白/稀疏页以及浏览器 “This page couldn’t load” 页面。
- X/Twitter 状态链接必须命中 URL 中的精确 status id；目标主帖未找到或裁切失败时禁止回退到无关整页。质量失败、临时网络失败和 5xx 只允许一次有界重载，4xx、SSRF 拒绝和中止不重试。
- 精确命中的 X 主帖可走确定性快速路径，但 JPEG 会先解码检查；纯色空白直接拒绝，异常小的可疑画面转交 AI。普通网页必须由视觉模型确认“画面有实际内容且与目标资讯一致”。
- CloudBase `qwen3.5-plus` 是视觉审核主路由，Packy 是超时/故障兜底；只有 `accept + targetMatched=true + confidence>=0.90` 才允许上传。拒绝、重试、无法判断、低置信、超时和 provider 异常全部 fail-closed，审核结果写入 `previewQualityAudit`。
- AI 用于判断和触发重试，不负责绕过站点登录、反爬或断网。始终无法取得有效画面时，资讯文字继续公开，错误图和无意义图不发布。

## 历史修复与并发边界

- `knowledgeOps.repairVisual` 仅接受维护令牌；批量模式按当前首张 `previewFileId` 精确 CAS，逐条事务清除预览和列表缩略图，保持 `publicState=active`、文字可见，并把旧文件写入持久清理日志后建立 v3 重抓任务。
- 修复拒绝活跃 job/legacy 租约、来源 URL/内容哈希变化、缓存身份冲突和非本条目拥有的文件名；最多 50 条且有 45 秒批次安全窗。
- 部署新 worker 后等待旧实例及租约窗口排空再执行批量修复。生产执行结果为 47 条 active 坏图引用已隔离并排队，17 条非 active 记录未改动；没有直接删除仍被引用的云文件。
- 实际 CloudBase 还暴露了 `previewQualityAudit=null` 与嵌套更新不兼容的问题；现用 `db.command.set` 原子替换整个审核对象，避免在 null 下创建 `confidence` 等子字段。

## 公平调度与任务生命周期补充

- 生产复核发现历史修复任务的优先级高于实时任务，旧实现又只按总优先级取前 20 条，导致新资讯即使已入队也长期进不了候选集。用户指出的两条最新 Rohan Paul 资讯当时均为 `pending`、`attempts=0`，根因是队列饥饿，不是原文无媒体。
- 仓储现在分别查询 live 与 repair，再由持久调度状态在 `live-fresh → repair-fresh → live-recovery → repair-recovery` 四个阶段轮转。历史积压不能再挤掉新资讯，持续新增也不能让修复车道永久停工。
- 视觉定时器改为每分钟运行。每次函数调用最多启动一个捕获任务，并使用 290 秒软截止；正文预览优先保留 282 秒，只有剩余预算足够时才派生列表缩略图，避免一次长截图拖垮整批。
- 旧 v2 任务不再依赖 `eligibleAt` 才能被发现。每轮安全认领一个过时代际任务，先清理它拥有的 staged/cleanup 文件：仍 active 且缺图的条目原子升级为 v3 `pending`，已就绪、已下线或来源失效的任务直接删除。
- 正常成功、已经就绪和 stale 任务会自动删除任务文档；临时失败保留为 `retry` 等待退避，清理失败保留为 `cleanup` 重试，达到上限的 `blocked` 故意保留供诊断或人工重排。因此“处理完自动删除”只适用于已收口状态，不适用于仍需重试或诊断的记录。

## 部署与验证

- `knowledgeFeed`、`knowledgeOps` 和公网 renderer 已协调部署；当前 renderer release 为 `20260721-150436`，公开和回环健康检查均为 `ok=true`。
- 对用户指出的目标 X 链接直接 canary：HTTP 200、`captureVersion=3`、`TARGET_STATUS_MATCHED`、1 张 65,949 字节截图。
- 同一条生产资讯首次重抓遇到临时错误壳时被 422 质量闸门拒绝并保持无图；下一轮自动重试成功写入一张 65,862 字节 v3 预览和列表缩略图。下载生产对象肉眼复核后确认画面是 Elon Musk 目标主帖及其引用的终端评测榜单，不是错误页。
- 生产已出现修复任务的 v3 成功记录：精确目标命中、`previewQualityAudit.policyVersion=1`、`verdict=accept`、新预览与新列表缩略图原子写入。普通网页的新任务也已由 CloudBase 视觉模型审核后发布审计。
- 用户指出的最新两条资讯 `cmrubsrb40pmibi7fbaczxjbl` 与 `cmrubsrb40pmjbi7ffk97fmb8` 均已生成正确的 v3 目标截图和列表缩略图，下载肉眼复核为对应 Rohan Paul 主帖与实际媒体，不是 X 错误壳；成功后两条任务文档均已删除。
- 部署后的分钟任务连续完成“一个旧 v2 升级 + 一个实时 v3 成功”，真实组合查询无新增索引错误，v2 活跃积压持续下降。
- 本地最终验证：384/384 Node 测试通过；项目检查通过 35 个 JSON、248 个 JavaScript 和 11 个页面；相关语法与结构检查通过。

## 相关实现

- `hyyc/cloudrun/source-preview-renderer/src/page-quality.js`
- `hyyc/cloudrun/source-preview-renderer/src/capture.js`
- `hyyc/cloudrun/source-preview-renderer/src/focus-policy.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/source-preview-review-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/feed-visual-job.js`
- `hyyc/cloudfunctions/knowledgeOps/services/visual-repair-service.js`
- `hyyc/tests/source-preview-quality.test.js`
- `hyyc/tests/source-preview-review.test.js`
- `hyyc/tests/visual-repair-ops.test.js`
