---
title: "知识获取平台小程序 Wiki 导航"
type: index
tags: [index, miniprogram, knowledge-platform, editorial-index]
last_updated: 2026-07-28
status: confirmed
confidence: high
---

# 知识获取平台小程序 Wiki 导航

## 项目入口

- [项目总览](overview.md) — 当前产品、代码、云端状态、验证结果和剩余工作
- [上线前接手清单、CI 边界与剩余风险](syntheses/2026-07-23-release-readiness-handoff.md) — 新会话优先读取；记录精确版本锚点、旧审计关闭状态、P2 日志残余、依赖复审、真机与发布顺序
- [生产发布候选部署与微信体验版上传](sources/2026-07-23-production-release-candidate.md) — 当前可复现 SHA、生产收敛、冒烟、微信上传与剩余人工边界
- [会员订阅先登录、再单独支付](sources/2026-07-24-two-step-membership-login-and-optional-profile.md) — 第一次点击只校验当前微信账号、可选资料引导、第二次点击才建单支付，并支持仅撤销本机订阅验证的作用域退出
- [iOS 付款成功后会员未生效事故修复与恢复](sources/2026-07-24-ios-membership-payment-recovery.md) — `_id` 事务回滚、发货回调顺序、重复支付保护、账户级建单租约、生产恢复和新版真机预览
- [iOS 结算边界、资料审核恢复与续费状态展示](sources/2026-07-24-ios-refund-profile-review-and-renewal-ui.md) — 不提供管理员主动退款、Apple 到虚拟支付账户再提现的结算路径、资料审核恢复与续费展示
- [历史：会员支付可见账号确认与完整安全诊断](sources/2026-07-24-visible-wechat-account-confirmation-and-payment-diagnostics.md) — 收银台诊断仍有效，旧单次点击交互已被两步流程取代
- [异步评论、站内消息、稳定加载与会员绑定上线](sources/2026-07-24-async-comments-message-center-and-stable-loading.md) — 评论/资料后台审核、我的消息、全页懒加载、无闪屏互动、微信身份与商品价格边界
- [评论回复持久化与消息左滑删除修复证据](sources/2026-07-25-threaded-comments-and-message-deletion.md) — `replyToCommentId` 入口漏传根因、线上 `deleteMessage` 更新、两次重进分组与测试数据清理
- [会员专栏管理员发布系统实现与后台部署](sources/2026-07-27-column-admin-publishing-implementation.md) — 小程序内管理端、草稿/发布快照、30 节基线覆盖、图片生命周期和首次后台部署的历史记录；后续生产 canary 以 7 月 28 日记录为准
- [小程序 UI 与功能审计分流及首批加固](syntheses/2026-07-27-ui-audit-triage.md) — 外部审计的采纳边界、按钮 v2 兼容基线、首页卡片模板去重，以及后续视觉与功能分期
- [会员学习进度、跨历史搜索与界面一致性加固](sources/2026-07-27-learning-progress-search-and-ui-hardening.md) — 阅读进度、继续学习、一框全站搜索、稳定推荐热度、统一空态与刷新、图片签名恢复的本地实现记录
- [会员专栏、学习进度与全站搜索生产发布准备](sources/2026-07-28-member-column-search-release-prep.md) — 29 集合/50 索引生产收敛、8,152 条搜索回填、三角色双图发布 canary、最终代码加固、632,253-byte 微信预览候选和待部署/未提交审核边界
- [评论界面送审暂停与开发者工具验收](sources/2026-07-28-comment-ui-review-pause.md) — 已上传安全候选 `2.4.2` 隐藏评论入口、气泡、弹层、专属文案与通知，保留后端和未来恢复路径；792/792 回归、服务端源码排除、线上源码回读与六页开发者工具 canary
- [资料异步审核、预览支付诊断与微信消息回调上线](sources/2026-07-24-async-profile-review-and-preview-payment-diagnostics.md) — “审核中”队列、真机支付故障边界、入站消息 webhook 与生产收敛
- [资料保存审核超时修复与生产部署](sources/2026-07-24-profile-moderation-timeout-repair.md) — 预览版资料保存失败根因、模型无思考修复、代码-only 发布与真实 canary 边界
- [2026-07-23 全项目生产就绪审计](reports/production-readiness-audit-2026-07-23.md) — 已被发布候选修复结果取代的审计前快照
- [微信小程序实体](entities/WeChatMiniProgram.md) — AppID、云环境、运行依赖和部署边界
- [里程碑时间线](timeline.md) — 从旧项目审计到真实微信端到端验证

## 工程工作流

- [微信开发者工具 CLI 优先工作流](concepts/WeChatDevToolsCLI.md) — 固定回环端口、自动启动与验证、故障恢复和人工介入边界

## 关键决策

- [保留项目身份、移除旧业务](decisions/2026-07-13-rebuild-product.md) — 旧项目重建边界
- [采用编辑索引式知识平台首页](decisions/2026-07-15-editorial-knowledge-platform-ui.md) — 当前产品结构与内容层级方向
- [采用 Luma 珍珠表面视觉系统](decisions/2026-07-17-luma-ui-redesign.md) — 历史视觉基线，蓝紫微光细节已被编辑蓝方案替代
- [采用资讯社交动作与编辑蓝会员转化界面](decisions/2026-07-18-engagement-and-editorial-social-ui.md) — 评论/喜爱/收藏/分享、会员转化卡和当前视觉基线
- [评论采用主动资料身份与原图附件，资讯互动使用乐观目标状态](decisions/2026-07-19-profiled-media-comments-and-optimistic-engagement.md) — 即时按钮反馈、幂等事务、头像昵称、表情与手机原图评论
- [精选与简报采用 AI 自动发布，评论采用多模态 AI 先审后发](decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md) — 自动资讯分析、精选/简报发布、评论图文 fail-closed 审核与治理风险
- [评论与资料采用后台 AI 审核，结果统一进入站内消息](decisions/2026-07-24-async-comments-and-message-center.md) — 取代评论同步等待；后台审核、可靠 outbox、消息中心、稳定加载与会员身份绑定
- [送审替换候选暂时隐藏评论界面](decisions/2026-07-28-pause-comment-ui-for-review.md) — 使用确定性客户端发布开关隐藏所有可达评论界面，保留后端与历史数据；未来恢复需作为新版本重新审核
- [会员专栏采用管理员草稿与发布快照](decisions/2026-07-27-column-admin-draft-publishing.md) — 真实管理员小程序后台、代码基线 + 数据库覆盖、版本冲突和发布媒体保护
- [采用微信小程序虚拟支付销售一次性 30 天会员](decisions/2026-07-19-wechat-virtual-payment-membership.md) — 道具直购、官方查单/发货、幂等权益、退款回收与服务端内容保护；取代斗拱支付决策
- [CloudBase 主模型与 Packy 自动兜底方案](decisions/2026-07-20-cloudbase-ai-primary-packy-fallback.md) — 已切换资源点计费；CloudBase 为主、Packy 做预算与故障兜底
- [资讯采用四分钟有界等图，Pro 转化使用简约完整权益卡](decisions/2026-07-21-bounded-visual-publication-and-pro-access-pass.md) — 正常图文一起出现，失败或超时仍公开文字；简报动态计数，七项权益与折扣共用单一模型，会员界面采用无侧轨的白底平铺结构
- [资讯发布不再依赖图片，动手课改为直接操作手册](decisions/2026-07-21-image-independent-feed-and-direct-practical-manual.md) — 动手课与简报结构继续有效；“排队时立即展示文字”已被四分钟有界等待细化
- [资讯按视觉就绪发布，专栏收敛为基础课与动手课](decisions/2026-07-21-visual-ready-feed-and-practical-column.md) — 部分已被取代；裁剪修复、双车道与两分钟调度继续有效，视觉发布门禁已经撤销
- [以实用课程、每周案例与趋势档案重做会员专栏](decisions/2026-07-20-practical-column-editorial-system.md) — 历史方案，已局部替代；24 节原生课程仍保留，周案例与趋势已退出当前界面
- [在原生课程中恢复受保护的手绘图集](decisions/2026-07-21-restore-protected-handdrawn-galleries.md) — 24 节基础课现已全部接入三页受保护手绘图；72 张 v2 发布副本按课签发短期地址
- [将会员精选移到资讯顶部并把底部入口改为 AI 专栏](decisions/2026-07-18-premium-learning-and-curation-ia.md) — 当前四 Tab、会员精选入口与学习专栏职责
- [新资讯使用聚焦截图，AI 专栏采用三页手绘知识卡](decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md) — 新资讯截图策略、媒体等待、手绘课程结构与开发者工具保持打开规则
- [资讯被动提示更新与专栏高清按需预览](decisions/2026-07-18-passive-feed-updates-and-hd-column-preview.md) — 阅读期间不自动换列表、轻量新增计数和 CloudBase 高清图按需打开
- [资讯详情采用短读导览和条件式原文入口](decisions/2026-07-15-engaging-news-detail.md) — 当前详情阅读结构与原文打开边界
- [知识平台按能力与依赖边界组织代码](decisions/2026-07-16-modular-architecture.md) — 后续页面、内容源、仓储和服务的扩展规则
- [AIHOT 正文与来源元数据采用双接口显式合同](decisions/2026-07-21-aihot-source-metadata-contract.md) — `/items` 保持正文事实，`/feed` 只补作者、云头像和上游原始标签；页面禁止用内部分类兜底
- [CloudBase 媒体只以 File ID 持久化，并采用单并发高频视觉调度](decisions/2026-07-21-cloud-media-runtime-and-safe-visual-throughput.md) — 媒体临时 HTTPS 规则继续有效；其中公网单机 Chromium 单并发结论已被 CloudBase 隔离实例六并发取代
- [缺图资讯使用受控原文页面截图](decisions/2026-07-16-source-preview-renderer.md) — 历史截图决定；公网浏览器执行层已于 2026-07-22 被取代，质量与安全规则继续有效
- [原文截图迁入 CloudBase SCF，公网服务器只保留受限代理](decisions/2026-07-22-cloudbase-scf-source-preview.md) — 当前截图执行层、六个隔离实例并发、实时等待目标 0、直连/代理路由与队列边界
- [优先复用来源媒体、限制截图预算并按日期懒加载资讯](decisions/2026-07-22-native-media-first-budgeted-visuals-and-lazy-days.md) — 历史决策；每日截图上限已被后续决策撤销，日期懒加载仍有效
- [取消截图日限额并采用 AIHOT 来源范围导航](decisions/2026-07-22-unbounded-visual-attempts-and-aihot-source-scopes.md) — 全部/一手信源/资讯/推文、完整来源媒体、最新优先和隔离实例持续清队列
- [以独立来源适配器接入 GitHub 开源库](decisions/2026-07-23-aigclink-open-source-library.md) — 第五个来源范围、AIGCLINK 标签筛选、全量历史、分钟指纹同步和独立失败边界
- [原文截图 v3 质量闸门与历史坏图修复](sources/2026-07-21-source-preview-v3-quality-and-repair.md) — HTTP 200 错误壳拦截、精确目标、条件式 AI 复核、公平队列及任务删除/保留生命周期证据
- [资讯源采用指纹驱动增量同步](decisions/2026-07-17-fingerprint-driven-feed-sync.md) — 每分钟轻量探测、条件回源、分布式租约与单触发器编排
- [资讯历史归档与视觉就绪发布](decisions/2026-07-17-feed-history-and-visual-publication.md) — 已被全量公开规则取代；保留归档与长图阶段证据
- [全量资讯存储与服务端角色权益](decisions/2026-07-17-full-feed-and-role-entitlements.md) — 全量存储、角色权益和“无图也进列表”继续有效
- [全量视觉队列、质量信号与移动端预算](decisions/2026-07-17-full-feed-visual-queue-and-quality.md) — 队列和性能规则仍有效；单车道与无图公开规则已局部替代
- [单一 Pro 会员、能力型权益与可回溯简报](decisions/2026-07-17-pro-membership-and-intelligence.md) — 会员与简报边界继续有效；普通 7 天的历史结论已被滚动 24 小时取代，Pro 30 天、管理员全部归档不变
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
- [Luma UI 重构与模拟器验证证据](sources/2026-07-17-luma-ui-redesign.md) — 九页面视觉重构、测试、真实数据截图和溢出修复
- [会员信息架构、AI 专栏与产品文案改版证据](sources/2026-07-18-premium-ia-and-copy.md) — 十页面结构、六个学习单元、频道锁与截图聚焦可行性分析
- [聚焦截图与手绘 AI 专栏实施证据](sources/2026-07-18-focus-previews-and-handdrawn-column.md) — 生产 X 正文裁切、媒体就绪、新资讯边界、三页知识卡和微信模拟器验证
- [专栏高清预览与资讯被动更新实施证据](sources/2026-07-18-hd-column-and-passive-feed-updates.md) — 18 张高清云图、轻量新增计数、云端部署与模拟器验收
- [资讯互动、收藏记录、微信分享与会员转化界面实施证据](sources/2026-07-18-engagement-ui-implementation.md) — 新集合、权限、索引、部署、模拟器和真实微信上下文往返
- [互动可靠性、资料评论与原图附件实施证据](sources/2026-07-19-interaction-reliability-and-comment-media.md) — TransactionBusy 根因、乐观交互、资料 ACL、部署和组件自动化
- [PackyAPI Grok 知识分析接入、生产自动化与图文审核](sources/2026-07-19-packy-grok-intelligence.md) — 严格结构、低推理、分析合批、自动精选/简报、评论多模态审核和生产状态
- [资料审核、付费内容保护与斗拱会员支付实施证据](sources/2026-07-19-profile-moderation-and-huifu-payment.md) — 昵称/头像审核、包内正文移除、云存储规则、支付部署与剩余商户配置
- [资料保存审核超时修复与生产部署](sources/2026-07-24-profile-moderation-timeout-repair.md) — 主模型 30 秒超时、Packy 网络失败、`enable_thinking:false` 修复及线上代码回读
- [异步评论、站内消息、稳定加载与会员绑定上线](sources/2026-07-24-async-comments-message-center-and-stable-loading.md) — 617 项回归、25 集合/43 索引、双函数部署、支付计划冒烟与 457,142-byte 开发预览
- [生产基础设施、斗拱模式与会员定价复核](sources/2026-07-19-infrastructure-pricing-and-huifu-mode.md) — 公网截图机与 CloudBase 实时容量、直连/间联判断规则和冷启动价格建议
- [微信虚拟支付会员实现与部署证据](sources/2026-07-19-wechat-virtual-payment.md) — 官方虚拟商品边界、签名/查单/发货实现、测试与安全关闭的云端部署
- [CloudBase 模型成本、共享资源点与 Packy 混合路由测算](sources/2026-07-20-cloudbase-ai-cost-and-hybrid-routing.md) — 当前真实资源曲线、模型预算、分钟任务浪费与切换阈值
- [历史内容补审、资讯同步恢复与支付通知上线证据](sources/2026-07-20-launch-readiness-remediation.md) — 生产缺审归零、同步失败恢复、退款安全消息与剩余真实联调边界
- [实用会员专栏与自动周案例实现证据](sources/2026-07-20-practical-column-implementation.md) — 24 节原生课程、周案例可靠发布、趋势档案、标题级预览与本地构建证据
- [专栏阅读恢复、手绘图回接与生产验证](sources/2026-07-21-column-reader-restoration.md) — 旧后端合同错配根因、18 张原图状态、六节受保护图集、云端部署与真实微信模拟器证据
- [视觉渲染修复、双车道队列与实操专栏上线证据](sources/2026-07-21-visual-renderer-and-practical-column.md) — 422 裁剪根因、线上 canary、视觉发布门禁、24+6 专栏、口语化简报与开发者工具验证
- [CloudBase 超时、无图资讯与动手课生产复核](sources/2026-07-21-timeout-feed-and-manual-production-validation.md) — 84 次模型 trace、资源点快照、无图列表/详情、合同 v4、实操页面与简报生产验证
- [四分钟等图、动态简报标题与 Pro 权益通行证实施证据](sources/2026-07-21-bounded-visual-and-membership-conversion.md) — 生产查询、云函数部署、314 项测试与微信开发者工具普通/Pro 双态验收
- [CloudBase 媒体运行时解析与安全截图提速证据](sources/2026-07-21-cloud-media-runtime-and-safe-visual-throughput.md) — 本地图片 500、临时签名 403 与按 `maxAge` 换签边界，AIHOT 移动端结构和生产队列复核
- [CloudBase 图片临时签名运行态修复与时间语义更正](sources/2026-07-22-cloud-media-proactive-renewal.md) — 更正 TCB `t` 为签名生成时间，修复资讯图片与来源头像全局留白，并保留按 `maxAge`/有界 TTL 的批量续签
- [CloudBase SCF 截图迁移、公网代理收缩与移动时间线验证](sources/2026-07-22-cloudbase-scf-source-preview-and-mobile-timeline.md) — X 直连/官方嵌入/代理 canary、WSS 中继、410 封口、时间线折叠与 422 项测试
- [CloudBase 四并发截图与 24 课手绘图 v2 上线证据](sources/2026-07-22-parallel-visual-worker-and-column-media-v2.md) — 真实四实例并发、实时队列目标、72 张压缩上传、24×3 映射与 413 项测试
- [CloudBase 六并发截图与个人代理余量验证](sources/2026-07-22-six-concurrency-and-personal-proxy-headroom.md) — 两轮六路真实 X 压测、服务器峰值、实时队列目标 0 与个人代理余量
- [新公网直连中继部署与 CloudBase 回程路由灰度](sources/2026-07-22-new-relay-route-canary.md) — 原公网地址回程失败与生产回滚历史，当前已被替换地址切换结论取代
- [替换公网地址回程恢复与生产切换](sources/2026-07-22-replacement-relay-ip-cutover.md) — 新地址通过 CloudBase 探针与真实 X canary，生产以正式域名 + 固定地址接入
- [资讯间距、生产截图链路与运行性能复核](sources/2026-07-22-runtime-reliability-performance-and-feed-spacing.md) — 14rpx 卡片间距、跨站直连、CloudBase 探针/X canary、实时队列、开发者工具首屏与性能边界
- [生产中继单端点与旧节点角色复核](sources/2026-07-23-relay-single-endpoint-audit.md) — 线上仅配置当前中继；旧公网服务器不在生产路径，也不是自动备用机
- [新公网节点个人 Clash 代理部署与 Mihomo 验证](sources/2026-07-23-personal-clash-proxy.md) — 复用 Nginx 443 的独立 VLESS/WebSocket 服务、受限订阅与真实 Mihomo 出口验证
- [来源头像资料延迟回填修复](sources/2026-07-23-source-avatar-profile-join-repair.md) — 正文与作者资料传播错位的根因、作者档案回填、线上强制刷新与头像 HTTP 200 证据
- [GitHub 开源库接入与生产验证](sources/2026-07-23-aigclink-open-source-library-integration.md) — 分段全量契约、官方头像、1,728 条生产同步、528 个标签、515 项回归和微信上传证据
- [CloudBase 数据库、存储与函数发布门禁](sources/2026-07-23-cloudbase-access-control-release-controls.md) — ADMINONLY/存储规则、四函数精确 manifest、退休计划与白名单回读
- [CloudBase 数据库索引合同与生产漂移](sources/2026-07-23-cloudbase-database-index-controls.md) — 34 项增量合同、发布前 11 项漂移、无删除 apply 与后续生产收敛
- [CloudBase 数据库集合创建控制](sources/2026-07-23-cloudbase-database-collection-controls.md) — 复用 22 集合合同、发布前 21/22 漂移、CreateTable + ADMINONLY 与后续生产收敛
- [生产发布候选部署与微信体验版上传](sources/2026-07-23-production-release-candidate.md) — 22 集合、34 索引、四函数、生产 canary、版本 1.0.0 与 397,154-byte 包体
- [2026-07-16 模块化架构评审](reports/architecture-2026-07-16.md) — 历史评分，已被 2026-07-17 复审取代
- [2026-07-17 模块化架构评审](reports/architecture-2026-07-17.md) — 当前整体 8.9/10、移动端性能 8.8/10，记录规模边界和付费上线前改造项
- [2026-07-17 会员与知识智能模块化复审](reports/architecture-2026-07-17-membership.md) — 当前整体 8.8/10、会员/智能边界和 AI/支付上线缺口
- [2026-07-18 资讯互动与编辑蓝 UI 模块化复审](reports/architecture-2026-07-18-engagement.md) — 本轮范围 9.2/10、当前整体约 9.0/10
- [2026-07-19 互动可靠性与媒体评论模块化复审](reports/architecture-2026-07-19-engagement-v2.md) — 本轮范围 9.2/10、评论组件化与公开前内容审核缺口
- [2026-07-19 Packy/Grok 知识智能模块化复审](reports/architecture-2026-07-19-intelligence.md) — 本轮范围 9.2/10、Provider 可替换性、成本控制与人工审核缺口
- [2026-07-19 自动知识智能与评论审核模块化复审](reports/architecture-2026-07-19-automatic-intelligence.md) — 本轮 9.3/10、整体约 9.1/10，记录自动发布边界与上线治理缺口
- [2026-07-20 实用会员专栏模块化复审](reports/architecture-2026-07-20-practical-column.md) — 本轮 9.2/10，记录付费边界、自动周案例可靠性与后续拆分阈值
- [2026-07-23 全项目生产就绪审计](reports/production-readiness-audit-2026-07-23.md) — 已被 `1bf9fb8` 修复和生产回读取代的历史 Fail 快照

## 当前模块

- 小程序页面：资讯、专栏、简报、我的四个原生 Tab，以及搜索、精选、会员、消息、详情、阅读器、资料、来源、收藏和真实管理员专用的专栏列表/编辑器，共 15 个当前产品页面。`trend-detail` 仍注册为第 16 个兼容路由，但当前没有趋势入口。评论由独立 `comment-sheet` 组件承载，页面逻辑另有 `features/column-admin` 管理边界
- 云函数：`knowledgeFeed`、`sourcePreviewWorker`、`knowledgeOps`、`membershipBilling`
- 数据：资讯为独立条目 + 按日索引 + 服务端权益，并有独立视觉任务、用户互动、会员评论及审核状态、公开资料、资料审核队列、消息 outbox、用户收件箱、会员、订单、分析、简报和模型预算表；历史周案例与趋势档案表只为兼容保留。服务端专用集合均为 `ADMINONLY`

## 当前发布边界与下一入口

- 当前已上传安全开发版本 `2.4.2` 的小程序代码锚点为
  `fffd078c4e30f3d7f03f3e731b1183ebebb6aeb6`；`2.4.0@68382f5` 与误带
  服务端源码的 `2.4.1` 均已被替换且不得提交。除既有专栏管理、学习进度、全站搜索
  和资讯稳定性改进外，该版本确定性隐藏评论入口、气泡、弹层、权益文案与评论通知。
- 当前生产合同为 29 个 `ADMINONLY` 集合、50 个索引、4 个正式函数和
  `knowledgeFeed` 10 个定时触发器；`knowledgeFeed` 已从评论实现锚点 `5acb52e` code-only
  部署，线上下载的 118 个受控文件与发布工作树 SHA-256 全部一致，manifest 回读
  收敛。8,152 条搜索存量回填、三角色搜索和管理员双图草稿/发布/下架 canary 已通过。
- 最终干净工作树验证为 38 个 JSON、358 个受控 JavaScript、16 个页面、792/792 个
  Node 测试、29 个集合与 50 个索引；覆盖率和生产依赖审计通过。微信开发者工具从
  精确提交生成 637,272-byte 预览包；`2.4.2` upload 回执为 639,674 bytes。
- 打包配置显式排除 `cloudfunctions / cloudrun / scripts / tests`，项目检查和专项测试
  均锁定该边界。`2.4.2` 已从零 `node_modules` 的独立干净工作树上传成功；正式线上
  最后确认仍为 `2.3.5`。审核规则确认、审核提交和审核通过后的显式发布仍由用户本人
  完成，本次没有代为勾选或提交。
- 预览支付继续使用 `env=0`，只能按真实扣款谨慎测试；开发者工具模拟器不作为支付
  验收环境。已付款账号只验证权益恢复，不得重复购买。
- 依赖风险登记有效至 2026-08-06；若审核延后越过该日期，须重新审计。微信订阅消息
  因缺少公众平台真实模板合同未接入，不使用假模板；站内消息仍是当前可用闭环。
- 分支和 RC 标签 `rc/2026-07-28-comments-hidden-v2` 已推送并精确指向 `fffd078`。
  下一步由用户本人确认平台审核规则并提交 `2.4.2`，审核通过后仍需显式发布。
- 当前仓库为 `D:\miniprogram`；接手时先读 [项目总览](overview.md)，再按需要读 [README](../README.md)。
