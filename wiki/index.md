---
title: "知识获取平台小程序 Wiki 导航"
type: index
tags: [index, miniprogram, knowledge-platform, editorial-index]
last_updated: 2026-07-16
status: confirmed
confidence: high
---

# 知识获取平台小程序 Wiki 导航

## 项目入口

- [项目总览](overview.md) — 当前产品、代码、云端状态、验证结果和剩余工作
- [微信小程序实体](entities/WeChatMiniProgram.md) — AppID、云环境、运行依赖和部署边界
- [里程碑时间线](timeline.md) — 从旧项目审计到真实微信端到端验证

## 关键决策

- [保留项目身份、移除旧业务](decisions/2026-07-13-rebuild-product.md) — 旧项目重建边界
- [采用编辑索引式知识平台首页](decisions/2026-07-15-editorial-knowledge-platform-ui.md) — 当前产品与 UI 主方向
- [资讯详情采用短读导览和条件式原文入口](decisions/2026-07-15-engaging-news-detail.md) — 当前详情阅读结构与原文打开边界
- [知识平台按能力与依赖边界组织代码](decisions/2026-07-16-modular-architecture.md) — 后续页面、内容源、仓储和服务的扩展规则
- [缺图资讯使用受控原文页面截图](decisions/2026-07-16-source-preview-renderer.md) — 公网渲染器、CloudBase 回填、多图预览和安全边界
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
- [2026-07-16 模块化架构评审](reports/architecture-2026-07-16.md) — 结构评分、已采纳项、延后项和未验证范围

## 当前模块

- 小程序页面：可筛选的纯资讯首页、完整摘要分段详情、条件式原始出处页，以及暂未从首页开放的个人阅读详情、收藏、设置；页面逻辑由 `features/knowledge-feed` 和 `features/digest` 承载
- 云函数：`digestIngest`、`digestStore`、`knowledgeFeed`
- 数据：待处理队列最多 5 条、结论卡最多 20 张、AI 月度硬上限 10 元

## 当前风险与下一入口

- 旧云业务已清理，6 个当前集合和三个新云函数已部署；真实微信端到端闭环已通过。
- 当前套餐没有可扣减的模型 Token，`hunyuan-v3 / hy3-preview` 会返回 429；小程序会明确提示并使用本地规则临时摘要，不冒充 AI 翻译或相关性判断。
- 近 7 天 AI/科技精选已在后台接入并全部允许展示；首页首屏只取 8 条，触底后每次再取 8 条。2026-07-16 最终动态池为 106 条且全部有视觉素材：13 条真实封面、93 条受控原文页面截图；公开首页不显示聚合平台、接口或缓存信息。娱乐、社会、游戏和英语仍待独立来源。
- 首页支持时间、公司与模型、技术方向组合筛选；筛选项附结果数，空选项不可选。“最新”对全部资讯按发布时间倒序，“热度”对全部资讯按热度倒序，不再单独处理放大主稿。
- 资讯详情提供原文截图多图预览、30 秒导读、完整上游摘要分段和三条相关阅读，不再按字符截断或添加人工省略号；当前没有已验证的外部业务域名，原文操作会复制链接供浏览器打开。
- 原文截图服务运行在独立公网服务器并通过回环 Mihomo 代理访问外站；服务、代理和 Nginx 当前正常，视觉回填失败 0、待清理 0。迁移部署时必须复制同等私网出口阻断。
- 若要恢复真正 AI 摘要，需要由用户决定开通资源点/成长套餐或配置自有模型；当前未自动开启新的付费能力。
- 微信开发者工具已编译运行，体验版上传与 30 天个人验证仍未完成。
- 当前仓库为 `D:\miniprogram`；接手时先读 [项目总览](overview.md)，再按需要读 [README](../README.md)。
