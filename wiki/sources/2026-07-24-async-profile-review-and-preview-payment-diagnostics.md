---
title: "资料异步审核、预览支付诊断与微信消息回调上线"
type: source
tags: [profile, moderation, queue, virtual-payment, message-push, deployment]
source_date: 2026-07-24
last_updated: 2026-07-24
status: confirmed
confidence: high
---

# 资料异步审核、预览支付诊断与微信消息回调上线

## 结论

- 资料保存不再同步等待 AI 审核。服务端先校验并冻结昵称/头像候选，写入独立
  `knowledge_user_profile_reviews` 队列后立即返回；`knowledgeFeed` 的新定时
  worker 在后台租约领取、审核并重试。
- 用户本人会看到候选头像上的“审核中”提示。已有审核通过资料在新候选通过前继续
  对外展示；首次提交的账号保持资料未完成，审核通过后才获得评论身份。
- 预览版的两次支付尝试均已成功到达服务端创建订单，订单停在
  `payment_pending`，没有形成微信支付平台订单。故障边界位于客户端
  `wx.requestVirtualPayment` 拉起收银台，不是订阅页、云函数订单创建或服务端
  开售开关。
- 微信后台“消息推送配置”是微信服务器向业务服务器投递事件的入站 webhook，
  不是向用户发通知的订阅消息，也不会主动拉起收银台。配置成功只证明微信能够
  验证该 URL、Token、加密模式和数据格式。

## 资料审核实现

- 队列文档以资料所有者派生键为主键，状态包含 `pending`、`processing`、
  `retry`、`approved`、`rejected`、`failed`；worker 使用到期租约回收、版本号和
  claim 精确匹配，旧 worker 不能覆盖同一用户更新的候选。
- worker 每次最多读取 6 条、并发 3 条，租约 2 分钟，最多 8 次，按退避时间重试。
  只有允许结果会在事务内同时交换公开资料和完成队列；拒绝、永久失败或过期 claim
  都不会更新公开资料。
- 审核头像保存到仅服务端可读的 review 前缀并延长保留期。候选只向所有者换取
  临时地址；审核通过后绑定为正式头像，拒绝或失效候选进入受限清理路径。
- 客户端资料页和编辑页显示橙色“审核中”角标，并在前台每 8 秒轮询一次、最多
  15 次；页面隐藏或卸载后停止。评论入口会提示“资料审核中，通过后即可发布评论”。

## 预览支付诊断

- `develop`、`trial`、`release` 是小程序版本；虚拟支付的 `env=0/1` 是真实环境/
  沙箱环境，两者不是同一开关。当前预览仍使用 `env=0`，会产生真实扣款。
- 微信开发者工具模拟器不能完成支付验收。Android/HarmonyOS 真机可用于开发版/
  体验版支付；Windows 需要使用“真机调试”。iOS 只支持真实环境，且要求满足微信
  官方列出的系统、微信版本、地区账号、虚拟支付权限、小程序简称和最低金额条件。
- 客户端现在会在模拟器提前提示改用真机，并把微信官方错误码映射成可操作说明。
  如果收银台回调失败，会先查单一次：服务端已经确认支付时继续成功流程，否则只
  上报经过白名单限制的错误码、设备平台、小程序版本和基础库版本。
- 服务端诊断接口先校验订单所有权；不接收或保存原始 `errMsg`、签名、OpenID、
  完整支付参数等敏感字段。

## 微信消息回调

- `membershipBilling` 已支持 `xpay_goods_deliver_notify`。收到发货通知后先校验
  订单形状、用户、环境、商品、数量、标价和实付金额，再向微信官方查单；只有官方
  状态确认一致，才幂等发放会员并确认发货。
- 原有 iOS 退款询问和退款结果通知继续使用加密响应与幂等回收；每 15 分钟对账
  任务仍是消息丢失时的后备恢复路径。
- 此 webhook 不等同于小程序“订阅消息”。若未来需要给用户发送审核结果或会员
  到期提醒，需要另行申请模板并在用户主动授权后调用订阅消息能力。

## 验证与生产部署

- 代码锚点为 `38d05c8`。完整 `npm.cmd run verify` 通过：568/568 个 Node 测试，
  30 个 JSON、285 个 JavaScript、11 个注册页面；覆盖率为行 80.24%、分支
  69.14%、函数 77.08%，生产依赖审计和 `git diff --check` 均通过。
- GitHub Actions `production-verify` 成功：
  https://github.com/zephyershen/miniprograme/actions/runs/30057855856
- 生产数据库控制面已收敛为 23 个合同集合、37 个合同索引；新增审核队列为
  `ADMINONLY`，5 个非合同集合只读保留。
- `knowledgeFeed` 与 `membershipBilling` 已更新。四个正式函数和触发器 manifest
  回读 0 漂移；`knowledgeFeed` 当前有 9 个定时器（新增资料审核 worker），
  `membershipBilling` 有 1 个 15 分钟对账定时器。
- 微信开发者工具已生成新的开发预览包，大小 414,774 bytes。自动化、数据库回读
  和二维码生成不替代真实账号资料审核或真实资金 canary。

## 剩余人工验证

1. 新账号扫码后提交昵称和头像，确认立即看到“审核中”，随后自动变为已通过或
   给出被拒绝状态；首次资料在通过前不应发布评论。
2. 优先使用 Android 真机测试预览支付；若仍失败，记录页面显示的微信错误码和
   设备条件，不复制完整支付参数。当前 `env=0`，测试会真实扣款。
3. iPhone 测试前逐项确认官方 iOS 条件；支付成功、取消、异常恢复、重复查单、
   发货、退款和权益重锁仍需完整人工资金验收。

## 官方参考

- 微信虚拟支付 API：
  https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
- 微信虚拟支付能力：
  https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
- 微信虚拟支付 iOS 说明：
  https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/ios.html
- 小程序消息推送：
  https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html

## 安全与隐私

- 本记录不包含用户标识、订单号、头像 File ID、昵称、签名、请求 ID、原始日志、
  环境变量值或回调密钥。
