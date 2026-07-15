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

- 固定读取 `https://aihot.virxact.com/api/public/items?mode=selected&take=20`，使用可识别的非浏览器 User-Agent。
- 上游条目提供标题、中英文标题、摘要、原文链接、AI HOT 规范链接、来源、发布时间、分类、热度和 attribution；接口本身不提供图片字段。小程序公开返回已移除聚合平台名称、规范链接和 attribution，只保留展示资讯所需字段，并在云函数层过滤掉无真实封面的条目。
- AI HOT 分类映射为：`ai-models`、`ai-products`、`paper`、`tip` → AI 前沿；`industry` → 科技。
- 娱乐、社会、游戏和英语不使用 AI HOT 内容冒充覆盖，页面明确显示这些频道仍待接入独立来源。

## 图文策略

- 首页只展示具有真实原文 Open Graph/Twitter 图片的资讯；没有真实图片的条目不进入公开列表，也不生成或绘制替代封面。
- 外站图片只允许公网 HTTPS，限制重定向、超时、内容类型和 2.5MB 体积；通过服务端下载后写入当前 CloudBase 存储，前端不直接依赖任意第三方图片域名。
- 当前已缓存并登记 7 张真实原文封面，原图补抓与资讯同步分离，避免外站超时拖慢首页。
- 详情页只保留原文链接，不显示聚合平台规范链接，也不复制原文正文；原文操作仅对已验证业务域名直开，其他来源复制链接供浏览器打开。

## 云端资源

- 新建 `knowledge_feed_cache` 集合，权限在创建时设为 `ADMINONLY`。
- 新增并部署 `knowledgeFeed` 云函数：Node.js 18.15、256MB、60 秒上限。
- 资讯缓存 TTL 为 15 分钟，使用 ETag 条件请求；刷新失败且已有缓存时返回 stale 数据。
- 缓存只含公共资讯字段、来源 attribution 和云存储封面 ID，不含 OpenID、用户偏好或其他个人信息。
- 封面对象位于 `knowledge-covers/aihot/`，本次验证时共 7 个对象。

## 页面实现

- `pages/inbox/index` 以 AI HOT 20 条精选作为公共首页主流，实测频道计数为 AI 前沿 16、科技 4。
- 首页已撤下“我的待处理”、主动导入文章、关注方向和设置入口，只呈现频道与公共资讯流。
- `pages/feed-detail/index` 展示封面、标题、来源、发布时间、30 秒导读、三条关键信息、三条有图相关阅读及原始出处操作；英文标题和热度表已从用户界面移除。
- 公开返回会清除来源名称中的 RSS 和翻译中转后缀，例如只显示 `TechCrunch` 或 `Hacker News`。
- 新增 `pages/source-view/index` 作为已验证业务域名的承载页；当前白名单为空，现有外部来源均走复制链接兜底。
- 空频道只显示通用的内容补充提示，不暴露来源接入状态，也不用假数据填满娱乐、社会、游戏和英语。

## 验证结果

- 首次云端同步成功返回 20 条真实 AI HOT 精选内容。
- 调整后缓存刷新约 973ms，缓存读取和单条详情实测约 50–70ms。
- 7 个原文封面对象已在 CloudBase 存储清单中确认；已登记封面的详情接口返回对应 `cloud://` 文件 ID。
- 微信开发者工具重新编译并渲染：首页仅显示 7 条真实有图资讯，其中 AI 前沿 3、科技 4；首屏没有项目总说明、个人队列、导入入口或接入技术文案。
- 线上 `knowledgeFeed` 重新部署并调用成功；公开响应为 7 条、缺图数为 0，且不再包含顶层 provider/source URL、条目 permalink 或 attribution。
- 线上单条详情调用成功返回 3 条相关阅读，3 条均带真实图片。
- `npm test` 为 45/45；`npm run check` 检查 20 个 JSON、46 个 JavaScript 和 6 个页面通过。

## 边界与后续

- 当前只完成 AI HOT 的 AI/科技精选源，不等同于 OpenAI、Grok、GLM、DeepSeek 各厂商官方源已分别直连。
- AI HOT 是测试版公开 API，生产可用性依赖本地缓存、重试和 stale 回退；当前实现已具备这些基本保护。
- 后续应分别接入娱乐、社会、游戏和英语来源，并建设跨来源去重、审核、来源优先级和定时封面维护。
