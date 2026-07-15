---
title: "AI HOT 图文资讯源接入与云端验证"
type: source
tags: [aihot, knowledge-feed, cloudbase, cover-images, editorial-index]
sources: [../../hyyc/cloudfunctions/knowledgeFeed, ../../hyyc/pages/inbox, ../../hyyc/pages/feed-detail, ../../cloudbaserc.json]
last_updated: 2026-07-15
status: confirmed
confidence: high
---

# AI HOT 图文资讯源接入与云端验证

## Provenance

- Source path / origin: AI HOT 公开 API、原文公开元数据、当前小程序代码、CloudBase CLI/API 与微信开发者工具模拟器
- Date observed: 2026-07-15
- Scope: AI/科技公共资讯流、来源追踪、封面缓存、频道映射和详情页
- Status: confirmed for the current selected feed; other editorial channels remain not connected
- Confidence: high

## 接口契约

- 读取 `https://aihot.virxact.com/api/public/items?mode=selected&take=100`，使用可识别的非浏览器 User-Agent，并按 `nextCursor` 继续分页；本地上限 120 条。
- 上游公开说明确认：`selected` 默认取近 7 天编辑精选，`take` 范围 1–100，支持 `category`、`q`、`cursor` 和 `fields`；更早内容会被截断。当前两页实测合计 108 条，而不是旧实现固定请求的 20 条。
- 上游条目提供标题、中英文标题、摘要、原文链接、规范链接、来源、发布时间、分类、热度和 attribution；接口本身不提供图片字段或主题标签。小程序公开返回已移除聚合平台名称、规范链接和 attribution，只保留展示资讯所需字段；封面字段允许为空，不再作为公开列表门槛。
- AI HOT 分类映射为：`ai-models`、`ai-products`、`paper`、`tip` → AI 前沿；`industry` → 科技。
- 参考 `/topics` 的信息架构，本地用标题、英文标题、摘要和来源做确定性主题归类：15 个“公司与模型”主题、14 个“技术方向”主题。公开接口没有返回这些主题，因此该归类是本项目实现，不能宣称为上游官方标签。
- 娱乐、社会、游戏和英语不使用 AI HOT 内容冒充覆盖，页面明确显示这些频道仍待接入独立来源。

## 图文策略

- 首页展示全部 108 条缓存资讯。具有真实原文 Open Graph/Twitter 图片时显示图片；没有图片的 95 条使用纯文字编辑行，不生成或绘制替代封面，也不显示空白图片框。
- 外站图片只允许公网 HTTPS，限制重定向、超时、内容类型和 2.5MB 体积；通过服务端下载后写入当前 CloudBase 存储，前端不直接依赖任意第三方图片域名。
- 当前对 108 条候选完成一次整池封面检查，成功缓存 13 张真实原文封面；其余条目可能没有公开元图片，或受境外站点网络、反爬和重定向限制，但不再因此隐藏。原图补抓与资讯同步分离，避免外站超时拖慢首页。
- 详情页只保留原文链接，不显示聚合平台规范链接，也不复制原文正文；原文操作仅对已验证业务域名直开，其他来源复制链接供浏览器打开。

## 云端资源

- 新建 `knowledge_feed_cache` 集合，权限在创建时设为 `ADMINONLY`。
- 新增并部署 `knowledgeFeed` 云函数：Node.js 18.15、256MB、60 秒上限。
- 资讯缓存 TTL 为 15 分钟，使用 ETag 条件请求；刷新失败且已有缓存时返回 stale 数据。
- 缓存只含公共资讯字段、来源 attribution 和云存储封面 ID，不含 OpenID、用户偏好或其他个人信息。
- 封面对象位于 `knowledge-covers/aihot/`，本次验证时共 13 个可用对象。

## 网络路径

- 生产环境的资讯列表请求、分页和封面抓取都从腾讯云 CloudBase 的 `knowledgeFeed` 云函数发起，不借用开发者或小程序用户的本地网络。
- 前端图片使用已缓存的 `cloud://` 文件，不让小程序直接连接任意境外图片主机。
- 开发阶段用本机浏览器检查公开接口说明和 Topics 页面时会经过开发者电脑网络；这只用于核对设计和契约，不是线上采集路径。
- 用户主动复制原文链接并在自己的浏览器打开后，原站访问才会使用用户自身网络；部分境外来源可能较慢或不可达。

## 页面实现

- `pages/inbox/index` 读取并公开近 7 天 108 条精选缓存；有图、无图条目均可进入首页和详情。
- 频道下方提供时间、公司与模型、技术方向三组组合筛选。筛选项附带当前频道的结果数，零结果选项不可选；默认近 7 天显示完整 108 条，不向用户暴露聚合或接口实现。
- 首页已撤下“我的待处理”、主动导入文章、关注方向和设置入口，只呈现频道与公共资讯流。
- `pages/feed-detail/index` 展示可选封面、标题、来源、发布时间、30 秒导读、完整上游摘要分段、三条相关阅读及原始出处操作；无图主稿和无图相关阅读均使用纯文字布局。
- 公开返回会清除来源名称中的 RSS 和翻译中转后缀，例如只显示 `TechCrunch` 或 `Hacker News`。
- 新增 `pages/source-view/index` 作为已验证业务域名的承载页；当前白名单为空，现有外部来源均走复制链接兜底。
- 空频道只显示通用的内容补充提示，不暴露来源接入状态，也不用假数据填满娱乐、社会、游戏和英语。

## 验证结果

- 云端强制刷新成功读取两页、合计 108 条真实精选内容，返回 `windowDays: 7` 和 `totalAvailable: 108`。
- 重新部署后线上公开响应为 108 条：13 条带 `cloud://` 真实来源图片，95 条封面为空；两类内容均可展示，没有生成或绘制替代封面。
- 微信开发者工具重新编译并渲染：首页默认显示精选 108、AI 前沿 82、科技 26；有图与纯文字行混排，无图条目可进入详情。
- 筛选弹层改为固定高度的独立滚动区，顶部每次从时间范围开始，向下可查看完整技术方向；底部重置/查看按钮不再覆盖选项。
- 线上单条详情抽查 `Anthropic 推出 Claude for Teachers`：摘要长度 361 字，完整返回、不含人工省略号，并带 3 条有图相关阅读和原文 URL。
- 公司与模型、技术方向使用本地确定性测试覆盖；时间、公司和方向可组合过滤，选项结果数和空选项禁用均有单元测试。
- `npm test` 为 52/52；`npm run check` 检查 20 个 JSON、51 个 JavaScript 和 6 个页面通过；`git diff --check` 无空白错误。

## 边界与后续

- 当前只完成 AI HOT 的 AI/科技精选源，不等同于 OpenAI、Grok、GLM、DeepSeek 各厂商官方源已分别直连。
- AI HOT 是测试版公开 API，生产可用性依赖本地缓存、重试和 stale 回退；当前实现已具备这些基本保护。
- 旧的“只公开 13 条有图内容”规则已经 `superseded`；当前 108 条全部公开。后续仍可改善真实图片获取，但图片命中率不再影响资讯是否可见。
- 后续应分别接入娱乐、社会、游戏和英语来源，并建设跨来源去重、审核、来源优先级和定时封面维护。
