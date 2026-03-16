# HYYC 支付 / 分账 / 提现开发交接手册

更新时间：2026-03-15

这份文档是给下一位开发直接接手用的。目标不是讲概念，而是让人看完后立刻知道：

- 项目现在做到哪里
- 哪些链路已经通了，哪些还在联调
- 关键代码在哪
- 哪些云函数要部署
- 哪些环境变量要配
- 出问题时先去哪里查
- 现在还有哪些风险点和待收尾项

---

## 1. 当前项目真实状态

### 1.1 已完成

- 普通用户实名注册后，会自动完成：
  - 个人用户基本信息开户 `/v2/user/basicdata/indv`
  - 用户业务入驻 `/v2/user/busi/open`
- 用户端页面已收敛：
  - `我的-账户信息` 只保留昵称、楼栋、门牌号
  - 不再单独提供“收款开通 / 收款状态”页面
  - 收款异常统一让用户联系管理员
- 商品支付已跑通：
  - 汇付下单
  - 小程序拉起微信支付
  - 实时分账
  - 钱包镜像账本写入
- 商品侧用户体验已补齐：
  - 卖家可在“我的商品”或商品详情里手动下架 / 重新上架
  - 商品详情卖家信息已按发布者读取，不再错误显示当前登录用户
  - 收藏按钮已持久化
  - 浏览记录已持久化
  - 个人页已新增“收藏”入口，内含“收藏 / 浏览记录”两个 tab
  - 商品“聊一聊”已接入：
    - 买家可从商品详情直接和卖家单聊
    - 卖家可从商品详情或“我的商品”直接进入咨询会话列表
    - 商品详情 / 我的商品都已显示商品咨询未读角标
- 任务支付已跑通：
  - 先付款
  - 发布者确认完成后再做延时分账
  - 钱包镜像账本写入
  - 正式版确认完成只依赖任务文档里持久化的支付元数据
  - 不再依赖 `huifu_api_debug_logs` 参与资金判断
- 任务取消退款已接通：
  - 未接单任务可由发布者直接取消并原路退款
  - 已接单 / 已提交任务，必须由接单人在聊天页同意后才退款
  - 退款成功后任务会改为 `cancelled`
  - 聊天消息卡片状态会切为“任务已取消”
  - 退款处理中时，聊天页 / 任务详情 / 我的任务会自动追状态，不需要手动退出重进
- 已付款任务现在禁止直接删除：
  - 必须先走取消 / 退款流程
- 任务完成提交已加基础校验：
  - 必须填写完成说明或上传至少 1 张凭证
  - 发布者现在可以在任务详情里直接查看接单人提交的完成说明 / 凭证图片 / 提交时间
- 我的任务体验已补齐：
  - 正常完成的任务支持发布者单条删除记录
  - 发起支付但实际未支付成功的 `pay_pending` 任务，取消支付后也允许删除
  - 批量删除只允许勾选当前真正可删除的任务
- 我的商品 / 商品广场体验已补齐：
  - 我的商品里上下架后，当前 tab 列表会立即更新，不用切标签手动刷新
  - 我的商品页已支持下拉刷新
  - 商品广场已支持下拉刷新，不再只能依赖顶部“点我刷新”
- 头像与 loading 体验已补齐：
  - 我的页 / 聊天页 / 商品咨询页头像已加本地临时链接缓存，进入页面时不再每次都慢 1~2 秒才出现
  - 全局 `ui-loading` 组件已修复 canvas 残影问题，不再在“我的”等页面留下人物动画残留
- 钱包页已展示：
  - 收入
  - 支出
  - 提现相关流水
- 钱包主文档已做唯一化保护：
  - 每个用户固定 1 个主钱包文档
  - 历史重复钱包会在资金写入前自动归并为影子钱包，避免余额分叉
- 提现页已接入：
  - 绑定本人银行卡
  - 已绑卡后可只修改开户地址，不改卡号时可留空并复用当前已绑卡
  - 绑卡成功后自动开通默认提现方式 `D1`
  - 查询汇付余额
  - 发起提现
  - 主动查询提现结果
- 独立资金补偿任务已接入：
  - `financeCompensate` 已支持钱包修复、过期商品锁释放、退款同步、提现同步、延时分账重试、账本补齐
  - 管理员临时调试入口已挂到“我的-账户信息”页
  - 支持先做 `dryRun` 预检查，再执行真实补偿
- 汇付回调云函数已接入：
  - 支付回调
  - 任务退款回调
  - 用户业务入驻回调
  - 提现绑卡审核回调
  - 提现结果回调

### 1.2 当前联调结论

- `DM`、`D1` 到账方式都已经能开通。
- 用户侧流程已改为：
  - 不再给用户选择到账方式
  - 默认固定走 `D1`
  - 绑卡成功后后端自动补开 `D1`
- `DM` 提现经常会被汇付返回：
  - `DM取现额度不足`
- `D1` 提现可以成功受理：
  - 返回 `resp_code=00000000`
  - `resp_desc=受理成功`
  - `trans_stat=P`
- 提现短回调地址方案已经打通：
  - `?t=` 短参数可以被 `huifuPayNotify` 识别
  - 旧的 `?token=` 也仍兼容
- 商品聊天云函数已补齐并已部署：
  - `markGoodsMessagesRead` 已用于卖家 / 买家商品房间已读标记
- 任务退款已做过真实链路验证：
  - `scanpay_refund` 可成功发起原路退款
  - 遇到云函数超时但退款实际成功时，前端和后端都有兜底
  - `scanpay_refund_query` 已接入，当前走 `v3` 路径
  - 查询参数要用退款请求号 / 退款全局流水号，不要再用原支付单号
- 资金补偿任务已做过真实触发验证：
  - `dryRun=true` 预检查可正常返回扫描结果
  - `dryRun=false` 执行补偿可正常返回执行结果
  - 当前线上扫描结果显示：未发现待修的商品锁 / 提现 / 退款 / 分账异常单
  - `financeCompensateTimer` 已部署并开始定时执行
  - 已确认在北京时间 `2026-03-16 09:30`、`2026-03-16 09:40` 写入新的 `finance_compensate_logs`
- 任务确认完成金额口径已重新收敛：
  - 先按订单原价计算接单人应得 `96%`
  - 再按汇付返回的 `confirmable/unconfirm` 金额执行延时确认
  - 支付手续费由平台承担，不从接单人应得里扣
- 提现绑卡参数已按汇付官方文档复核：
  - `prov_id` / `area_id` 为必填
  - `mp` 在官方表里是非必填
  - 当前项目已改成跟随官方口径：页面不再要求填写手机号，后端也允许不传 `mp`
- 多人并发商品购买已做过真实验证：
  - 同一商品双人同时购买时，只会有一人成功拿到购买资格
- 企业进件逻辑已经全部删除，不要再往这个方向改。

### 1.3 仍未完全确认

- 提现最终到账成功后的完整回调闭环，还需要继续真机联调。
- 提现手续费如果未来不是 `0.00`，需要重新核对钱包镜像账本。
- 如果后续要支持“拒绝取消申请”或“平台介入”，还需要单独补业务流转。
- 商品聊天现在已经可用，但仍然是基础版：
  - 还没有全局消息中心
  - 也没有订阅消息 / 小程序消息提醒
- 手机号查看申请和任务取消申请目前都只有“同意”链路：
  - 页面状态里虽然兼容了 `rejected`
  - 但前后端都还没有真正的“拒绝”动作入口
- 接单人提交完成后，目前只会写 `tasks.submit`：
  - 发布者能在任务详情里看到
  - 但聊天页 / 会话列表里还没有单独的“已提交完成”消息提醒
- 商品详情里的“查看卖家主页”当前仍是占位按钮，尚未接成真实卖家主页

### 1.4 当前上线建议

- 以当前代码状态看，项目已经可以进入灰度上线 / 小范围上线：
  - 注册
  - 商品支付
  - 任务支付
  - 任务取消退款
  - 提现基础流程
  - 商品聊天
  这些核心链路都已经接通。
- 但不建议直接按“完全稳定版”放量上线，主要原因有：
  - 提现最终到账回调闭环还没有完全真机验证完
  - 还缺至少一轮双账号 / 多设备真机并发回归
  - 商品聊天目前仍是基础版，没有全局消息中心和订阅提醒
- 当前更准确的上线口径是：
  - 已达到“可以提审 + 可以灰度发布”的状态
  - 还没有达到“可以无观察直接全量放量”的状态
- 如果准备正式放量，建议至少先补做这 3 类动作：
  - 真机完整跑一次 `D1` 绑卡 -> 提现 -> 到账 -> 回调回写
  - 真机完整跑一次商品链路和一次任务链路，确认支付 / 聊天 / 提交 / 确认 / 退款状态都能收口
  - 至少再做一次双账号并发验证：同一商品双人抢购、同账号重复提现、任务确认完成连续点击

### 1.5 当前待完成项

- 这一轮资金安全主线暂未完全结束，后续修完其他 bug 后需要回到这里继续收尾。
- 当前剩余的上线前动作：
  - 再测：支付成功后直接退出小程序，确认回调 / 补偿能自动收口
  - 再测：`D1` 提现完整链路，确认到账和状态回写闭环
  - 再测：同一账号连续点击提现，只能受理一笔
  - 再测：任务确认完成连续点击，不能重复分账
  - 如果时间允许，再测：退款动作重复触发，不会重复退款
  - 连续观察 `finance_compensate_logs` 至少 `1-3` 天，确认定时补偿稳定执行、没有长期卡单
- 当前临时管理员补偿入口仅用于联调：
  - 等上述验证完成并确认稳定后，建议移除页面入口或继续严格限制为管理员可见
- 正式提审 / 发布前还要补的运维动作：
  - 复核生产环境的汇付参数、`SYSTEM_COMPENSATE_TOKEN`、回调地址等环境变量，并留一份备份
  - 复核云数据库权限规则，确认敏感写操作只走云函数
  - 准备灰度发布，不要直接全量上线

---

## 2. 当前业务口径

### 2.1 普通用户收款

- 用户实名后自动开通收款。
- 用户端不再单独展示收款状态页。
- 正常情况下用户无需手动处理。
- 如果收款状态异常，统一联系管理员。
- 接单前必须满足：
  - `huifu_id` 存在
  - `huifu_open_status=success`
  - `user_busi_status=success`

### 2.2 商品分账

- 当前默认平台费率：`4%`
- 用户分成：`96%`
- 实际费率代码默认值在：
  - `hyyc/cloudfunctions/huifuMiniappPay/index.js`
  - `hyyc/cloudfunctions/goodsPurchase/index.js`
- 若环境变量 `HUIFU_PLATFORM_FEE_RATE` 存在，会覆盖默认值。

### 2.3 任务分账

- 任务发布时先付款。
- 发布者确认完成后再做延时分账。
- 当前默认分账比例同商品：
  - 平台 `4%`
  - 接单人 `96%`
- 正式资金口径：
  - 接单人按订单原价固定拿 `96%`
  - 平台拿“可确认金额减去接单人应得金额”的剩余部分
  - 如果支付手续费导致 `confirmable` 小于订单原价，差额由平台承担
- 如果出现 `confirmable` 甚至小于接单人应得金额的异常单，后端直接失败并释放锁，不允许少给接单人
- 正式实现依赖：
  - `tasks.pay.orderAmtYuan`
  - `tasks.pay.confirmableAmtYuan`
  - `tasks.pay.unconfirmAmtYuan`
  - `tasks.pay.feeAmtYuan`
- `huifu_api_debug_logs` 现在只作为调试日志，不再参与任务确认金额推导。
- 任务取消退款口径：
  - 未接单：发布者可直接取消并原路退款
  - 已接单 / 已提交：发布者先发起取消申请，接单人同意后原路退款
- 退款不会回到小程序钱包余额：
  - 走的是汇付原交易退款，再由微信支付原路退回支付账户

### 2.4 提现

- 用户页面不再展示到账方式选择。
- 当前用户侧默认固定：
  - `D1`
- 绑卡成功后，后端会自动尝试开通默认提现方式。
- 如果第三方侧当下还没完全同步：
  - 提现页加载时会自动补开一次
  - 用户直接点提现时也会再自动补开一次
  - 仍未完成时，给用户提示“提现功能准备中，请稍后再试”
- 后端代码仍保留 `DM / D1 / T1` 的兼容能力，但小程序不再暴露给用户选择。
- 当前测试环境最低提现金额已改为 `1` 元。
- 正常逻辑下，一次只允许 1 笔处理中提现，避免重复提现。
- 按汇付 `用户业务入驻修改 /v2/user/busi/modify` 当前官方参数表：
  - `card_info.prov_id` 必填
  - `card_info.area_id` 必填
  - `card_info.mp` 非必填
- 当前项目实现已收敛到官方口径：
  - 前端提现绑卡页不再展示手机号输入框
  - 后端 `walletWithdraw action=bind_card` 允许不传 `bankMobile/mp`
  - 当前页面实际要求只有：银行卡号 + 开户地址（省、市）
  - 如果用户已经绑过卡，只改开户地址时可以不重新输入银行卡号

### 2.5 用户端展示口径

- `我的-账户信息` 页只展示并允许修改：
  - 昵称
  - 楼栋
  - 门牌号
- 页面保留“联系管理员”信息。
- 不再保留单独的“收款开通 / 收款状态”页面。
- 不要再把“去账户页手动开通收款”作为默认产品方案。
- `我的-商品` 当前展示并支持管理的状态：
  - `pending`
  - `need_fix`
  - `posted`
  - `off_shelf`
  - `sold`
- 商品聊天卖家入口当前有两处：
  - 商品详情底部“咨询会话”
  - 我的商品列表里的“咨询会话”
- 商品详情页顶部卖家信息展示口径：
  - 优先读发布者公开资料
  - 如果公开资料读取失败，回退到商品里保存的卖家快照字段
- 收藏和浏览记录不单独新开集合：
  - 统一写在当前用户自己的 `userInfo` 文档里
- 老商品如果创建时还没带 `ownerAvatarFileID` 快照：
  - 编辑并重新保存一次后会自动补齐
  - 在补齐前，如果公开资料读取失败，可能只能回退昵称或默认头像

---

## 3. 不要误解的几个点

### 3.1 钱包页余额 = 汇付官方可用余额

- 钱包页顶部余额应展示汇付账户真实可用余额。
- 用户通过 `wx.requestPayment` 完成的商品购买 / 任务付款，资金来自微信支付（微信零钱/银行卡），不应扣减这里的余额。
- 本地 `wallet_transactions` 只作为“收支明细镜像”：
  - 影响汇付余额的记录：收入、提现、提现手续费、提现退回
  - 不影响汇付余额的记录：商品购买、任务付款、任务原路退款
- 提现仍然以汇付余额为准。

### 3.2 注册阶段不会自动开通提现

- 注册阶段只做：
  - 开户
  - 用户业务入驻
- 不会自动开通取现。
- 原因：
  - 汇付对接已确认，开通结算/取现时需要 `card_info`
  - 注册阶段没有银行卡资料

### 3.3 当前只支持本人银行卡

- 绑定银行卡时，要求：
  - 银行卡姓名 = 实名用户姓名
  - 开户地址（省 / 市）必须填写
- 不支持绑配偶或其他人的银行卡。
- 汇付官方文档当前口径：
  - `prov_id / area_id` 必填
  - `mp` 非必填
- 现网测试现象：
  - 即使填写的不是银行留存手机号，也可能绑卡 / 提现成功
  - 这说明当前接口未必严格把 `mp` 校验为“银行预留手机号”
  - 因此当前产品先不要求用户填写银行卡手机号，后续如业务需要再补回

---

## 4. 官方接口文档

- 个人用户基本信息开户
  https://paas.huifu.com/open/doc/api/#/yhgl/api_yhgl_gryhjbxxzc

- 用户业务入驻
  https://paas.huifu.com/open/doc/api/#/yhgl/api_yhgl_ywrz

- 用户业务入驻修改
  https://paas.huifu.com/open/doc/api/#/yhgl/api_yhgl_ywrzxg

- 用户信息查询
  https://paas.huifu.com/open/doc/api/#/yhgl/api_yhgl_yhywcx

- 账户余额信息查询
  https://paas.huifu.com/open/doc/api/#/jyjs/api_jyjs_yuexxcx

- 取现
  https://paas.huifu.com/open/doc/api/#/jyjs/qx/api_qx

- 提现结果查询
  对照官方 SDK / `/v2/trade/settlement/query`

- 聚合正扫 / 小程序支付
  https://paas.huifu.com/open/doc/api/#/smzf/api_jhzs?id=appwx

---

## 5. 核心代码入口

### 5.1 前端页面

- 实名页
  `hyyc/pages/auth/realname/index.js`

- 账户信息页
  `hyyc/pages/profile/account/index.js`
  `hyyc/pages/profile/account/index.wxml`
  `hyyc/pages/profile/account/index.wxss`
  说明：
  - 当前已临时挂管理员“资金补偿调试”面板
  - 支持 `预检查(dryRun)` 和 `执行补偿`

- 钱包页
  `hyyc/pages/profile/wallet/index.js`
  `hyyc/pages/profile/wallet/index.wxml`

- 提现页
  `hyyc/pages/profile/withdraw/index.js`
  `hyyc/pages/profile/withdraw/index.wxml`
  说明：
  - 绑卡区域当前只保留脱敏已绑卡信息、银行卡号输入、省市选择、保存按钮
  - 不再展示额外的长段说明文案

- 商品发布页
  `hyyc/pages/publish/goods/index.js`

- 商品详情 / 收藏 / 支付页
  `hyyc/pages/goods/detail/index.js`

- 商品咨询会话列表页
  `hyyc/pages/chat/goods-sessions/index.js`
  `hyyc/pages/chat/goods-sessions/index.wxml`

- 商品咨询单聊页
  `hyyc/pages/chat/goods-room/index.js`
  `hyyc/pages/chat/goods-room/index.wxml`

- 我的商品页
  `hyyc/pages/profile/goods/index.js`
  `hyyc/pages/profile/goods/index.wxml`

- 我的收藏页
  `hyyc/pages/profile/favorites/index.js`
  `hyyc/pages/profile/favorites/index.wxml`

- 我的页
  `hyyc/pages/profile/index/index.js`
  `hyyc/pages/profile/index/index.wxml`

- 任务发布支付页
  `hyyc/pages/publish/task/index.js`

- 任务聊天页（取消申请 / 同意取消）
  `hyyc/pages/chat/room/index.js`
  `hyyc/pages/chat/room/index.wxml`

- 任务详情页（提交按钮 / 退款状态同步）
  `hyyc/pages/task/detail/index.js`
  `hyyc/pages/task/detail/index.wxml`

- 我发布的任务列表页（取消入口 / 删除限制提示）
  `hyyc/pages/profile/tasks/index.js`
  `hyyc/pages/profile/tasks/index.wxml`

- 任务提交完成页
  `hyyc/pages/task/submit/index.js`

### 5.2 云函数

- 注册实名主流程
  `hyyc/cloudfunctions/registerUserByIdCard/index.js`

- 收款开通补偿 / 手工重试（当前无前端入口）
  `hyyc/cloudfunctions/huifuUserApplyForMe/index.js`

- 汇付统一入口
  `hyyc/cloudfunctions/huifuMiniappPay/index.js`

- 资金补偿任务
  `hyyc/cloudfunctions/financeCompensate/index.js`

- 资金补偿定时 wrapper
  `hyyc/cloudfunctions/financeCompensateTimer/index.js`
  `hyyc/cloudfunctions/financeCompensateTimer/config.json`

- 管理员代调资金补偿
  `hyyc/cloudfunctions/adminFinanceCompensate/index.js`

- 管理员登录
  `hyyc/cloudfunctions/adminLogin/index.js`

- 提现编排
  `hyyc/cloudfunctions/walletWithdraw/index.js`

- 汇付回调
  `hyyc/cloudfunctions/huifuPayNotify/index.js`

- 商品支付后落库
  `hyyc/cloudfunctions/goodsPurchase/index.js`

- 商品详情卖家公开资料读取
  `hyyc/cloudfunctions/getUserPublicProfile/index.js`

- 商品聊天已读标记
  `hyyc/cloudfunctions/markGoodsMessagesRead/index.js`

- 任务支付成功后落库
  `hyyc/cloudfunctions/taskPaySuccess/index.js`

- 任务创建
  `hyyc/cloudfunctions/taskCreate/index.js`

- 任务接单校验
  `hyyc/cloudfunctions/taskAccept/index.js`

- 任务提交完成
  `hyyc/cloudfunctions/taskSubmit/index.js`

- 任务取消 / 退款编排
  `hyyc/cloudfunctions/taskCancelFlow/index.js`

- 已付款任务删除保护
  `hyyc/cloudfunctions/deleteTaskWithMessages/index.js`

### 5.3 公共组件 / 工具

- 全局 loading 组件
  `hyyc/components/ui/loading/index.js`
  `hyyc/components/ui/loading/index.wxml`

- 头像临时链接缓存
  `hyyc/utils/avatarCache.js`

---

## 6. 现在的完整链路

### 6.1 注册实名链路

1. 前端实名页提交资料。
2. `registerUserByIdCard` 做 OCR / 实名资料保存。
3. 调 `huifuMiniappPay action=user_indv_open`
4. 调 `huifuMiniappPay action=user_busi_open`
5. 回写 `userInfo`：
   - `huifu_id`
   - `huifu_open_status`
   - `user_busi_status`
6. 用户端不再单独展示“收款开通”页面，默认按自动开通口径处理。

### 6.2 商品支付链路

1. 商品页调用 `huifuMiniappPay` 下单。
2. 汇付返回 `pay_info`
3. 前端 `wx.requestPayment`
4. 成功后 `goodsPurchase` 落库
5. 钱包镜像账本写：
   - 买家支出明细（仅记录“微信支付已完成”，不扣汇付余额）
   - 卖家收入（计入汇付余额）

### 6.2.1 商品聊天链路

1. 买家在商品详情页点击“聊一聊”。
2. 页面进入 `pages/chat/goods-room/index`：
   - 按商品 `gid` + 卖家 / 买家身份初始化房间
   - 文本消息和图片消息都写进 `messages`
   - 当前消息记录会带：
     - `bizType=goods`
     - `gid`
     - `sellerId / sellerOpenid`
     - `peerUserId / peerOpenid`
3. 卖家在以下任一入口查看咨询：
   - 商品详情页底部“咨询会话”
   - 我的商品卡片上的“咨询会话”
4. 卖家进入 `pages/chat/goods-sessions/index` 后：
   - 按商品聚合当前所有咨询用户会话
   - 显示每个买家的最后一条消息与未读数
5. 已读标记：
   - 优先调用云函数 `markGoodsMessagesRead`
   - 如果开发环境漏部署，前端房间页会临时兜底标记，避免未读一直不消

### 6.3 任务支付链路

1. 发布页先调用 `taskCreate` 建立待支付任务。
2. 前端调用 `huifuMiniappPay` 下单。
3. 前端 `wx.requestPayment`。
4. 成功后 `taskPaySuccess` 把任务改为可展示。
5. 接单人接单时调用 `taskAccept`：
   - 云函数内部用事务锁任务，避免多人同时接单成功
6. 接单人提交完成时调用 `taskSubmit`：
   - 现在要求“完成说明”或“至少 1 张凭证”二选一
   - 提交内容会写进 `tasks.submit`
   - 发布者可在任务详情页直接查看
7. 发布者确认完成后：
   - `huifuMiniappPay action=delay_confirm_task` 做延时分账
   - 只按任务文档中已保存的 `pay.confirmableAmtYuan / feeAmtYuan / orderAmtYuan` 等元数据执行
   - 不再从调试日志反推金额
8. 钱包镜像账本写：
   - 发布者付款明细（仅记录“微信支付已完成”，不扣汇付余额）
   - 接单人收入（计入汇付余额）

### 6.3.1 钱包页 UI 约定

- 明细列表要明确区分：
  - `余额变动`：会影响顶部余额
  - `消费记录`：只展示消费情况，不影响顶部余额
- 明细很多时，优先用：
  - 类型筛选（全部 / 余额变动 / 消费记录）
  - 分页 / 加载更多

### 6.3.2 任务取消 / 退款链路

1. 未接单任务：
   - 发布者可直接取消
   - `taskCancelFlow action=cancel_direct`
   - 内部调用 `huifuMiniappPay action=scanpay_refund`
2. 已接单 / 已提交任务：
   - 发布者在聊天页发起取消申请
   - `taskCancelFlow action=request` 会写入 `tasks.cancelRequest`
   - 同时写一条 `messages.type=task_cancel_request`
3. 接单人在聊天页点“同意取消”：
   - `taskCancelFlow action=approve`
   - 内部调用 `huifuMiniappPay action=scanpay_refund`
   - 任务会先立刻写成 `cancelled + refund_pending`
   - 接单人任务详情页里的“提交完成”按钮要立刻禁用
4. 退款成功后：
   - 任务状态改为 `cancelled`
   - `cancelRequest.status` 改为 `approved`
   - `pay.status` 改为 `refunded`
   - 聊天卡片文案会改成“任务已取消”
5. 退款处理中时：
   - `cancelRequest.status` / `pay.status` 会写成 `refund_pending`
   - 聊天页会监听任务文档，并持续短轮询补查
   - 任务详情页 / 我的任务页会持续短轮询补查
6. 当前主动查询口径：
   - `huifuMiniappPay action=scanpay_refund_query`
   - 当前路径是 `/v3/trade/payment/scanpay/refundquery`
   - 查询入参要用退款请求号 `RF...` / 退款全局流水号 `0031...`
   - 不要再用原支付单号 `TK...` / 原支付全局流水号 `0029...`
7. 当前特殊兜底：
   - 如果汇付返回“申请退款金额大于可退款余额”，代码会按“这笔退款已经处理过”来兜底成功，防止重复点击后页面还停在待处理

### 6.4 提现链路

#### 步骤 1：绑定银行卡

- 页面调用 `walletWithdraw action=bind_card`
- 云函数内部调：
  - `/v2/user/busi/modify`
- 本次先传 `card_info`
- 如果绑卡成功且已拿到可用 `token_no`：
  - 后端会立刻自动补开默认 `D1`
  - 内部先调 `/v2/user/busi/open`
  - 再调 `/v2/user/busi/modify`
  - `cash_type` 不能放顶层，必须写进 `cash_config`
- 如果第三方当下还没同步完成，页面会提示“提现功能准备中”
- 当前官方文档口径：
  - `card_info.prov_id` / `card_info.area_id` 必填
  - `card_info.mp` 非必填
- 当前项目实现口径：
  - 不再要求用户填写银行卡手机号
  - 仍要求选择开户地址（省、市）
  - 已绑卡后只改开户地址时，可不重新输入银行卡号
  - 与当前官方参数表一致

#### 步骤 2：发起提现

- 页面调用 `walletWithdraw action=submit`
- 云函数内部调：
  - `/v2/trade/settlement/encashment`
- 如果发现默认提现方式还没准备好：
  - 提交前会自动再补开一次 `D1`
  - 仍未完成则返回“提现功能准备中，请稍后再试”

#### 步骤 3：查询提现结果

- 正常依赖汇付回调
- 如果老单没有回调：
  - 提现页加载时会自动查一次
  - 顶部“立即同步提现状态”按钮会调用 `walletWithdraw action=sync_active_withdraw`
  - 后端内部主动调 `/v2/trade/settlement/query`

### 6.5 资金补偿链路

1. 管理员在“我的-账户信息”页打开临时调试面板。
2. 页面调用 `adminFinanceCompensate`：
   - 管理员账号密码校验通过后
   - 由后端代调 `financeCompensate`
3. `预检查` 对应：
   - `action=run_all`
   - `dryRun=true`
   - 只扫描，不落库
4. `执行补偿` 对应：
   - `action=run_all`
   - `dryRun=false`
   - 真正执行修复
5. 当前 `financeCompensate` 会做：
   - `repairWalletDocs`
   - `releaseExpiredGoodsLocks`
   - `syncTaskRefunds`
   - `syncWithdraws`
   - `retryDelayConfirms`
   - `repairMissingLedgers`
6. 执行结果会同时输出到：
   - 页面结果区
   - 云函数日志
   - 集合 `finance_compensate_logs`
7. 正式定时任务实现：
   - 使用 `financeCompensateTimer`
   - 由定时触发器每 `10` 分钟后台调用一次 `financeCompensate run_all`
   - 不对小程序前端开放
8. 当前线上确认口径：
   - 以集合 `finance_compensate_logs` 是否持续新增记录为准
   - 不要只依赖云函数详情页里的日志展示

---

## 7. 当前实现细节

### 7.1 提现状态主动查询

- 如果本地库里存在 1 笔 `processing/pending` 的提现单：
  - 提现页加载时会自动查一次
  - 页面顶部也有“立即同步提现状态”按钮
- “立即同步提现状态”不再只是整页重刷：
  - 前端会调用 `walletWithdraw action=sync_active_withdraw`
  - 后端如果第一次查询仍是 `P`，会等待约 `1.2` 秒再补查一次
  - 同步后会明确给用户提示：已到账 / 仍在处理中 / 同步失败
- 主动查询结果会回写：
  - `wallet_withdraw_requests`

### 7.2 提现并发保护

- 提现测试绕过逻辑已经删除：
  - `ignoreActiveWithdrawForTest`
  - `TEST_BYPASS_PENDING`
  - `onForceSubmitWithdraw`
  - `forceTestBypass`
- 现在前后端都统一要求：
  - 同一用户只允许存在 1 笔处理中提现
  - 发现 `activeWithdraw` 时，前端直接拦截，后端也会再次拦截
- 这样做的目的：
  - 避免联调残留逻辑进入生产
  - 避免重复提现和后续对账混乱

### 7.2.1 钱包唯一文档保护

- 现在所有资金写入前，都会先检查当前用户钱包是否已存在：
  - 主钱包文档
  - 历史影子钱包文档
- 处理口径：
  - 主钱包只认固定 docId = 当前用户 `openid`
  - 历史重复钱包会标记为 `legacy_shadow`
  - 已经标记为影子钱包的文档，后续不会再重复计入主钱包余额
- 这样做的目的：
  - 避免“首次并发写入”或历史脏数据导致一个用户出现多份钱包余额
  - 避免补偿任务或后续资金写入把影子钱包反复叠加

### 7.3 当前已知提现行为

- 用户侧默认只走 `D1`。
- 绑卡成功后，后端会自动尝试开通 `D1`。
- 首次绑卡后的短时间内，如果第三方侧状态还没同步好，页面可能短暂提示：
  - `提现功能准备中，请稍后再试`
- `DM`：
  - 经常直接失败
  - 常见原因：`DM取现额度不足`
- `D1`：
  - 能成功受理
  - 常返回：
    - `resp_code=00000000`
    - `resp_desc=受理成功`
    - `trans_stat=P`
- `P` 不代表失败，只代表处理中。

### 7.4 当前任务取消实现细节

- 前端审批入口已经从聊天消息卡片里移到固定横幅：
  - 避免 `scroll-view` 内点击事件不稳定
- 接单人点击“同意取消”后：
  - 按钮会立刻进入“处理中...”
  - 同一请求会被前端锁住，防止重复点击
  - 任务详情页重新显示时，会先刷新任务文档
  - 如果任务已经进入 `cancelled / refund_pending / refunded`，接单人的“提交完成”按钮会立刻禁用
- 如果退款实际成功，但前端调用因为超时没拿到结果：
  - 前端会回读任务状态
  - 如果已是 `cancelled + refunded/refund_pending`，页面直接按成功处理
- 页面实时性说明：
  - 聊天页会 `watch tasks.doc(tid)`，回调或主动查询改库后会立刻刷新卡片状态
  - 聊天页在 `refund_pending` 时还会每 `3` 秒主动补查一次
  - 我的任务页 / 任务详情页在 `refund_pending` 时会每 `3` 秒静默刷新一次
- 如果重复点击导致汇付返回：
  - `申请退款金额大于可退款余额`
  现在前后端都按“退款已处理”兜底，不再把页面留在“等待接单人同意”
- 退款镜像流水说明：
  - 会写 `wallet_transactions`
  - 但 `affectsBalance=false`
  - 只是消费 / 退款明细镜像，不回到汇付余额，也不回到小程序钱包余额

### 7.5 当前商品详情 / 收藏实现细节

- 商品发布 / 编辑时，前端会把这些卖家快照一起写进 `goods`：
  - `ownerOpenid`
  - `ownerNickname`
  - `ownerAvatarFileID`
- 商品详情读取卖家信息时：
  - 先按 `goods._openid` 调 `getUserPublicProfile`
  - 返回值里的 `_openid` 必须和商品发布者一致才会使用
  - 如果云函数失败或返回不匹配，才回退到商品快照
- 这样做的原因：
  - 避免详情页错误显示“当前登录用户”的头像昵称
  - 避免以后再次出现用户侧串号
- 收藏和浏览记录当前存储方式：
  - `userInfo.goodsFavorites`
  - `userInfo.goodsBrowseHistory`
- 浏览记录触发时机：
  - 商品详情页成功加载后自动写入
- 当前数量上限：
  - 收藏最多保留 `60` 条
  - 浏览记录最多保留 `100` 条
- 去重规则：
  - 都按 `goodsId` 去重
  - 新一次访问 / 收藏会顶到最前面

### 7.6 当前任务提交展示 / 删除实现细节

- 接单人提交完成后，云函数只会更新：
  - `tasks.status=submitted`
  - `tasks.submit.note`
  - `tasks.submit.images`
  - `tasks.submit.submittedAt`
- 发布者查看入口当前放在任务详情页：
  - 页面会把 `submit.images` 里的 `cloud://` 文件转成临时链接后再展示
  - 点击图片可直接预览
- 已完成任务现在允许发布者删除“记录”：
  - 前端入口在“我的任务”
  - 云函数 `deleteTaskWithMessages` 也已放开 `status=completed`
- 发起支付但未真正支付成功的 `pay_pending` 任务：
  - 取消微信支付后允许删除
  - 后端不会再把“仅发起过支付”误判成“已支付完成”
- 批量删除限制：
  - 只有“未真正支付成功的 `pay_pending`” / `completed` / `cancelled+refunded` 会被算作可删除
  - 其它任务在批量模式下会显示但不可勾选

### 7.7 当前商品列表 / 商品聊天 / 头像 / loading 实现细节

- 我的商品上下架：
  - 更新成功后会直接在当前列表本地改状态 / 移除条目
  - 同时写入 `hyyc_goods_refresh_token`，通知商品广场下次进入时刷新
- 商品聊天：
  - 已新增 `pages/chat/goods-room` 和 `pages/chat/goods-sessions`
  - 卖家未读会显示在：
    - 商品详情页底部“咨询会话”按钮
    - 我的商品列表里的“咨询会话”按钮
  - 我的商品页按“每个商品”的未读数聚合
  - 商品详情页按“当前商品总未读数”聚合
  - 商品聊天头像会先读本地缓存，再后台补公开资料
  - 房间页已读优先走云函数 `markGoodsMessagesRead`
  - 如果开发环境没部署这个云函数，房间页会自动降级成前端兜底更新，避免开发时一直报 `FUNCTION_NOT_FOUND`
- 商品广场刷新：
  - 保留顶部“有新商品，点我刷新”
  - 现在也支持原生下拉刷新第一页
- 头像缓存：
  - 新增 `avatarCache`，把 `cloud://` 头像换到的临时链接缓存到本地
  - 我的页和聊天页会优先读缓存，减少重复 `getTempFileURL`
- 全局 loading：
  - 旧实现用 `hidden` 隐藏 canvas，真机 / 开发者工具偶发残影
  - 现在改成显示时挂载、隐藏时销毁，避免“人物动画残留”问题

---

## 8. 数据库集合

### 8.1 业务数据

- `userInfo`
  - 用户实名信息
  - 汇付开户状态
  - 用户业务入驻状态
  - 提现绑卡快照
  - 商品收藏 `goodsFavorites`
  - 商品浏览记录 `goodsBrowseHistory`

- `wallets`
  - 本地钱包镜像余额

- `wallet_transactions`
  - 本地钱包镜像流水

- `tasks`
  - 任务主表
  - 含任务支付信息 `pay`
  - 含取消申请信息 `cancelRequest`

- `goods`
  - 商品主表
  - 含卖家快照字段：
    - `ownerOpenid`
    - `ownerNickname`
    - `ownerAvatarFileID`
  - 含商品展示状态：
    - `pending`
    - `need_fix`
    - `posted`
    - `off_shelf`
    - `sold`

- `messages`
  - 聊天消息
  - 取消申请会写 `type=task_cancel_request`

### 8.2 调试 / 回调数据

- `wallet_withdraw_requests`
  - 每笔提现申请
  - 请求报文
  - 响应报文
  - 当前状态

- `huifu_api_debug_logs`
  - 所有实际发往汇付的请求/响应
  - 仅用于联调排查
  - 不参与正式资金判断

- `function_debug_traces`
  - 云函数命中轨迹
  - 用于判断前端到底有没有调到指定云函数

- `huifu_notify_logs`
  - 汇付回调日志摘要

- `finance_compensate_logs`
  - 每次资金补偿任务的执行摘要
  - 用于追踪 `dryRun` / 真执行结果

- `tasks`
  - 重点看 `status`
  - `pay.status`
  - `pay.refund.reqDate / reqSeqId / hfSeqId`
  - `cancelRequest.status`

---

## 9. 最重要的调试方法

### 9.1 先看哪个集合

1. 先按场景看业务主表：
   - 任务看 `tasks`
   - 提现看 `wallet_withdraw_requests`
2. 再看 `huifu_notify_logs`
3. 再看 `huifu_api_debug_logs`
4. 再看 `function_debug_traces`

### 9.2 看什么字段

- `huifu_api_debug_logs`
  - `action`
  - `apiPath`
  - `copyableRequestJson`
  - `copyableResponseJson`
  - `reqDate`
  - `reqSeqId`
  - 说明：这里只用于排查“实际发了什么 / 汇付回了什么”，不是正式业务状态来源

- `wallet_withdraw_requests`
  - `status`
  - `statusText`
  - `reqDate`
  - `reqSeqId`
  - `hfSeqId`
  - `copyableRequestJson`
  - `copyableResponseJson`

- `function_debug_traces`
  - `functionName`
  - `action`
  - `buildTag`

- `tasks`
  - `status`
  - `pay.status`
  - `pay.refund.reqDate`
  - `pay.refund.reqSeqId`
  - `pay.refund.hfSeqId`
  - `cancelRequest.status`

### 9.3 常见判断

- 页面说失败，但 `withdraw_apply` 返回：
  - `resp_code=00000000`
  - `trans_stat=P`
  那就是已受理，不是失败。

- `DM` 失败但 `D1` 成功，通常不是代码错，是汇付业务规则不同。

- 如果页面显示“处理中”，先看：
  - `/v2/trade/settlement/query`
  是否已经返回 `S/F/P`

- 如果任务退款还停在“退款中”，先看：
  - `scanpay_refund_query` 的 `apiPath` 是否是 `/v3/trade/payment/scanpay/refundquery`
  - `copyableRequestJson` 里是否传了退款请求号 `RF...` 或退款全局流水号 `0031...`
  - 不要再把原支付单号 `TK...` / 原支付全局流水号 `0029...` 传给退款查询

- 如果任务退款同步返回：
  - `resp_code=00000100`
  - `trans_stat=P`
  那是“已受理，退款处理中”，不是失败。

- 如果回调没回写，但主动查询有结果：
  - 以主动查询结果为准

- 如果任务取消页提示失败，但你怀疑退款已经成功：
  - 先看 `huifu_api_debug_logs`
  - 筛 `action=scanpay_refund`
  - 再看 `tasks.pay.status` / `tasks.cancelRequest.status`

- 如果汇付返回：
  - `申请退款金额大于可退款余额`
  通常不是“新的退款失败”，而是“原单已经退过了”

---

## 10. 回调地址规则

### 10.1 当前回调接收函数

- `huifuPayNotify`

### 10.2 当前支持的 token 参数

- `?token=xxx`
- `?t=xxx`

代码位置：
- `hyyc/cloudfunctions/huifuPayNotify/index.js`

### 10.3 长度限制

- 汇付不同接口对 `notify_url` / `async_return_url` 的长度限制不完全一样
- 任务退款 `scanpay_refund` 当前文档是 `512`
- 但用户业务入驻 / 提现等老接口仍然要按各自文档约束处理
- 当前 CloudBase 域名很长，所以 token 必须尽量短

### 10.4 当前建议

- 建议 token 长度：
  - `16` 位
  - 或 `20` 位
- 不要再用很长的 token

当前固定前缀长度约为：
- `92`

所以：
- token `16` 位，总长约 `108`
- token `20` 位，总长约 `112`

这是安全区，不要再贴着旧接口的长度边界走。

---

## 11. 环境变量

### 11.1 `registerUserByIdCard`

- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `TENCENT_REGION`
- `ALLOWED_COMMUNITIES`
- `HUIFU_UPPER_HUIFU_ID`

### 11.2 `huifuUserApplyForMe`

- `HUIFU_UPPER_HUIFU_ID`

### 11.3 `huifuMiniappPay`

- 必配：
  - `HUIFU_SYS_ID`
  - `HUIFU_PRODUCT_ID`
  - `HUIFU_HUIFU_ID`
  - `HUIFU_PRIVATE_KEY` 或 `HUIFU_PRIVATE_KEY_PATH`
- 普通用户业务入驻必配：
  - `HUIFU_UPPER_HUIFU_ID`
- 小程序支付必配：
  - `HUIFU_SUB_APPID`
  - `HUIFU_NOTIFY_URL`
- 提现 / 绑卡建议配置：
  - `HUIFU_USER_BUSI_NOTIFY_URL`
  - `HUIFU_WITHDRAW_NOTIFY_URL`
- 平台分账费率可选：
  - `HUIFU_PLATFORM_FEE_RATE`

说明：
- `HUIFU_USER_BUSI_NOTIFY_URL` 不配时回退到 `HUIFU_NOTIFY_URL`
- `HUIFU_WITHDRAW_NOTIFY_URL` 不配时回退到 `HUIFU_NOTIFY_URL`
- 当前代码如果发现 URL 超长，会直接不上传，避免被汇付参数校验拦住
- 如果没有配置 `HUIFU_PLATFORM_FEE_RATE`：
  - 代码默认按 `4%` 平台费率执行

### 11.4 `goodsPurchase`

- 无新增必配环境变量
- 也会读取：
  - `HUIFU_PLATFORM_FEE_RATE`
- 如果该变量未配置：
  - 默认按 `4%` 平台费率镜像商品侧分账结果

### 11.5 `walletWithdraw`

- 无新增必配环境变量
- 依赖：
  - 当前用户已实名
  - 当前用户已开户
  - 当前用户已业务入驻
  - `huifuMiniappPay` 环境变量完整

### 11.6 `huifuPayNotify`

- 必配：
  - `HUIFU_NOTIFY_TOKEN`
  - `HUIFU_PLATFORM_PUBLIC_KEY`
- 建议也配：
  - `HUIFU_SYS_ID`
  - `HUIFU_PRODUCT_ID`
  - `HUIFU_HUIFU_ID`

### 11.7 资金补偿 / 管理员调试

- `financeCompensate` 必配：
  - `SYSTEM_COMPENSATE_TOKEN`
- `adminFinanceCompensate` 必配：
  - `SYSTEM_COMPENSATE_TOKEN`
- `financeCompensateTimer` 必配：
  - `SYSTEM_COMPENSATE_TOKEN`
  - 可选：`FINANCE_COMPENSATE_TIMER_LIMIT`
- 以下函数必须配置同一串 `SYSTEM_COMPENSATE_TOKEN`，否则补偿代调会失败：
  - `financeCompensate`
  - `financeCompensateTimer`
  - `huifuMiniappPay`
  - `taskCancelFlow`
  - `walletWithdraw`
  - `adminFinanceCompensate`
- 管理员账号密码可选环境变量：
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
- 如果配置了管理员账号密码环境变量：
  - `adminLogin`
  - `adminFinanceCompensate`
  这两个函数必须保持一致
- 如果未配置：
  - 当前代码仍会回退到默认管理员账号密码

---

## 12. 云函数部署要求

### 12.1 必须重新部署的函数

- `registerUserByIdCard`
- `huifuUserApplyForMe`
- `huifuMiniappPay`
- `taskCreate`
- `taskPaySuccess`
- `walletWithdraw`
- `huifuPayNotify`
- `goodsPurchase`
- `taskAccept`
- `taskSubmit`
- `taskCancelFlow`
- `deleteTaskWithMessages`
- `getUserPublicProfile`
- `financeCompensate`
- `financeCompensateTimer`
- `adminFinanceCompensate`
- `adminLogin`

### 12.2 超时建议

- `huifuMiniappPay`：`60 秒`
- `taskCancelFlow`：`60 秒`
- `walletWithdraw`：`60 秒`
- `huifuPayNotify`：`60 秒`

仓库中已有：
- `hyyc/cloudbaserc.json`

但如果开发是手动在云开发控制台上传，仍然要以线上配置为准检查一遍。

注意：
- `taskCancelFlow` 如果线上还是 `3 秒`，接单人点“同意取消”时很容易前端先报超时
- `huifuMiniappPay` 如果线上超时太短，也会导致退款实际已受理、前端却先失败

---

## 13. 当前 BuildTag 快照

以代码当前状态为准：

- `registerUserByIdCard@2026-03-13.3`
- `huifuUserApplyForMe@2026-03-13.3`
- `huifuMiniappPay@2026-03-15.4`
- `walletWithdraw@2026-03-15.4`
- `financeCompensate@2026-03-15.1`
- `financeCompensateTimer@2026-03-15.1`
- `adminFinanceCompensate@2026-03-15.1`

调试时：
- 用户页面不再展示 `buildTag`
- 云函数返回值和数据库 `function_debug_traces` 里仍会落 `buildTag`

---

## 14. 下一位开发上手顺序

建议严格按这个顺序来，不要直接跳进去改代码。

1. 先看这份文档。
2. 先读这 6 个文件：
   - `hyyc/cloudfunctions/huifuMiniappPay/index.js`
   - `hyyc/cloudfunctions/taskCancelFlow/index.js`
   - `hyyc/cloudfunctions/walletWithdraw/index.js`
   - `hyyc/cloudfunctions/huifuPayNotify/index.js`
   - `hyyc/pages/chat/room/index.js`
   - `hyyc/pages/profile/withdraw/index.js`
3. 去云开发确认环境变量。
4. 去数据库看这 4 个集合是否存在：
   - `wallet_withdraw_requests`
   - `huifu_api_debug_logs`
   - `function_debug_traces`
   - `huifu_notify_logs`
5. 真机跑一次：
   - 注册
   - 支付
   - 分账
   - 提现
6. 如果提现异常：
   - 先查 `huifu_api_debug_logs`
   - 不要先猜
7. 明确一条正式口径：
   - `huifu_api_debug_logs` 只用于排查，不允许作为正式资金逻辑依赖

---

## 15. 现在最该继续做的事

按优先级：

1. 用 `D1` 再做一次新提现，完整验证：绑卡 -> 提现 -> 到账 -> 回调回写。
2. 再做一次“支付成功后立刻退出小程序”的真实验证，确认任务 / 商品都能靠回调或补偿自动收口。
3. 做一次同账号重复提现测试，确认连续点击只能受理一笔。
4. 做一次任务“确认完成”连续点击测试，确认不会重复分账。
5. 如果时间允许，再做一次退款重复触发测试，确认不会重复退款。
6. 连续观察 `finance_compensate_logs` 至少 `1-3` 天：
   - 确认每 `10` 分钟都有新记录
   - 没有长期卡在 `refund_pending / confirming / processing / pay_pending` 的订单
7. 真机继续验证商品聊天：
   - 买家发送后，卖家“咨询会话”是否稳定显示未读
   - 进入房间后，已读状态是否及时回写
   - 买卖双方头像是否都能稳定加载
8. 正式提审前复核微信公众平台侧配置：
   - 隐私保护指引与实际调用的隐私接口保持一致
   - 类目、服务范围、资质材料和真实业务一致
   - 用户协议、隐私政策、客服联系方式可以正常访问
9. 发布策略固定为：
   - 先提审
   - 审核通过后先灰度发布
   - 灰度稳定后再全量发布
10. 如果产品要继续完善任务协商：
   - 增加“拒绝取消申请”
   - 增加“平台介入 / 客服介入”
11. 如果商品侧要继续补完整：
   - 增加全局消息中心
   - 增加订阅消息 / 小程序消息提醒
   - 接通真实卖家主页

---

## 16. 明确不做

- 不再恢复企业进件。
- 不再新增企业商户相关页面、云函数、回调。
- 不再恢复独立的“收款开通 / 收款状态”用户页面。
