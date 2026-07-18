---
title: "知识获取平台小程序项目总览"
type: overview
tags: [overview, miniprogram, wechat, knowledge-platform, editorial-index]
sources: [sources/2026-07-13-digest-inbox-implementation.md, sources/2026-07-14-cloud-cleanup-and-deployment.md, sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, sources/2026-07-15-editorial-ui-implementation.md, sources/2026-07-15-aihot-feed-integration.md, sources/2026-07-16-modular-refactor.md, sources/2026-07-16-source-preview-deployment.md, sources/2026-07-17-fingerprint-sync-and-carousel.md, sources/2026-07-17-feed-history-and-long-preview.md, sources/2026-07-17-full-feed-admin-and-capacity.md, sources/2026-07-17-visual-backfill-quality-and-performance.md, sources/2026-07-17-pro-membership-implementation.md, sources/2026-07-17-luma-ui-redesign.md, sources/2026-07-18-premium-ia-and-copy.md, sources/2026-07-18-focus-previews-and-handdrawn-column.md, decisions/2026-07-15-engaging-news-detail.md, decisions/2026-07-16-modular-architecture.md, decisions/2026-07-16-source-preview-renderer.md, decisions/2026-07-17-fingerprint-driven-feed-sync.md, decisions/2026-07-17-full-feed-and-role-entitlements.md, decisions/2026-07-17-full-feed-visual-queue-and-quality.md, decisions/2026-07-17-pro-membership-and-intelligence.md, decisions/2026-07-17-luma-ui-redesign.md, decisions/2026-07-18-premium-learning-and-curation-ia.md, decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md]
last_updated: 2026-07-18
status: confirmed
confidence: high
---

# 知识获取平台小程序项目总览

## 一句话说明

这是一个从个人文章消化箱迁移为编辑型知识获取平台的微信小程序，现有资讯、专栏、简报、我的四个原生 Tab；会员精选作为资讯顶部带锁入口进入独立页面。普通用户查看最近 7 天 AI/科技全部资讯，人工 Pro 查看 30 天，并可访问 AI 学习专栏、精选与简报；当前微信账号由服务端识别为管理员。部署时条目库为 3,090 条；首页每页 8 条，最新、热度和未来精选均使用数据库游标。全库视觉与 360×253 列表缩略图继续异步补齐；真实 AI Provider、真实精选/简报和支付仍保持关闭。娱乐、社会、游戏和英语仍待各自内容源。

## 事实健康表

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| AppID、云环境 ID、Git 历史和远程地址已保留 | confirmed | 项目配置、应用入口、Git 命令 |
| 旧社区、商品、任务、聊天、实名、定位、钱包、支付和图片审核代码已从活跃树移除 | confirmed | 当前文件树与重建历史 |
| 10 个页面、4 个云函数及本地测试已实现 | confirmed | 当前代码、181/181 个 Node 测试通过 |
| 旧云资源清空及 5 个新集合创建 | confirmed | 2026-07-14 CloudBase 清单与复核 |
| `digestIngest`、`digestStore` 已部署 | confirmed | 两函数部署结果与云端日志 |
| 真实 OpenID、数据库闭环和开发者工具编译 | confirmed | 2026-07-15 微信开发者工具端到端验证 |
| 编辑索引式首页与频道视觉系统 | confirmed | 2026-07-15 Moodboard 选择、当前代码和模拟器编译 |
| AI/科技精选聚合、最新/热度排序、服务端分页、筛选、缓存和原始来源追踪 | confirmed | 2026-07-16 线上验证最新倒序、热度倒序及热度与时间筛选组合通过 |
| 知识资讯主链路按 feature/adapter/repository/service/presenter 分层 | confirmed | 2026-07-16 模块化重构、边界测试与 CloudBase 接口回归 |
| 完整摘要分段和相关阅读 | confirmed | 无图详情实机打开、云端摘要无人工省略、3 条相关阅读 |
| 缺图资讯原文截图与自动轮播 | confirmed | 公网真实长页生成 5 张连续截图；详情自动/手动轮播、圆点和整组全屏预览均有回归覆盖 |
| AI/科技资讯增量同步 | confirmed | 每分钟指纹检查、6 小时条件校验、24 小时完整刷新、分布式租约和线上连续定时日志 |
| 无图资讯也公开，视觉只做增强 | confirmed | `mode=all` 不经过视觉门禁；全量缺图进入独立任务队列，实时新增优先于历史 |
| 移动端筛选与分页预算 | confirmed | 条目级 facet 已改为计数矩阵；分页通过数据路径追加，详情只挂载相邻截图 |
| 全量存储与角色权益 | confirmed | 普通 7 天、Pro 30 天、管理员全部归档；唯一微信账号授权匹配 |
| Pro 会员与知识智能骨架 | confirmed | free/member/admin 重鉴权、固定示例、AI 待处理队列、简报引用快照、独立运维函数 |
| 会员学习与精选信息架构 | confirmed | 资讯顶部精选锁入口、底部 AI 专栏、频道数字移除、微信模拟器六场景截图 |
| 手绘 AI 知识卡与新资讯聚焦截图 | confirmed | 六课共 18 张完整手绘海报轮播、生产 X 正文裁切、媒体 2/2 就绪、forward-only 视觉边界 |
| 专栏高清按需查看与资讯被动更新提示 | confirmed | 18 张 1086×1448 云图、原生三图预览、60 秒轻量计数、点击后才更新列表 |
| 微信开发者工具 CLI 优先工作流 | confirmed | Stable 2.01.2510290 的 `auto`、`open`、`islogin` 已通过；端口只监听 `127.0.0.1:9420` |
| 多来源去重、独立官方源与其他四个频道 | needs-review | 尚未实现，不得宣称为全频道实时新闻服务 |
| 真正 AI 摘要 | needs-review | 当前套餐模型调用返回 429；应用已透明使用本地临时摘要 |
| 体验版上传与 30 天验证 | needs-review | 尚未上传体验版 |

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
3. `digestIngest` 校验 URL、阻止 SSRF、限制抓取大小并抽取正文。
4. 云 AI 可用时生成相关性、中文摘要和关键句；不可用时生成明确标注的本地临时摘要。
5. 用户必须丢弃或保留结论；卡片满 20 张时必须显式选择替换对象。

上述代码和云函数仍保留，但首页已撤下待处理数量、导入入口、关注方向设置提示和个人队列。当前公开体验不提供任意网页全文、自动剪贴板监听、支付、广告、登录页、定位、推送或全文翻译；会员 UI 仅处于人工授权内测，真实精选和简报不会在 AI API 接入前启用。已接入的聚合资讯仍不等同于各厂商官方源分别直连。

## 代码与数据

- 页面：`pages/inbox/index`、`pages/curated/index`、`pages/briefing/index`、`pages/profile/index` 为资讯、专栏、简报、我的四个原生 Tab；`pages/featured/index` 是资讯顶部带锁入口打开的会员精选页。详情与来源页继续保留，个人消化、结论卡和设置作为二级入口。
- 小程序模块：`features/knowledge-feed/`、`membership/`、`curated-feed/`、`ai-column/`、`briefing/` 分别拥有独立查询或展示模型；`features/digest/` 保留个人消化闭环；`services/cloud-functions.js` 是共享传输层。
- 微信运行时模块引用统一使用带 `.js` 扩展名的相对 `require`，页面直接引用具体 feature 文件，不再使用 `...require(...)` 聚合入口；项目检查会阻止这两类已验证不兼容写法。
- 资讯云函数模块：`adapters/` 隔离外部资讯源，`repositories/` 隔离条目、日索引、授权和同步状态，`services/` 编排查询、权益、同步、迁移和视觉维护，`policies/` 承载定时入口、访问规则和维护鉴权，`presenters/` 约束公开 DTO；`knowledgeFeed/index.js` 只装配依赖和路由 action。
- 首页频道：全部之后显示带锁“精选”导航入口，再依次为 AI 前沿、科技、娱乐、社会、游戏、英语；精选不参与普通频道过滤。频道标签不显示数量，当前聚合源覆盖 AI/科技，其他频道保留真实空状态。
- 首页筛选：普通用户可选 24 小时、近 3 天、近 7 天并看见锁定的 30 天入口；Pro 可选近 30 天；管理员另有“全部归档”。15 个公司与模型主题、14 个技术方向可组合，选项显示当前资讯数，零结果项不可选。
- 首页排序：默认选中“最新”，当前频道和筛选范围内的全部资讯显式按发布时间从新到旧；用户切换“热度”后，全部资讯按上游热度值从高到低，同热度按发布时间倒序。放大主稿始终只是当前排序的第一条，不再有独立选稿规则。两种模式都在分页前执行，切换会从第一页重新加载。
- 首页资讯分页：云函数先按频道和筛选条件查询，再下发 8 条列表 DTO；第一页携带计数矩阵，后续使用稳定 `nextCursor`，不再重复 count 或矩阵计算。客户端兼容旧 offset，但优先游标，并通过 `feed.remainingItems[n]` 只追加新增行。
- 视觉基线：`styles/design-tokens.wxss`，以冷白珍珠画布、实体内容表面、连续圆角和单一蓝紫焦点建立层级；模糊材质只用于悬浮控制与临时覆盖层。
- 云函数：`digestIngest`、`digestStore`、`knowledgeFeed`、私有运维入口 `knowledgeOps`
- 集合：个人闭环 5 个集合；资讯链路包括缓存、归档、独立条目、日索引、同步状态、管理员授权、迁移和视觉任务；会员/智能链路包括 `knowledge_memberships`、`knowledge_feed_item_analysis`、`knowledge_feed_analysis_jobs`、`knowledge_feed_digests`。服务端专用集合均为 `ADMINONLY`。
- `knowledgeFeed` 由单一 `knowledge-feed-source-sync` 每分钟运行：fingerprint 变化时立即刷新 `mode=all`；指纹不变时每 6 小时做 ETag 条件校验，每 24 小时做完整一致性刷新。用户请求只读取 CloudBase。
- 每分钟全量视觉 worker 最多处理 2 条：新增/变更优先，历史先近 7 天再向前补；失败指数退避并在 8 次后阻断，孤儿图片清理最多每小时一次。已有完整视觉只派生 360×253 列表缩略图，新视觉在完整图片与缩略图都上传后原子发布；无图条目不隐藏。
- `knowledge_feed_items` 保存独立条目，`knowledge_feed_day_index` 保存按日轻量索引；新增 `knowledge_memberships`、分析、任务和简报集合。普通用户固定近 7 天，Pro 近 30 天，管理员全部归档。覆盖状态只把连续 `coverage:'all'` 的区间标记为完整，更老日报精选仍明确为 partial。
- 同步使用数据库租约和事务写入校验防止跨实例重复投递及乱序覆盖；429/5xx 退避持久化在缓存文档。2026-07-17 线上首轮检测到精选指纹变化并更新，下一分钟只返回 `not-modified`；数据库 observed/applied 指纹一致、失败数为 0、租约已释放。
- 生产资讯同步和外站封面请求由腾讯云 CloudBase 云函数发起；原文截图由独立公网服务器通过受控 Mihomo 出口生成，再由 CloudBase 上传和缓存。开发者本地网络不参与生产抓取；用户主动在浏览器打开原文时才使用自己的网络。
- 用户界面不显示 AI HOT、API、缓存、规范链接等接入实现，只显示资讯的原始发布方和原文链接。
- 来源标签会清除 RSS、翻译中转等采集方式后缀，不把技术管道暴露给用户。
- 详情页不复制原文正文：导读和“完整内容”完整保留上游摘要并按语义单元分段，不再按字符裁剪或添加人工省略号；相关阅读可使用真实封面或原文截图。缺图资讯详情通过原生 `swiper` 每 4 秒自动轮播全部截图，也支持手动滑动；截图最多 12 张并显示圆点。点击任意图片时，`wx.previewImage` 从当前图打开整组 URL，可缩放并继续左右切换。
- 来源区位于“接着看”之前：左侧展示原发布方和单行省略 URL，长链接可展开/收起；右侧是紧凑的复制按钮。`DIRECT_WEBVIEW_HOSTS` 当前为空，因此点击现有外部 URL 会复制并提示到手机浏览器粘贴，不能宣称小程序可直接唤起任意系统浏览器。
- 身份只取自云函数上下文；数据库使用 OpenID 的 SHA-256 派生值，不保存原始 OpenID。
- 当前真实管理员可在“我的”页切换普通用户、Pro 会员和管理员三种服务端预览。`knowledge_feed_access_grants` 始终保留真实 `role:'admin'`，只额外保存 `previewRole`；非管理员调用会被服务端拒绝，预览不会产生真实会员记录。
- 原始正文只在函数内存中参与处理，不写数据库或云存储。
- 降级结果携带 `processingMode: local_fallback`，前端明确提示其不是 AI 翻译或相关性判断。
- 不保存昵称、手机号、位置、实名资料、支付信息或全文。

## 安全与成本

- 个人文章导入链路只接受默认 443 端口的 HTTPS，并拒绝凭据、内网、保留 IP 和微信公众平台文章；公共资讯截图链路有独立的受控来源与维护权限。
- DNS 解析后绑定已校验的公网 IP 建立 HTTPS 连接，并在每次重定向后重新校验。
- 最多 3 次重定向、响应最大 2MB、正文最多 12,000 字符。
- 当前 AI 提供方为 `hunyuan-v3`，模型为 `hy3-preview`；可通过环境变量切换。
- AI 调用前事务预留预算，成功后结算实际 Token 成本；每月 10 元硬上限。
- AI 额度错误会释放预算预留并进入本地临时摘要，不产生伪造的 AI 用量记录。
- 腾讯云自动化凭据仅保存在被 Git 忽略且受本机 ACL 限制的 `wiki/secrets/`，普通 Wiki 不含实际值。
- 原文截图服务只绑定回环地址，经 Nginx Bearer 鉴权公开；生产必须使用回环代理并在代理解析后拒绝私网/保留地址。服务限制单并发、最多 12 张、单图约 1.25MB 和总超时，并拒绝 HTTP 4xx/5xx。`focus-v1` 已部署：先站点适配、再通用 DOM 正文识别、低置信度整页回退；截图前等待字体、头像和正文图片稳定。当前不使用 OCR 或视觉大模型，生产只处理 2026-07-18T04:43:08.568Z 之后首次发现的新资讯。
- 资讯刷新与封面/截图回填使用数据库事务合并；孤儿视觉文件只按模块拥有的前缀删除，失败会进入持久化队列重试。
- 封面和截图对象路径包含来源 URL 哈希；事务 patch 同时校验 `expectedUrl`。若生成期间条目 URL 改变或被移除，旧图不会写入新资讯，未应用上传会进入受限清理队列；同 URL 强制重建使用独立捕获版本，避免覆盖当前正在引用的截图。

## 本地验证

- `npm test`：178/178 通过。
- `npm run check`：28 个 JSON、154 个 JavaScript、10 个页面通过结构、语法与微信模块引用兼容性检查。
- `git diff --check`：通过。
- 微信开发者工具模拟器已覆盖资讯、详情、精选、专栏、简报和我的页面；本轮额外验证 Agent 第一/第二张完整海报手动滑动及 Skill 独立海报加载，控制台没有新增红色错误，频道锁和数字移除已确认。
- 专栏 18 张原始 PNG 保留在 `png/`；运行时统一使用 640×853 非渐进式基线 JPEG，总计 1,603,890 bytes。`swiper` 不使用组件 `lazy-load`，而是显式加载“当前页 + 下一页”：未展开 0 张，展开首屏 2 张，滑动后才加载第 3 张。CLI 新预览实际包体为 1,786,530 bytes；手机旧预览只显示容器背景的问题仍需扫描新二维码复验。
- 微信开发者工具后续默认按 [CLI 优先工作流](concepts/WeChatDevToolsCLI.md) 启动和操作：`D:\Apps\miniprogram\cli.bat auto --project D:\miniprogram --port 9420 --trust-project`；当前 `auto`、`open`、`islogin` 和回环监听已验证。自动化结束只断开连接，不结束 renderer、不调用 CLI `close`，并把 IDE 留在可验收页面。
- 微信开发者工具此前已重新编译资讯首页与详情并清除项目级红色错误；2026-07-17 的自动/手动轮播与整组全屏预览已通过页面逻辑和标记测试，仍需在真机覆盖 1、5、8 张、从中间图片进入全屏和返回后继续轮播。

## 云端与端到端状态

- 旧业务的 41 个函数、24 个集合、2,456 条文档、217 个存储对象和 `adminportal/` 已清理。
- 环境级空存储桶、平台认证文件、AppID 关联和标准版套餐被保留。
- 12 个当前集合均由云函数管理；资讯新增集合保存独立条目、日索引、同步状态、管理员授权和迁移进度。
- 四个 Node.js 18.15 云函数已部署；`knowledgeFeed` 为 Active/Available，512 MB、300 秒、0.4 vCPU，单一每分钟定时触发器；`knowledgeOps` 无触发器且受维护令牌保护。部署时状态为条目 3,090、分析/任务/简报/会员均为 0。新增集合为 `ADMINONLY`，条目、分析任务和简报复合索引已创建。分钟日志确认缩略图 worker 继续 2/2，真实 intelligence 和 digests 为 disabled。
- 真实微信上下文已验证：保存偏好 → 导入文章 → 生成临时摘要 → 保留结论卡 → 统计更新 → 清除个人数据。
- 环境“超限按量”关闭；未自动开启新的 AI 付费方案。

详细证据见 [微信端到端验证与运行时修复](sources/2026-07-15-wechat-e2e-and-runtime-fixes.md)。

## 尚未完成的外部操作

1. 为娱乐、社会、游戏和英语分别选择内容源，并实现跨来源去重、优先级和审核机制。
2. 在 AI HOT 之外分别接入重点厂商官方源，避免把聚合源误标为官方直连。
3. 如需微信内直接打开原文，先确认小程序主体支持 `web-view`，再在微信公众平台验证需要开放的业务域名并加入 `DIRECT_WEBVIEW_HOSTS`。
4. 用户决定是否开通资源点/成长套餐或配置自有模型，以启用真正 AI 摘要、翻译和相关性判断。
5. 按 CLI 优先工作流预览并上传体验版，不直接提交公开审核；扫码、验证码和审核确认仍由用户完成。
6. 用户提供 AI API 后，在测试环境回填最近 30 天；覆盖至少 95% 且人工抽检通过后再开启真实精选和简报。
7. 当前管理员可完成普通/Pro/管理员页面和权限预览；仍需第二个微信账号验证真实会员到期、宽限、撤销和续费状态，并补充 25,000 条规模 P95 报告。
8. 支付最后接入；正式启用汇付前完成产品开通、签约、解约、回调验签、主动查询、退款和沙箱回放。
9. 正式收费前把 AI 专栏完整正文迁移到服务端重鉴权内容接口；聚焦截图已完成并保留整页协议回滚能力，后续仅在真实误判样本证明有必要时再评估视觉模型兜底。

## 已被替代的旧结论

- “正式 Git 根是 `D:\miniprogramcode`、当前分支为 `my-work`”已被当前工作仓库和重建分支替代。
- “产品方向未确定”已被 [“别收藏了”首版决策](decisions/2026-07-13-digest-inbox-v1.md) 替代。
- “产品不提供资讯流”已被 [编辑索引式知识平台首页决策](decisions/2026-07-15-editorial-knowledge-platform-ui.md) 替代；旧摘要闭环继续作为迁移基础。
- “真实微信身份和数据库闭环未验证”已在 2026-07-15 被端到端结果替代。
- “AI 失败不入队”已被 [透明临时摘要决策](decisions/2026-07-15-ai-quota-fallback.md) 替代。
- “精选一百余条就是全部资讯、无视觉不公开”已被 [全量资讯存储与服务端角色权益](decisions/2026-07-17-full-feed-and-role-entitlements.md) 替代。
- “只有 free/admin 且管理员默认 90 天”已被 [单一 Pro 会员、能力型权益与可回溯简报](decisions/2026-07-17-pro-membership-and-intelligence.md) 替代。
