---
title: "会员订阅改为先登录当前微信账号、再单独发起支付"
type: source
tags: [payment, wechat-login, logout, profile, ios, deployment, preview]
source_date: 2026-07-24
last_updated: 2026-07-24
status: confirmed
confidence: high
---

# 会员订阅改为先登录当前微信账号、再单独发起支付

## 结论

- 会员购买采用明确的两步交互。第一次点击“使用当前微信账号登录”只执行
  `wx.login`、服务端 `code2Session` 和当前云函数身份一致性校验；不创建订单，
  也不调用 `wx.requestVirtualPayment`。
- 登录步骤通过后，页面将状态切换为“订阅并支付”。只有用户再次点击，客户端才
  重新取得一次新登录凭证、创建订单并进入微信或 Apple 收银台。
- 登录状态只按服务端下发的匿名查看者分区保存在本机，用于控制两步界面；它不是
  支付授权。第二次点击仍由 `createPayment` 重做权威身份校验，不能依赖缓存放款。
- “我的”页在该本机验证状态存在时提供“退出登录”。退出只删除当前查看者分区的
  订阅验证标记，使主按钮回到“使用当前微信账号登录”；它不会退出手机微信、切换
  微信账号、取消会员、删除头像昵称或清除未完成订单。
- 微信不允许小程序静默取得真实头像和昵称。资料未完成时，登录成功弹窗会让用户
  选择“完善资料”或“稍后设置”；完善页使用 `chooseAvatar` 和
  `input type="nickname"`，资料保存后继续进入现有后台审核队列。资料是评论展示
  信息，不是会员绑定或支付的硬门槛。

## 微信官方能力边界

- [`wx.login`](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)
  只取得临时登录凭证 `code`，不会弹出微信账号选择页，也不返回头像和昵称。
- 服务端通过
  [`code2Session`](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)
  将临时凭证换成当前微信身份；会员最终绑定服务端确认的 OpenID。
- 当前头像昵称能力使用
  [`chooseAvatar` 与昵称输入](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/userProfile.html)：
  用户主动选择头像，并从昵称键盘建议中确认或输入昵称。
- 微信
  [头像昵称能力调整公告](https://developers.weixin.qq.com/community/develop/doc/00022c683e8a80b29bed2142b56c01)
  说明旧的真实资料自动获取方式已调整，并将付款前强制头像昵称授权列为不合理
  使用场景。因此本项目不能实现“自动读取真实头像昵称”，也不能把完善资料设为
  进入收银台的必要条件。

## 实现

- `features/billing/account-session.js` 只保存当前查看者分区的已完成登录步骤，
  防止不同微信身份共享界面状态。
- `pages/profile/index.js` 把第一次点击拆成登录码获取、`verifyAccount` 云端校验和
  可选资料引导；这一分支始终在建单前返回。第二次点击沿用原来的新登录码、建单、
  收银台、失败后查单和安全诊断流程。
- `membershipBilling.verifyAccount` 只返回 `{ verified: true }`，不创建订单，
  不向客户端返回 OpenID；服务端使用常量时间比较确认登录码身份与云函数 actor
  一致。
- 资料编辑页明确标注“微信资料 · 可选”，支持保存后返回订阅或暂不设置。资料候选
  仍为私有、后台审核，通过后才用于评论公开展示，审核状态不影响会员购买。
- 退出操作有明确确认框，只删除当前查看者分区的
  `membership_account_verification_v1`。存储删除失败时保留原状态；页面隐藏、
  卸载、重复点击、在途会员/价格请求均有并发保护，退出后价格加载仍会正常收敛。
  待支付订单使用独立存储键并继续参与恢复，不受退出影响。
- 旧的“确认当前微信账号并支付”单次弹窗已移除；原有收银台错误归一化、官方查单、
  幂等发放、发货通知和退款回收逻辑保持不变。

## 验证与生产状态

- 当前客户端锚点 `f522b64`；全量 Node 测试 626/626，项目检查为 32 个 JSON、
  301 个 JavaScript、12 个注册页面。完整 `npm.cmd run verify`、覆盖率、
  生产依赖审计和 `git diff --check` 均通过。
- 本次退出功能只修改客户端，无需重部署云函数；`membershipBilling` 仍使用已部署
  的两步登录服务端合同，四函数 manifest 和线上计划均未更改。线上计划
  冒烟仍为可售、30 天、当前价与商品原价 590 分，1090 分仅作界面比较价。
- 新开发预览包为 467,606 bytes。真实新账号仍需真机确认：第一次点击不出现
  收银台、可选资料可跳过、第二次点击才支付，以及成功/取消/无数字码/退款完整
  矩阵；还应确认退出后按钮回到登录步骤且未完成订单可恢复。当前支付环境
  `env=0` 会真实扣款。

## 取代关系

本实现取代代码锚点 `d2434be` 的“原生确认框后在同一次点击内登录、建单并支付”
交互。旧记录中的收银台失败边界和安全诊断结论继续有效，但旧按钮和单次点击流程
不再代表当前产品。

## 敏感信息边界

本记录不包含用户标识、OpenID、订单号、请求 ID、支付签名、原始错误文本、原始
日志、环境变量值或回调密钥。
