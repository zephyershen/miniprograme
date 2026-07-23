---
title: "知识获取平台小程序项目总览"
type: overview
tags: [overview, miniprogram, wechat, knowledge-platform, editorial-index]
sources: [sources/2026-07-13-digest-inbox-implementation.md, sources/2026-07-14-cloud-cleanup-and-deployment.md, sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, sources/2026-07-15-editorial-ui-implementation.md, sources/2026-07-15-aihot-feed-integration.md, sources/2026-07-16-modular-refactor.md, sources/2026-07-16-source-preview-deployment.md, sources/2026-07-17-fingerprint-sync-and-carousel.md, sources/2026-07-17-feed-history-and-long-preview.md, sources/2026-07-17-full-feed-admin-and-capacity.md, sources/2026-07-17-visual-backfill-quality-and-performance.md, sources/2026-07-17-pro-membership-implementation.md, sources/2026-07-17-luma-ui-redesign.md, sources/2026-07-18-premium-ia-and-copy.md, sources/2026-07-18-focus-previews-and-handdrawn-column.md, sources/2026-07-19-interaction-reliability-and-comment-media.md, sources/2026-07-19-packy-grok-intelligence.md, sources/2026-07-19-profile-moderation-and-huifu-payment.md, sources/2026-07-19-infrastructure-pricing-and-huifu-mode.md, sources/2026-07-19-wechat-virtual-payment.md, sources/2026-07-20-cloudbase-ai-cost-and-hybrid-routing.md, sources/2026-07-20-launch-readiness-remediation.md, sources/2026-07-20-practical-column-implementation.md, sources/2026-07-21-column-reader-restoration.md, sources/2026-07-21-timeout-feed-and-manual-production-validation.md, sources/2026-07-21-bounded-visual-and-membership-conversion.md, sources/2026-07-21-source-preview-v3-quality-and-repair.md, sources/2026-07-22-cloudbase-scf-source-preview-and-mobile-timeline.md, sources/2026-07-22-parallel-visual-worker-and-column-media-v2.md, sources/2026-07-22-public-proxy-capacity-and-traffic-audit.md, sources/2026-07-22-new-relay-route-canary.md, sources/2026-07-22-cloud-media-proactive-renewal.md, sources/2026-07-22-replacement-relay-ip-cutover.md, sources/2026-07-22-six-concurrency-and-personal-proxy-headroom.md, sources/2026-07-22-runtime-reliability-performance-and-feed-spacing.md, decisions/2026-07-15-engaging-news-detail.md, decisions/2026-07-16-modular-architecture.md, decisions/2026-07-16-source-preview-renderer.md, decisions/2026-07-17-fingerprint-driven-feed-sync.md, decisions/2026-07-17-full-feed-and-role-entitlements.md, decisions/2026-07-17-full-feed-visual-queue-and-quality.md, decisions/2026-07-17-pro-membership-and-intelligence.md, decisions/2026-07-17-luma-ui-redesign.md, decisions/2026-07-18-premium-learning-and-curation-ia.md, decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md, decisions/2026-07-19-profiled-media-comments-and-optimistic-engagement.md, decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md, decisions/2026-07-19-wechat-virtual-payment-membership.md, decisions/2026-07-20-cloudbase-ai-primary-packy-fallback.md, decisions/2026-07-20-practical-column-editorial-system.md, decisions/2026-07-21-restore-protected-handdrawn-galleries.md, decisions/2026-07-21-image-independent-feed-and-direct-practical-manual.md, decisions/2026-07-21-bounded-visual-publication-and-pro-access-pass.md, decisions/2026-07-21-aihot-source-metadata-contract.md, decisions/2026-07-22-cloudbase-scf-source-preview.md]
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# 知识获取平台小程序项目总览

## 一句话说明

这是一个从个人文章消化箱迁移为编辑型知识获取平台的微信小程序，现有资讯、专栏、简报、我的四个原生 Tab；会员精选作为资讯顶部能力入口进入独立页面。普通用户查看滚动 24 小时内的 AI 资讯，Pro 查看 30 天，并可访问精选、简报，以及由 24 节基础课和 6 节动手课组成的会员专栏；免费目录只显示标题。资讯顶部包含“全部 / 官方动态 / 资讯 / 推文 / GitHub”五个来源范围：前四个来自 AIHOT 成员关系，`GitHub` 从 AIGCLINK 公开方案索引同步全部项目，卡片来源显示为“GitHub 开源库”。独立频道使用无日期和时间线的连续列表，只按 AIGCLINK 原生标签筛选且不限时间；同一记录在“全部”频道仍按普通资讯时间线、主题和权限展示。24 节基础课在鉴权后各显示三页高清手绘讲解。新资讯优先完整复用并持久化来源媒体，没有合格来源图时才进入截图队列；截图失败不阻止文字公开，后续图片可继续补入。CloudBase 内置模型负责后台分析、简报与图文/资料审核，Packy/Grok 自动兜底。一次购买 30 天使用微信小程序虚拟支付；正式上线仍需完成真实支付/退款与消息密钥联调，并走完备案和微信发布流程。

## 最新生产审计状态

2026-07-23 的初始 [全项目生产就绪审计](reports/production-readiness-audit-2026-07-23.md)
结论为 Fail；该结论已被发布提交 `1bf9fb8` 的修复和生产回读取代。当前
[生产发布候选](sources/2026-07-23-production-release-candidate.md) 已通过
最终 526/526 测试、GitHub Actions 10/10、22 集合/34 索引/存储规则/四函数
收敛、GitHub/截图/媒体生产 canary，并已上传微信版本 `1.0.0`。免费资讯首发
没有未受控的 P0/P1，但 [上线前接手清单](syntheses/2026-07-23-release-readiness-handoff.md)
确认截图执行层仍有一项 P2 日志脱敏残余；正式公开还需完成依赖复审、凭据轮换、
真机验收、微信类目/隐私配置、审核提交和发布。支付在完整真机矩阵前继续关闭。

## 事实健康表

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| AppID、云环境 ID、Git 历史和远程地址已保留 | confirmed | 项目配置、应用入口、Git 命令 |
| 旧社区、商品、任务、聊天、实名、定位、钱包、支付和图片审核代码已从活跃树移除 | confirmed | 当前文件树与重建历史 |
| 11 个注册页面、4 个正式云函数及本地测试已实现 | confirmed | 当前代码、526/526 个 Node 测试与四函数白名单回读通过 |
| 旧云资源清空及 5 个新集合创建 | confirmed | 2026-07-14 CloudBase 清单与复核 |
| `digestIngest`、`digestStore` 已退休 | confirmed | 正式函数冒烟后按固定允许列表删除，最终函数清单精确为四个 |
| 真实 OpenID、数据库闭环和开发者工具编译 | confirmed | 2026-07-15 微信开发者工具端到端验证 |
| 编辑索引式首页与频道视觉系统 | confirmed | 2026-07-15 Moodboard 选择、当前代码和模拟器编译 |
| AI/科技精选聚合、最新/热度排序、服务端分页、筛选、缓存和原始来源追踪 | confirmed | 2026-07-16 线上验证最新倒序、热度倒序及热度与时间筛选组合通过 |
| AIHOT 作者身份、头像与原始标签 | confirmed | `/items` 提供正文、`/feed` 可选增强；作者资料晚到时会按精确 X 原帖账号复用云端作者档案，页面不再回退内部分类 |
| GitHub 开源库来源范围 | confirmed | 服务端同步版本 3 已部署；生产 1,728 条 `openSource` 记录、528 个原生标签，分钟指纹轮询、全量历史和官方头像均已验证 |
| 来源头像客户端可读链路 | confirmed | 真实来源头像优先；缺失或续签失败时使用本地产品图标，批量换签、列表/详情与版本 1.0.0 体验版上传均已验证 |
| 知识资讯主链路按 feature/adapter/repository/service/presenter 分层 | confirmed | 2026-07-16 模块化重构、边界测试与 CloudBase 接口回归 |
| 完整摘要分段和相关阅读 | confirmed | 无图详情实机打开、云端摘要无人工省略、3 条相关阅读 |
| 缺图资讯原文截图与自动轮播 | confirmed | `sourcePreviewWorker` 在 CloudBase SCF 内执行 Chromium、上传云文件并保留 v3 质量闸门；详情多图轮播合同不变 |
| AI/科技资讯增量同步 | confirmed | 修复缓存 `_id` 回写后生产失败数 747→0；观测/应用指纹一致，连续日志为 `updated` 后 `unchanged` |
| 无图资讯有界等待后仍公开 | confirmed | 新条目最多等图 4 分钟；成功图文同发，首次失败或超时放行文字，旧无字段条目无需迁移 |
| 移动端筛选与分页预算 | confirmed | 条目级 facet 已改为计数矩阵；分页通过数据路径追加，详情只挂载相邻截图 |
| 全量存储与角色权益 | confirmed | 普通滚动 24 小时、Pro 30 天、管理员全部归档；唯一微信账号授权匹配 |
| Pro 会员与知识智能骨架 | confirmed | free/member/admin 重鉴权、固定示例、AI 待处理队列、简报引用快照、独立运维函数 |
| CloudBase 主模型与 Packy/Grok 兜底 Provider | confirmed | 84 次生产 trace 全部最终 200；分析/简报/审核为 90/180/30 秒，60,000 点月预算和超额熔断 |
| 会员学习与精选信息架构 | confirmed | 资讯顶部精选锁入口、底部 AI 专栏、频道数字移除、微信模拟器六场景截图 |
| 实用会员专栏 | confirmed | 24 节基础课、6 节动手课、合同版本 4、标题级免费目录、服务端正文鉴权；24 节基础课均接入受保护的三页手绘图集 v2 |
| 周案例与趋势档案产品入口 | superseded | 生成和历史数据结构仅作兼容；当前界面与周案例触发器已移除 |
| 资讯互动与会员转化界面 | confirmed | 喜爱计入热度、紧凑收藏记录、会员评论门禁、详情分享路由；“我的”页和全部受限入口共用七项 Pro 权益、服务端价格与动态折扣，使用无侧轨、无“当前”标签的简约白底订阅卡；弹层打开时锁住底页，卡片内部独立滚动 |
| 公开资料审核与隐私文案 | confirmed | 私有 staging、服务端发布/绑定、对象级所有权、跨身份不可见 canary 与客户端直写拒绝均已验证；微信后台隐私声明仍需管理员确认 |
| 历史公开内容审核闭环 | confirmed | 生产 2 条评论与 1 份资料完成幂等补审；公开评论和完整资料的缺审计数均为 0，未删除媒体 |
| 付费内容服务端保护 | confirmed | 客户端不含课程正文或手绘图，免费 DTO 不含副标题/摘要/结论，服务端正文重鉴权后才签发短期图片 URL，缓存按角色与期限隔离并失效关闭 |
| 微信虚拟支付会员闭环代码 | confirmed | 官方查单/发货、对账、iOS 退款询问、安全通知与幂等回收已部署；`available=false` 安全关闭，待真机支付验收后再开售 |
| 生产基础设施容量 | confirmed | 截图已迁入 2048 MB CloudBase SCF；公网中继实测业务内存低于 600 MiB，单次 X 视频帖约 2.9 MB 出站，代理专用新机 1C1G/512GB 月流量足够；旧 renderer 已下线 |
| 微信开发者工具 CLI 优先工作流 | confirmed | Stable 2.01.2510290 的 `auto`、`open`、`islogin` 已通过；端口只监听 `127.0.0.1:9420` |
| 跨来源去重、独立官方源与其他扩展频道 | needs-review | AIGCLINK 上游与“GitHub 开源库”展示已投入生产，但跨来源语义去重和厂商官方源尚未实现，不得宣称为全频道实时新闻服务 |
| CloudBase 内置模型 | confirmed | 已切资源点计费并启用 `qwen3.5-flash`、`qwen3.5-plus`；Packy 自动兜底 |
| 体验版上传 | confirmed | 版本 1.0.0 已上传，实际包体 397,154 bytes；30 天观察和正式审核发布仍待管理员完成 |
| 体验版、CI 业务代码锚点与线上运行代码同源 | confirmed | 体验版基于 `1bf9fb8`，CI/业务代码锚点为 `e2ef825`；两者间无小程序业务或正式云函数运行代码差异，四个线上入口逐字节一致；后续仅有 Wiki 交接提交 |
| 生产依赖风险 | needs-review | 五份锁文件可复现；6 个 CloudBase 传递依赖风险包和 26 个 advisory source 精确登记至 2026-08-06，到期或漂移即阻断 |
| 截图执行层日志脱敏 | needs-review | `sourcePreviewWorker` 仍有四处原始 `error.message` 日志；需统一脱敏、补测试、重部署并以失败 canary 验收 |

## 仓库与身份

- 当前工作仓库：`D:\miniprogram`
- 当前分支：`codex/rebuild-digest-inbox`
- 本轮筛选与完整摘要改版前的完整仓库快照：`c69ae6a`
- 重建历史基线：`704a88ec1713054f78843a89570ca637ed19b06e`
- 旧版本标签：`legacy-hyyc-704a88e`
- 远程：`https://github.com/zephyershen/miniprograme.git`
- AppID：`wxcb0f641838abf6e6`
- 云环境 ID：`hyyc-1gi3f5sqc5becabf`
- 唯一项目配置：仓库根部 `project.config.json`，小程序根为 `hyyc/`

`D:\miniprogramcode\miniprogram` 是早期审计的历史路径；后续命令以当前工作仓库为准。

## 已保留但不在首页开放的迁移闭环

1. 用户首次选择 1–3 个关注方向。
2. 用户主动读取剪贴板或手动输入公开 HTTPS 文章链接。
3. 旧 `digestIngest`/`digestStore` 函数已从生产退休；流程仅保留为 Git 历史，
   当前产品不再提供该入口。

旧个人消化函数和文件暂留兼容历史，但活跃页面已撤下待处理数量、导入入口、关注方向、结论卡和旧设置。当前公开体验不提供任意网页全文、自动剪贴板监听、广告、独立登录页、定位、推送或全文翻译；会员购买使用微信小程序虚拟支付，平台配置完成前安全关闭。真实精选和简报按产品负责人要求自动发布。已接入的聚合资讯仍不等同于各厂商官方源分别直连。

## 代码与数据

- 页面：`pages/inbox/index`、`pages/curated/index`、`pages/briefing/index`、`pages/profile/index` 为资讯、专栏、简报、我的四个原生 Tab；`pages/featured/index` 是会员精选页，另有资讯详情、专栏阅读器、兼容趋势详情、来源、资料编辑与我的收藏，共 11 个注册页面。旧 digest/settings 页面不再注册。
- 小程序模块：`features/knowledge-feed/`、`membership/`、`billing/`、`curated-feed/`、`ai-column/`、`briefing/`、`engagement/` 与 `user-profile/` 分别拥有独立查询或展示模型；`services/cloud-functions.js` 是共享传输层。
- CloudBase 图片只持久化 `cloud://` File ID；知识资讯、个人资料和评论分别在 feature media session 中批量换取 HTTPS 临时地址。WXML 只绑定 URL；TCB 地址中的 `t` 是签名生成时间而非到期时间，正缓存优先服从 SDK `maxAge`，SDK 未返回寿命时最多缓存 5 分钟。资讯、详情、精选和收藏页只在前台批量续签；图片失败仍只强制换签一次后降级为首字母或无图，文字内容不受影响。
- 微信运行时模块引用统一使用带 `.js` 扩展名的相对 `require`，页面直接引用具体 feature 文件，不再使用 `...require(...)` 聚合入口；项目检查会阻止这两类已验证不兼容写法。
- 资讯云函数模块：`adapters/` 隔离外部资讯源和可选来源元数据，`repositories/` 隔离条目、来源账号、日索引、授权和同步状态，`services/` 编排查询、来源增强、权益、同步、迁移和视觉维护，`policies/` 承载定时入口、访问规则和维护鉴权，`presenters/` 约束公开 DTO；`knowledgeFeed/index.js` 只装配依赖和路由 action。
- 知识智能在同一云函数内保持独立边界：contract 约束严格分析/合批/简报/评论审核 JSON；CloudBase adapter 是主路由，Packy adapter 是预算与故障兜底，resilient provider 负责熔断；确定性 policy 计算精选分，worker 负责租约与重试，审核 service 负责临时图片 URL、fail-closed 决策和拒绝文件清理。
- 会员专栏沿用单向边界：页面 → `features/ai-column` API/session/model → 云函数 action → 内容 service。固定正文只在云函数包；24 节基础课在鉴权后各获得三页短期签名手绘图，共 72 张。六节动手课不使用类比或概览图，安装课在正文内按官方支持平台分组。周案例与趋势档案实现只作旧客户端兼容，当前产品没有入口或触发器。
- 资讯顶部：来源范围为“全部 / 官方动态 / 资讯 / 推文 / GitHub”。`官方动态` 只是 `firstParty` 的用户界面名称，内部来源合同不变；前四个使用 AIHOT 上游成员关系而不是本地关键词分类。`GitHub` 使用 AIGCLINK 公开方案索引并由独立同步服务维护，卡片来源显示为“GitHub 开源库”；“精选”作为独立会员能力入口，不参与来源过滤。独立频道使用连续卡片列表，不显示日期分组、折叠、时间线或时间点，只按 AIGCLINK 原生标签筛选且不限时间；同一条目在“全部”频道仍按普通资讯时间线、主题和权限显示。生产已同步 1,728 条记录和 528 个标签。
- 首页筛选：普通用户只可选 24 小时并看见锁定的会员历史入口；Pro 可选 24 小时、近 3 天、近 7 天和近 30 天；管理员另有“全部归档”。15 个公司与模型主题、14 个技术方向可组合，选项显示当前资讯数，零结果项不可选。
- 首页排序：默认选中“最新”，当前频道和筛选范围内的全部资讯显式按发布时间从新到旧；用户切换“热度”后，全部资讯按上游热度值从高到低，同热度按发布时间倒序。放大主稿始终只是当前排序的第一条，不再有独立选稿规则。两种模式都在分页前执行，切换会从第一页重新加载。
- 首页资讯分页：云函数先按频道和筛选条件查询，再下发 8 条列表 DTO；第一页携带计数矩阵，后续使用稳定 `nextCursor`，不再重复 count 或矩阵计算。客户端兼容旧 offset，但优先游标，并通过 `feed.remainingItems[n]` 只追加新增行。
- 首页性能边界：忽略云函数、测试和运维脚本后，小程序代码/静态文件约 0.41 MiB；列表图片、来源头像、日期内容和课程海报均按需加载。2026-07-22 开发者工具实测同一会话重新进入资讯页到首批 8 条文字与图片同时可用约 4.4–7.9 秒，滚动数据量受控但冷启动并非亚秒级，不能表述为所有网络下都“瞬时打开”。
- 互动能力：`features/engagement/` 拥有客户端 API、展示转换、乐观状态、最新目标同步、页面间状态与评论输入模型；`components/comment-sheet` 独立管理评论输入、64 个表情、手机图片、原图预览和资料补全。键盘高度变化时整块输入坞贴住键盘顶部，发送占据工具行最右列；详情页通过 `page-meta` 锁住底层页面，评论列表继续独立滚动。云端 service 负责权限、公开视图与校验，repository 负责目标状态、幂等事务和收藏快照。评论仅 Pro 可读写，喜爱与收藏对所有真实微信用户开放；喜爱数加入公开热度。
- 视觉基线：`styles/design-tokens.wxss`，以冷白画布、白色实体内容面、深墨正文和 `#1d9bf0` 编辑蓝建立层级；喜爱粉和成功绿只表达状态，模糊仅用于临时遮罩。旧蓝紫渐变、微光和大面积珍珠材质已被替代。
- 云函数：`knowledgeFeed`、截图执行函数 `sourcePreviewWorker`、私有运维入口
  `knowledgeOps`、微信虚拟支付入口 `membershipBilling`。旧
  `digestIngest`/`digestStore` 已退休。
- 集合：资讯链路包括缓存、归档、独立条目、来源账号资料、日索引、同步状态、管理员授权、迁移和视觉任务；会员/智能链路包括 `knowledge_memberships`、`knowledge_membership_orders`、`knowledge_feed_item_analysis`、`knowledge_feed_analysis_jobs`、`knowledge_feed_digests` 与 `knowledge_ai_budget`；互动链路包括 `knowledge_feed_user_engagements`、`knowledge_feed_comments` 与 `knowledge_user_profiles`；专栏链路新增 `knowledge_column_cases`、`knowledge_trend_dossiers` 与 `knowledge_trend_events`。服务端专用集合均应为 `ADMINONLY`。
- `knowledgeFeed` 配置使用八个隔离定时入口：来源同步每分钟，视觉在每分钟 `:10/:25/:40/:55` 做四次轻量探测，分析每 10 分钟，归档与旧视觉每小时，日/周/月简报按日历边界运行。周案例触发器已移除。来源指纹与缓存快照复用，304 不写库；用户请求只读取 CloudBase。
- 视觉 worker 保持全局调度租约，但每批可并行调用 6 个独立 2GB `sourcePreviewWorker` 实例，单实例仍只运行一次 Chromium 捕获；每轮扫描最多 40 条并有界处理 38 条。fresh live 等待目标为 0，新资讯先排空，再恢复 live/repair 与 fresh/recovery 加权公平轮转；失败指数退避并在 8 次后阻断，孤儿图片清理最多每小时一次。旧 v2 任务会清理并在仍缺图时升级为 v3；成功、已就绪和 stale 记录删除，`retry`/`cleanup` 留待收口，`blocked` 保留诊断。已有完整视觉只派生 360×253 列表缩略图。新无图条目短暂 hold 最多四分钟；视觉成功原子公开图文，首次明确失败或到期即公开文字，以后仍可补图。目标 0 不等于外站故障、冷启动或突发流量下的绝对零执行等待；历史 retry/blocked 也不算最新资讯排队。
- `knowledge_feed_items` 保存独立条目，`knowledge_feed_day_index` 保存按日轻量索引；新增 `knowledge_memberships`、分析、任务和简报集合。普通用户固定滚动 24 小时，Pro 近 30 天，管理员全部归档。最新列表先返回完整日期桶，展开日期后再通过 `feedDay` 分页加载当天条目；覆盖状态只把连续 `coverage:'all'` 的区间标记为完整，更老日报精选仍明确为 partial。
- 同步使用数据库租约和事务写入校验防止跨实例重复投递及乱序覆盖；429/5xx 退避持久化在缓存文档。2026-07-17 线上首轮检测到精选指纹变化并更新，下一分钟只返回 `not-modified`；数据库 observed/applied 指纹一致、失败数为 0、租约已释放。
- 生产资讯同步、外站封面和来源头像请求由腾讯云 CloudBase 云函数发起；来源头像已持久化到 `knowledge-source-avatars/`，生产规则已只放行该头像前缀供客户端读取。原文截图由 CloudBase `sourcePreviewWorker` 直接生成并上传：普通站点默认直连，确认区域受限的站点走公网 WSS 中继；精确 X status 优先尝试中继官方嵌入页并保留三条有界后备路径。服务商替换公网地址后，正式代理域名 A 记录已切换并传播，CloudBase 认证探针、健康检查和真实 X canary 均已通过；生产继续用正式域名做 TLS 校验并固定连接替换地址。2026-07-23 [线上函数复核](sources/2026-07-23-relay-single-endpoint-audit.md)确认当前只配置这一组中继 URL/固定地址，旧公网服务器既不在生产路径中，也不是自动备用；中继失败时只会进入 CloudBase 直连尝试与视觉任务重试。公网服务器只运行直连 WSS 中继，不运行 Mihomo、Chromium 或截图 API，开发者本地网络不参与生产抓取。
- 用户界面不显示 AI HOT、API、缓存、规范链接、模型分析/生成/审核或分析覆盖率等后台实现，只显示资讯内容、原作者头像/昵称/账号、上游原始标签、原文链接和普通发布状态；作者身份和时间位于卡片上方，标签位于媒体之后。“最新”模式使用可按日期折叠的窄移动时间线，时间、节点与正文分开；“热度”模式保持全宽。没有上游标签时隐藏标签行，不用内部分类补位。简报覆盖率继续保存在云端供运维判断，但不再显示“不完整”提示。
- 来源标签会清除 RSS、翻译中转等采集方式后缀，不把技术管道暴露给用户。
- 详情页不复制原文正文：导读和“完整内容”完整保留上游摘要并按语义单元分段，不再按字符裁剪或添加人工省略号；相关阅读可使用真实封面或原文截图。缺图资讯详情通过原生 `swiper` 每 4 秒自动轮播全部截图，也支持手动滑动；截图最多 12 张并显示圆点。点击任意图片时，`wx.previewImage` 从当前图打开整组 URL，可缩放并继续左右切换。
- 来源区位于“接着看”之前：左侧展示原发布方和单行省略 URL，长链接可展开/收起；右侧是紧凑的复制按钮。`DIRECT_WEBVIEW_HOSTS` 当前为空，因此点击现有外部 URL 会复制并提示到手机浏览器粘贴，不能宣称小程序可直接唤起任意系统浏览器。
- 身份只取自云函数上下文；数据库使用 OpenID 的 SHA-256 派生值，不保存原始 OpenID。
- 当前真实管理员可在“我的”页切换普通用户、Pro 会员和管理员三种服务端预览。新构建的 `develop`/`trial` 与 `release` 都允许发起已登记的真实写请求，未知环境仍失败关闭；每条写链路继续由服务端校验身份、内容、对象所有权与业务配置。`knowledge_feed_access_grants` 始终保留真实 `role:'admin'`，只额外保存 `previewRole`，非管理员调用会被服务端拒绝，预览不会产生真实会员记录。
- 原始正文只在函数内存中参与处理，不写数据库或云存储。
- 降级结果内部仍携带 `processingMode: local_fallback` 供运维判断，前端不再显示额度、模型或本地规则等实现提示。
- 只在用户主动选择后保存评论展示所需的昵称与云头像文件 ID，保存前先做文本和图片审核；不保存手机号、位置、实名资料或网页全文。虚拟支付官方查单要求订单绑定 OpenID，因此只在 `ADMINONLY` 支付订单中保存原始 OpenID 与必要交易字段，绝不返回客户端。

## 安全与成本

- 个人文章导入链路只接受默认 443 端口的 HTTPS，并拒绝凭据、内网、保留 IP 和微信公众平台文章；公共资讯截图链路有独立的受控来源与维护权限。
- DNS 解析后绑定已校验的公网 IP 建立 HTTPS 连接，并在每次重定向后重新校验。
- 最多 3 次重定向、响应最大 2MB、正文最多 12,000 字符。
- 环境已在 2026-07-20 不可逆切换为资源点计费，标准版每账期 330,000 点共享池；超限按量关闭，1000 点等于 1 元并不代表超额固定为 2 元。
- 会员知识智能以 CloudBase `qwen3.5-flash`（分析/文本审核）和 `qwen3.5-plus`（简报/图片审核）为主，PackyAPI `grok-4.5` 自动兜底；CloudBase 分任务超时为资讯分析 90 秒、简报/周内容 180 秒、同步审核 30 秒，Packy 后台/审核为 90/20 秒。
- 模型调用前在 `knowledge_ai_budget` 按输出上限的 2 倍原子预留，内部月度上限 60,000 点并声明 100,000 点核心保留线；成功后按实耗结算。若实耗仍高于预留，先在月上限内原子补记差额，只有补差会突破 60,000 点时才持久化 `overrunDetected` 并把当月后续请求转 Packy。该限制不读取 CloudBase 整个共享池实时余额，因此不能宣称基础设施拥有平台级绝对优先权。
- 保留的旧个人摘要链路仍独立使用 CloudBase `hy3-preview` 与原有 10 元预算，但活跃小程序已移除其入口。
- 腾讯云自动化凭据仅保存在被 Git 忽略且受本机 ACL 限制的 `wiki/secrets/`，普通 Wiki 不含实际值。
- 当前生产公网节点没有旧 Codex/Mihomo/Chromium 常驻任务，只运行 Nginx 与受控 WSS 中继；2026-07-22 复核负载接近 0、约 486–511 MiB 可用内存、Swap 0，最近一小时无 Nginx/中继 error 日志。
- 原文截图由 CloudBase 事件函数执行；普通站点默认直连，区域受限站点与精确 X status 按受控策略使用令牌保护的 WSS `CONNECT host:443` 中继，公网服务器不接收截图结果也不持有上传权限。每次捕获最多 12 张并受 90 秒函数边界约束。v3 同时拒绝 HTTP 4xx/5xx、HTTP 200 错误壳、登录墙、挑战页、空白/纯色画面和目标不符；X 原页和嵌入页都必须精确命中 status id。第一方 Open Graph 主图及普通网页截图仍进入 CloudBase/Packy 视觉审核，只有高置信目标一致结果才上传。
- 资讯刷新与封面/截图回填使用数据库事务合并；孤儿视觉文件只按模块拥有的前缀删除，失败会进入持久化队列重试。
- 封面和截图对象路径包含来源 URL 哈希；事务 patch 同时校验 `expectedUrl`。若生成期间条目 URL 改变或被移除，旧图不会写入新资讯，未应用上传会进入受限清理队列；同 URL 强制重建使用独立捕获版本，避免覆盖当前正在引用的截图。

## 本地验证

- `npm test`：527/527 通过。
- `npm run check`：30 个 JSON、280 个 JavaScript、11 个注册页面通过结构、
  语法与微信模块引用兼容性检查；客户端源码 0.43 MiB。
- `git diff --check`：通过。
- 微信开发者工具模拟器已覆盖资讯、详情、精选、专栏、简报和我的页面；2026-07-21 最新回归确认专栏首页返回 `contractVersion=4`、会员无锁、六节动手课目录不含操作系统名，“安装 Codex CLI”按 Windows/macOS/Linux 展开且视觉模式为 `none`，简报不含 `trends` 且核心标题按 5 条显示“先看这5件事”。普通用户真实点击精选会打开可滚动的七项权益订阅卡，弹层和“我的”页均为白底、无侧轨并使用单行“订阅”按钮；测试后恢复 Pro 预览状态。
- 24 节基础课的 72 张手绘海报已保存到云端受保护前缀；客户端包不内置海报，每次课程接口只对当前鉴权课程签发 3 张，阅读器首轮只挂载当前页与相邻页。24 节完整课程正文继续保存在云函数代码内，客户端只带标题目录。
- 微信开发者工具后续默认按 [CLI 优先工作流](concepts/WeChatDevToolsCLI.md) 启动和操作：`D:\Apps\miniprogram\cli.bat auto --project D:\miniprogram --port 9420 --trust-project`；当前 `auto`、`open`、`islogin` 和回环监听已验证。自动化结束只断开连接，不结束 renderer、不调用 CLI `close`，并把 IDE 留在可验收页面。
- 微信开发者工具此前已重新编译资讯首页与详情并清除项目级红色错误；2026-07-17 的自动/手动轮播与整组全屏预览已通过页面逻辑和标记测试，仍需在真机覆盖 1、5、8 张、从中间图片进入全屏和返回后继续轮播。

## 云端与端到端状态

- 旧业务的 41 个函数、24 个集合、2,456 条文档、217 个存储对象和 `adminportal/` 已清理。
- 环境级空存储桶、平台认证文件、AppID 关联和标准版套餐被保留。
- 当前业务集合均由云函数管理；互动、评论和主动资料表为 `ADMINONLY`。资料按主键读取，互动与评论保持 owner 和 item 查询索引。
- 四个正式函数保留：三个 Node.js 18.15 函数和 Node.js 20.19 的
  `sourcePreviewWorker`。生产 `knowledgeFeed` 已部署 24 节基础课、6 节动手课、
  合同版本 4、GitHub 全量库、受保护手绘图、视觉队列、AIHOT 来源增强、
  CloudBase 主模型、Packy 兜底、评论/资料审核和安全媒体链路。
  `knowledgeOps` 无触发器且受维护令牌保护；`membershipBilling` 每 15 分钟
  对账，但现网 `plans.available=false`，在双端真实支付验收前不会开售。
- 生产历史补审已处理 2 条评论和 1 份资料；复核查询中公开评论和完整资料的缺审计数均为 0。生产资讯同步修复后失败计数为 0，观测指纹与应用指纹一致。
- 真实微信上下文已验证喜爱/收藏目标状态开启与还原、会员评论列表读取、空资料接口、会员转化卡状态以及列表/详情分享 payload；部署后日志未再出现 `TransactionBusy`，所有测试互动状态已还原。开发者工具已验证键盘高度 336px 时输入坞整体上移、96rpx 发送按钮右对齐、64 表情网格、标准图片图标、页面滚动锁和评论独立滚动；喜欢与收藏两次快速反向点击在 29ms/16ms 内即时变化并最终同步为测试前状态。头像、相册原图、真机键盘与好友接收仍需手机人工验收。
- 真实微信上下文已验证：保存偏好 → 导入文章 → 生成临时摘要 → 保留结论卡 → 统计更新 → 清除个人数据。
- 环境“超限按量”关闭；已切换套餐内资源点并启用两款内置模型，不会在资源点用完后自动产生无上限按量费用。

详细证据见 [微信端到端验证与运行时修复](sources/2026-07-15-wechat-e2e-and-runtime-fixes.md)。

## 上线前未完成事项

1. 修复 `sourcePreviewWorker` 四处原始 `error.message` 日志，增加统一脱敏和专项测试，只重部署该函数并用成功/失败 canary 验收日志；详细路径和处理顺序见 [上线前接手清单](syntheses/2026-07-23-release-readiness-handoff.md)。
2. 在 `2026-08-06` 前升级或重新复审当前 6 个 CloudBase 传递依赖风险包和 26 个 advisory source；当前审计通过代表风险被精确控制，不代表零漏洞。
3. 轮换发布控制形成前可能出现在本地工具输出中的相关凭据；普通 Wiki 只记录轮换要求，不保存实际值。
4. 在 iOS/Android 真机补齐普通/Pro、GitHub 标签筛选与频道转圈、无图列表/详情、头像、相册原图、键盘、分享接收、前后台切换和弱网恢复验收。新构建的开发版/体验版允许完整写链路联调，但会直接改动同一生产云环境；测试后必须清理或还原数据，并且现有已上传的体验版 `1.0.0` 仍需重新上传才会包含这项门禁变化。
5. 保持生产 `plans.available=false`；开启销售前完成 Android/iOS 支付成功、取消、异常恢复、重复查单、发货、退款和退款/到期后权益重锁。免费资讯首发不要求开启支付。
6. 完成名称、备案、服务类目、隐私/UGC 声明、审核提交和正式发布；扫码、验证码和最终提交仍由管理员完成。

## 不阻塞本次首发的后续扩展

- 娱乐、社会、游戏和英语频道，以及重点厂商独立官方源、跨来源去重和优先级机制；这些入口当前已关闭，不构成首发缺口。
- 经平台确认业务域名后在微信内直接打开原文；现阶段复制链接的降级路径可用。
- 持续观察资源点、九个定时任务和模型兜底的真实曲线，并在规模增长后补 25,000 条 P95 报告。
- 产品负责人明确暂缓举报、评论删除、申诉和自动隐藏；公开规模增长后再评估长期 UGC 治理及供应商 AUP 风险。

## 已被替代的旧结论

- “正式 Git 根是 `D:\miniprogramcode`、当前分支为 `my-work`”已被当前工作仓库和重建分支替代。
- “产品方向未确定”已被 [“别收藏了”首版决策](decisions/2026-07-13-digest-inbox-v1.md) 替代。
- “产品不提供资讯流”已被 [编辑索引式知识平台首页决策](decisions/2026-07-15-editorial-knowledge-platform-ui.md) 替代；旧摘要闭环继续作为迁移基础。
- “真实微信身份和数据库闭环未验证”已在 2026-07-15 被端到端结果替代。
- “AI 失败不入队”已被 [透明临时摘要决策](decisions/2026-07-15-ai-quota-fallback.md) 替代。
- “精选一百余条就是全部资讯、无视觉不公开”已被 [全量资讯存储与服务端角色权益](decisions/2026-07-17-full-feed-and-role-entitlements.md) 替代。
- “只有 free/admin 且管理员默认 90 天”已被 [单一 Pro 会员、能力型权益与可回溯简报](decisions/2026-07-17-pro-membership-and-intelligence.md) 替代。
