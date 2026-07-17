---
title: "历史归档、长页截图与免费窗口验证"
type: source
tags: [aihot, archive, cloudbase, playwright, validation]
date: 2026-07-17
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 历史归档、长页截图与免费窗口验证

> 本页记录改造前阶段证据。当前公开总量、管理员权限和维护频率以 [全量资讯、管理员权益与容量验证](2026-07-17-full-feed-admin-and-capacity.md) 为准。

## 上游契约核验

- 2026-07-17 实测 `/api/public/items?mode=selected` 为 103 条、`mode=all` 为 1,943 条；两种模式都被服务端限制在最近 7 天，传入更早 `since` 仍会截到 7 天窗口。
- `/api/public/dailies?take=180` 返回 87 期，范围为 2026-04-22 至 2026-07-17；逐日 `/api/public/daily/{date}` 可获得标题、摘要、来源和原文链接，但不是历史全量 items。
- 公开 OpenAPI 没有 topic/tag 历史端点。`/topics` 网页不能作为稳定生产 API。

## 代码证据

- `repositories/feed-archive.js` 以日期为文档主键，合并时优先保留字段更完整的 selected 条目。
- `services/feed-archive-service.js` 分批回填 60 天，前向保留 90 天，并把 current selected 合并入日分片。
- `policies/feed-access.js`、`lib/feed-page.js`、`services/feed-service.js` 和 `presenters/public-feed.js` 共同限制免费 7 天窗口，包括直达详情和相关阅读。
- `services/sync-cycle-service.js` 优先即时视觉；有图片工作时延后历史与维护，历史正在批量回填时也延后 5 分钟视觉兜底。
- 来源快照刷新会保留归档进度、视觉租约和 `previewCaptureVersion`，避免控制状态丢失或把 v2 截图误判为旧版反复重建。
- `capture-segments.js` 在每次滚动后重新读取页面高度，连续截取最多 12 个视口；`preview-service.js` 校验协议版本/张数并对上传文件先写清理日志。
- 小程序列表只接收首图和 `previewCount`；详情重新请求完整 DTO，页面内 `swiper` 自动/手动轮播，`wx.previewImage` 接收全部临时 URL。

## 自动与真实环境验证

- `npm test`：119/119 通过。
- `npm run check`：21 个 JSON、88 个 JavaScript、6 个页面通过。
- `git diff --check`：通过，仅有工作区换行提示。
- 公网截图服务真实捕获 `https://aihot.virxact.com/changelog`：HTTP 200、协议 v2、页面高度 6,629px、5/5 张、未截断。
- CloudBase 2026-07-17 10:03 定时日志：函数成功、来源 `not-modified`、归档 `ready`，归档 60 天共 1,297 条，范围 2026-05-19 至 2026-07-17。
- 10:05 与 10:10 的旧批次配置均成功处理 2 条新版长截图；为给 6 小时完整源校验预留更充分的 180 秒预算，最终批次收敛为 1。10:20 最终版本维护成功处理 1 条，`pendingVisualDeletes=0`，未出现租约重入或渲染器 `BUSY`。
- 线上免费 feed：`windowDays=7`、`totalAvailable=102`；列表每条仅返回首个 `previewFileId`，同时保留真实 `previewCount`（抽样为 3、4、5、8）。
- 对 `previewCount=8` 的线上条目调用详情 action，详情实际返回 8 个 `previewFileIds`，验证列表/详情传输契约。

## 范围说明

- 60 天归档已存在，但会员订阅、支付、权益解析和历史页面尚未实现。
- 日报回填能立即提供一个月以上精选资料；无法从现有公开 items 接口补出过去一个月的完整全量条目。
- 普通 Wiki 不记录服务器密码、CloudBase 环境变量值或截图令牌。
