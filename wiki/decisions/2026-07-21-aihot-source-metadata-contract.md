---
title: "AIHOT 正文与来源元数据采用双接口显式合同"
type: decision
tags: [aihot, source-metadata, knowledge-feed, architecture, cloudbase]
sources: [../sources/2026-07-15-aihot-feed-integration.md]
date: 2026-07-21
last_updated: 2026-07-21
status: accepted
confidence: high
---

# AIHOT 正文与来源元数据采用双接口显式合同

## 背景

AIHOT 的条目接口能够稳定提供标题、摘要、原文和分类，但作者头像、X 昵称、账号与上游标签出现在另一份公开 feed 数据里。旧客户端把本项目内部 `categoryLabel` 放到卡片顶部，因此用户看到“方法实践”“模型更新”等本地分类，而不是 AIHOT 的“开源生态”“数据/训练”等原始标签；作者区域也只有文字来源，缺少 AIHOT 已展示的头像和账号身份。

## 选项

1. 继续根据标题和摘要在本地生成标签，并用来源字符串猜作者：实现简单，但会制造上游没有说过的标签和身份。
2. 只使用 feed 接口替换现有条目接口：作者信息完整，但会让稳定的正文、分页和历史同步依赖一个展示型接口。
3. 保留 `/items` 作为正文事实源，以 `/feed` 作为可选来源元数据增强；两者在 adapter 层匹配后写入显式字段。

## 最终决定

采用选项 3：

- `/items` 继续是标题、摘要、原文链接、发布时间和内容状态的权威来源；`/feed` 只补充作者身份、头像和 AIHOT 原始标签。
- 存储合同新增 `sourceIdentity: { platform, displayName, handle }`、`sourceTags: string[]` 与 `sourceAvatarFileId`。公开 presenter 只下发这三类展示字段，不下发内部元数据哈希。
- `sourceMetadataHash` 与 `contentHash`、`analysisInputHash` 独立。头像或标签变化只更新来源元数据，不重新排截图，也不重新触发资讯 AI 分析。
- AIHOT 的短期头像代理地址不入库、不下发。同步时立即下载并缓存到 CloudBase `knowledge-source-avatars/x/`，按规范化 handle 复用 `knowledge_feed_source_profiles` 中的来源资料。
- 元数据增强 fail-open：feed 超时或单条匹配失败不能阻断正文同步，也不能清空已存在的作者、头像或标签；后续分钟同步继续补齐。
- 列表、详情和相关阅读只展示 `sourceTags`，保持上游顺序并最多显示三项。没有原始标签时整行隐藏，禁止回退到 `categoryLabel`、频道、主题或模型推断标签。
- 作者行优先展示云端头像、显示名和 `@handle`；缺少增强数据时才回退到原有来源文字，不伪造头像或账号。

## 模块边界

- `adapters/aihot-feed-enrichment.js` 只负责读取和规范化 AIHOT feed。
- `services/source-metadata-enrichment-service.js` 负责编排匹配、头像持久化、哈希和 fail-open 合并。
- `repositories/source-profile.js` 只负责可复用来源账号资料；条目仓储继续拥有条目元数据。
- `presenters/public-feed.js` 约束公开字段；小程序端 `features/knowledge-feed/source-presentation.js` 统一作者与标签的展示模型。
- 页面只消费展示模型，不认识 AIHOT 的接口形状，也不再自行解释内部分类。

## 影响与验证

- 生产同步已写入 114 条带来源标签的资讯，并缓存 25 个来源账号头像；增强失败不会影响正文可用性。
- 用户指出的三条 Rohan Paul 资讯均已写入 `Rohan Paul / @rohanpaul_ai` 和云端头像。对应原始标签分别为：`开源生态 / 现象/趋势 / 部署/工程`、`xAI / 数据/训练 / 模型发布`、`开源生态 / 政策/监管`。
- 公开单条接口确认作者、头像和标签已返回，同时内部 `sourceMetadataHash` 未泄漏。
- 相关回归和全量测试最终为 384/384；项目检查通过 35 个 JSON、248 个 JavaScript 和 11 个页面。

## 状态

`accepted`。后续新增来源也必须先映射到同一显式合同，不能在页面里直接读取供应商字段或自行生成用户可见标签。

## 日期和来源

- 日期：2026-07-21
- 来源：用户对 AIHOT 作者/标签差异的现场核对、AIHOT 公开接口、生产 CloudBase 数据与本地回归

## 相关代码 / 页面

- `hyyc/cloudfunctions/knowledgeFeed/adapters/aihot-feed-enrichment.js`
- `hyyc/cloudfunctions/knowledgeFeed/lib/source-metadata.js`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/source-profile.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/source-metadata-enrichment-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/presenters/public-feed.js`
- `hyyc/features/knowledge-feed/source-presentation.js`
- `hyyc/pages/inbox/`
- `hyyc/pages/feed-detail/`
