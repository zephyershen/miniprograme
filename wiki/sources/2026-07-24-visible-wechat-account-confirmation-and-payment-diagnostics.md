---
title: "会员支付增加可见微信账号确认与完整安全诊断"
type: source
tags: [payment, wechat-login, ios, diagnostics, deployment, preview]
source_date: 2026-07-24
last_updated: 2026-07-24
status: superseded
confidence: high
superseded_by: 2026-07-24-two-step-membership-login-and-optional-profile.md
---

# 会员支付增加可见微信账号确认与完整安全诊断

## 取代说明

本页记录的收银台失败边界和安全诊断合同继续有效；其中“原生确认框后在同一次点击
内登录、建单并支付”的界面已由代码锚点 `d927bfb` 取代。当前产品以
[先登录、再单独发起支付](2026-07-24-two-step-membership-login-and-optional-profile.md)
为准：第一次点击不建单、不拉起收银台，第二次点击才支付。

## 结论

- `wx.login` 是静默取得临时登录凭证的身份握手，不会弹出头像、昵称授权页，也不会
  让用户选择另一个微信账号。能进入微信或 Apple 收银台，说明本次请求已经完成
  `wx.login`、服务端 `code2Session`、当前 OpenID 一致性校验、建单与签名。
- 本次两个不同微信身份的最新尝试均使用 590 分计划价和 590 分
  `goodsPrice`，订单保持待支付，未扣款、未发放会员；因此旧尝试中的
  `-15013` 原价不一致不能解释本次失败。
- 本次失败发生在 `wx.requestVirtualPayment` 拉起后的微信/Apple 收银台阶段。
  原客户端没有取得可识别数字错误码，因此只凭“支付无法完成”不能进一步断言是
  App Store 账号、系统支付方式、微信版本还是收银台临时状态。
- 客户端现在先显示“确认微信账号”原生确认框，明确当前微信账号、30 天期限、
  实付金额和 iPhone 的 Apple 收银台边界；用户取消时不会登录、建单或拉起支付。
- 收银台失败后会报告严格白名单诊断：官方错误码、未识别数字错误码或无数字错误码，
  再加平台、运行版本和基础库版本。任何原始错误文本、用户标识、订单号、支付签名或
  环境变量都不会上传或写入 Wiki。

## 官方语义

- 微信 [`wx.login`](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)
  文档定义其职责为取得登录凭证 `code`；它不是用户资料授权界面。
- 微信 [`wx.requestVirtualPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)
  文档要求 `goodsPrice` 与道具配置原价一致，并把 `-15013` 定义为道具价格错误。
- 微信 [iOS 虚拟支付](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/ios.html)
  要求已开通能力、iPhone/iPad、iOS 15 及以上、微信 8.0.68 及以上、中国大陆
  App Store 账号且金额不少于 1 元；iOS 只能使用真实环境 `env=0`。

## 实现

- `features/billing/payment.js` 新增当前微信账号确认，并把确认放在静默登录和建单
  之前。iOS 确认文案额外说明 Apple 收银台和中国大陆 App Store 账号条件。
- 未知数字码直接以安全数字显示；没有数字码时，iOS 提示检查系统版本、微信版本和
  中国大陆 App Store 账号。取消支付仍保持原有无错误提示语义。
- `membershipBilling` 只接受三种严格诊断类型，并校验数字范围、官方码集合、
  平台、运行版本和基础库版本；服务端只保存安全字段。
- 页面按钮由“登录微信并订阅”改为“确认当前微信账号并支付”，避免暗示
  `wx.login` 会弹出独立登录页。

## 验证与生产状态

- 代码锚点 `d2434be`；支付客户端、资料页和云端支付服务专项 66/66 通过。
- 完整 `npm.cmd run verify` 通过；全量 Node 测试 620/620，项目检查为
  32 个 JSON、300 个 JavaScript、12 个注册页面，覆盖率和生产依赖审计通过，
  `git diff --check` 无错误。
- `membershipBilling` 已部署并回读为四函数 manifest 0 漂移；线上计划冒烟仍为
  可售、30 天、当前价/商品原价 590 分、1090 分仅作界面比较价。
- 新开发预览包为 459,512 bytes。真实成功、取消、无数字错误、重复查单、发货、
  退款和权益回收仍需 iPhone 真机人工 canary；当前 `env=0` 会真实扣款。

## 敏感信息边界

生产复核只保留聚合后的状态、金额一致性和失败阶段结论。本文未记录用户标识、
订单号、请求 ID、支付签名、原始日志、错误原文、环境变量值或回调密钥。
