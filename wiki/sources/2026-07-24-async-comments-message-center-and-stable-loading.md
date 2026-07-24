---
title: "异步评论、站内消息、稳定加载与会员绑定上线"
type: source
tags: [comments, moderation, messages, loading, payment, deployment, preview]
source_date: 2026-07-24
last_updated: 2026-07-24
status: confirmed
confidence: high
---

# 异步评论、站内消息、稳定加载与会员绑定上线

## 结论

- 评论与资料现均为“立即提交、后台审核、通过后公开”。用户本人可立即看到审核中
  状态，模型延迟或暂时失败不再表现为输入界面的长时间转圈。
- “我的”页新增站内消息中心，统一承载会员订阅成功、资料审核、评论审核和同一资讯
  收到新评论的结果；未读数与消息已读状态跨页面保持。
- 所有 CloudBase Qwen 任务显式使用无思考模式，Packy/Grok 固定最低推理强度。
- 全部主要懒加载页面统一展示转圈，后台换签、轮询、喜爱和收藏只更新局部字段，
  不再清空或整页重绑当前内容。
- 会员购买前重新完成微信登录握手并校验身份一致。登录用于绑定 OpenID，不自动取得
  头像昵称；展示资料继续使用微信当前要求的主动选择流程。
- iOS 开发版/体验版在满足微信条件时可以使用真实环境虚拟支付；开发者工具模拟器
  不能完成支付。错误 `-15013` 表示传入原价与微信商品后台原价不一致，不是
  “预览版禁止支付”。

## 评论审核与治理

- 新评论以确定性 ID 写入 `knowledge_feed_comments` 的私有 `pending` 状态；同一
  评论的网络重试幂等返回，不重复进入限流和公开计数。
- 同一所有者与资讯 30 秒内只接受一条新评论，滚动 24 小时最多 30 条。限流记录与
  评论文档在现有互动事务内同时写入。
- 后台 worker 使用 `pending/retry/processing`、到期租约、claim 和版本校验；
  允许结果才事务发布并写消息 outbox。拒绝结果清除正文和附件引用，附件进入受限
  清理；永久失败保留可通知但不含公开内容的状态。
- 公开列表只返回 `active` 评论；作者和管理员可读取必要的私有状态。已有举报、
  删除、申诉和恢复生命周期继续作用于通过后的评论。

## 站内消息可靠性

- 新增 `knowledge_message_events` 与 `knowledge_user_messages`，均为
  `ADMINONLY`。事件 ID 可确定重放，用户消息按事件或所有者+资讯聚合。
- 单批最多 20 位收件人，消息写入和 `deliveredOwnerKeys` checkpoint 在同一事务
  完成；每批最多 42 个事务操作，低于数据库 100 操作限制。过期 worker 不能用旧
  claim 覆盖新投递。
- 直接事件重放保留已读状态；聚合消息使用 `sourceEventId` 版本令牌，旧的已读请求
  不能清除更新后的通知。全部已读严格按打开页面时的 cutoff 处理，不会误读之后到达
  的消息。
- 客户端消息操作全局串行，异步响应在写入页面前复核查看者 scope 和 generation；
  账号变化或旧响应不得进入新账号缓存。

## 页面加载与阅读稳定性

- 新增全局 `components/loading-state`，接入全部、专栏、简报、精选、课程阅读器、
  详情、收藏、资料、资料编辑、消息以及懒加载媒体。
- 已有内容在后台刷新期间继续显示；媒体壳预留高度，避免图片换签时版面塌陷。
- 资讯轮询只更新固定提示层，不替换列表；喜爱、收藏、当前详情和媒体续签使用叶子
  `setData`。收藏页重新进入不先清空列表，详情页保留轮播索引、自动播放和来源展开
  状态。

## 会员身份与价格

- 支付按钮现为“登录微信并订阅”。客户端每次购买先调用 `wx.login`，服务端
  `code2Session` 后确认返回 OpenID 与当前 CloudBase actor 一致；不一致时拒绝建单。
- `goodsPriceCents` 独立配置，默认 590 分；界面比较价 1090 分不再被当作微信商品
  原价。当前 590/590 不发送活动价，避免 `-15013`。
- `membershipBilling` 无参数生产冒烟返回计划可售、当前价 590 分、比较价 1090 分。
  若真机仍返回 `-15013`，应在微信虚拟支付商品后台确认该商品原价也是 590 分。
- 会员成功事件与付费订单/权益在同一事务写入；对账只补缺失事件，不重复通知。

## 验证与生产部署

- 业务代码提交为 `2db8dce`。完整 `npm.cmd run verify` 通过：617/617 个 Node
  测试，32 个 JSON、300 个 JavaScript、12 个注册页面；覆盖率为行 80.37%、
  分支 68.89%、函数 77.27%，生产依赖审计与 `git diff --check` 均通过。
- 生产控制面收敛为 25/25 个合同集合、43/43 个合同索引和 25 份数据库规则；
  5 个非合同集合保留，四个函数 manifest 0 漂移。
- 新增评论审核、消息事件和用户消息索引后，`knowledgeFeed` 与
  `membershipBilling` 已强制部署并恢复可用。生产计划冒烟显示 30 天会员 5.9 元，
  比较价 10.9 元。
- 最新微信开发预览包为 457,142 bytes，二维码由已登录开发者工具生成；自动验证和
  云端回读不能替代真实新账号评论/资料与真实资金 canary。

## 消息推送配置边界

微信后台“消息推送配置”是微信服务器向开发者 URL 转发用户消息、客服消息或平台
事件的入站 webhook。它不负责本次站内消息中心，不是向用户主动发送通知，也不会
拉起支付。若未来需要微信系统级订阅通知，仍需单独申请模板，并由用户在具体场景
主动授权。

## 剩余人工验证

1. 新账号扫码，提交头像昵称和评论，确认立即出现“审核中”，随后在消息中心收到
   通过、拒绝或失败结果；另一位参与者确认收到同一资讯的新评论聚合提醒。
2. 在全部、专栏、简报、精选、详情和收藏页覆盖弱网、前后台切换及连续喜爱/收藏，
   确认转圈只出现在加载区域，当前列表、滚动位置和媒体不闪白。
3. iPhone 真机在确认会真实扣款后测试支付；若出现 `-15013`，只记录错误码并核对
   微信商品后台原价 590 分，不复制订单号、签名或完整支付参数。

## 官方参考

- CloudBase 大模型调用参数：
  https://cloud.tencent.com/document/product/1823/132247
- CloudBase 资源点：
  https://cloud.tencent.com/document/product/876/127357
- 微信登录：
  https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html
- 微信头像昵称填写：
  https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/userProfile.html
- 微信虚拟支付：
  https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
- 微信虚拟支付 iOS 说明：
  https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/ios.html
- 微信小程序消息推送：
  https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html

## 安全与隐私

本记录不包含用户标识、订单号、评论正文、昵称、头像或附件 File ID、支付签名、
请求 ID、原始日志、环境变量值或回调密钥。
