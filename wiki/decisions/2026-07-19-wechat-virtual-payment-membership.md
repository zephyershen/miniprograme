---
title: "采用微信小程序虚拟支付销售一次性 30 天会员"
type: decision
tags: [membership, payment, wechat, virtual-payment, cloudbase, security]
sources: [../sources/2026-07-19-wechat-virtual-payment.md, ../sources/2026-07-20-launch-readiness-remediation.md]
last_updated: 2026-07-24
status: accepted
confidence: high
supersedes: 2026-07-19-huifu-membership-payment-and-paid-content.md
---

# 采用微信小程序虚拟支付销售一次性 30 天会员

## 背景

项目销售的是解锁精选、简报、评论和学习专栏等功能的一次性 30 天会员。微信官方将解锁功能、订阅内容和付费功能列为虚拟商品，必须接入小程序虚拟支付；普通 `wx.requestPayment`、CloudBase CloudPay 和普通 JSAPI 微信支付不适用于本商品。

## 决策

1. 前端改用 `wx.requestVirtualPayment` 的 `short_series_goods` 道具直购模式；当前仍是一次购买 30 天，不做自动续费，也不冒充会员订阅。
2. 每次购买先由 `wx.login` 取得临时 code，`membershipBilling` 调用 `code2Session`，并确认换得的 OpenID 与当前 CloudBase 调用者一致。session_key、虚拟支付 AppKey 和小程序 AppSecret 只留在服务端。
3. 订单号、商品 ID、数量、1090 分道具价和 590 分首发活动价全部由服务端固定；服务端针对完全一致的 `signData` 生成支付签名和用户态签名，客户端只接收拉起收银台所需的四个白名单字段。划线价不参与权益金额校验，实际成交价始终为 590 分。
4. 前端 success 只触发查单。只有 `/xpay/query_order` 返回的订单号、正式/沙箱环境、订单类型、标价和实付金额全部匹配，且状态为已支付后，数据库事务才幂等增加一次 30 天权益。
5. 权益提交后调用 `/xpay/notify_provide_goods`；空的 2xx 成功响应也视为成功。订单保留发货重试和下一次核对时间，已支付订单仍可定期复核退款；退款幂等回收对应 30 天。
6. 客户端在拉起收银台前保存待确认订单，异常退出后再次打开小程序会恢复服务端查单；每 15 分钟的有界对账负责兜底。安全模式消息入口消费 iOS 退款询问与退款通知，只有官方查单确认退款后才回收权益。
7. 既有付费内容保护继续有效：完整专栏不进入小程序包，服务端每次重鉴权后返回短期地址，客户端不能直接读取 `ai-column/`。
8. iOS Apple 虚拟商品退款必须由付款用户通过 Apple 官方入口申请，开发者不能用
   普通 `/xpay/refund_order` 代替。退款询问、退款通知和官方查单只负责验证并
   幂等回收该笔 30 天权益；管理员直接撤销会员不构成资金退款。产品不实现管理
   员主动退款入口；用户选择不退款时不执行任何订单或权益变更，但平台被动退款
   回调必须保留，防止未来 Apple 退款后会员仍然有效。

## 当前状态

- 前端、云函数适配器、订单服务、幂等权益事务、发货重试、退款回收和安全模式消息处理均已实现；全项目 265 项 Node 测试与项目检查通过。
- `membershipBilling` 已重新部署，云端实测返回 `available=true`、道具 `pro_30d`、590 分首发活动价与 1090 分划线道具价；产品负责人确认后台已开启 IAP。
- GET 地址验证、iOS 退款询问和退款通知均校验消息签名、AES 密文与 AppID；订单表已增加三个交易号稀疏索引。消息推送 Token 与 EncodingAESKey 尚未在微信后台和云函数成对配置，因此通知地址保持安全关闭。
- 斗拱代码和支付回调已退出活跃会员支付链路。

## 上线前剩余

- 在微信后台消息推送配置中填写 URL、Token 和 EncodingAESKey，选择 JSON 与安全模式；把同一组 Token/AESKey 只写入 CloudBase 环境变量，不写入代码、前端或普通 Wiki。
- 完成 Android 与 iOS 真机的成功、取消、退出恢复、重复查单、金额不一致、发货、退款询问、退款通知和退款后重新锁定验收。当前未产生真实生产订单，因此这些结果必须以真实联调为准。
