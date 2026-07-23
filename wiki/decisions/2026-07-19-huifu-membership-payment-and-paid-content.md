---
title: "采用斗拱直连接口、服务端发放会员并保护付费内容"
type: decision
tags: [membership, payment, huifu, paid-content, cloudbase, security]
sources: [../sources/2026-07-19-profile-moderation-and-huifu-payment.md]
last_updated: 2026-07-19
status: superseded
confidence: high
superseded_by: 2026-07-19-wechat-virtual-payment-membership.md
---

# 采用斗拱直连接口、服务端发放会员并保护付费内容

> 支付通道部分已被[微信小程序虚拟支付决策](2026-07-19-wechat-virtual-payment-membership.md)取代。付费内容移出客户端包、服务端重鉴权和云存储禁止直读的内容保护结论继续有效。

## 背景

普通用户需要在小程序内实际购买 Pro；项目运行在 Node.js CloudBase 云函数，斗拱服务端 SDK 不提供 Node.js 版本，网页 JS SDK 也不适合作为小程序下单、签名和异步回调的可信边界。同时，完整专栏海报此前在客户端包和公开读取云存储目录中，不能作为正式付费内容。

## 决策

1. `membershipBilling` 云函数直接调用斗拱小程序支付 API；客户端只接收白名单化的 `wx.requestPayment` 参数，不加载网页 JS SDK，也不接触商户私钥或用户 OpenID。
2. 当前商品是一次购买 Pro 30 天，不自动续费。客户端支付成功只触发查单；只有斗拱验签通过的异步通知或服务端主动查询确认 `trans_stat=S` 后，事务才会延长会员周期。
3. 订单由服务端生成并绑定派生 `ownerKey`、商户号、请求日期和固定金额；回调验证原始 `resp_data` 签名、金额、商户号、订单号和日期。同一订单幂等发放一次，重复通知不重复延长。
4. `knowledge_memberships` 与 `knowledge_membership_orders` 均为 `ADMINONLY`。回调路由为 `https://hyyc-1gi3f5sqc5becabf-1395663220.ap-shanghai.app.tcloudbase.com/hyyc/membership/notify`，不使用用户登录鉴权，但函数只接受 POST 并独立验签。
5. 小程序包只保留专栏标题、摘要与学习路径。18 张完整海报从客户端包移除；`knowledgeFeed.columnContent` 每次重新校验 `ai_column` 权益后，由服务端生成短期地址。
6. 云存储自定义规则只公开 `knowledge-covers/`、`knowledge-previews/`、`knowledge-thumbnails/` 和 `user-media/`；客户端不能直接读取 `ai-column/`。服务端 SDK 保留完整权限。
7. 支付配置不完整时购买入口保持不可用，不使用测试价格，也不会向斗拱发起请求。生产密钥只能放 CloudBase 环境变量或被 Git 忽略的本地配置，普通 Wiki 不记录实际值。

## 为什么这样定

- Node 云函数直调 API 可以把签名、验签、金额和会员事务留在唯一可信边界，避免网页 SDK 或客户端状态直接决定权益。
- CloudBase 承担下单与回调后，公网服务器性能不在支付主链路上。
- 一次购买 30 天不依赖代扣签约、解约和自动续费协议，符合当前会员产品；若以后需要自动续费，应另做代扣协议和状态机，不能复用一次支付假装订阅。
- 删除包内正文并关闭云存储客户端直读，才能让页面隐藏升级为实际内容保护。

## 影响与剩余配置

- 代码、函数、回调路由、订单集合和 ACL 已部署；无配置调用返回安全的 `available:false`。
- 启用真实支付仍需设置 `HUIFU_SYS_ID`、`HUIFU_PRODUCT_ID`、`HUIFU_MERCHANT_ID`、商户 PKCS#8 私钥、斗拱平台公钥、30 天价格、回调地址和直连/间联 OpenID 模式，并完成斗拱成功、取消、超时、重复通知、金额不一致和主动查询联调。
- 当前没有实现自动续费、退款或退款后撤销权益；正式收费前退款链路仍需补齐。
