---
title: "知识获取平台小程序 Wiki 导航"
type: index
tags: [index, miniprogram, knowledge-platform, editorial-index]
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 知识获取平台小程序 Wiki 导航

## 项目入口

- [项目总览](overview.md) — 当前产品、代码、云端状态、验证结果和剩余工作
- [微信小程序实体](entities/WeChatMiniProgram.md) — AppID、云环境、运行依赖和部署边界
- [里程碑时间线](timeline.md) — 从旧项目审计到真实微信端到端验证

## 工程工作流

- [微信开发者工具 CLI 优先工作流](concepts/WeChatDevToolsCLI.md) — 固定回环端口、自动启动与验证、故障恢复和人工介入边界

## 关键决策

- [保留项目身份、移除旧业务](decisions/2026-07-13-rebuild-product.md) — 旧项目重建边界
- [采用编辑索引式知识平台首页](decisions/2026-07-15-editorial-knowledge-platform-ui.md) — 当前产品与 UI 主方向
- [资讯详情采用短读导览和条件式原文入口](decisions/2026-07-15-engaging-news-detail.md) — 当前详情阅读结构与原文打开边界
- [知识平台按能力与依赖边界组织代码](decisions/2026-07-16-modular-architecture.md) — 后续页面、内容源、仓储和服务的扩展规则
- [缺图资讯使用受控原文页面截图](decisions/2026-07-16-source-preview-renderer.md) — 公网渲染器、CloudBase 回填、多图预览和安全边界
- [资讯源采用指纹驱动增量同步](decisions/2026-07-17-fingerprint-driven-feed-sync.md) — 每分钟轻量探测、条件回源、分布式租约与单触发器编排
- [资讯历史归档与视觉就绪发布](decisions/2026-07-17-feed-history-and-visual-publication.md) — 已被全量公开规则取代；保留归档与长图阶段证据
- [全量资讯存储与服务端角色权益](decisions/2026-07-17-full-feed-and-role-entitlements.md) — 取代精选总量和视觉门禁，普通用户 7 天全量、管理员 90 天
- [全量视觉队列、质量信号与移动端预算](decisions/2026-07-17-full-feed-visual-queue-and-quality.md) — 全库补图、精选语义、计数矩阵与增量渲染
- [单一 Pro 会员、能力型权益与可回溯简报](decisions/2026-07-17-pro-membership-and-intelligence.md) — 普通 7 天、Pro 30 天、管理员全部归档，精选与简报等待真实 AI
- [“别收藏了”首版产品与技术边界](decisions/2026-07-13-digest-inbox-v1.md) — 已被替代，但保留为现有摘要闭环的技术基础
- [AI 额度不可用时使用透明临时摘要](decisions/2026-07-15-ai-quota-fallback.md) — 当前无模型 Token 时的可用性策略

## 证据

- [旧代码与仓库审计](sources/2026-07-13-code-and-repository-audit.md) — 重建前的历史快照
- [首版本地实现审计](sources/2026-07-13-digest-inbox-implementation.md) — 初始文件、Git 与测试证据
- [云环境清理与首版部署核验](sources/2026-07-14-cloud-cleanup-and-deployment.md) — 旧资源清理、新集合和首次部署
- [微信端到端验证与运行时修复](sources/2026-07-15-wechat-e2e-and-runtime-fixes.md) — 真实 OpenID、完整业务闭环、AI 429 与兜底验证
- [编辑索引式 UI 实现证据](sources/2026-07-15-editorial-ui-implementation.md) — 选定 Moodboard、代码落地、测试和模拟器编译
- [AI HOT 图文资讯源接入与云端验证](sources/2026-07-15-aihot-feed-integration.md) — 公开资讯、封面缓存、频道映射、部署与模拟器证据
- [知识资讯主链路模块化重构与回归证据](sources/2026-07-16-modular-refactor.md) — feature、adapter、repository、service、presenter 边界与线上回归
- [原文截图服务部署与端到端验证证据](sources/2026-07-16-source-preview-deployment.md) — 服务器、CloudBase、云存储和微信多图预览验证
- [指纹同步与详情自动轮播验证](sources/2026-07-17-fingerprint-sync-and-carousel.md) — 线上定时日志、缓存状态、并发回归和详情页交互
- [历史归档、长页截图与免费窗口验证](sources/2026-07-17-feed-history-and-long-preview.md) — 上游 7 天限制、60 天归档、真实长页和公开 DTO
- [全量资讯、管理员权益与容量验证](sources/2026-07-17-full-feed-admin-and-capacity.md) — 线上全量/历史数量、管理员授权、函数与服务器容量
- [全量补图、精选语义与性能验证](sources/2026-07-17-visual-backfill-quality-and-performance.md) — 队列启动、质量信号、响应预算和移动端优化
- [Pro 会员与知识智能骨架实施证据](sources/2026-07-17-pro-membership-implementation.md) — 四 Tab、服务端重鉴权、游标、运维函数、ACL、索引和部署状态
- [2026-07-16 模块化架构评审](reports/architecture-2026-07-16.md) — 历史评分，已被 2026-07-17 复审取代
- [2026-07-17 模块化架构评审](reports/architecture-2026-07-17.md) — 当前整体 8.9/10、移动端性能 8.8/10，记录规模边界和付费上线前改造项
- [2026-07-17 会员与知识智能模块化复审](reports/architecture-2026-07-17-membership.md) — 当前整体 8.8/10、会员/智能边界和 AI/支付上线缺口

## 当前模块

- 小程序页面：资讯、精选、简报、我的四个原生 Tab，以及资讯详情、条件式原始出处和保留的个人消化页面；页面逻辑由 `features/knowledge-feed`、`membership`、`curated-feed`、`briefing` 和 `digest` 承载
- 云函数：`digestIngest`、`digestStore`、`knowledgeFeed`、`knowledgeOps`
- 数据：个人队列最多 5 条、结论卡最多 20 张；资讯为独立条目 + 按日索引 + 服务端权益，AI 月度硬上限 10 元

## 当前风险与下一入口

- 旧云业务已清理，当前会员与智能集合已按 `ADMINONLY` 加入，4 个云函数已部署；真实微信端到端闭环已通过。
- 当前套餐没有可扣减的模型 Token，`hunyuan-v3 / hy3-preview` 会返回 429；小程序会明确提示并使用本地规则临时摘要，不冒充 AI 翻译或相关性判断。
- 近 7 天 AI/科技全量已接入公开首页。普通用户服务端限制 7 天，人工 Pro 为 30 天，当前唯一微信账号以管理员身份查看全部已归档数据；部署时运维状态为 3,090 条资讯。全量缺图与列表缩略图继续独立回填。会员架构和固定示例已上线，真实 AI 精选、简报、支付及其他四个频道仍保持关闭。
- 首页支持时间、公司与模型、技术方向组合筛选；筛选项附结果数，空选项不可选。“最新”对全部资讯按发布时间倒序，“热度”对全部资讯按热度倒序，不再单独处理放大主稿。
- 资讯详情提供原文截图自动/手动轮播、图片下方圆点、点击后整组全屏滑动、30 秒导读、完整上游摘要分段和三条相关阅读；长页最多连续截取 12 张，列表只传首图、详情再取全部。“来源与原文”位于“接着看”之前，URL 可展开/收起并可复制。当前没有已验证的外部业务域名，微信也不能直接唤起任意系统浏览器，因此外部原文点击会复制链接并提示到手机浏览器粘贴。
- 原文截图服务运行在独立公网服务器并通过回环 Mihomo 代理访问外站；CloudBase 负责定时编排、上传实际 JPEG、保存文件 ID 和公开数据。真实 6,629px 长页已生成 5 张连续截图；协议校验、懒加载重测和上传清理日志均已启用。迁移部署时必须复制同等私网出口阻断。
- 若要恢复真正 AI 摘要，需要由用户决定开通资源点/成长套餐或配置自有模型；当前未自动开启新的付费能力。
- 微信开发者工具已启用 CLI 自动化；后续默认通过固定 `127.0.0.1:9420` 服务端口操作，体验版上传与 30 天个人验证仍未完成。
- 当前仓库为 `D:\miniprogram`；接手时先读 [项目总览](overview.md)，再按需要读 [README](../README.md)。
