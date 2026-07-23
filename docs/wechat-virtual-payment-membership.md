# 微信小程序虚拟支付会员接入

本项目销售的是一次性“30 天会员”虚拟权益，属于微信定义的解锁功能/订阅内容。会员收款必须使用小程序虚拟支付和 `wx.requestVirtualPayment`，不能使用普通 `wx.requestPayment`、CloudBase CloudPay 或普通 JSAPI 支付代替。

## 当前实现

1. 前端在每次购买前调用 `wx.login` 获取一次性登录凭证。
2. `membershipBilling` 用 `code2Session` 校验凭证，并确认返回的 OpenID 与云函数调用者一致。
3. 云函数生成道具直购 `signData`、支付签名和用户态签名；AppKey、AppSecret、session_key 均不会返回客户端。
4. 前端调用 `wx.requestVirtualPayment`，并保存待确认订单号。
5. 前端成功回调只触发查单，不直接开会员。云函数调用 `/xpay/query_order`，校验订单号、订单金额和实付金额后，才幂等增加 30 天权益。
6. 权益到账后调用 `/xpay/notify_provide_goods` 确认发货；失败会保留重试状态。
7. 收银台异常退出时，订单号仍保存在本机；再次打开小程序会向服务端恢复查单。
8. `/hyyc/membership/notify` 接收微信安全模式消息：GET 完成地址验证，POST 处理 iOS 退款询问和退款通知；退款必须再次通过官方查单确认后才幂等回收权益。

生产环境当前已发布道具 `pro_30d`，但真实支付与退款尚未完成真机验收。首发版本因此保持新购关闭；已有订单的查单、补单和退款回收仍继续运行。

## 开通步骤

1. 小程序必须已认证，主体和类目满足虚拟支付准入要求。
2. 在小程序管理后台左侧进入“虚拟支付”，签署协议并开通新的虚拟支付商户配置。
3. 先在沙箱创建并发布一个“30 天会员”道具：道具 ID 建议 `pro_30d`，后台道具价格设为 1090 分，记录 `offerId`、沙箱 AppKey 和道具 ID。
4. 沙箱通过后，再发布同价的正式道具，切换为正式 AppKey 和 `env=0`。
5. 如小程序后台启用了接口 IP 白名单，把云开发标准版的固定出口 IP 加入白名单。
6. 为 `knowledge_membership_orders` 创建 `status + nextCheckAt` 复合升序索引，供 15 分钟一次的有界对账扫描使用。

一次性 30 天包不是自动续费，不需要开通“会员订阅”能力。若以后改为自动扣款，再单独评估会员订阅的准入条件、签约、续费通知和取消流程。

## 云函数配置

以下值只放在云函数环境变量或未提交的 `config.local.js` 中。AppKey、AppSecret 不得写入小程序前端、Git、文档或聊天截图。

| 环境变量 | 说明 |
|---|---|
| `WECHAT_VIRTUAL_PAY_ENABLED` | 完成后台开通和商品发布后设为 `true` |
| `WECHAT_VIRTUAL_PAY_RELEASE_APPROVED` | 仅在下方真机矩阵全部验收并留存证据后设为 `true`；默认缺失即关闭新购 |
| `WECHAT_VIRTUAL_PAY_ENV` | 沙箱 `1`，正式环境 `0` |
| `WECHAT_VIRTUAL_PAY_OFFER_ID` | 虚拟支付“基本配置”中的 offerId |
| `WECHAT_VIRTUAL_PAY_APP_KEY` | 与 env 对应的沙箱/正式 AppKey |
| `WECHAT_VIRTUAL_PAY_PRODUCT_ID` | 已发布的 30 天会员道具 ID |
| `WECHAT_VIRTUAL_PAY_PRO_30D_PRICE_CENTS` | 实际活动成交价，单位分；首发 `590` |
| `WECHAT_VIRTUAL_PAY_PRO_30D_COMPARE_AT_PRICE_CENTS` | 后台道具价格与划线价，单位分；当前 `1090` |
| `WECHAT_MINIPROGRAM_APP_ID` | 当前小程序 AppID |
| `WECHAT_MINIPROGRAM_APP_SECRET` | 当前小程序 AppSecret，仅服务端使用 |
| `WECHAT_VIRTUAL_PAY_TIMEOUT_MS` | 可选，微信接口超时，默认 8000ms |
| `WECHAT_MESSAGE_PUSH_TOKEN` | 微信后台消息推送配置中的 Token，只存服务端 |
| `WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY` | 微信后台消息推送配置中的 EncodingAESKey，只存服务端 |

参考模板：`hyyc/cloudfunctions/membershipBilling/config.example.js`。

## 退款消息推送配置

1. 在微信公众平台进入“开发管理 → 消息推送配置”。
2. URL 填写 `https://hyyc-1gi3f5sqc5becabf-1395663220.ap-shanghai.app.tcloudbase.com/hyyc/membership/notify`。
3. 数据格式选择 JSON，加密方式选择安全模式；不要使用明文或兼容模式处理支付退款事件。
4. 在后台生成或填写 Token、EncodingAESKey，并把完全相同的两项分别写入 `WECHAT_MESSAGE_PUSH_TOKEN`、`WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY`。
5. 先完成 GET 地址验证，再发送测试通知。缺少任一配置时接口会返回 HTTP 503，不会接受未验签消息。

通知处理会校验 SHA-1 消息签名、AES-256-CBC 密文、PKCS#7 填充与 AppID；退款通知还会绑定 OpenID、商户订单、微信交易号和 590 分实付金额，并以官方查单为最终依据。微信要求重试时接口返回加密失败应答，不会在通知字段不一致时直接回收会员。

## 上线前验证

- 用真实手机分别验证 Android 和 iOS；开发者工具不能代替真机支付验收。
- 测试取消支付、重复点击、支付后立即退出微信、弱网、支付成功但前端回调丢失、重复查单、重复发货。
- 确认签名中的道具价为 1090 分、活动成交价为 590 分；5.90 元订单只能增加一次 30 天，金额不一致时绝不发放权益。
- `cloudbaserc.json` 已注册每 15 分钟执行一次的 `membership-billing-reconcile`；部署后确认触发器为启用状态。若后续接入微信消息推送，可保留该低频任务作为发货与退款兜底。
- 配置退款和投诉处理。Android 等渠道可调用虚拟支付退款接口；iOS 退款由用户从 App Store 发起，应消费退款通知并回收对应权益。
- 验证 `xpay_subscribe_ios_refund_query_notify` 的退款建议应答和 `xpay_refund_notify` 的权益回收；重复通知不得重复扣减会员时长。

## 官方资料

- [小程序虚拟支付总览](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)
- [`wx.requestVirtualPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)
- [查询创建的订单](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order)
- [通知已发货完成](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods)
- [iOS 虚拟支付](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/ios.html)
- [小程序消息推送](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html)
