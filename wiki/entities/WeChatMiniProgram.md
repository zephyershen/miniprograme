---
title: "知识获取平台微信小程序"
type: entity
tags: [wechat, miniprogram, cloud-development, knowledge-platform, editorial-index]
sources: [../sources/2026-07-13-digest-inbox-implementation.md, ../sources/2026-07-14-cloud-cleanup-and-deployment.md, ../sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, ../sources/2026-07-15-editorial-ui-implementation.md, ../sources/2026-07-15-aihot-feed-integration.md, ../sources/2026-07-16-source-preview-deployment.md, ../sources/2026-07-17-full-feed-admin-and-capacity.md, ../sources/2026-07-18-engagement-ui-implementation.md, ../sources/2026-07-19-interaction-reliability-and-comment-media.md, ../sources/2026-07-19-packy-grok-intelligence.md, ../sources/2026-07-19-profile-moderation-and-huifu-payment.md, ../sources/2026-07-20-cloudbase-ai-cost-and-hybrid-routing.md, ../sources/2026-07-21-timeout-feed-and-manual-production-validation.md, ../sources/2026-07-22-cloudbase-scf-source-preview-and-mobile-timeline.md, ../sources/2026-07-22-six-concurrency-and-personal-proxy-headroom.md, ../sources/2026-07-22-cloud-media-proactive-renewal.md, ../sources/2026-07-22-runtime-reliability-performance-and-feed-spacing.md, ../decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md, ../decisions/2026-07-19-huifu-membership-payment-and-paid-content.md, ../decisions/2026-07-20-cloudbase-ai-primary-packy-fallback.md, ../decisions/2026-07-21-image-independent-feed-and-direct-practical-manual.md, ../decisions/2026-07-22-cloudbase-scf-source-preview.md]
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# 知识获取平台微信小程序

## 它是什么

使用原生 WXML、WXSS、JavaScript 和微信云开发构建的编辑型知识获取平台。当前产品包含资讯、AI 专栏、简报和我的四个 Tab，资讯页按 AIHOT 上游范围展示“全部 / 一手信源 / 资讯 / 推文”，会员精选是独立入口。普通用户查看滚动 24 小时，Pro 查看 30 天，管理员查看全部归档；娱乐、社会、游戏和英语尚未接入，不显示入口。

## 身份与位置

- 当前工作仓库：`D:\miniprogram`
- 小程序代码：`D:\miniprogram\hyyc`
- 项目配置：`D:\miniprogram\project.config.json`
- 云部署配置：`D:\miniprogram\cloudbaserc.json`
- AppID：`wxcb0f641838abf6e6`
- 云环境：`hyyc-1gi3f5sqc5becabf`
- Git 远程：`https://github.com/zephyershen/miniprograme.git`

## 运行依赖

- 微信小程序基础库 `3.12.0`
- Node.js 18.15 云函数
- `wx-server-sdk`、`@cloudbase/node-sdk`、`@mozilla/readability`、`jsdom`、`ws@8.21.0`
- CloudBase 内置模型 `qwen3.5-flash` 与 `qwen3.5-plus`，分别承担主分析/文本审核和主简报/图片审核
- PackyAPI OpenAI Responses 兼容端点及 `grok-4.5`，在 CloudBase 超时、限流、结构失败、预算耗尽或熔断时自动兜底
- 微信小程序虚拟支付；CloudBase `membershipBilling` 负责 code2Session、签名、官方查单、发货重试、退款回收和会员发放

## 数据与权限

- 前端不传 OpenID，身份只由云函数上下文提供。
- 当前 `app.json` 不声明定位、通讯录、相册、摄像头或其他旧业务权限。
- 剪贴板只在用户点击按钮时读取。
- 真实密钥只能留在云环境变量或受限配置中；普通 Wiki 和仓库不保存密钥值。
- 当前业务集合只由云函数访问；公共资讯缓存与按日历史归档都不保存用户身份。
- 普通用户由云函数限制滚动 24 小时，Pro 为 30 天，管理员查看项目全部已归档数据；角色由 OpenID 的 SHA-256 派生键、独立会员记录和管理员授权决定，管理员优先。当前唯一微信账号已授予管理员角色，普通 Wiki 不记录其身份哈希。
- 喜爱与收藏对所有真实微信用户开放；评论只对 Pro/管理员开放并由服务端重鉴权。互动和评论表为 `ADMINONLY`，公开结果不包含派生身份键。
- 评论发布者通过微信 `chooseAvatar` 与昵称输入主动选择展示资料；昵称和头像在保存前同步审核，失败或不确定时不保存。`knowledge_user_profiles` 为 `ADMINONLY`，只保存派生身份键、昵称、云头像文件 ID 和紧凑审核记录。评论支持最多 3 张手机原图，附件文件 ID 只随会员评论 DTO 返回。
- 付费专栏完整海报不在小程序包中，客户端也不能直接读取 `ai-column/` 云存储目录；`knowledgeFeed.columnContent` 重鉴权后返回短期地址。
- `knowledge_memberships` 与 `knowledge_membership_orders` 为 `ADMINONLY`。客户端支付结果不能直接授予权益；只有微信虚拟支付服务端查单确认订单号、环境、类型、标价和实付金额全部一致后，事务才发放一次性 30 天 Pro。
- `knowledge_ai_budget`、`knowledge_feed_archive` 及其他服务端专用集合均已复核为 `ADMINONLY`；分析时间索引和公开状态/分析状态/发布时间覆盖索引已在线创建并验证。

## 如何运行与验证

- 默认使用 `D:\Apps\miniprogram\cli.bat auto --project D:\miniprogram --port 9420 --trust-project` 启动或接管微信开发者工具；端口只监听 `127.0.0.1`。完整启动、验证和恢复步骤见 [微信开发者工具 CLI 优先工作流](../concepts/WeChatDevToolsCLI.md)。
- 小程序根目录由 `project.config.json` 指向 `hyyc/`；扫码、验证码、权限和审核确认仍由用户完成。
- 本地执行 `npm test` 与 `npm run check`。
- 真实微信上下文的已验证闭环：保存关注方向、导入公开文章、查看摘要、保留卡片、核对统计、清除个人数据。
- 2026-07-16 微信开发者工具已编译并渲染分页资讯首页、原文截图详情、来源 URL 和相关阅读；来源区位于“接着看”之前，控制台无项目级红色错误。
- 当前本地回归为 437/437 个 Node 测试；项目检查覆盖 35 个 JSON、267 个 JavaScript 和 11 个注册页面。评论输入坞、互动、模型主备路由、预算熔断、评论与资料审核、微信虚拟支付签名/查单及生产自动队列均已验证；2026-07-23 进一步验证了正文与作者资料短暂错开时可按精确 X 原帖账号复用已有作者档案，目标头像对象换签后返回 HTTP 200。

## 部署状态

当前保留 6 个 Node.js 18.15 云函数：`digestIngest`、`digestStore`、`knowledgeFeed`、`sourcePreviewWorker`、`knowledgeOps`、`membershipBilling`。2026-07-20 环境已不可逆切换到标准版资源点计费，每账期共享 330,000 点且“超限按量”关闭；`qwen3.5-flash` 与 `qwen3.5-plus` 已启用。体验版上传仍为 `needs-review`。

知识智能以 CloudBase 内置模型为主、Packy 为备；调用前在 `knowledge_ai_budget` 按输出上限的 2 倍原子预留，内部模型月度上限为 60,000 点，成功后按实耗结算。预留不足、限流和服务故障会转 Packy；实际消耗仍超过预留时先在月上限内原子补差，只有补差会越过 60,000 点时才持久化 `overrunDetected` 并把当月后续调用熔断到 Packy。CloudBase 分任务超时为分析 90 秒、简报 180 秒、同步审核 30 秒；2026-07-21 生产 trace 证明 84 次调用全部最终 200。该内部预算不能改变 CloudBase 共享池的平台调度优先级，因此仍需持续观察核心资源余量。

AI 资讯全量源已部署，具备每分钟指纹检查、6 小时条目条件校验、24 小时完整刷新、持久化退避、分布式租约、来源追踪、服务端游标分页与计数矩阵。作者资料增强在上游资料晚到或临时失败时，会按精确 X 原帖账号读取已有云端作者档案，不再要求同一轮增强流已出现该条目。CloudBase 负责条目/日索引/视觉任务存储、角色权益、定时编排，并在 `sourcePreviewWorker` 的隔离 Chromium 中直接截图和上传 JPEG；独立公网服务器只为 X/区域受限站点提供令牌保护的 WSS `CONNECT` 中继，不运行 Playwright、Mihomo 或上传逻辑。[2026-07-23 线上复核](../sources/2026-07-23-relay-single-endpoint-audit.md)确认函数只配置一组正式中继 URL 和固定地址，旧公网服务器不在生产路径中，也没有被注册成自动备用；新中继失效时不会自动切旧节点。worker 每分钟四次探测、每轮最多 6 并发并优先 fresh live；新条目最多有界等图 4 分钟，失败或超时仍公开文字，后续继续补图。详情只挂载当前及相邻截图，自动播放一轮后停止，仍可手动滑动并整组全屏查看。

SCF 实际状态已复核：`knowledgeFeed` 有 8 个隔离定时器，分别执行每分钟来源同步、每分钟 `:10/:25/:40/:55` 视觉 worker、每 10 分钟分析、每小时归档与旧视觉，以及日/周/月简报；`membershipBilling` 有 1 个每 15 分钟的有界最旧优先对账定时器。会员架构现为普通滚动 24 小时、Pro 30 天、管理员全部归档；会员、订单、智能、互动和评论集合为 `ADMINONLY`，所需查询索引已创建。自动分析、简报生成、真实精选和简报公开均已启用。`membershipBilling` 已部署为微信虚拟支付事件函数，服务端购买方案当前 `available=true`；真实订单和退款仍待双端真机验收。

2026-07-19 `knowledgeFeed` 已部署事务顺序读、冲突短重试、目标状态和幂等评论；生产验证后 `TransactionBusy` 为 0。个人资料 action 与评论头像/附件公开视图已上线，资料集合 ACL 为 `ADMINONLY`。评论文本/附件与昵称/头像在写入前由审核服务 fail-closed 检查，失败不公开或不保存，被拒绝的新上传文件会清理；用户界面只显示普通发布状态，不显示后台处理机制。项目当前未调用微信 `mediaCheckAsync/imgSecCheck/msgSecCheck`，也未配置 CloudBase COS 自动内容审核。

该精选源不等同于重点厂商官方源分别直连；娱乐、社会、游戏和英语仍为待接入状态，当前不显示导航入口。当前没有已验证的外部业务域名，微信小程序也不能直接唤起任意系统浏览器，因此外部原文入口复制 URL 并提示用户到手机浏览器粘贴。

## 历史关系

旧版社区任务/二手交易项目已被替代。旧页面、函数和依赖可通过 `legacy-hyyc-704a88e` 标签回看，不应恢复到当前活跃代码。
