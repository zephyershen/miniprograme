---
title: "优先复用来源媒体、限制截图预算并按日期懒加载资讯"
type: decision
tags: [aihot, media, screenshot, cloudbase, resource-points, timeline, membership, lazy-loading]
date: 2026-07-22
last_updated: 2026-07-22
status: accepted
confidence: high
superseded_by: 2026-07-22-unbounded-visual-attempts-and-aihot-source-scopes
---

# 优先复用来源媒体、限制截图预算并按日期懒加载资讯

## 背景

AIHOT 的公开 feed 对部分 X 条目直接提供 `xMediaProxied` 图片；继续为这些条目启动 Chromium 会重复下载页面、增加等待并消耗 CloudBase 计算资源点。与此同时，30 天资讯不能在手机端一次性返回和渲染，普通用户的历史权限也已从 7 天收紧为滚动 24 小时。

## 决定

- 来源增强先校验并下载 AIHOT 的 `xMediaProxied` 原图，只接受 AIHOT 同源 `/api/img-proxy`、`mode=full` 且底层为 `https://pbs.twimg.com` 的图片；持久化到 Cloud Storage 后直接作为条目视觉。没有合格来源媒体时才进入原文截图队列。
- 来源媒体下载失败保持 fail-open，不清空已有图，也不阻止文字资讯公开；截图仍经过 v3 页面质量门槛和条件式 AI 复核，错误页、登录墙、挑战页、空白页和目标不符结果不得发布。
- `sourcePreviewWorker` 保持单实例单 Chromium，调度器最多并发调用 4 个隔离的 2GB 实例。并发只缩短队列时间，不会减少单任务 GBs。
- 视觉 worker 对每个将要领取的任务保守预留 24 资源点，每个上海自然日最多预留 1200 点；达到上限后不再领取新截图任务。该阈值只约束截图链路，不能代替 CloudBase 控制台对整个环境共享池的告警与观察。
- 最新资讯首屏只返回选定范围内的日期桶；7 天返回 7 个日期，30 天返回 30 个日期，包括没有资讯的日期。日期默认折叠，用户展开某天后调用 `feedDay` 分页加载当天内容。
- 普通用户只允许滚动 24 小时和 `1d` 筛选；Pro 会员允许 1、3、7、30 天。服务端继续独立鉴权，客户端隐藏选项不能替代权限检查。
- 24 节基础课的 72 张发布图合计约 35MB；课程接口只签发当前课程的 3 张，客户端画廊只让当前页进入加载窗口。旧的蓝色概览/流程图不再出现在基础课详情。

## 资源与失败边界

- 典型截图约 13 秒，2GB 实例按 GBs 计量；四并发不会把同一任务计费四次，但同时到来的四个任务会分别计费。
- 当前失败主要来自外站页面/资源超时、上游 401/404、精确目标无法捕获，以及视觉审核拒绝；这些属于内容和网络失败，不代表 2GB 内存不足。
- 每日 1200 点使用的是“任务开始前的保守预留”，失败任务也不会退回当天预算，因此实际消耗通常不高于保留值。若 CloudBase 计量规则或套餐变化，先核对控制台再调整阈值。

## 验证

- AIHOT 来源适配器、恶意代理地址拒绝、原图下载上传、已有视觉跳过下载均有自动化测试。
- 视觉预算达到 1200 点时，worker 返回 `budget-limited`，不领取任务且释放全局租约。
- 生产 `feedDay` 验证 2026-07-20 当天返回 224 条、首批 20 条和分页游标，函数执行约 366ms。
- 生产 30 天 feed 返回从 2026-07-22 到 2026-06-23 的 30 个日期桶。
- 课程图片源共 72 张，优化发布副本共 36,782,296 bytes；每个课程实际首轮只涉及 3 张，不会一次下载全部 35MB。

## 相关代码

- `hyyc/cloudfunctions/knowledgeFeed/adapters/aihot-feed-enrichment.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/source-metadata-enrichment-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-visual-worker-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/item-feed-query-service.js`
- `hyyc/features/knowledge-feed/list-model.js`
- `hyyc/pages/inbox/`
- `hyyc/features/ai-column/model.js`
- `hyyc/pages/column-reader/`

## 2026-07-22 后续修订

本决策中的“每日 1200 点截图预留上限”和“来源图片数量上限”已撤销。生产环境实际达到旧上限后停止领取新任务，造成最新资讯积压；现行规则改为不因应用内日预算跳过截图，并完整保存 AIHOT 提供的全部合格原帖图片。并发、超时、重试、图片来源校验和质量审核仍保留。详情见 `2026-07-22-unbounded-visual-attempts-and-aihot-source-scopes.md`。
