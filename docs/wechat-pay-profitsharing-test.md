# 微信支付 v3 分账：本项目测试入口使用说明

本文档用于指导你在本项目里跑通“微信支付 v3 分账（profitsharing）”的最小闭环，并解释关键概念（尤其是 `amount` 到底给谁、商户后台“分账管理比例 30%”对你方案的影响）。

重要提醒（结合你目前的业务设定）：

- 你商户后台“分账管理比例”最大 30%，而你希望把 96% 给个人卖家，这会导致 profitsharing 方案在微信侧直接受限。
- 因此本文档的“分账测试”更适合用来理解接口与错误返回；你要落地 C2C 资金结算，大概率要走“平台托管 + 转账到零钱/提现”路线（见本文后面的结论章节）。

## 我刚刚在项目里实现了什么

我在小程序里新增了一个“开发者测试面板 + 云函数”，用于发起微信支付 v3 分账请求：

- 云函数：`hyyc/cloudfunctions/wechatProfitsharingTest`
  - 能做两件事：
    - `add_receiver`：调用 `/v3/profitsharing/receivers/add` 添加分账接收方
    - `create_order`：调用 `/v3/profitsharing/orders` 创建分账单（并按费率计算金额）
  - 说明：微信支付 v3 的接口需要 **服务端签名**（RSA SHA256），小程序端不能直接请求微信支付 API，所以必须放到云函数/服务器。

- 前端入口：`hyyc/pages/profile/index`
  - 在“我的/个人中心”页底部加了一个“开发者工具：微信分账测试”面板：
    - 仅在 `develop` / `trial` 环境展示，`release` 环境隐藏，避免影响真实用户
  - 你可以填：
    - `transaction_id`（支付成功后的交易单号）
    - `B openid`（接收分账的用户 openid）
    - 总金额（元）、平台费率（默认 0.04）
  - 点击按钮后会调用 `wx.cloud.callFunction({ name: 'wechatProfitsharingTest' })`
  - 云函数返回的结果会展示在页面里（包括微信侧返回的 `code/message`）

相关文件：
- `hyyc/cloudfunctions/wechatProfitsharingTest/index.js`
- `hyyc/cloudfunctions/wechatProfitsharingTest/config.example.js`
- `hyyc/pages/profile/index/index.wxml`
- `hyyc/pages/profile/index/index.js`
- `hyyc/pages/profile/index/index.wxss`
- `.gitignore`（已忽略云函数本地私钥/证书/本地配置，避免误提交）

## 你问的核心：amount 这个参数到底是谁的金额？

结论：

- 分账接口请求体里 `receivers[].amount` 的含义是：**分给该 receiver（接收方）的金额**，单位是“分”。
- 它不是“平台（发起分账的商户）自己要拿的金额”。
- 平台/主商户想“自己留多少”通常不需要填 `amount` 给自己：
  - 你只需要把“要分出去的部分”写在 receivers 里
  - 剩下没分出去的那部分会 **留在发起交易的商户** 侧
  - 如果 `unfreeze_unsplit: true`，分账完成后剩余部分会自动解冻（从冻结资金变成可用余额）

举例（你的需求）：

- A 付款 10 元（即 1000 分）
- 平台抽成 4%（即 40 分）
- B 应得 96%（即 960 分）

如果这笔交易的“主收款商户”是平台商户号：

- receivers 里写 B：`amount = 960`
- 平台的 40 分不需要写 receivers（因为本来就在主商户账户里）

注意：这套逻辑能否成功，还要看你商户后台的“分账管理比例”限制（下一节）。

## 商户后台“分账管理比例（最大 30%）”对方案的影响

你截图里写得很关键：

> 分账管理比例，指每笔订单允许分账的最大比例，非实际分账比例
>
> 最大只能设置 30%

这通常意味着：

- **每笔订单最多只能把“订单金额的 30%”分给 receivers（所有接收方 amount 之和）**

因此你想要的 “把 96% 给 B（960/1000）” 在这种限制下会直接不成立：

- 960/1000 = 96%  ＞ 30%
- 微信侧大概率会返回 “超出可分账比例/超出分账限额” 类的错误（具体 code/message 以接口返回为准）

### 如果确实只能 30%，那正确的业务结构通常要反过来

如果你的真实业务是“B 是卖家、平台抽成 4%”，并且分账比例上限 30%，常见做法是：

- 让“主收款商户”是卖家（或特约商户/子商户）B
- 平台作为 receiver 拿 4%（40 分）
- 这样 receivers 总额 = 4%（不超过 30%）

但这会牵涉到你当前到底是：

- 普通商户模式（只有你一个 mchid）
- 服务商/特约商户模式（存在 sub_mchid / 二级商户）
- 电商收付通等更复杂产品

这些模式用的下单参数、分账接口也可能不完全相同。

我目前实现的测试逻辑是“把 receiverFen 分给 B，平台留平台费（未分出部分）”，它更适合：

- 平台商户收款，且允许把大部分金额分出去（分账管理比例足够高）

如果你确认你这边只能 30%，你应该告诉我你用的模式（普通/服务商/电商收付通），我可以把代码调整为“只分 4% 给平台（receiver），其余留给主商户（卖家）”的方向。

## 针对你的真实场景（平台是唯一商户，买卖双方都是普通用户）的结论

你补充的场景是：

- 只有你是商户（平台商户号收款）
- A（卖家）和 B（买家）都是普通用户，不是商户
- 你希望：买家付款 10 元后，卖家实际拿到 96%（9.6 元），平台收 4%（0.4 元）
- 但商户后台“分账管理比例”最大 30%

在这种约束下：

- 用“分账（profitsharing）”把 96% 分给个人卖家（A）这条路 **不可行**（96% > 30%）
- 这不是代码问题，是产品/风控规则的限制：分账接口只允许在比例上限内把金额拆给 receivers

要实现“平台抽 4%，卖家拿 96%”，通常有三条可选路线（从易到难）：

1) 两笔支付（最简单，但体验差）
   - 买家分别支付：商品款给卖家（私下/转账/其他方式）+ 服务费给平台
   - 缺点：两次支付、链路长、纠纷与对账复杂

2) 平台收款 100% + 平台“转账到零钱/提现”给卖家 96%（更贴近托管/担保交易）
   - 买家使用小程序支付给平台商户号（你）
   - 你在平台侧做“托管资金”（内部账本）：
     - 付款成功先冻结
     - 买家确认收货后放款
   - 放款动作使用“商家转账到零钱（v3 转账）”把 96% 转给卖家 openid
   - 这条路不依赖 profitsharing 的 30% 上限，但会引入：
     - 需要开通“商家转账”等能力（微信侧有准入/风控）
     - 可能需要卖家实名信息（微信侧可能要求姓名校验/信息采集）
     - 提现/转账可能有额度、频次、审核、失败重试等工程细节

3) 升级为电商/服务商类产品（最重）
   - 例如“电商收付通”等，让卖家成为子商户/特约商户，平台抽佣走分账
   - 通常要求卖家完成商户入驻（对 C2C 个人卖家不一定现实）

本项目在 `hyyc/docs/plans.md` 里已经更接近路线 2（平台托管资金 + 卖家提现），这与 30% 的限制更匹配。

## 我不清楚“支付下单是哪个模式/接口”，在哪里看？

你现在的仓库里还没有真正接入微信支付下单逻辑（我在代码里搜索不到 `wx.requestPayment`、`prepay_id`、`/v3/pay/transactions/*` 等关键字）。

所以目前“你用的是哪个下单接口”这件事，答案很可能是：**还没接入/还没写**。

你可以用下面三种方式确认（推荐按顺序）：

1) 看代码里是否已经调起微信支付
   - 小程序端关键 API：`wx.requestPayment`
   - 服务端/云函数关键字：`prepay_id`、`/v3/pay/transactions/jsapi`、`/v3/pay/partner/transactions/jsapi`、`unifiedorder`

2) 看商户平台已开通的支付产品
   - 商户平台（pay.weixin.qq.com）里通常在“产品中心/产品大全/支付产品”能看到是否开通了“小程序支付”
   - 但这只能说明“你可以用哪类支付”，不能直接告诉你“代码正在用哪个接口版本（v2/v3、普通/服务商）”

3) 看你未来要走的典型选择（结合你的身份：只有你是商户）
   - 如果你是普通商户自己收款：通常用 v3 普通商户下单接口（JSAPI 类）
   - 如果你是服务商帮别人收款（有 sub_mchid）：才会走 partner/服务商接口

## 本项目新增的“付款接口测试”怎么用

为了让你能拿到 `transaction_id` 并继续测分账，我在同一个“开发者工具面板”里加了一个“JSAPI 支付测试”按钮：

- 云函数：`hyyc/cloudfunctions/wechatPayJsapiTest`
  - `action=jsapi_prepay`：创建 `/v3/pay/transactions/jsapi` 预支付单，返回 `payParams` 给小程序调起 `wx.requestPayment`
  - `action=query_by_out_trade_no`：支付完成后通过 `/v3/pay/transactions/out-trade-no/{out_trade_no}` 查询订单，拿到 `transaction_id`
  - 下单时我已设置：`settle_info: { profit_sharing: true }`（声明该订单可分账），避免你后面分账直接因为“不可分账”失败

### 为了跑通支付，你需要配置什么？

支付（prepay）必须要有 v3 签名材料。`notify_url` 在微信下单接口里是必填字段：

1) `appid`：小程序 appid（必须已绑定到商户号）
2) `mchid`：你的商户号
3) `serialNo`：商户 API 证书序列号
4) 商户 API 私钥（`apiclient_key.pem` 的私钥内容/文件）
5) `notify_url`：一个公网可访问的 https 地址（微信服务器会回调）

配置方式二选一：

- 方式 A：本地文件（建议开发测试）
  - 复制 `hyyc/cloudfunctions/wechatPayJsapiTest/config.example.js`
  - 为 `hyyc/cloudfunctions/wechatPayJsapiTest/config.local.js`
  - 私钥文件放到：`hyyc/cloudfunctions/wechatPayJsapiTest/cert/apiclient_key.pem`

- 方式 B：云函数环境变量（更适合线上）
  - `WXPAY_APPID`
  - `WXPAY_MCHID`
  - `WXPAY_SERIAL_NO`
  - `WXPAY_PRIVATE_KEY`
  - `WXPAY_NOTIFY_URL`

#### 这些参数要配到哪个云函数？要配几份？

本项目有两个相关云函数：

- `hyyc/cloudfunctions/wechatPayJsapiTest`：支付（prepay + query）
  - 必需：`WXPAY_APPID` / `WXPAY_MCHID` / `WXPAY_SERIAL_NO` / `WXPAY_PRIVATE_KEY`
  - 建议：`WXPAY_NOTIFY_URL`（回调地址）

- `hyyc/cloudfunctions/wechatProfitsharingTest`：分账（add_receiver + create_order）
  - 必需：`WXPAY_APPID` / `WXPAY_MCHID` / `WXPAY_SERIAL_NO` / `WXPAY_PRIVATE_KEY`
  - 不需要：`WXPAY_NOTIFY_URL`

如果你的云开发控制台支持“环境级环境变量”（对同一环境下所有云函数生效），推荐配置一次即可，两个云函数会同时读取到。

如果只能按“云函数级环境变量”配置，那就需要在两个云函数里各配置一遍相同的 `WXPAY_*`（至少前 4 项）。

重要说明：

- 目前我还没有在项目里实现“支付回调 notify”的 HTTP 接收与验签解密（生产必须做）。
- 但为了让你先测试，我在支付成功后会立刻调用“查询订单接口”来拿 `transaction_id`，因此你可以先不依赖回调完成测试。
- 不过 `notify_url` 在创建订单时仍然是必填字段；如果你暂时没有可用回调地址，本项目会自动使用一个占位 https URL 让你先跑通支付 + 查询，但回调会失败/重试，建议尽快改为真实可访问的 https URL。

### 支付测试步骤

1) 部署云函数 `wechatPayJsapiTest`（安装依赖 + 上传部署）
2) 在小程序“我的/个人中心”页底部，找到“1) 先发起一笔 JSAPI 支付”
3) 点击“生成预支付单并调起支付”
4) 支付成功后，面板会自动显示查询结果，并尝试把 `transaction_id` 自动填入分账表单的 transaction_id 输入框

## 接下来你要怎么做（一步一步）

下面步骤按“先跑通分账请求”来写。

### 第 0 步：确认你走的是哪一种收款模式（非常重要）

请先确认一件事（否则后面会踩坑）：

1. 这笔交易的 `mchid` 是谁？（平台商户 or 卖家商户）
2. 商户后台“分账管理比例”是否只有 30% 上限？

如果只有 30%，并且你希望平台抽成 4%，通常应当让“主收款商户”是卖家（或子商户），平台做 receiver。

### 第 1 步：确保订单“可分账”

分账不是对任意订单都能直接做。

你在“下单/支付”阶段需要把订单设置为可分账（字段名称以你用的下单 API 为准，常见叫 `profit_sharing` 或类似含义）。

如果没开“可分账”，你后面拿到 `transaction_id` 去分账会失败。

### 第 2 步：准备微信支付 v3 的服务端签名材料

云函数需要以下信息来签名请求：

- `appid`：小程序 appid
- `mchid`：发起分账请求的商户号（通常是这笔交易的主商户）
- `serial_no`：商户 API 证书序列号
- 商户 API 私钥：apiclient_key.pem（私钥 PEM 内容）

### 第 3 步：把配置放进云函数（两种方式二选一）

方式 A：本地文件（建议开发阶段用）

1. 复制配置模板：
   - 把 `hyyc/cloudfunctions/wechatProfitsharingTest/config.example.js`
   - 复制为 `hyyc/cloudfunctions/wechatProfitsharingTest/config.local.js`
2. 把私钥文件放到：
   - `hyyc/cloudfunctions/wechatProfitsharingTest/cert/apiclient_key.pem`
3. 注意：这些文件已被 `.gitignore` 忽略，不会被提交（避免泄露）。

方式 B：云函数环境变量（更适合线上/多人协作）

在云开发控制台给云函数设置环境变量：

- `WXPAY_APPID`
- `WXPAY_MCHID`
- `WXPAY_SERIAL_NO`
- `WXPAY_PRIVATE_KEY`（PEM 内容，可用 `\\n` 表示换行）
- （可选）`WXPAY_PRIVATE_KEY_PATH`

### 第 4 步：部署云函数

在微信开发者工具里：

1. 打开云开发（你项目已经有 env：`hyyc-1gi3f5sqc5becabf`）
2. 找到 `cloudfunctions/wechatProfitsharingTest`
3. 右键：
   - “安装依赖”
   - “上传并部署：云端安装依赖”

### 第 5 步：准备一笔真实支付成功的 transaction_id

你必须要有一笔“支付成功”的订单，并拿到其 `transaction_id`。

注意区分：

- `out_trade_no`：你自己系统的商户订单号
- `transaction_id`：微信支付返回的交易单号（分账接口通常用它）

### 第 6 步：拿到 B 用户的 openid（如果 B 是 PERSONAL_OPENID 接收方）

如果 receiver 选择 `PERSONAL_OPENID`：

- 这个 openid 必须是同一个 appid 下的用户 openid
- 且接收方需要先被添加到分账接收方列表（本测试按钮已默认“自动 add_receiver”）

### 第 7 步：在小程序里点击测试按钮发起分账

1. 打开“我的/个人中心”页面
2. 在底部“开发者工具：微信分账测试”面板里填：
   - transaction_id：支付成功后得到的 transaction_id
   - B openid：B 的 openid
   - 总金额(元)：例如 10
   - 平台费率：例如 0.04
3. 点击“发起分账（自动添加接收方）”
4. 看页面下方输出的 JSON：
   - `ok: true` 表示 HTTP 层成功（2xx），但仍建议看微信返回内容确认状态
   - `ok: false` 会包含微信侧 `code/message`（用于定位问题）

### 第 8 步：常见问题排查

- `MISSING_WXPAY_CONFIG`
  - 云函数缺少 appid/mchid/serial_no/privateKey，请回到“第 3 步”配置

- `error:0909006C:PEM routines:get_name:no start line` / `INVALID_PRIVATE_KEY_FORMAT`
  - 含义：云函数拿到的 `WXPAY_PRIVATE_KEY` 不是一个合法的 PEM 私钥（不是 `apiclient_key.pem` 的内容）
  - 常见原因：
    - 误把“APIv3 密钥（32位字符串）”填到了 `WXPAY_PRIVATE_KEY`
    - 误把证书内容（`apiclient_cert.pem`）填成了私钥
    - 环境变量里丢了 `-----BEGIN ... PRIVATE KEY-----` / `-----END ... PRIVATE KEY-----` 头尾行
    - 换行被压扁但未用 `\\n` 代替
  - 处理方式：
    - 直接把 `apiclient_key.pem` 全文（包含 BEGIN/END 行）粘贴到 `WXPAY_PRIVATE_KEY`
    - 或者把文件放到云函数目录 `cert/apiclient_key.pem` 并清空 `WXPAY_PRIVATE_KEY`，让代码从文件读取

- 交易不可分账 / 订单不支持分账
  - 大概率是下单时没设置“可分账”

- 超出“分账管理比例”
  - 你后台最大 30% 的话，把 96% 分给 B 会失败
  - 需要调整业务结构（见上文）

- 接收方不存在/未添加
  - add_receiver 失败（或 relation_type 不合法）
  - 看返回 JSON 里的 `addReceiver` / `response` 的 code/message

## 我还需要你提供哪些信息（我才能把它从“测试”改成“可用方案”）

请把下面信息发我（可以打码，但要能区分）：

1. 你商户后台“分账管理比例”上限是否就是 30%？（看截图像是）
2. 这笔订单的收款主体是谁：
   - 只有一个商户号（平台商户号）？
   - 还是服务商/特约商户（有 sub_mchid）？
3. 你下单用的是哪一种支付接口/模式（小程序 JSAPI？服务商下单？）
4. 你希望 B 是哪种接收方：
   - 普通用户（PERSONAL_OPENID）
   - 商户（MERCHANT_ID）
5. 一笔真实支付成功的 `transaction_id`（用于你本地测试）

拿到这些后，我可以给你两套“正确结构”的实现方案，并把前端按钮做成可切换模式（例如“平台留佣金” vs “平台收佣金”），避免你被 30% 的限制卡住。
