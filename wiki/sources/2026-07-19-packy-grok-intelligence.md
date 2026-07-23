---
title: "PackyAPI Grok 知识分析接入与小批生产验证"
type: source
tags: [packyapi, grok, intelligence, curated-feed, digests, cloudbase, cost-control]
last_updated: 2026-07-19
status: confirmed
confidence: high
---

# PackyAPI Grok 知识分析接入与小批生产验证

## 范围

本轮把会员知识智能从 disabled provider 升级为可替换的 PackyAPI Responses provider，覆盖资讯结构化分析、精选评分投影、滚动简报生成、队列限流、最近 30 天覆盖率和原始用量统计。公开精选、公开简报和支付没有开启。

API 凭据只从本机被 Git 忽略的 `docs/packyapi.txt` 读取并写入 CloudBase 函数环境变量；代码、测试、普通 Wiki 和部署配置都不含实际值。

## 已确认接口

- `GET /v1/models` 成功；当前令牌可用模型为 `grok-4.5`。
- `POST /v1/responses` 成功；服务实际返回模型标识 `grok-4.5-build`。
- 严格 JSON Schema 输出、`reasoning.effort=low`、usage 与 `cost_in_usd_ticks` 均可用。
- 低推理档在同类单条测试中把总 token 从 2,407 降到 1,238，结构和中文短理由仍有效。
- 三条合批测试一次返回三条完整结果，总用量 2,218 token、`costUsdTicks=93,600,000`。按四条生产单请求的平均原始成本单位外推，合批约减少 46%；`costUsdTicks` 只按供应商原始单位记录，不在缺少正式换算合同的情况下冒充美元金额。

## 生产小批结果

2026-07-19 将 `knowledgeOps` 与 `knowledgeFeed` 重新部署后，只临时开启一分钟间隔并处理四条最新资讯，随后立即关闭自动分析。最终状态：

- 条目 3,542；分析任务 2,410。
- 完成 4，待处理 2,406，retry/leased/blocked 均为 0。
- 最近 30 天有效资讯 2,363，AI ready 4，覆盖率 0.17%。
- 四条均为 `standard`，没有为了测试误判成 `curated`。
- 四次生产调用合计 input 3,648、output 2,653、reasoning 2,169、total 6,301 token，`costUsdTicks=229,964,000`。
- 入库理由能区分厂商自述、测试版代码、开源/个人工具分享和证据不足；模型与 usage 一并保存在分析文档。

生产环境最终状态为：API key 已配置，`KNOWLEDGE_INTELLIGENCE_ENABLED=false`、`KNOWLEDGE_DIGEST_GENERATION_ENABLED=false`、`KNOWLEDGE_LIVE_CURATED=false`、`KNOWLEDGE_LIVE_DIGESTS=false`，常规间隔恢复为 10 分钟。

## 实现边界

- `adapters/intelligence-contracts.js`：严格分析/合批/简报合同与引用校验。
- `adapters/packy-intelligence-provider.js`：Responses 传输、超时、错误映射、低推理档和最多五条合批。
- `services/feed-analysis-worker-service.js`：租约后合批、幂等发布、指数退避、北京时间日上限。
- `services/digest-generation-service.js`：24h/7d/30d 窗口、来源快照、覆盖标记；生成与公开读取使用独立开关。
- `repositories/`：任务、分析、条目投影、覆盖和用量元数据持久化。
- `knowledgeOps`：最近 30 天小批优先、覆盖率、各任务状态和原始用量汇总。

新任务按发布时间提高优先级；人工播种的最近资讯可覆盖旧 2,000 余条积压优先执行。每轮最多五条合成一次 provider 请求，默认每天最多分析 48 条。Provider、简报生成、精选公开和简报公开四层仍能独立关闭。

## 验证与剩余条件

- 197/197 个 Node 测试通过。
- 项目检查通过 31 个 JSON、178 个 JavaScript、11 个页面。
- 真实单条、本地真实合批、生产队列领取、分析发布和状态汇总均已验证。
- PackyAPI 的供应商条款要求外部发布内容保持人工审核与 AI 披露；当前公开开关关闭，正式开放前必须补管理员审核状态、驳回/修订记录和用户可见 AI 说明。
- 最近 30 天覆盖率达到至少 95%、人工抽检通过且成本预算由用户确认后，才允许开启真实精选；简报生成还需独立生产小批验证后才能开启公开读取。

## 2026-07-19 生产自动化启用（取代上述运行状态）

产品负责人随后明确要求忽略本轮额度预算、取消管理员逐条批准，并使用同一模型自动分析资讯、发布精选/简报及审核评论文本和图片。原“小批后关闭”的生产状态因此被以下状态取代：

- `KNOWLEDGE_INTELLIGENCE_ENABLED=true`、`KNOWLEDGE_DIGEST_GENERATION_ENABLED=true`、`KNOWLEDGE_LIVE_CURATED=true`、`KNOWLEDGE_LIVE_DIGESTS=true`。
- 分析间隔为 1 分钟、每轮最多 10 条、每日保护上限 10,000 条；仍使用最多五条合批、租约、幂等分析键、指数退避和确定性精选阈值。
- 截至本次记录，生产共有 3,553 条资讯，已完成 179 条分析、自动精选 12 条并发布 2 份真实简报；待处理 2,237、租约中 5、retry/blocked 均为 0；30 天原始 Token 汇总为 137,097。
- 运维状态新增精选数量、评分平均值/最大值以及 60/65/70 分分布，便于观察模型与确定性政策是否漂移。
- Provider 已用真实图片验证 Responses 多模态输入；评论严格 Schema 测试返回 `allow`。发布链路采用 fail-closed：`reject`、`unsure`、Provider 失败或临时图片 URL 失败都不公开，拒绝的新上传图片会删除。
- 精选页和简报页显示 AI 自动判断说明；评论输入坞显示上传和 AI 审核阶段。
- 最新回归为 199/199 个 Node 测试；项目检查覆盖 31 个 JSON、179 个 JavaScript、11 个页面。

本节只记录已实施的产品与生产状态，不推翻此前供应商条款证据。PackyAPI AUP 对外部发布的专业媒体内容提出人工复核要求；零人工放行是产品负责人明确选择，仍属于需要单独处理的供应商条款和治理风险。
