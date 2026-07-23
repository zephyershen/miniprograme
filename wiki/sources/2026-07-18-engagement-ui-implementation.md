---
title: "资讯互动、收藏记录、微信分享与会员转化界面实施证据"
type: source
tags: [engagement, cloudbase, membership, ui, verification]
date: 2026-07-18
last_updated: 2026-07-18
status: confirmed
confidence: high
---

# 资讯互动、收藏记录、微信分享与会员转化界面实施证据

## 实现

- `knowledgeFeed` 新增 `toggleLike`、`toggleFavorite`、`comments`、`addComment`、`favorites` 五个公开 action；每次都从真实微信上下文解析用户和权益。
- `knowledge_feed_user_engagements` 保存每用户每资讯的喜爱、收藏状态和紧凑收藏快照；`knowledge_feed_comments` 保存会员评论。两张表均为 `ADMINONLY`，并分别建立 `ownerKey`、`itemId` 单字段索引。
- 喜爱切换在事务中同步更新 `likeCount` 和 `score = baseScore + likeCount`；资讯源刷新保留互动计数，不会把热度贡献覆盖掉。
- 收藏页增加紧凑单行列表，旧内容超出当前历史权限时仍可取消收藏，但打开详情会重新鉴权。
- 评论在详情底部面板中按新到旧展示，内容去除多余空白并限制为 280 字。免费用户不能调用读取或发布接口。
- 资讯卡和详情均使用微信原生分享按钮，分享结果包含标题、详情路径和可用的列表缩略图。
- 精选、评论、30 天历史、AI 专栏和简报锁定场景统一接入会员转化组件；内测期继续不展示价格和付款。

## 云端证据

- 两张新表创建成功，ACL 复核为 `ADMINONLY`；索引更新请求成功。
- `knowledgeFeed` 于 2026-07-18 23:29 重新部署，函数状态为 `Deployment completed`。
- 开发者工具真实微信上下文完成喜爱开启/关闭、收藏开启/关闭、收藏页单行记录、会员评论读取和分享 payload 验证。喜爱时条目热度从 38 增至 39，取消后恢复；测试产生的喜爱和收藏状态均已还原。
- 评论列表真实调用返回空数组且会员权限为可用；分享路径从列表和详情均返回同一个带资讯 ID 的详情路由。

## 本地与模拟器证据

- `npm test`：185/185 通过，其中新增覆盖存储热度初始化、匿名确定性身份、free/member 权限、评论校验和客户端展示格式。
- `npm run check`：29 个 JSON、162 个 JavaScript、10 个页面通过。
- `git diff --check`：通过；微信开发者工具 CLI 预览通过，包体 1,826,626 bytes。
- 模拟器截图确认资讯卡的四个动作、选中态、首卡不再被新资讯提示遮挡，以及会员转化卡的蓝白编辑样式。

## 外部设计与平台资料

- Apple HIG：<https://developer.apple.com/design/human-interface-guidelines?lang=en>
- Paul Robert Lloyd, The Week：<https://paulrobertlloyd.com/projects/the_week/>
- Clearleft, evo car magazine app：<https://clearleft.com/work/evo-car-magazine-app>
- 腾讯云修改数据库权限：<https://cloud.tencent.com/document/product/876/34819>
- 腾讯云更新表索引：<https://cloud.tencent.com/document/product/876/127964>

## 敏感信息处理

普通 Wiki 不记录 OpenID、派生 owner key、账号、密码、令牌、自动化握手值或临时会话。端到端查询只核对状态与结果，测试后恢复用户互动状态。

## 尚未验证

- 实际发送给另一位微信好友后，由接收端点击卡片进入详情。
- 使用第二个真实微信账号完成免费、Pro 到期、撤销和续费矩阵。
- 体验版上传和 iPhone/Android 双机主观视觉验收。
