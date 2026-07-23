---
title: "资料审核、付费内容保护与斗拱会员支付实施证据"
type: source
tags: [profile, moderation, payment, huifu, paid-content, deployment]
source_date: 2026-07-19
last_updated: 2026-07-19
status: confirmed
confidence: high
---

# 资料审核、付费内容保护与斗拱会员支付实施证据

## 范围

本轮按产品负责人要求只保留评论文本/图片和公开资料审核，不增加举报、评论删除、申诉或自动隐藏。昵称与头像在保存公开资料前走同一 Packy/Grok 严格审核合同；拒绝、不确定、模型不可用或头像短期地址失败均不保存，新上传且未采用的头像会删除。

隐私文案删除“不保存昵称”，只说明不保存手机号、位置、实名信息或网页全文。代码检索确认用户界面没有举报、申诉、自动隐藏或删除评论入口。

## 付费内容

- 客户端 `features/ai-column/catalog.js` 只保留公开课程路线；完整内容经 `features/ai-column/api.js` 请求 `knowledgeFeed.columnContent`。
- 云端 `column-content-service.js` 重新鉴定 `ai_column` 权益，并把 `content/ai-column-media.js` 中的文件 ID 换成临时地址。
- 18 张包内海报副本已删除，原始设计资产仍保留在项目 `png/`，云端高清资源未删除。
- CloudBase 云存储规则已从 `READONLY` 改为 `CUSTOM`：仅既有公开资讯/用户媒体前缀允许客户端读取，`ai-column/` 不允许客户端直接读取。

## 支付实现与云端状态

- 新增 `membershipBilling` 的 config、签名、斗拱 adapter、订单 repository、billing service 和路由入口；采用 RSA-SHA256、首层 ASCII 排序和原始回调 `resp_data` 验签。
- 下单接口为斗拱 `/v3/trade/payment/jspay`，`trade_type=T_MINIAPP`；查单接口为 `/v3/trade/payment/scanpay/query`。客户端使用返回的 `pay_info` 调用 `wx.requestPayment`。
- 会员只在回调或主动查询确认成功后通过 CloudBase 事务发放；前端成功回调不能直接写会员。
- `membershipBilling` 与更新后的 `knowledgeFeed` 已部署为 Node.js 18.15，状态为 `Deployment completed`。
- `/hyyc/membership/notify` 已映射到 `membershipBilling`；公网 GET 探测返回 HTTP 405。
- `knowledge_membership_orders` 已创建；它和 `knowledge_memberships` 的 ACL 均实测为 `ADMINONLY`。
- 由于生产商户号、产品号、私钥、公钥与实际价格尚未配置，线上 `plans` 返回 `available:false`，没有发生真实扣款。

## 验证

- 全量 `npm test`：205/205 通过。
- `npm run check`：33 个 JSON、196 个 JavaScript、11 个页面通过。
- `git diff --check`：无差异错误，只有工作区换行提示。
- 独立支付测试覆盖排序签名、同步/原始异步验签、小程序下单参数、OpenID 不外泄、金额和计划校验。

## 外部依据

- 斗拱 SDK 说明：https://paas.huifu.com/docs/devtools/#/SDK_js
- 斗拱小程序支付：https://paas.huifu.com/open/doc/api/#/smzf/api_jhzs?id=miniwx
- 斗拱扫码交易查询：https://paas.huifu.com/open/doc/api/#/smzf/api_qrpay_cx?id=miniwx
- 斗拱签名说明：https://paas.huifu.com/open/doc/guide/#/api_v2jqyq
- CloudBase 云存储安全规则：https://docs.cloudbase.net/storage/security-rules
- CloudBase HTTP 访问云函数：https://docs.cloudbase.net/service/access-cloud-function
