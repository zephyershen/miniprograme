---
title: "取消截图日限额并采用 AIHOT 来源范围导航"
type: decision
tags: [aihot, source-channel, screenshot, cloudbase, timeline, membership, media]
date: 2026-07-22
last_updated: 2026-07-23
status: accepted
confidence: high
---

# 取消截图日限额并采用 AIHOT 来源范围导航

## 背景

生产环境的截图预留达到每日 1200 点后，视觉 worker 从 09:54 起停止领取任务，最新资讯累积为 25 条首次任务和 97 条重试任务。与此同时，原来的“AI 前沿/科技”是本地语义分类，不能稳定对应 AIHOT 的公开数据边界。

## 决定

- 删除截图链路的应用内每日点数预留和 50 次启动上限。worker 不再因为旧预算字段停止领取任务；四个隔离的 2GB `sourcePreviewWorker` 并发、290 秒软截止、任务租约、指数退避、最多 8 次尝试和 v3 质量门仍然有效。
- 首次任务在同一优先级和同一次同步入队时按 `publishedAt` 从新到旧领取，目标是让用户刚看到的资讯先补图；历史 retry 仍通过持久化轮转获得处理机会。
- AIHOT `xMediaProxied` 不再限制图片张数，有多少合格原帖照片就下载并持久化多少张。仍逐张校验 AIHOT 代理路径、底层 HTTPS 主机、媒体类型和单图字节上限；详情返回全部图片，列表只取一张缩略图。
- 资讯页使用同一套列表而不是四个独立页面。顶部来源范围为“全部 / 官方动态 / 资讯 / 推文”；`官方动态` 对应的内部 key 仍为 `firstParty`，“精选”是单独的会员能力入口，不参与来源过滤。
- `sourceChannelKeys` 保存 AIHOT 返回的全部来源成员关系；查询使用互斥的 `sourceChannelKey`，优先级为 `firstParty > x > news`，避免同一条资讯在多个范围重复出现并控制数据库复合索引数量。
- 四个来源范围共用日期折叠、时间线、时间点、筛选、最新/热度排序和按日懒加载。普通用户仍由服务端限制为滚动 24 小时，Pro 允许 30 天，管理员允许全部归档。
- 顶部筛选栏不再显示结果总数；筛选与排序放在同一行。筛选弹层内部仍显示各选项数量。

## 生产修复与验证

- `knowledgeFeed` 已部署取消日限额的版本，并移除同步状态中遗留的 `visualBudget*` 字段。部署后首次任务从 25 条降为 0；最新 5 条 X 资讯均转为 `ready`，写入截图和列表缩略图。
- 抽检最新一条截图，画面准确包含作者、正文、原帖视频和互动区，没有错误页、登录墙或空白占位。
- 强制全量刷新更新了 2,092 条当前资讯；生产来源主范围已有 `firstParty=154`、`news=762`、`x=1176` 条活动记录，其余更早归档记录保留在“全部”。
- 生产 `knowledge_feed_items` 使用 4 个 `sourceChannelKey` 复合索引，并清理了不再使用的旧频道索引；最终索引总数为 14。
- AIHOT 原图增强曾在 `aihot-source` 重新合并主数据时丢失视觉字段：图片已识别并下载，但 `previewFileIds` 没有进入持久化文档。现改为分别通过 `sourceMetadataFields` 和 `visualFields` 白名单合并来源资料与视觉字段；生产抽样的 Codex 资讯已从截图 `retry` 转为 AIHOT 原图 `ready`。
- 自动化测试 420/420 通过；覆盖同批任务最新优先、维护令牌强制全量刷新、AIHOT 原图跨来源增强边界持久化；项目检查覆盖 35 个 JSON、264 个 JavaScript 和 11 个页面。

## 失败边界

取消日限额不等于发布无意义图片。当前剩余 retry 主要是原网页抓取失败或 AI 视觉复核拒绝；这些任务继续退避重试，文字仍可读，但失败截图不会发布。CloudBase 共享资源池继续通过控制台告警观察，而不是用应用内硬停机牺牲内容完整性。

## 相关代码

- `hyyc/cloudfunctions/knowledgeFeed/lib/source-channels.js`
- `hyyc/cloudfunctions/knowledgeFeed/adapters/aihot-feed-enrichment.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-visual-worker-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-sync-maintenance-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/feed-item.js`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/feed-visual-job.js`
- `hyyc/features/knowledge-feed/channels.js`
- `hyyc/features/knowledge-feed/list-model.js`
- `hyyc/pages/inbox/`
