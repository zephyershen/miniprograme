---
title: "iOS 结算边界、资料审核恢复与续费状态展示"
type: source
tags: [ios, refund, profile-review, membership, renewal, production, preview]
source_date: 2026-07-24
last_updated: 2026-07-24
status: confirmed
confidence: high
---

# iOS 结算边界、资料审核恢复与续费状态展示

## 结论

- 生产只读聚合确认存在同一账号两笔已付款购买，会员到期时间按两次各 30 天累加；
  未发现已退款订单。用户决定保留两笔购买、不申请退款；没有发起退款，也没有
  直接修改订单或会员数据。
- iOS 虚拟商品由 Apple 收款，开发者后台不能代替用户主动发起这类退款。用户需要
  使用付款的 Apple 账号在 Apple 官方退款入口只选择一笔重复购买；是否批准由
  Apple 决定。后端继续处理微信转发的退款询问、退款通知和官方查单，只有官方
  确认退款后才幂等回收该笔对应的 30 天权益。
- 资料长时间停在“审核中”不是 AI 推理耗时。生产记录显示文本/图片审核已经成功，
  最后一次事务在回写 CloudBase 管理字段 `_id` 时失败并进入指数退避。写入边界
  已统一剥离 `_id`，部署后让原记录通过正常 worker 完成；当前资料已公开，审核
  结果消息也已完成投递，没有人工跳过审核或强制批准。
- “我的”页现在按真实权益显示购买动作：未验证账号显示“使用当前微信账号登录”，
  免费账号显示“订阅并支付”，有效会员显示“续费 30 天”。会员到期时间同时显示
  在身份卡和购买卡；续费从现有到期时间继续增加 30 天，已到期时从当前时间起算。

## 资料审核修复

- `knowledgeFeed/repositories/user-profile-review.js` 的提交、领取、状态迁移和
  `approveAndSave` 事务全部通过统一的可写文档转换，避免把数据库读取结果中的
  `_id` 再写回。
- 新增仓储级仿真测试：读取时自动附加 `_id`，写入时拒绝 `_id`，覆盖资料、审核
  队列和消息 outbox 的原子写入。
- 新增已公开头像的重试终结测试，保证 worker 重试不会重复写入或遗漏结果。
- `knowledgeFeed` 已重新部署，函数为可用状态，资料审核分钟触发器保持启用。对
  受影响记录只提前了下一次正常重试时间，没有改审核结论；worker 随后完成审核。

## 会员展示与累加规则

- 展示模型新增 `isActiveMember` 和 `purchaseMode`，管理员预览身份不冒充真实
  付费会员。
- 支付成功提示按购买前状态区分“Pro 已开通”和“续费成功”。
- 服务端原有的累加合同保持不变：基准时间为
  `max(currentPeriodEnd, now)`，然后增加 30 天。同一订单重复确认不会再次延长。
- 覆盖有效会员续费、过期会员重开、相同订单重复回放和页面文案的自动化测试。

## 不退款与平台回调边界

- 产品不提供管理员主动退款入口，本次两笔购买不申请退款，不需要执行订单、会员
  或数据库操作。
- 普通非 iOS 虚拟支付订单有微信服务端主动退款接口，但不能把它用于 Apple
  `order_type=7` 订单；管理员撤销会员也不等于资金退款，不能作为替代方案。
- Apple/微信仍可能因用户未来自行申请、争议或平台处理而发送退款通知，因此必须
  保留官方通知、查单确认和幂等权益回收；这不是管理员退款功能。

## iOS 结算路径

- iOS 订单不是支付成功后直接进入银行账户。官方路径是
  `用户付款 → Apple → 腾讯 → 开发者虚拟支付账户 → 提现账户`。
- Apple 通常在自然月结束后 45～60 天内扣除 Apple 佣金后结算给腾讯；腾讯收到
  后再划入开发者虚拟支付账户，到账后才可提现。
- 当前代码没有创建提现单、查询提现单或查询可提现余额的功能，也不保存银行账户
  配置。因此不能从代码或支付成功状态判断款项已经进入哪一个银行账户。
- 是否绑定用户所说的对公账户，必须在小程序管理后台的“虚拟支付 → 资金管理”
  核对待结算金额、可提现余额、提现账户与提现单状态。2026 年官方页面当前列示
  Apple 服务费 12%、腾讯技术服务费限时 0%，不能把支付原价理解为全额到账。

## 验证与发布

- 完整 `npm.cmd run verify` 通过：670/670 个 Node 测试，32 个 JSON、303 个
  JavaScript、12 个注册页面；覆盖率为行 80.68%、分支 69.18%、函数 77.57%。
- `git diff --check` 通过；四个生产云函数均为部署完成状态。
- 最新开发预览包为 472,432 bytes。预览环境会真实扣款，已付款账号只用于确认
  “续费 30 天”和到期时间，不应再次点击续费，除非确实要再购买 30 天。

## 官方依据

- [微信 iOS 虚拟支付说明](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/ios.html)
- [微信普通虚拟支付退款接口](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_refund_order.html)
- [微信虚拟支付资金管理](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)
- [微信创建提现单接口](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_create_withdraw_order)

## 敏感信息边界

本记录不包含用户标识、OpenID、订单号、昵称、头像 File ID、请求 ID、支付签名、
原始日志、环境变量值、访问令牌或回调密钥。
