---
title: "知识获取平台小程序项目总览"
type: overview
tags: [overview, miniprogram, wechat, knowledge-platform, editorial-index]
sources: [sources/2026-07-13-digest-inbox-implementation.md, sources/2026-07-14-cloud-cleanup-and-deployment.md, sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, sources/2026-07-15-editorial-ui-implementation.md, sources/2026-07-15-aihot-feed-integration.md, sources/2026-07-16-modular-refactor.md, decisions/2026-07-15-engaging-news-detail.md, decisions/2026-07-16-modular-architecture.md]
last_updated: 2026-07-16
status: confirmed
confidence: high
---

# 知识获取平台小程序项目总览

## 一句话说明

这是一个从个人文章消化箱迁移为编辑型知识获取平台的微信小程序：当前后台保留近 7 天 AI/科技资讯池，首页以非卡片式结构首屏加载 8 条、触底再追加 8 条，并可按时间、公司与模型、技术方向筛选；默认按发布时间从新到旧，也可在相同筛选范围内切换为热度从高到低。有图时显示真实原图，无图时使用纯文字编辑行。详情用可选图片、30 秒导读、完整上游摘要分段和相关阅读降低阅读负担。个人导入/待处理流程已从首页撤下，娱乐、社会、游戏和英语仍待各自内容源。

## 事实健康表

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| AppID、云环境 ID、Git 历史和远程地址已保留 | confirmed | 项目配置、应用入口、Git 命令 |
| 旧社区、商品、任务、聊天、实名、定位、钱包、支付和图片审核代码已从活跃树移除 | confirmed | 当前文件树与重建历史 |
| 6 个页面、3 个云函数及本地测试已实现 | confirmed | 当前代码、66 个 Node 测试 |
| 旧云资源清空及 5 个新集合创建 | confirmed | 2026-07-14 CloudBase 清单与复核 |
| `digestIngest`、`digestStore` 已部署 | confirmed | 两函数部署结果与云端日志 |
| 真实 OpenID、数据库闭环和开发者工具编译 | confirmed | 2026-07-15 微信开发者工具端到端验证 |
| 编辑索引式首页与频道视觉系统 | confirmed | 2026-07-15 Moodboard 选择、当前代码和模拟器编译 |
| AI/科技精选聚合、最新/热度排序、服务端分页、筛选、缓存和原始来源追踪 | confirmed | 2026-07-16 线上验证最新倒序、热度倒序及热度与时间筛选组合通过 |
| 知识资讯主链路按 feature/adapter/repository/service/presenter 分层 | confirmed | 2026-07-16 模块化重构、边界测试与 CloudBase 接口回归 |
| 完整摘要分段和相关阅读 | confirmed | 无图详情实机打开、云端摘要无人工省略、3 条相关阅读 |
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

上述代码和云函数仍保留，但首页已撤下待处理数量、导入入口、关注方向设置提示和个人队列。当前公开体验不提供任意网页全文、自动剪贴板监听、支付、广告、会员、登录页、定位、推送或全文翻译；已接入的聚合精选仍不等同于各厂商官方源分别直连。

## 代码与数据

- 页面：`pages/inbox/index`（纯资讯首页）、`pages/feed-detail/index`（短读公共资讯详情）、`pages/source-view/index`（仅承载已验证域名）；`pages/digest/index`、`pages/cards/index`、`pages/settings/index` 仍在代码中，但首页不再提供个人导入/待处理入口。
- 小程序模块：`features/knowledge-feed/` 拥有资讯配置、频道、筛选、阅读、列表/详情模型和 API；`features/digest/` 拥有保留的个人消化 API/展示转换；`services/cloud-functions.js` 是两个能力共享的唯一 CloudBase 传输层。
- 资讯云函数模块：`adapters/` 隔离外部资讯源，`repositories/` 隔离缓存集合，`services/` 编排查询/缓存降级和封面维护，`presenters/` 约束公开 DTO；`knowledgeFeed/index.js` 只装配依赖和路由 action。
- 首页频道：精选、AI 前沿、科技、娱乐、社会、游戏、英语；当前聚合源覆盖前两类，其他频道保留真实空状态。
- 首页筛选：24 小时、近 3 天、近 7 天；15 个公司与模型主题；14 个技术方向。三个维度可组合，选项显示当前资讯数，零结果项不可选；弹层内容独立滚动，底部操作区不覆盖主题。
- 首页排序：默认“最新”，显式按发布时间从新到旧；切换“热度”后先应用频道、时间、公司/模型和技术方向筛选，再按上游热度值从高到低排列，同热度按发布时间从新到旧。排序切换会从第一页重新加载。
- 首页资讯分页：云函数先按频道和筛选条件过滤，再下发当前 8 条完整资讯；第一页同时携带轻量筛选索引，触底后用 `nextOffset` 每次追加 8 条。切换频道、应用筛选和下拉刷新都会从第一页重新开始，重复触底请求会被前端状态锁阻止。
- 视觉基线：`styles/editorial-tokens.wxss`，以米白纸张、黑色排版、细线和单一频道色建立层级。
- 云函数：`hyyc/cloudfunctions/digestIngest`、`hyyc/cloudfunctions/digestStore`、`hyyc/cloudfunctions/knowledgeFeed`
- 集合：`digest_queue`、`conclusion_cards`、`user_state`、`daily_stats`、`usage_monthly`、`knowledge_feed_cache`
- 公共资讯缓存 15 分钟并使用 ETag；近 7 天内容池随上游更新，2026-07-16 线上验证时为 106 条。原文封面经安全校验后写入 `knowledge-covers/aihot/`；缺图条目以纯文字展示，不生成几何替代图或空白占位。
- 生产资讯同步和外站封面请求由腾讯云 CloudBase 云函数发起，不使用开发者或小程序用户的本地网络；用户主动在浏览器打开原文时才使用自己的网络。
- 用户界面不显示 AI HOT、API、缓存、规范链接等接入实现，只显示资讯的原始发布方和原文链接。
- 来源标签会清除 RSS、翻译中转等采集方式后缀，不把技术管道暴露给用户。
- 详情页不复制原文正文：导读和“完整内容”完整保留上游摘要并按语义单元分段，不再按字符裁剪或添加人工省略号；相关阅读只选真实有图条目。
- `DIRECT_WEBVIEW_HOSTS` 当前为空；在微信公众平台完成业务域名验证前，原文入口复制链接供浏览器打开，不强行进入 `web-view`。
- 身份只取自云函数上下文；数据库使用 OpenID 的 SHA-256 派生值，不保存原始 OpenID。
- 原始正文只在函数内存中参与处理，不写数据库或云存储。
- 降级结果携带 `processingMode: local_fallback`，前端明确提示其不是 AI 翻译或相关性判断。
- 不保存昵称、手机号、位置、实名资料、支付信息或全文。

## 安全与成本

- 只接受默认 443 端口的 HTTPS；拒绝凭据、内网、保留 IP 和微信公众平台文章。
- DNS 解析后绑定已校验的公网 IP 建立 HTTPS 连接，并在每次重定向后重新校验。
- 最多 3 次重定向、响应最大 2MB、正文最多 12,000 字符。
- 当前 AI 提供方为 `hunyuan-v3`，模型为 `hy3-preview`；可通过环境变量切换。
- AI 调用前事务预留预算，成功后结算实际 Token 成本；每月 10 元硬上限。
- AI 额度错误会释放预算预留并进入本地临时摘要，不产生伪造的 AI 用量记录。
- 腾讯云自动化凭据仅保存在被 Git 忽略且受本机 ACL 限制的 `wiki/secrets/`，普通 Wiki 不含实际值。

## 本地验证

- `npm test`：66/66 通过。
- `npm run check`：19 个 JSON、64 个 JavaScript、6 个页面通过结构与语法检查。
- `git diff --check`：通过。
- 微信开发者工具已打开当前项目并加载资讯首页；本轮分页的结构、语法、云端返回和页面状态由静态检查、线上函数调用及模拟器画面共同核验。

## 云端与端到端状态

- 旧业务的 41 个函数、24 个集合、2,456 条文档、217 个存储对象和 `adminportal/` 已清理。
- 环境级空存储桶、平台认证文件、AppID 关联和标准版套餐被保留。
- 6 个当前集合均为 `ADMINONLY`；其中 5 个个人业务集合无测试记录，`knowledge_feed_cache` 保存公共资讯缓存。
- 三个 Node.js 18.15 云函数已部署；`knowledgeFeed` 当前使用服务端排序与分页，并已部署模块化版本。2026-07-16 重构后线上回归：内容池随上游更新为 105 条，“最新”前 3 条按时间倒序；“热度 + 24 小时”先筛为 19 条，前 3 条热度为 82、78、78；有效详情返回 3 条相关阅读，无效 ID 返回稳定 `ITEM_NOT_FOUND`。无图条目和无图相关阅读仍能打开详情；公开响应已移除聚合平台页面、归因和平台标识字段。
- 真实微信上下文已验证：保存偏好 → 导入文章 → 生成临时摘要 → 保留结论卡 → 统计更新 → 清除个人数据。
- 环境“超限按量”关闭；未自动开启新的 AI 付费方案。

详细证据见 [微信端到端验证与运行时修复](sources/2026-07-15-wechat-e2e-and-runtime-fixes.md)。

## 尚未完成的外部操作

1. 为娱乐、社会、游戏和英语分别选择内容源，并实现跨来源去重、优先级和审核机制。
2. 在 AI HOT 之外分别接入重点厂商官方源，避免把聚合源误标为官方直连。
3. 如需微信内直接打开原文，先确认小程序主体支持 `web-view`，再在微信公众平台验证需要开放的业务域名并加入 `DIRECT_WEBVIEW_HOSTS`。
4. 用户决定是否开通资源点/成长套餐或配置自有模型，以启用真正 AI 摘要、翻译和相关性判断。
5. 在微信开发者工具中预览并上传体验版，不直接提交公开审核。
6. 根据新的知识平台目标重写 30 天验证指标。

## 已被替代的旧结论

- “正式 Git 根是 `D:\miniprogramcode`、当前分支为 `my-work`”已被当前工作仓库和重建分支替代。
- “产品方向未确定”已被 [“别收藏了”首版决策](decisions/2026-07-13-digest-inbox-v1.md) 替代。
- “产品不提供资讯流”已被 [编辑索引式知识平台首页决策](decisions/2026-07-15-editorial-knowledge-platform-ui.md) 替代；旧摘要闭环继续作为迁移基础。
- “真实微信身份和数据库闭环未验证”已在 2026-07-15 被端到端结果替代。
- “AI 失败不入队”已被 [透明临时摘要决策](decisions/2026-07-15-ai-quota-fallback.md) 替代。
