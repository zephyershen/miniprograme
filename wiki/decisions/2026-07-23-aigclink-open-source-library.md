---
title: "以独立来源适配器接入 GitHub 开源库"
type: decision
tags: [aigclink, open-source, source-adapter, feed, sync]
date: 2026-07-23
last_updated: 2026-07-23
status: accepted
confidence: high
---

# 以独立来源适配器接入 GitHub 开源库

## 背景

资讯页已有“全部 / 官方动态 / 资讯 / 推文”四个 AIHOT 来源范围，其中 `官方动态` 对应内部 `firstParty`。产品继续展示 AIGCLINK 公开方案库，并把第五个来源范围用于 GitHub 项目。

## 决定

- 顶部第五个来源范围使用短标签 `GitHub`；卡片来源继续显示 `GitHub 开源库`，不复制页面或另建产品入口。
- 独立频道采用连续卡片列表，不展示日期分组、折叠控件、时间线、时间点或单条时间；同一记录进入“全部”频道时仍按普通资讯的日期时间线展示。布局由频道和排序共同决定，不能写进共享条目 DTO。
- 独立频道不使用 AIHOT 的时间、公司和技术方向筛选，也不受 free/Pro 历史窗口限制；它只使用 AIGCLINK 原生多选标签筛选，并支持搜索全部标签。记录进入“全部”频道时仍遵守普通资讯的时间、主题和权限合同。
- AIGCLINK 使用独立 adapter 和 sync service。外部接口变化或失败只记录本来源错误，不阻断 AIHOT 正文同步。
- adapter 用包含边界日期的分段查询绕过公开 block map 的单次容量上限，读取目标集合全部索引记录；保存标题、可选摘要、收录日期、来源标签、项目地址和来源详情地址，不复制目标页面全文。
- 分钟定时器先读取最近 30 条的内容指纹；指纹变化时立即分段全量同步，未变化时只更新轮询时间。每天再做一次全量对账，以覆盖旧记录编辑或删除。该机制是最长约一分钟的轮询检测，不宣称 webhook 级瞬时推送。
- 条目对用户显示 `GitHub 开源库` 并使用 GitHub 官方 Invertocat 作为小头像；AIGCLINK 仍作为内部上游归因并保留其详情链接，原始项目链接不变。来源自身的“开源/闭源”等分类只作为元数据，不由本项目改写许可证结论。
- AIGCLINK 条目写入既有条目表并使用显式 `sourceChannelKeys: ['openSource']`。全量历史不再扩写按日索引，也不为全部老记录排截图；最近新增记录仍可进入视觉队列，历史文字立即可见。

## 上线状态

服务端已明确接受 `openSource`，不会再静默回退为 `all`。展示与同步合同升级到版本 3 后，生产已收录 1,727 条、528 个 AIGCLINK 标签，时间跨度为 2023-10-28 至 2026-07-21；`MCP` 标签生产查询返回 53 条。分钟轮询已验证未变化时跳过全量写入，同步错误为空。

## 相关代码

- `hyyc/cloudfunctions/knowledgeFeed/adapters/aigclink-source.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/aigclink-sync-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/scheduled-work-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/item-feed-query-service.js`
- `hyyc/features/knowledge-feed/channels.js`
- `hyyc/features/knowledge-feed/list-model.js`
- `hyyc/pages/inbox/index.wxml`
