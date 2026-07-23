---
title: "微信虚拟支付会员实现与部署证据"
type: source
tags: [wechat, virtual-payment, membership, cloudbase, deployment]
last_updated: 2026-07-20
status: confirmed
confidence: high
---

# 微信虚拟支付会员实现与部署证据

## 官方边界

- 微信虚拟支付总览明确把虚拟货币、解锁功能、订阅内容和付费功能列为虚拟商品，并要求购买和支付接入小程序虚拟支付。
- `wx.requestVirtualPayment` 道具直购需要字符串 `signData`、`paySig`、`signature` 和 `mode=short_series_goods`；支付签名使用虚拟支付 AppKey，用户态签名使用 `code2Session` 返回的 session_key。若使用低于后台道具价的活动价，官方要求同时传 `goodsPrice` 与 `activitySellingPrice`，后者是实际下单金额。
- `/xpay/query_order` 不支持云调用，服务端需使用稳定版 access_token 与 pay_sig；状态 2/3/4 才能作为已支付依据。轮询发货使用 `/xpay/notify_provide_goods`，官方成功返回体可以为空。
- 一次性会员购买不等于自动续费会员订阅；当前产品继续使用一次购买 30 天。

## 本地实现证据

- `features/billing/payment.js` 使用 `wx.login`、能力检测、`wx.requestVirtualPayment` 和待确认订单本地恢复；前端不直接授予权益。
- `membershipBilling` 按 adapter/repository/service 边界拆分 code2Session、稳定 access token、签名、查单、发货、订单持久化和会员事务。
- 官方 HMAC 测试向量通过；同时覆盖账号不一致、字段白名单、订单类型、环境、订单号、标价/实付金额、空发货响应、取消支付和幂等权益边界。
- 2026-07-19 全项目 213/213 Node 测试、33 JSON/198 JavaScript/11 页面项目检查通过。

## 云端证据

- CloudBase CLI 3.6.1 重新部署 `membershipBilling` 成功。
- 2026-07-20 远程调用 `plans` 返回 `available:false`、`priceCents:590`、`compareAtPriceCents:1090`；价格模型已上线，但支付密钥和商品参数仍为空，因此当前不会产生真实扣款。
- 实际密钥、session_key、OpenID、access token 和用户资料均未写入普通 Wiki 或用户输出。
