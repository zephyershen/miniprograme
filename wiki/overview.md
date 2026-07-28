---
title: "知识获取平台小程序项目总览"
type: overview
tags: [overview, miniprogram, wechat, knowledge-platform, editorial-index]
sources: [sources/2026-07-13-digest-inbox-implementation.md, sources/2026-07-14-cloud-cleanup-and-deployment.md, sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, sources/2026-07-15-editorial-ui-implementation.md, sources/2026-07-15-aihot-feed-integration.md, sources/2026-07-16-modular-refactor.md, sources/2026-07-16-source-preview-deployment.md, sources/2026-07-17-fingerprint-sync-and-carousel.md, sources/2026-07-17-feed-history-and-long-preview.md, sources/2026-07-17-full-feed-admin-and-capacity.md, sources/2026-07-17-visual-backfill-quality-and-performance.md, sources/2026-07-17-pro-membership-implementation.md, sources/2026-07-17-luma-ui-redesign.md, sources/2026-07-18-premium-ia-and-copy.md, sources/2026-07-18-focus-previews-and-handdrawn-column.md, sources/2026-07-19-interaction-reliability-and-comment-media.md, sources/2026-07-19-packy-grok-intelligence.md, sources/2026-07-19-profile-moderation-and-huifu-payment.md, sources/2026-07-19-infrastructure-pricing-and-huifu-mode.md, sources/2026-07-19-wechat-virtual-payment.md, sources/2026-07-20-cloudbase-ai-cost-and-hybrid-routing.md, sources/2026-07-20-launch-readiness-remediation.md, sources/2026-07-20-practical-column-implementation.md, sources/2026-07-21-column-reader-restoration.md, sources/2026-07-21-timeout-feed-and-manual-production-validation.md, sources/2026-07-21-bounded-visual-and-membership-conversion.md, sources/2026-07-21-source-preview-v3-quality-and-repair.md, sources/2026-07-22-cloudbase-scf-source-preview-and-mobile-timeline.md, sources/2026-07-22-parallel-visual-worker-and-column-media-v2.md, sources/2026-07-22-public-proxy-capacity-and-traffic-audit.md, sources/2026-07-22-new-relay-route-canary.md, sources/2026-07-22-cloud-media-proactive-renewal.md, sources/2026-07-22-replacement-relay-ip-cutover.md, sources/2026-07-22-six-concurrency-and-personal-proxy-headroom.md, sources/2026-07-22-runtime-reliability-performance-and-feed-spacing.md, sources/2026-07-24-async-comments-message-center-and-stable-loading.md, sources/2026-07-24-visible-wechat-account-confirmation-and-payment-diagnostics.md, sources/2026-07-24-two-step-membership-login-and-optional-profile.md, sources/2026-07-24-ios-membership-payment-recovery.md, sources/2026-07-24-ios-refund-profile-review-and-renewal-ui.md, sources/2026-07-25-threaded-comments-and-message-deletion.md, sources/2026-07-28-member-column-search-release-prep.md, sources/2026-07-28-comment-ui-review-pause.md, decisions/2026-07-15-engaging-news-detail.md, decisions/2026-07-16-modular-architecture.md, decisions/2026-07-16-source-preview-renderer.md, decisions/2026-07-17-fingerprint-driven-feed-sync.md, decisions/2026-07-17-full-feed-and-role-entitlements.md, decisions/2026-07-17-full-feed-visual-queue-and-quality.md, decisions/2026-07-17-pro-membership-and-intelligence.md, decisions/2026-07-17-luma-ui-redesign.md, decisions/2026-07-18-premium-learning-and-curation-ia.md, decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md, decisions/2026-07-19-profiled-media-comments-and-optimistic-engagement.md, decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md, decisions/2026-07-19-wechat-virtual-payment-membership.md, decisions/2026-07-20-cloudbase-ai-primary-packy-fallback.md, decisions/2026-07-20-practical-column-editorial-system.md, decisions/2026-07-21-restore-protected-handdrawn-galleries.md, decisions/2026-07-21-image-independent-feed-and-direct-practical-manual.md, decisions/2026-07-21-bounded-visual-publication-and-pro-access-pass.md, decisions/2026-07-21-aihot-source-metadata-contract.md, decisions/2026-07-22-cloudbase-scf-source-preview.md, decisions/2026-07-24-async-comments-and-message-center.md, decisions/2026-07-28-pause-comment-ui-for-review.md]
last_updated: 2026-07-28
status: confirmed
confidence: high
---

# 知识获取平台小程序项目总览

## 一句话说明

这是一个从个人文章消化箱迁移为编辑型知识获取平台的微信小程序，现有资讯、专栏、简报、我的四个原生 Tab；会员精选作为资讯顶部能力入口进入独立页面。普通用户查看滚动 24 小时内的 AI 资讯，Pro 查看 30 天，并可访问精选、简报，以及由 24 节基础课和 6 节动手课组成的会员专栏；免费目录只显示标题。资讯顶部包含“全部 / 官方动态 / 资讯 / 推文 / GitHub”五个来源范围：前四个来自 AIHOT 成员关系，`GitHub` 从 AIGCLINK 公开方案索引同步全部项目，卡片来源显示为“GitHub 开源库”。独立频道使用无日期和时间线的连续列表，只按 AIGCLINK 原生标签筛选且不限时间；同一记录在“全部”频道仍按普通资讯时间线、主题和权限展示。24 节基础课在鉴权后各显示三页高清手绘讲解。新资讯优先完整复用并持久化来源媒体，没有合格来源图时才进入截图队列；截图失败不阻止文字公开，后续图片可继续补入。CloudBase 内置模型以无思考模式负责后台分析、简报、图文、评论和资料审核，Packy/Grok 以最低推理强度自动兜底；资料与评论均采用异步审核，结果进入“我的消息”。全部主要懒加载区域显示转圈，阅读中的列表和媒体在后台刷新时保持稳定。一次购买 30 天使用微信小程序虚拟支付：第一次点击只登录并校验当前微信账号，第二次点击才创建订单和发起支付；头像昵称使用官方选择控件且为可选资料。会员商品和生产支付链路已开售，iOS 实付与会员恢复已完成线上核对；真实退款和退款后权益回收仍需人工验收。

2026-07-28 最终候选 `68382f5` 已把 24 节基础课和 6 节动手课改为可持续更新的
内置安全基线，并提供真实管理员专用的草稿、预览、发布和下架后台；阅读进度、
继续学习、一框全站关键词搜索、明确标注的推荐热度、共享空态/骨架屏、下拉刷新和
图片签名自动恢复也已完成。生产现为 29 个合同集合、50 个合同索引、4 个正式函数
和 10 个 `knowledgeFeed` 触发器；8,152 条搜索存量回填及普通/Pro/管理员双图发布
canary 已通过。最终候选继续纳入资讯按日续载、滚动日期权限、免费专栏标题级搜索、
简报 Tab 跳转、管理排序防误触、空资讯分享、进度 revision 和搜索文本 NFKC
同构归一化。`knowledgeFeed` 已 code-only 部署并完成线上源码哈希回读；632,253-byte
微信开发版本 `2.4.0` 已上传。公众平台已确认线上 `2.3.5`、审核区为空和该开发
卡片；提交弹窗尚待用户本人确认已阅读审核规则。

2026-07-28 待上传替换候选已把评论设为确定性的客户端关闭态：资讯列表和详情不
显示“评论”、评论数量、气泡或弹层，旧评论深链不能重新打开；会员权益、消息中心
和个人资料也不再显示评论文案或评论通知，通用消息入口改为信封。评论后端、审核、
治理与历史数据仍保留，未来恢复需修改中央发布开关并提交新的微信审核版本，不能在
审核通过后远程热开启。完整回归为 791/791，开发者工具六页实画面 canary 已通过。
新版消息请求还会让 `knowledgeFeed` 越过评论通知继续寻找会员/资料消息，并拒绝关闭
态“全部已读”；该 code-only 更新与微信替换版本仍待部署/上传，不改集合、索引、
生产数据或存储规则。

## 最新生产审计状态

2026-07-23 的初始 [全项目生产就绪审计](reports/production-readiness-audit-2026-07-23.md)
结论为 Fail；该结论已被后续修复和生产部署取代。当前工作树完整 `npm run verify`
通过。生产已收敛为 29 个合同集合、
50 个合同索引、四个正式函数和完整触发器 manifest。资料与评论均改为后台队列并
显示“审核中”，我的消息统一承载结果；虚拟商品价格分离、稳定懒加载和局部互动
刷新已上线。会员订阅为两次点击，支持作用域退出；支付订单新增账户级租约、阶段
恢复和事务状态转换。iOS “付款成功但会员未生效”已修复并恢复：生产只读核对
3/3 已付款记录均匹配有效会员和已完成成功消息。发货回调不再被手工发货 API
阻塞。最新审核包为 1,420,316 bytes。
[iOS 支付恢复记录](sources/2026-07-24-ios-membership-payment-recovery.md)
记录根因、发布和资金边界。生产资料审核真实记录已按正常 worker 完成；产品不
提供管理员主动退款，用户决定本次不申请 Apple 退款，平台被动退款通知与权益
一致性保护继续保留。2026-07-25 已修复回复目标在 `addComment` 入口丢失以及线上
消息删除 action 未同步的问题；`knowledgeFeed` 已从当前工作树 code-only 更新并
完成线上源码哈希回读，临时回复在两次退出重进后都保持线程分组且已删除清理。
业务提交 `d681a44` 已推送；会员身份的购买入口会精确显示“续费”，会员页底部
提供可复制的微信咨询方式。微信 `2.3.4` 从该提交的隔离干净工作树上传，并于
2026-07-25 19:47:21 进入审核。公开线上仍为 `2.3.2`。剩余边界是审核通过后的
正式发布、真实手机评论 canary，以及 2026-08-06 前的依赖复审。

2026-07-27 专栏管理实现和 719/719 回归已通过。生产已增量创建两个集合与三个
索引并部署新版 `knowledgeFeed`；线上函数、集合、索引回读均收敛。客户端仍只有
开发预览，不能把后台部署表述为小程序正式上线。

2026-07-28 学习进度和全站搜索的生产合同已完成增量发布；`knowledgeOps` 保持
已验证版本，`knowledgeFeed` 已从最终候选 `68382f5` code-only 更新并回读收敛。
搜索存量 8,152 条已全部扫描，
`ready=true`、待失败 0、隔离 0。真实管理员三角色、双图草稿/预览/发布/下架、
普通标题目录、Pro 正文与进度均通过生产 canary；完整标题全角标点搜索也在最终
canary 中命中。微信开发版本 `2.4.0` 已上传；公众平台已确认线上 `2.3.5`、审核区
为空和该开发卡片，提交弹窗尚待用户本人确认已阅读审核规则，未正式发布。

## 事实健康表

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| AppID、云环境 ID、Git 历史和远程地址已保留 | confirmed | 项目配置、应用入口、Git 命令 |
| 旧社区、商品、任务、聊天、实名、定位、钱包、支付和图片审核代码已从活跃树移除 | confirmed | 当前文件树与重建历史 |
| 16 个注册页面、4 个正式云函数及本地测试已实现 | confirmed | 当前工作树、791/791 个 Node 测试；含搜索页、两个真实管理员专栏页面和一个兼容趋势路由 |
| 旧云资源清空及 5 个新集合创建 | confirmed | 2026-07-14 CloudBase 清单与复核 |
| `digestIngest`、`digestStore` 已退休 | confirmed | 正式函数冒烟后按固定允许列表删除，最终函数清单精确为四个 |
| 真实 OpenID、数据库闭环和开发者工具编译 | confirmed | 2026-07-15 微信开发者工具端到端验证 |
| 编辑索引式首页与频道视觉系统 | confirmed | 2026-07-15 Moodboard 选择、当前代码和模拟器编译 |
| AI/科技精选聚合、最新/热度排序、服务端分页、筛选、缓存和原始来源追踪 | confirmed | 2026-07-16 线上验证最新倒序、热度倒序及热度与时间筛选组合通过 |
| AIHOT 作者身份、头像与原始标签 | confirmed | `/items` 提供正文、`/feed` 可选增强；作者资料晚到时会按精确 X 原帖账号复用云端作者档案，页面不再回退内部分类 |
| GitHub 开源库来源范围 | confirmed | 服务端同步版本 3 已部署；生产 1,728 条 `openSource` 记录、528 个原生标签，分钟指纹轮询、全量历史和官方头像均已验证 |
| 来源头像客户端可读链路 | confirmed | 真实来源头像优先；缺失或续签失败时使用本地产品图标，批量换签、列表/详情与版本 2.3.1 上传均已验证 |
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
| 实用会员专栏 | production-canary-passed | 24+6 节内置基线、标题级免费目录和服务端正文鉴权保持；管理员双图草稿、预览、发布、普通/Pro 双态和下架生产 canary 已通过，测试内容已下架 |
| 专栏阅读进度与继续学习 | backend-deployed-canary-passed | `knowledge_column_progress` 已创建并保持 `ADMINONLY`；服务端会员重鉴权、单课与总进度、继续学习、草稿预览隔离和 Pro 进度读写均通过 |
| 跨内容关键词搜索 | backend-deployed-backfill-complete | 页面一框直搜官方动态、资讯、推文、完整 GitHub 库、会员专栏和知识简报；8,152 条存量回填完成，`ready=true`、待失败 0、隔离 0，普通/Pro/管理员权益 canary 已通过 |
| 微信订阅消息 | blocked-by-platform-config | 站内消息 outbox 继续有效；缺少公众平台真实模板 ID 与关键词字段合同，未写假配置或暴露不可用授权入口 |
| 周案例与趋势档案产品入口 | superseded | 生成和历史数据结构仅作兼容；当前界面与周案例触发器已移除 |
| 资讯互动与会员转化界面 | replacement-candidate-comments-hidden | 待上传替换候选仅显示喜欢、收藏、分享，列表和详情均无评论气泡或空槽；“我的”页和受限入口共用六项可见 Pro 权益、服务端价格与动态折扣，评论后端保留但不可达 |
| 公开资料异步审核与隐私文案 | confirmed | 私有 staging/review、独立审核队列、租约重试、所有者候选读取和“审核中”界面已部署；旧已通过资料在新候选通过前继续公开，真实账号 canary 待完成 |
| 评论异步审核与站内消息 | backend-retained-ui-paused | 评论私有 pending、限流、后台租约审核、事务公开、outbox、两级线程和治理后端仍保留；待上传替换候选过滤评论通知、跨页保留会员/资料消息并重算可见未读，不显示评论分类、入口、弹层或文案，未来恢复需重新送审 |
| 历史公开内容审核闭环 | confirmed | 生产 2 条评论与 1 份资料完成幂等补审；公开评论和完整资料的缺审计数均为 0，未删除媒体 |
| 评论举报、删除、申诉与恢复闭环 | confirmed | 复用评论和用户互动集合；作者/管理员删除、三人举报自动隐藏、作者申诉、真实管理员恢复均为幂等事务，公开计数只改变一次；普通用户只能读取 active 评论及其媒体，作者私有状态按 item/status/author 精确查询，管理员治理扫描保持 500 条上限 |
| 付费内容服务端保护 | confirmed | 客户端不含课程正文或手绘图，免费 DTO 不含副标题/摘要/结论，服务端正文重鉴权后才签发短期图片 URL，缓存按角色与期限隔离并失效关闭 |
| 微信虚拟支付会员闭环代码 | confirmed | 登录与 OpenID 校验、账户级建单租约、官方查单、事务履约、回调应答、对账、恢复和平台退款幂等回收均已部署；iOS 实付 3/3 已恢复有效会员与成功消息；产品不提供管理员主动退款，本次不申请退款 |
| 生产基础设施容量 | confirmed | 截图已迁入 2048 MB CloudBase SCF；公网中继实测业务内存低于 600 MiB，单次 X 视频帖约 2.9 MB 出站，代理专用新机 1C1G/512GB 月流量足够；旧 renderer 已下线 |
| 微信开发者工具 CLI 优先工作流 | confirmed | Stable 2.01.2510290 的 `auto`、`open`、`islogin` 已通过；CLI 只使用回环端口，自动化首选 9420，本次沿用 IDE 已监听的 37542 |
| 跨来源去重、独立官方源与其他扩展频道 | needs-review | AIGCLINK 上游与“GitHub 开源库”展示已投入生产，但跨来源语义去重和厂商官方源尚未实现，不得宣称为全频道实时新闻服务 |
| CloudBase 内置模型 | confirmed | 已切资源点计费并启用 `qwen3.5-flash`、`qwen3.5-plus`；Packy 自动兜底 |
| 微信版本上传与审核 | submit-dialog-awaiting-user-ack | `2.4.0` 已从精确候选上传，回执包体 632,253 bytes；公众平台回读线上 `2.3.5`、审核区为空和 `2.4.0` 开发卡片，提交弹窗已打开，尚待用户本人确认已阅读审核规则 |
| 最终代码与生产后端一致性 | confirmed | 最终锚点 `68382f5` 已 code-only 部署 `knowledgeFeed`；manifest、三份变更源码哈希、三角色权限、全标题搜索、时间线续载和简报跳转均回读或 canary 通过；RC 标签为 `rc/2026-07-28-member-admin-global-search-v3` |
| 生产依赖风险 | needs-review | 五份锁文件可复现；6 个 CloudBase 传递依赖风险包和 26 个 advisory source 精确登记至 2026-08-06，到期或漂移即阻断 |
| 截图执行层日志脱敏 | confirmed | `sourcePreviewWorker` 的原始错误输出已统一经过安全脱敏，专项测试通过并完成生产重部署 |

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

旧个人消化函数和文件暂留兼容历史，但活跃页面已撤下待处理数量、导入入口、关注方向、结论卡和旧设置。当前公开体验不提供任意网页全文、自动剪贴板监听、广告、独立登录页、定位、推送或全文翻译；会员购买使用微信小程序虚拟支付，平台配置已完成并开售，订单仍由服务端双开关和计划校验保护。真实精选和简报按产品负责人要求自动发布。已接入的聚合资讯仍不等同于各厂商官方源分别直连。

## 代码与数据

- 页面：`pages/inbox/index`、`pages/curated/index`、`pages/briefing/index`、`pages/profile/index` 为资讯、专栏、简报、我的四个原生 Tab；真实管理员另有 `pages/column-admin/index` 和 `pages/column-editor/index`。加上搜索、精选、会员、消息、详情、阅读器、资料、来源、收藏和兼容趋势详情，共 16 个注册页面。
- 小程序模块：`features/knowledge-feed/`、`membership/`、`billing/`、`curated-feed/`、`ai-column/`、`column-admin/`、`briefing/`、`engagement/`、`user-profile/` 与 `messages/` 分别拥有独立查询或展示模型；`services/cloud-functions.js` 是共享传输层。
- CloudBase 图片只持久化 `cloud://` File ID；知识资讯、个人资料和评论分别在 feature media session 中批量换取 HTTPS 临时地址。WXML 只绑定 URL；TCB 地址中的 `t` 是签名生成时间而非到期时间，正缓存优先服从 SDK `maxAge`，SDK 未返回寿命时最多缓存 5 分钟。资讯、详情、精选和收藏页只在前台批量续签；图片失败仍只强制换签一次后降级为首字母或无图，文字内容不受影响。
- 微信运行时模块引用统一使用带 `.js` 扩展名的相对 `require`，页面直接引用具体 feature 文件，不再使用 `...require(...)` 聚合入口；项目检查会阻止这两类已验证不兼容写法。
- 资讯云函数模块：`adapters/` 隔离外部资讯源和可选来源元数据，`repositories/` 隔离条目、来源账号、日索引、授权和同步状态，`services/` 编排查询、来源增强、权益、同步、迁移和视觉维护，`policies/` 承载定时入口、访问规则和维护鉴权，`presenters/` 约束公开 DTO；`knowledgeFeed/index.js` 只装配依赖和路由 action。
- 知识智能在同一云函数内保持独立边界：contract 约束严格分析/合批/简报/评论审核 JSON；CloudBase adapter 是关闭思考模式的主路由，Packy adapter 固定最低 `low` 推理强度作为预算与故障兜底，resilient provider 负责熔断；确定性 policy 计算精选分，worker 负责租约与重试，审核 service 负责临时图片 URL、fail-closed 决策和拒绝文件清理。
- 会员专栏沿用单向公共边界：页面 → `features/ai-column` → 云函数 action → 内容 service；管理边界为 `features/column-admin` → 真实管理员 action → entry/media repository。现有 24+6 节正文和 72 张手绘图作为代码基线，`knowledge_column_entries` 的发布快照可覆盖、重排或下架，`knowledge_column_media` 管理新增图片归属和延迟清理。会员接口永远不读草稿。
- 专栏阅读进度通过 `knowledge_column_progress` 按查看者、类型与稳定内容 ID 隔离；服务端只接受当前已发布内容并重新校验会员权益。客户端在目录显示总进度、单课进度和最近未完成内容，管理员草稿预览与兼容案例不写进度。
- 关键词搜索使用专用页面和服务端 `feedSearch` action。页面移除内容范围选择，只用一个输入框聚合官方动态、资讯、推文、完整 GitHub 库、会员专栏和知识简报；内部按来源独立分页，避免近期 GitHub 条目与“全部资讯”重复。普通用户只搜索滚动 24 小时资讯和专栏公开目录，Pro 搜索 30 天资讯、专栏正文与简报，管理员可搜索全部资讯归档；GitHub 继续覆盖完整开源库。新条目同步时生成受字节预算限制的中文双字与英文前缀 token；旧条目由独立定时器每分钟推进一批 `searchTokenBackfill`，单条稳定失败五次后隔离并继续主扫描，批量故障则整批延后。`knowledgeOps.status` 返回进度、隔离 ID、安全错误码与耗时；维护令牌 action 仅作人工恢复。搜索 token 与内容/视觉 `contentHash` 解耦，不会令在途截图任务失效；首页入口保持常驻，主扫描完成前实际查询显示“索引正在准备”，查询结果不暴露内部索引字段。
- 资讯顶部：来源范围为“全部 / 官方动态 / 资讯 / 推文 / GitHub”。`官方动态` 只是 `firstParty` 的用户界面名称，内部来源合同不变；前四个使用 AIHOT 上游成员关系而不是本地关键词分类。`GitHub` 使用 AIGCLINK 公开方案索引并由独立同步服务维护，卡片来源显示为“GitHub 开源库”；“精选”作为独立会员能力入口，不参与来源过滤。独立频道使用连续卡片列表，不显示日期分组、折叠、时间线或时间点，只按 AIGCLINK 原生标签筛选且不限时间；同一条目在“全部”频道仍按普通资讯时间线、主题和权限显示。生产已同步 1,728 条记录和 528 个标签。
- 首页筛选：普通用户只可选 24 小时并看见锁定的会员历史入口；Pro 可选 24 小时、近 3 天、近 7 天和近 30 天；管理员另有“全部归档”。15 个公司与模型主题、14 个技术方向可组合，选项显示当前资讯数，零结果项不可选。
- 首页排序：默认选中“最新”，当前频道和筛选范围内的全部资讯显式按发布时间从新到旧；用户切换“热度”后，全部资讯按上游热度值从高到低，同热度按发布时间倒序。放大主稿始终只是当前排序的第一条，不再有独立选稿规则。两种模式都在分页前执行，切换会从第一页重新加载。
- 首页资讯分页：云函数先按频道和筛选条件查询，再下发 8 条列表 DTO；第一页携带计数矩阵，后续使用稳定 `nextCursor`，不再重复 count 或矩阵计算。客户端兼容旧 offset，但优先游标，并通过 `feed.remainingItems[n]` 只追加新增行。
- 首页性能边界：忽略云函数、测试和运维脚本后，小程序代码/静态文件约 0.41 MiB；列表图片、来源头像、日期内容和课程海报均按需加载。2026-07-22 开发者工具实测同一会话重新进入资讯页到首批 8 条文字与图片同时可用约 4.4–7.9 秒，滚动数据量受控但冷启动并非亚秒级，不能表述为所有网络下都“瞬时打开”。
- 互动能力：`features/engagement/` 拥有客户端 API、展示转换、乐观状态、最新目标同步、页面间状态与评论输入模型；`components/comment-sheet` 独立管理评论输入、64 个表情、手机图片、原图预览和资料补全。键盘高度变化时整块输入坞贴住键盘顶部，发送占据工具行最右列；详情页通过 `page-meta` 锁住底层页面，评论列表继续独立滚动。评论提交后先以所有者可见的 `pending` 状态返回，后台审核通过才事务公开；同一资讯 30 秒冷却、滚动 24 小时最多 30 条。云端 service 负责权限、审核、公开视图与校验，repository 负责目标状态、幂等事务和收藏快照。评论仅 Pro 可读写，喜爱与收藏对所有真实微信用户开放；喜爱数加入公开热度。
- 资讯列表、详情和资讯类搜索结果另显示 `100–1000` 的稳定“推荐热度”，由稳定内容标识生成并明确使用推荐语义；它不写入数据库、不冒充用户行为，也不改变真实喜欢数、喜欢状态或上游排序分。
- 站内消息：`features/messages/` 按 API/model/session 隔离读取、已读和查看者缓存，`pages/messages` 只负责展示。`knowledge_message_events` 作为可靠 outbox，`knowledge_user_messages` 保存会员成功、资料结果、评论结果和收到评论通知；聚合消息以版本令牌避免旧已读覆盖新通知。
- 加载与稳定刷新：全局 `components/loading-state` 已接入资讯、精选、专栏、简报、详情、收藏、资料和消息等懒加载区域；共享 `components/empty-state` 统一核心空态与错误态。精选、简报、专栏目录和阅读器支持下拉刷新。后台换签和轮询保留现有内容，喜爱、收藏、媒体与当前详情只更新叶子字段；固定媒体壳保留高度，阅读器图片失败会强制换签一次，避免列表、滚动位置和轮播闪动。
- 视觉基线：`styles/design-tokens.wxss`，以冷白画布、白色实体内容面、深墨正文和 `#1d9bf0` 编辑蓝建立层级；喜爱粉和成功绿只表达状态，模糊仅用于临时遮罩。四个原生 Tab 使用同尺寸同笔画的深灰/编辑蓝线性图标。旧蓝紫渐变、微光和大面积珍珠材质已被替代。
- 云函数：`knowledgeFeed`、截图执行函数 `sourcePreviewWorker`、私有运维入口
  `knowledgeOps`、微信虚拟支付入口 `membershipBilling`。旧
  `digestIngest`/`digestStore` 已退休。
- 集合：资讯链路包括缓存、归档、独立条目、来源账号资料、日索引、同步状态、管理员授权、迁移和视觉任务；会员/智能链路包括会员、订单、分析、任务、简报和模型预算；互动链路包括互动、评论、资料审核和消息。专栏生产已包含 `knowledge_column_entries`、`knowledge_column_media` 和 `knowledge_column_progress`，并保留旧案例/趋势集合作兼容。生产 29 个合同集合均已收敛为 `ADMINONLY`，50 个合同索引回读一致。
- `knowledgeFeed` 配置使用十个隔离定时入口：来源同步每分钟，搜索 token 回填使用独立每分钟入口，视觉在每分钟 `:10/:25/:40/:55` 做四次轻量探测，分析每 10 分钟，归档与旧视觉每小时，日/周/月简报按日历边界运行，资料审核 worker 每分钟运行。周案例触发器已移除。来源指纹与缓存快照复用，304 不写库；用户请求只读取 CloudBase。
- 视觉 worker 保持全局调度租约，但每批可并行调用 6 个独立 2GB `sourcePreviewWorker` 实例，单实例仍只运行一次 Chromium 捕获；每轮扫描最多 40 条并有界处理 38 条。fresh live 等待目标为 0，新资讯先排空，再恢复 live/repair 与 fresh/recovery 加权公平轮转；失败指数退避并在 8 次后阻断，孤儿图片清理最多每小时一次。旧 v2 任务会清理并在仍缺图时升级为 v3；成功、已就绪和 stale 记录删除，`retry`/`cleanup` 留待收口，`blocked` 保留诊断。已有完整视觉只派生 360×253 列表缩略图。新无图条目短暂 hold 最多四分钟；视觉成功原子公开图文，首次明确失败或到期即公开文字，以后仍可补图。目标 0 不等于外站故障、冷启动或突发流量下的绝对零执行等待；历史 retry/blocked 也不算最新资讯排队。
- `knowledge_feed_items` 保存独立条目，`knowledge_feed_day_index` 保存按日轻量索引；新增 `knowledge_memberships`、分析、任务和简报集合。普通用户固定滚动 24 小时，Pro 近 30 天，管理员全部归档。最新列表先返回完整日期桶，展开日期后再通过 `feedDay` 分页加载当天条目；覆盖状态只把连续 `coverage:'all'` 的区间标记为完整，更老日报精选仍明确为 partial。
- 同步使用数据库租约和事务写入校验防止跨实例重复投递及乱序覆盖；429/5xx 退避持久化在缓存文档。2026-07-17 线上首轮检测到精选指纹变化并更新，下一分钟只返回 `not-modified`；数据库 observed/applied 指纹一致、失败数为 0、租约已释放。
- 生产资讯同步、外站封面和来源头像请求由腾讯云 CloudBase 云函数发起；来源头像已持久化到 `knowledge-source-avatars/`，生产规则已只放行该头像前缀供客户端读取。原文截图由 CloudBase `sourcePreviewWorker` 直接生成并上传：普通站点默认直连，确认区域受限的站点走公网 WSS 中继；精确 X status 优先尝试中继官方嵌入页并保留三条有界后备路径。服务商替换公网地址后，正式代理域名 A 记录已切换并传播，CloudBase 认证探针、健康检查和真实 X canary 均已通过；生产继续用正式域名做 TLS 校验并固定连接替换地址。2026-07-23 [线上函数复核](sources/2026-07-23-relay-single-endpoint-audit.md)确认当前只配置这一组中继 URL/固定地址，旧公网服务器既不在生产路径中，也不是自动备用；中继失败时只会进入 CloudBase 直连尝试与视觉任务重试。公网服务器只运行直连 WSS 中继，不运行 Mihomo、Chromium 或截图 API，开发者本地网络不参与生产抓取。
- 用户界面不显示 AI HOT、API、缓存、规范链接、模型供应商、分析覆盖率等后台实现；资料页只显示必要的“审核中”生命周期提示。资讯只显示内容、原作者头像/昵称/账号、上游原始标签、原文链接和普通发布状态；作者身份和时间位于卡片上方，标签位于媒体之后。“最新”模式使用可按日期折叠的窄移动时间线，时间、节点与正文分开；有剩余条目时轨道连续到“展开更多 / 剩余 N 条”，失败时保留轨道并显示重试，空日期首次加载只显示一个 loading；“热度”模式保持全宽。没有上游标签时隐藏标签行，不用内部分类补位。简报覆盖率继续保存在云端供运维判断，但不再显示“不完整”提示。
- 来源标签会清除 RSS、翻译中转等采集方式后缀，不把技术管道暴露给用户。
- 详情页不复制原文正文：导读和“完整内容”完整保留上游摘要并按语义单元分段，不再按字符裁剪或添加人工省略号；相关阅读可使用真实封面或原文截图。缺图资讯详情通过原生 `swiper` 每 4 秒自动轮播全部截图，也支持手动滑动；截图最多 12 张并显示圆点。点击任意图片时，`wx.previewImage` 从当前图打开整组 URL，可缩放并继续左右切换。
- 来源区位于“接着看”之前：左侧展示原发布方和单行省略 URL，长链接可展开/收起；右侧是紧凑的复制按钮。`DIRECT_WEBVIEW_HOSTS` 当前为空，因此点击现有外部 URL 会复制并提示到手机浏览器粘贴，不能宣称小程序可直接唤起任意系统浏览器。
- 身份只取自云函数上下文；数据库使用 OpenID 的 SHA-256 派生值，不保存原始 OpenID。
- 当前真实管理员可在“我的”页切换普通用户、Pro 会员和管理员三种服务端预览。新构建的 `develop`/`trial` 与 `release` 都允许发起已登记的真实写请求，未知环境仍失败关闭；每条写链路继续由服务端校验身份、内容、对象所有权与业务配置。`knowledge_feed_access_grants` 始终保留真实 `role:'admin'`，只额外保存 `previewRole`，非管理员调用会被服务端拒绝，预览不会产生真实会员记录。
- 原始正文只在函数内存中参与处理，不写数据库或云存储。
- 降级结果内部仍携带 `processingMode: local_fallback` 供运维判断，前端不再显示额度、模型或本地规则等实现提示。
- 只在用户主动选择后接收评论展示所需的昵称与云头像文件 ID；候选先冻结到私有 review 前缀并进入后台审核，只有通过后才交换公开资料。微信登录只绑定 OpenID，不自动取得昵称头像；拒绝、失败或不确定结果不公开。不保存手机号、位置、实名资料或网页全文。会员订阅第一次点击只执行 `wx.login` 与服务端 `code2Session` 身份一致性校验，不创建订单；第二次点击才用新的登录码建单并支付。`wx.login` 本身不弹出账号选择或资料授权页，头像昵称为用户主动选择的可选展示资料，不作为支付硬门槛。本机“退出登录”只撤销当前查看者的订阅步骤标记，不退出手机微信、不清除会员、资料或未完成订单。虚拟支付官方查单要求订单绑定 OpenID，因此只在 `ADMINONLY` 支付订单中保存原始 OpenID 与必要交易字段，绝不返回客户端。

## 安全与成本

- 个人文章导入链路只接受默认 443 端口的 HTTPS，并拒绝凭据、内网、保留 IP 和微信公众平台文章；公共资讯截图链路有独立的受控来源与维护权限。
- DNS 解析后绑定已校验的公网 IP 建立 HTTPS 连接，并在每次重定向后重新校验。
- 最多 3 次重定向、响应最大 2MB、正文最多 12,000 字符。
- 环境已在 2026-07-20 不可逆切换为资源点计费，标准版每账期 330,000 点共享池；超限按量关闭，1000 点等于 1 元并不代表超额固定为 2 元。
- 会员知识智能以 CloudBase `qwen3.5-flash`（分析/文本审核）和 `qwen3.5-plus`（简报/图片审核）为主，所有 Qwen 请求显式关闭思考模式；PackyAPI `grok-4.5` 以其支持的最低 `low` 推理强度自动兜底。CloudBase 分任务超时为资讯分析 90 秒、简报/周内容 180 秒、评论与后台资料审核 30 秒，Packy 后台/审核为 90/20 秒。无思考通常降低模型延迟与推理消耗，但数据库、存储、函数、输入和请求仍消耗资源点，不能按固定比例承诺节省。审核超时只影响后台任务，不再阻塞提交请求。
- 模型调用前在 `knowledge_ai_budget` 按输出上限的 2 倍原子预留，内部月度上限 60,000 点并声明 100,000 点核心保留线；成功后按实耗结算。若实耗仍高于预留，先在月上限内原子补记差额，只有补差会突破 60,000 点时才持久化 `overrunDetected` 并把当月后续请求转 Packy。该限制不读取 CloudBase 整个共享池实时余额，因此不能宣称基础设施拥有平台级绝对优先权。
- 保留的旧个人摘要链路仍独立使用 CloudBase `hy3-preview` 与原有 10 元预算，但活跃小程序已移除其入口。
- 腾讯云自动化凭据仅保存在被 Git 忽略且受本机 ACL 限制的 `wiki/secrets/`，普通 Wiki 不含实际值。
- 当前生产公网节点没有旧 Codex/Mihomo/Chromium 常驻任务，只运行 Nginx 与受控 WSS 中继；2026-07-22 复核负载接近 0、约 486–511 MiB 可用内存、Swap 0，最近一小时无 Nginx/中继 error 日志。
- 原文截图由 CloudBase 事件函数执行；普通站点默认直连，区域受限站点与精确 X status 按受控策略使用令牌保护的 WSS `CONNECT host:443` 中继，公网服务器不接收截图结果也不持有上传权限。每次捕获最多 12 张并受 90 秒函数边界约束。v3 同时拒绝 HTTP 4xx/5xx、HTTP 200 错误壳、登录墙、挑战页、空白/纯色画面和目标不符；X 原页和嵌入页都必须精确命中 status id。第一方 Open Graph 主图及普通网页截图仍进入 CloudBase/Packy 视觉审核，只有高置信目标一致结果才上传。
- 资讯刷新与封面/截图回填使用数据库事务合并；孤儿视觉文件只按模块拥有的前缀删除，失败会进入持久化队列重试。
- 封面和截图对象路径包含来源 URL 哈希；事务 patch 同时校验 `expectedUrl`。若生成期间条目 URL 改变或被移除，旧图不会写入新资讯，未应用上传会进入受限清理队列；同 URL 强制重建使用独立捕获版本，避免覆盖当前正在引用的截图。

## 本地验证

- `npm.cmd run verify`：通过项目结构、环境、数据库、索引、全量 Node 测试、
  覆盖率和生产依赖审计。
- `npm.cmd run check`：38 个 JSON、358 个 JavaScript、16 个注册页面通过结构、
  语法与微信模块引用兼容性检查；客户端检查包约 0.71 MiB。
- `npm.cmd test`：791/791 个 Node 测试通过；完整 `npm.cmd run verify` 同时通过
  环境、29 个集合、50 个索引、覆盖率和生产依赖审计。
- `git diff --check`：通过。
- 微信开发者工具 CLI `auto`、生产页面自动化与 `preview`：通过；锁定代码提交
  `68382f5` 的预览和上传包均为 632,253 bytes。资讯时间线续载实测外层命中区
  47px、内部按钮 35px，错误轨道可见且空日期没有重复 loading；搜索结果跳转周简报
  后正确激活 `7d`。微信开发版本 `2.4.0` 已上传；公众平台提交弹窗已打开，尚待
  用户本人确认审核规则。
- 微信开发者工具模拟器已覆盖资讯、详情、精选、专栏、简报和我的页面；2026-07-21 最新回归确认专栏首页返回 `contractVersion=4`、会员无锁、六节动手课目录不含操作系统名，“安装 Codex CLI”按 Windows/macOS/Linux 展开且视觉模式为 `none`，简报不含 `trends` 且核心标题按 5 条显示“先看这5件事”。普通用户真实点击精选会打开可滚动的七项权益订阅卡，弹层和“我的”页均为白底、无侧轨并使用单行“订阅”按钮；测试后恢复 Pro 预览状态。
- 24 节基础课的 72 张手绘海报已保存到云端受保护前缀；客户端包不内置海报，每次课程接口只对当前鉴权课程签发 3 张，阅读器首轮只挂载当前页与相邻页。24 节完整课程正文继续保存在云函数代码内，客户端只带标题目录。
- 微信开发者工具后续默认按 [CLI 优先工作流](concepts/WeChatDevToolsCLI.md) 启动和操作：`D:\Apps\miniprogram\cli.bat auto --project D:\miniprogram --port 9420 --trust-project`；当前 `auto`、`open`、`islogin` 和回环监听已验证。自动化结束只断开连接，不结束 renderer、不调用 CLI `close`，并把 IDE 留在可验收页面。
- 微信开发者工具此前已重新编译资讯首页与详情并清除项目级红色错误；2026-07-17 的自动/手动轮播与整组全屏预览已通过页面逻辑和标记测试，仍需在真机覆盖 1、5、8 张、从中间图片进入全屏和返回后继续轮播。

## 云端与端到端状态

- 旧业务的 41 个函数、24 个集合、2,456 条文档、217 个存储对象和 `adminportal/` 已清理。
- 环境级空存储桶、平台认证文件、AppID 关联和标准版套餐被保留。
- 当前 29 个合同集合均由云函数管理并为 `ADMINONLY`。互动、评论、公开资料、资料审核队列、消息 outbox、收件箱、会员 checkout 租约、专栏草稿/媒体和学习进度分别按 owner、item、状态和到期时间使用合同索引；50 个合同索引已回读收敛。
- 四个正式函数保留：三个 Node.js 18.15 函数和 Node.js 20.19 的
  `sourcePreviewWorker`。生产 `knowledgeOps` 保持已验证版本；`knowledgeFeed`
  已于 2026-07-28 从最终候选 `68382f5` code-only 更新，三份变更源码哈希与
  manifest 均回读一致；`knowledgeFeed` 继续包含
  24 节基础课、6 节动手课、
  合同版本 4、GitHub 全量库、受保护手绘图、视觉队列、AIHOT 来源增强、
  CloudBase 无思考主模型、Packy 低推理兜底、评论/资料异步审核、站内消息和安全
  媒体链路、学习进度、全站搜索和十个隔离触发器。8,152 条搜索存量已完成回填，
  `ready=true`、待失败 0、隔离 0。
  `knowledgeOps` 无触发器且受维护令牌保护；`membershipBilling` 已部署当前
  支付恢复版本并每 15 分钟对账。现网 `plans.available=true`，30 天会员商品
  原价和现价均为 5.9 元，10.9 元仅为界面比较价；微信入站发货回调在官方查单和
  权益事务成功后直接返回加密成功，手工发货接口只作带 `pay_sig` 的后台异常
  兜底；最新生产对账已让 3/3 历史已付款订单完成发货确认。新订单继续受
  产品开关、正式发布批准、微信配置、服务端计划校验和账户级租约保护。
- 生产历史补审已处理 2 条评论和 1 份资料；本次真实资料审核的 AI 与媒体判定已成功，修复 `_id` 事务写入后由正常 worker 完成公开和结果消息投递。复核查询中公开评论和完整资料的缺审计数均为 0。生产资讯同步修复后失败计数为 0，观测指纹与应用指纹一致。
- 真实微信上下文已验证喜爱/收藏目标状态开启与还原、会员评论列表读取、空资料接口、会员转化卡状态以及列表/详情分享 payload；部署后日志未再出现 `TransactionBusy`，所有测试互动状态已还原。开发者工具已验证键盘高度 336px 时输入坞整体上移、96rpx 发送按钮右对齐、64 表情网格、标准图片图标、页面滚动锁和评论独立滚动；喜欢与收藏两次快速反向点击在 29ms/16ms 内即时变化并最终同步为测试前状态。头像、相册原图、真机键盘与好友接收仍需手机人工验收。
- 评论、资料和会员事件现通过可靠 outbox 投递站内消息；批量投递 checkpoint、
  聚合版本、严格 cutoff 已读、超过 1000 条全部已读和查看者切换/响应乱序均有
  自动回归。评论与资料真实状态转换、收到评论的多账号通知仍需真机人工验收。
- 真实微信上下文已验证：保存偏好 → 导入文章 → 生成临时摘要 → 保留结论卡 → 统计更新 → 清除个人数据。
- 环境“超限按量”关闭；已切换套餐内资源点并启用两款内置模型，不会在资源点用完后自动产生无上限按量费用。

详细证据见 [微信端到端验证与运行时修复](sources/2026-07-15-wechat-e2e-and-runtime-fixes.md)。

## 上线前未完成事项

1. 已确认正式线上为 `2.3.5`、审核区为空，已上传开发卡片为 `2.4.0`；先以新的
   评论隐藏替换版本覆盖开发卡片，再提交审核，不再提交旧 `2.4.0`。
2. 评论真机发布、回复和多账号通知验收随评论 UI 一起暂停；以后恢复评论的新审核
   版本必须重新完成。资料头像/昵称仍可独立验证“审核中”、后台结果与我的消息。
3. 在全部、专栏、简报、精选、详情和收藏页真机覆盖弱网、前后台切换及连续
   喜爱/收藏，确认加载转圈不清空现有内容，列表、媒体和滚动位置不闪动。
4. 用同一已付款微信账号扫描最新预览，确认“我的”直接显示现有 Pro，且不会再次
   拉起收银台；再用真实新账号覆盖首次只登录、第二次才支付、取消和异常恢复。
   产品不提供管理员主动退款，本次不申请 Apple 退款；平台被动退款通知与权益
   回收保护继续保留。当前预览为 `env=0` 真实扣款，已付款账号不得为复测再次购买。
5. 在真机补齐普通/Pro、GitHub 标签筛选、无图列表/详情、头像、相册原图、
   键盘、分享接收和弱网恢复验收；测试后清理或还原生产数据。
6. 在 `2026-08-06` 前升级或重新复审当前 6 个 CloudBase 传递依赖风险包和
   26 个 advisory source；当前审计通过代表风险被精确控制，不代表零漏洞。
7. 专栏、学习进度、搜索、8,152 条回填、真实管理员双图发布和最终三角色 canary
   已完成；`knowledgeFeed` 已从 `68382f5` code-only 部署并完成 manifest/源码哈希
   回读。分支和 RC 标签 `rc/2026-07-28-member-admin-global-search-v3` 已推送，
   微信开发版本 `2.4.0` 已上传。下一步先部署并回读评论隐藏候选的
   `knowledgeFeed` 兼容更新、上传替换开发版本，再由用户本人确认已阅读审核规则；
   审核通过后显式发布。
8. 微信订阅消息仍需在公众平台创建真实模板，并提供模板 ID、关键词字段名和用途
   映射；在这些合同确定前不接入授权入口或发送调用，站内消息继续作为现有兜底。

## 不阻塞本次首发的后续扩展

- 娱乐、社会、游戏和英语频道，以及重点厂商独立官方源、跨来源去重和优先级机制；这些入口当前已关闭，不构成首发缺口。
- 经平台确认业务域名后在微信内直接打开原文；现阶段复制链接的降级路径可用。
- 当前生产继续观察 `knowledgeFeed` 十个定时器、`membershipBilling` 对账任务和模型兜底的真实曲线，并在规模增长后补 25,000 条 P95 报告。
- 持续观察举报阈值、申诉处理时延和误恢复率；当前已具备最小完整治理闭环，规模增长后再评估独立审核队列、申诉理由与管理员批量工作台。
- 按真实消息量制定终态 outbox、已投递收件人 checkpoint 和消息收件箱的保留/
  归档策略；当前可靠性与安全边界不依赖立即清理。

## 已被替代的旧结论

- “正式 Git 根是 `D:\miniprogramcode`、当前分支为 `my-work`”已被当前工作仓库和重建分支替代。
- “产品方向未确定”已被 [“别收藏了”首版决策](decisions/2026-07-13-digest-inbox-v1.md) 替代。
- “产品不提供资讯流”已被 [编辑索引式知识平台首页决策](decisions/2026-07-15-editorial-knowledge-platform-ui.md) 替代；旧摘要闭环继续作为迁移基础。
- “真实微信身份和数据库闭环未验证”已在 2026-07-15 被端到端结果替代。
- “AI 失败不入队”已被 [透明临时摘要决策](decisions/2026-07-15-ai-quota-fallback.md) 替代。
- “精选一百余条就是全部资讯、无视觉不公开”已被 [全量资讯存储与服务端角色权益](decisions/2026-07-17-full-feed-and-role-entitlements.md) 替代。
- “只有 free/admin 且管理员默认 90 天”已被 [单一 Pro 会员、能力型权益与可回溯简报](decisions/2026-07-17-pro-membership-and-intelligence.md) 替代。
