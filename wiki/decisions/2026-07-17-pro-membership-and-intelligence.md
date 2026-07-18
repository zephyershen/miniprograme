---
title: "采用单一 Pro 会员、能力型权益与可回溯知识简报"
type: decision
tags: [membership, pro, entitlements, curated-feed, digests, intelligence, payment]
sources: [sources/2026-07-17-pro-membership-implementation.md, sources/2026-07-18-premium-ia-and-copy.md]
last_updated: 2026-07-18
status: confirmed
confidence: high
---

# 采用单一 Pro 会员、能力型权益与可回溯知识简报

## 决策

会员体系只设一个 `Pro` 档位，身份继续由云函数上下文中的 OpenID 派生 `ownerKey`，数据库不保存原始 OpenID。权限不以页面是否隐藏为准，而由每次服务端查询重新计算。

| 能力 | 普通用户 | Pro 会员 | 管理员 |
| --- | --- | --- | --- |
| 全量资讯 | 最近 7 天 | 最近 30 天 | 项目实际已归档的全部数据 |
| AI 专栏 | 目录与价值预览 | 可用 | 可用 |
| AI 精选 | 固定示例 | 可用 | 可用 |
| 24h / 7d / 30d 简报 | 固定示例 | 可用 | 可用 |
| 简报来源回看 | 不可用 | 可用 | 可用 |
| 购买提示 | 只显示内测说明 | 不显示 | 不显示 |

管理员授权与会员记录独立，管理员优先。会员状态为 `inactive / active / grace / expired / revoked`，续费状态独立为 `none / auto_renew / cancel_at_period_end`。取消续费不立即剥夺当前周期权益；客户端不能直接写会员状态。

## 前端结构

2026-07-18 起，小程序使用四个原生底部 Tab：资讯、专栏、简报、我的；旧“资讯、精选、简报、我的”Tab 结论被 [会员学习与精选信息架构决策](2026-07-18-premium-learning-and-curation-ia.md) 部分替代。

- 资讯继续使用编辑索引视觉、8 条一页、缩略图和稳定游标；免费用户可见锁定的 30 天入口，在 7 天边界只显示一次轻量提示。
- 资讯顶部带锁“精选”是独立会员页的导航入口，不参与普通频道筛选；精选对普通用户只展示固定完整示例，会员页默认按重要度并支持时间、频道、公司/模型和技术方向筛选。
- 专栏对普通用户展示 Agent、Skill、MCP 等学习路径预览；Pro 与管理员可展开完整学习单元。正式收费前，完整专栏正文必须迁移到服务端重鉴权内容接口。
- 简报使用 24 小时、7 天、30 天滚动窗口，必须包含结论、必须知道、影响、趋势、雷达、继续阅读和来源索引。
- 我的展示身份、到期时间、数据覆盖与权益。支付关闭期间只显示“会员能力内测中”，不出现价格或虚假购买按钮；收藏与旧结论卡作为二级入口。
- 真实管理员的“我的”页额外显示普通用户、Pro 会员、管理员三个身份预览按钮。预览状态由服务端验证真实管理员授权后写入同一授权记录；页面参数不能授予权限，预览普通用户后仍以真实管理员身份允许切回。

## 服务端边界

服务端统一返回 `viewer / entitlements / coverage / features`。所有列表、详情、精选、简报引用和历史回看均重新鉴权；越权返回 `ENTITLEMENT_REQUIRED` 及白名单 `featureKey`。

管理员身份预览是内测工具，不改变真实角色优先级：`viewer.actualRole` 仍为 `admin`，`viewer.role` 只表达本次有效预览角色。公开 `setRolePreview` action 必须先读取并验证有效管理员授权，普通用户、会员或客户端伪造请求统一拒绝；预览不会写入 `knowledge_memberships`。

模块边界：

- `membership`：会员状态、权益计算、人工授权和未来支付适配。
- `knowledgeFeed`：普通资讯、精选查询、详情和简报引用访问。
- `knowledgeIntelligence`：分析任务、精选策略、简报结构与 Provider 合同。
- `knowledgeOps`：人工授权、分析回填和状态查询；不再混入小程序公共 action。

新增集合为 `knowledge_memberships`、`knowledge_feed_item_analysis`、`knowledge_feed_analysis_jobs`、`knowledge_feed_digests`，均为 `ADMINONLY`。资讯查询使用数据库游标：最新为 `publishedAt + _id`，热度为 `score + publishedAt + _id`，精选为 `curationScore + publishedAt + _id`；计数与筛选矩阵只在首屏计算。

## AI 与精选

预留合同：

```js
analyzeItem(normalizedItem) => AnalysisResult
generateDigest(window, analyzedItems, previousDigest) => DigestResult
```

生产 Provider 在用户提供 API 前保持关闭；任务可保持 `pending`，不能用旧上游 `selected=true` 冒充 AI 精选。分析幂等键为 `provider + itemId + analysisInputHash + policyVersion`，热度与上游精选变化不会导致无意义重跑，也不保存思维链。

精选先做规范化 URL 与标题近似去重，再按 `35% 重要性 + 20% 新颖性 + 20% 来源可信度 + 15% 证据完整度 + 10% 可行动性 - 重复惩罚` 评分。综合分至少 70，单频道最多约 15%；低质量时期允许少于 10%，不能为凑比例纳入垃圾内容。

简报每天北京时间 08:00、08:05、08:10 分别生成 24h、7d、30d 滚动窗口。每条结论必须带有效来源 ID；跨出会员当前时间边界时只返回简报固化引用快照，不绕过普通资讯权限。

## 功能开关与支付边界

四个开关独立：会员 UI、真实精选、真实简报、购买入口。当前仅会员 UI 开启；真实精选、真实简报和购买入口关闭。AI 回填达到最近 30 天完整且分析覆盖至少 95% 后，才能开启真实精选和简报。

未来汇付只作为支付适配器：回调必须验签和幂等，订单、到期、宽限、取消、撤销与退款后的会员状态仍由本项目服务端掌控。当前不创建订单、不展示价格、不发起扣款。

## 被替代的结论

- “精选必须是原生底部 Tab”被“资讯顶部会员精选入口 + 底部 AI 专栏”替代。
- “只有 free/admin，管理员默认近 90 天”被 `free/member/admin` 能力权益与管理员全部归档替代。
- “上游 selected 就是精选”被本地版本化分析与质量硬门槛替代。
- “offset 足够支撑会员历史”被稳定数据库游标替代。
