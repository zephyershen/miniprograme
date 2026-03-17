# HYYC 项目开发交接手册

更新时间：2026-03-17

这份文档的目标不是讲概念，而是让一个完全没接触过本项目的人在第一次打开仓库后，能尽量少踩坑地完成：

- 认识项目真实形态
- 知道当前功能做到哪里
- 找到核心页面、云函数、数据表
- 理解商品 / 任务 / 资金三条主线的真实口径
- 明确哪些函数必须部署、哪些环境变量必须配
- 遇到问题时知道先查哪里
- 立刻开始继续开发，而不是先花半天猜现状

---

## 1. 一句话认识这个项目

`HYYC` 是一个面向合作小区住户的微信小程序，当前有两条主要业务线：

- 社区任务：发布任务、支付、接单、提交完成、确认完成、取消退款、申请查看手机号
- 闲置商品：发布商品、图片审核、上架、收藏、浏览记录、聊天咨询、购买、已买到/已发布管理

资金链路依赖：

- 腾讯云云开发：数据库、云函数、文件存储
- 汇付：开户、业务入驻、小程序支付、延时分账、原路退款、提现
- COS 内容审核：商品图片审核

当前代码状态已经达到“可以灰度上线 / 可以继续开发”的阶段，但还不是“完全稳定、无需观察即可全量放量”的状态。

---

## 2. 新人第一天先记住这 10 件事

1. 微信开发者工具请直接打开 `hyyc/` 目录，不要打开仓库根目录。
2. 小程序是“源码 + 云函数仓库”形态，不是有后端服务和自动部署流水线的工程。
3. `hyyc/app.js` 里当前把云开发环境 ID 写死成了 `hyyc-1gi3f5sqc5becabf`，切环境时别只改控制台不改代码。
4. `hyyc/cloudbaserc.json` 不是完整的云函数部署清单，很多当前实际在用的函数没有写进去。
5. 云数据库权限规则不在仓库里，必须去云开发控制台确认；不要假设“前端能查就代表权限设计是对的”。
6. 商品模块现在强依赖 `getGoodsProfile`，如果这个函数没部署，`我的商品 / 我买到的 / 收藏 / 浏览记录 / 已售后详情` 都会不完整。
7. 买家或卖家跨角色读取商品/消息时，很多场景必须走云函数，不能偷懒直接前端查库，否则很容易报 `database permission denied`。
8. 收藏和浏览记录没有单独新集合，仍然写在 `userInfo` 文档里，但展示时会叠加最新商品快照。
9. 这个项目没有成体系的自动化测试，当前主要依赖真机联调、云函数日志和关键链路回归。
10. 当前最容易误判的地方不是代码逻辑，而是“漏部署云函数 / 漏配环境变量 / 数据库规则没对齐”。

---

## 3. 仓库与工程形态

### 3.1 仓库目录

- `docs/`
  - 项目文档
- `hyyc/`
  - 小程序主工程
  - 包含 `app.json`、`pages/`、`cloudfunctions/`
- `project.config.json`
  - 仓库根目录也有一个微信工程配置，但真正适合导入开发者工具的是 `hyyc/`
- `pics/`
  - 截图等临时素材

### 3.2 小程序主工程目录

- `hyyc/app.js`
  - 小程序启动入口
  - 当前写死 `wx.cloud.init({ env: 'hyyc-1gi3f5sqc5becabf' })`
- `hyyc/app.json`
  - 页面注册、分包、tabBar、隐私权限声明
- `hyyc/pages/`
  - 所有页面源码
- `hyyc/cloudfunctions/`
  - 所有云函数
- `hyyc/config/`
  - 前端访问控制与小区围栏配置
- `hyyc/utils/`
  - 公共工具
- `hyyc/components/`
  - UI 和聊天组件

### 3.3 重要前端配置

- `hyyc/config/access.js`
  - 前端允许的小区名称
  - 功能开关：
    - `taskWorkflow`
    - `goodsChat`
  - 首页“特定人群使用说明”
- `hyyc/config/community.js`
  - 小区地理围栏配置
  - 当前只有：
    - `花语云萃`
    - 半径 `220m`

注意：

- 前端 `access.js` 只是展示和入口限制，不是安全边界。
- 真正的账号校验、小区校验、读写权限，仍然必须在云函数和数据库规则里兜住。

### 3.4 工程化现状

- 没有完整 CI/CD
- 没有系统化单元测试 / E2E 测试
- `miniprogram_npm/` 已经在仓库中
- 如果本地 npm 依赖丢失，可在 `hyyc/` 下执行 `npm install`
- 当前依赖很轻：
  - `@babel/runtime`
  - `lottie-miniprogram`

---

## 4. 当前产品范围与真实状态

### 4.1 已经接通的核心能力

- 注册实名
  - 手机号换取
  - 身份证 OCR / 实名资料
  - 普通用户开户
  - 用户业务入驻
- 商品
  - 发布
  - 编辑
  - 图片审核
  - 上下架
  - 购买
  - 收藏
  - 浏览记录
  - 商品聊天
  - 我的商品
  - 我买到的
- 任务
  - 发布并支付
  - 接单
  - 提交完成
  - 发布者确认完成
  - 取消退款
  - 任务聊天
  - 查看对方资料与手机号申请
- 钱包 / 提现
  - 钱包镜像账本
  - 查询汇付余额
  - 绑卡
  - 默认 `D1` 提现
  - 主动同步提现状态
- 资金安全
  - 商品支付锁
  - 任务退款状态追踪
  - 延时分账重试
  - 钱包修复
  - 管理员补偿入口
  - 定时补偿任务

### 4.2 当前仍未完全收尾的点

- 提现最终到账后的完整回调闭环，还需要继续真机验证
- 商品“查看卖家主页”仍是占位按钮，未接成真实主页
- 商品聊天和任务聊天都还没有全局消息中心
- 商品聊天和任务聊天都还没有订阅消息 / 小程序消息提醒
- 任务取消申请目前只有“同意”链路，没有“拒绝”入口
- 手机号查看申请目前只有“同意”链路，没有“拒绝”入口
- 还缺至少一轮双账号 / 多设备真机回归

### 4.3 当前上线判断

- 已达到：
  - 可以提审
  - 可以灰度发布
  - 可以继续往真实用户场景联调
- 尚未达到：
  - 可以无观察直接全量放量

---

## 5. 页面地图

以下路径来自 `hyyc/app.json` 和当前分包配置。

### 5.1 主包页面

- `pages/welcome/index`
  - 欢迎页 / 登录入口 / 管理员隐藏入口
- `pages/home/index/index`
  - 任务广场
- `pages/goods/index/index`
  - 商品广场
- `pages/goods/detail/index`
  - 商品详情 / 收藏 / 购买 / 商品聊天入口
- `pages/publish/index/index`
  - 发布入口聚合
- `pages/publish/task/index`
  - 发布任务并支付
- `pages/publish/goods/index`
  - 发布 / 编辑商品
- `pages/profile/index/index`
  - 我的
- `pages/profile/account/index`
  - 账户信息 / 管理员补偿入口
- `pages/profile/tasks/index`
  - 我的任务
- `pages/profile/goods/index`
  - 我的商品 / 我买到的
- `pages/profile/favorites/index`
  - 我的收藏 / 浏览记录
- `pages/profile/wallet/index`
  - 钱包
- `pages/profile/withdraw/index`
  - 提现

### 5.2 分包页面

- `pages/auth/realname/index`
  - 实名注册
- `pages/auth/legal/doc/index`
  - 协议类页面
- `pages/task/detail/index`
  - 任务详情
- `pages/task/submit/index`
  - 任务提交完成
- `pages/chat/room/index`
  - 任务聊天
- `pages/chat/sessions/index`
  - 任务会话列表
- `pages/chat/goods-room/index`
  - 商品聊天房间
- `pages/chat/goods-sessions/index`
  - 商品咨询会话列表
- `pages/user/profile/index`
  - 任务场景下查看对方资料 / 申请查看手机号

---

## 6. 云函数地图

这一节非常重要。新同学最容易踩的坑，就是把云函数当成“只要部署支付相关几个就够了”。

### 6.1 前端直接调用的云函数

- 基础能力
  - `login`
    - 获取当前用户 `openid`
  - `exchangePhoneNumber`
    - 微信手机号 code 换手机号
- 注册 / 管理员
  - `registerUserByIdCard`
  - `adminLogin`
  - `adminFinanceCompensate`
- 商品主链路
  - `getGoodsProfile`
    - 收藏 / 浏览记录最新快照
    - 我的商品 / 我买到的
    - 商品详情权限兜底
    - 删除我的商品记录 / 购买记录
  - `getUserPublicProfile`
    - 商品详情 / 商品聊天读取卖家公开资料
  - `goodsPurchase`
    - 商品支付成功后落库
  - `markGoodsMessagesRead`
    - 商品聊天服务端已读
  - `imageAuditStart`
    - 商品图片审核任务启动
- 商品支付
  - `huifuMiniappPay`
    - 商品下单
    - 商品支付查询 / 释放锁等资金动作
- 任务主链路
  - `taskCreate`
  - `taskPaySuccess`
  - `taskAccept`
  - `taskSubmit`
  - `taskCancelFlow`
  - `deleteTaskWithMessages`
  - `taskContactFlow`
  - `markMessagesReadByOwner`
  - `markMessagesReadByPeer`
- 钱包 / 提现
  - `walletWithdraw`

### 6.2 云函数之间互相调用的函数

- `registerUserByIdCard`
  - 内部调 `huifuMiniappPay`
- `walletWithdraw`
  - 内部调 `huifuMiniappPay`
- `taskCancelFlow`
  - 内部调 `huifuMiniappPay`
- `financeCompensate`
  - 内部调 `walletWithdraw` / `huifuMiniappPay`
- `financeCompensateTimer`
  - 内部调 `financeCompensate`
- `huifuUserApplyForMe`
  - 内部调 `huifuMiniappPay`
- `huifuIndvOpenForMe`
  - 内部调 `huifuMiniappPay`

### 6.3 回调 / 定时触发类函数

- `huifuPayNotify`
  - 汇付支付 / 提现 / 业务入驻等回调
- `imageAuditCallback`
  - COS 图片审核回调
  - 这是云函数 URL，不是页面 `callFunction`
- `financeCompensateTimer`
  - 定时触发补偿

### 6.4 当前不是主链路，但建议保留的函数

- `checkUserByIdNumber`
  - 服务端按身份证号查重工具
  - 当前页面里没有直接调用入口
- `huifuIndvOpenForMe`
  - 手工补开户
- `huifuUserApplyForMe`
  - 手工补业务入驻

---

## 7. 关键数据模型与状态口径

### 7.1 `userInfo`

存：

- 基础实名资料
- 手机号
- 楼栋 / 门牌号 / 小区
- 汇付开户状态
- 汇付业务入驻状态
- 提现绑卡快照
- 商品收藏 `goodsFavorites`
- 商品浏览记录 `goodsBrowseHistory`

### 7.2 `goods`

这是商品主表，当前真实会用到这些字段：

- 商品基本信息
  - `title`
  - `desc`
  - `price`
  - `originalPrice`
  - `category`
  - `condition`
  - `tradeType`
  - `images`
  - `building`
  - `community`
- 发布者快照
  - `ownerId`
  - `_openid`
  - `ownerOpenid`
  - `ownerNickname`
  - `ownerAvatarFileID`
- 审核状态
  - `status`
    - `pending`
    - `need_fix`
    - `posted`
    - `off_shelf`
    - `sold`
  - `auditJobId`
  - `auditNeedFixIdx`
  - `auditError`
- 购买状态
  - `buyerId`
  - `buyerOpenid`
  - `soldAt`
- 支付锁
  - `paymentLock`
- 软删除标记
  - `sellerDeletedAt`
  - `buyerDeletedAt`

### 7.3 `tasks`

任务主表当前重点看：

- 基础任务信息
- `status`
- 支付信息
  - `pay.status`
  - `pay.orderAmtYuan`
  - `pay.confirmableAmtYuan`
  - `pay.unconfirmAmtYuan`
  - `pay.feeAmtYuan`
- 提交完成信息
  - `submit.note`
  - `submit.images`
  - `submit.submittedAt`
- 取消申请
  - `cancelRequest`
- 联系方式权限
  - `contactAccess`
- 手机号申请
  - `contactRequest`

### 7.4 `messages`

同一个集合同时承载任务聊天和商品聊天。

- 商品聊天：
  - `bizType=goods`
  - `gid`
  - `sellerId / sellerOpenid`
  - `peerUserId / peerOpenid`
  - `readBySeller`
  - `readByBuyer`
- 任务聊天：
  - `tid`
  - `ownerId`
  - `peerUserId`
  - `readByOwner`
  - `readByPeer`
  - `type=task_cancel_request`
  - `type=contact_request`

### 7.5 钱包与资金相关集合

- `wallets`
  - 主钱包与历史影子钱包
- `wallet_transactions`
  - 钱包镜像流水
- `wallet_withdraw_requests`
  - 提现申请与主动查询结果

### 7.6 审核 / 回调 / 补偿相关集合

- `image_audit_jobs`
  - 图片审核任务
- `huifu_notify_logs`
  - 汇付异常回调摘要
- `finance_compensate_logs`
  - 资金补偿执行摘要

### 7.7 旧调试集合

- `huifu_api_debug_logs`
- `function_debug_traces`

当前口径：

- 已不再作为正式业务逻辑依赖
- 重新部署最新云函数后，可以手工清理

---

## 8. 商品模块的当前真实实现

这一节是本轮最重要的补充。因为商品侧最近改动最大，旧文档已经不够用了。

### 8.1 商品发布 / 编辑 / 审核链路

1. 商品发布或编辑时，前端先写 `goods`
2. 商品会先保存为 `status=pending`
3. 然后调用 `imageAuditStart`
4. `imageAuditStart` 创建 `image_audit_jobs`
5. COS 审核完成后回调 `imageAuditCallback`
6. 回调收口：
   - 全部通过 -> `status=posted`
   - 有问题 -> `status=need_fix`
   - 同时回写 `auditNeedFixIdx / auditError`

当前实际行为：

- 商品发布后不是立刻公开，而是先审核
- 编辑商品后会重新进入审核链路
- `need_fix` 的商品可以编辑后重新提交审核

### 8.2 商品状态与用户侧可见性

- `pending`
  - 仅本人可见
  - 商品广场不可见
- `need_fix`
  - 仅本人可见
  - 详情页会显示需要修改说明
- `posted`
  - 同小区公开可见
  - 可购买
- `off_shelf`
  - 默认仅本人可见
  - 可重新上架
- `sold`
  - 卖家可见
  - 买家可见
  - 其他人不可购买

### 8.3 `getGoodsProfile` 是当前商品模块的权限兜底中心

当前这个云函数有 4 个 action：

- `get_goods_snapshots`
  - 给收藏 / 浏览记录刷新最新商品状态
- `list_my_goods`
  - 返回：
    - 我发布的
    - 我买到的
- `delete_my_goods_record`
  - 删除“我的商品记录”或“我买到的记录”
  - 实际是软删除
- `get_goods_detail`
  - 详情页和商品聊天页的权限兜底读取

它解决的问题：

- 买家读取已成交商品详情时的数据库权限限制
- 收藏 / 浏览记录的状态同步
- 我的商品 / 我买到的统一读取
- 删除记录时的角色校验

### 8.4 我的商品页当前口径

页面路径：

- `hyyc/pages/profile/goods/index.js`
- `hyyc/pages/profile/goods/index.wxml`

当前 UI 和业务口径：

- 顶部是两个视图：
  - `我发布的`
  - `我买到的`
- `我发布的` 下方筛选只保留：
  - `全部`
  - `已上架`
  - `已下架`
  - `已售出`
- `审核中 / 需修改` 不再做顶部 tab
  - 这两个状态直接显示在卡片右上角
- 卡片按钮当前支持：
  - `查看`
  - 卖家视角：`咨询会话`
  - 买家视角：`联系卖家`
  - `删除记录`

### 8.5 “我买到的”当前口径

这是新功能，旧文档没有写全。

当前行为：

- 买到的商品单独显示在“我买到的”
- 点击 `查看` 可以继续进商品详情
- 只要卖家没有删除商品记录，买家就能继续看已成交商品详情
- 如果卖家删除了商品记录，买家点进去会直接看到空态：
  - `商品不存在或已下架`
  - 不再额外弹“加载失败，请稍后重试”

### 8.6 商品记录删除的真实口径

当前不是硬删除，而是软删除。

- 卖家删除自己发布的商品记录：
  - 写 `sellerDeletedAt`
  - 如果商品还在上架，会先自动改成 `off_shelf`
  - 不会直接抹掉买家的购买记录
- 买家删除自己的购买记录：
  - 写 `buyerDeletedAt`
  - 不会影响卖家的商品主记录

### 8.7 收藏 / 浏览记录的当前口径

存储位置不变：

- `userInfo.goodsFavorites`
- `userInfo.goodsBrowseHistory`

但展示逻辑已经升级：

- 页面加载时会通过 `getGoodsProfile action=get_goods_snapshots` 获取最新商品快照
- 这样别人商品卖掉、下架、软删除后：
  - 收藏页会同步显示 `已售出 / 已下架`
  - 浏览记录也会同步
- 浏览记录仍然是：
  - 商品详情成功加载后自动写入
- 上限仍然是：
  - 收藏最多 `60`
  - 浏览记录最多 `100`

### 8.8 商品详情页当前口径

页面路径：

- `hyyc/pages/goods/detail/index.js`
- `hyyc/pages/goods/detail/index.wxml`

当前真实行为：

- 详情页读取顺序是：
  1. 先尝试按“本人”直查
  2. 再尝试按“公开 posted 商品”直查
  3. 最后走 `getGoodsProfile action=get_goods_detail`
- 这是为了兼容数据库权限规则

卖家打开自己商品时：

- `pending / need_fix / posted / off_shelf` 都可以看到详情
- `pending / need_fix / posted / off_shelf` 都可以进入编辑
- `posted / off_shelf` 可以直接上下架
- 如果有活跃 `paymentLock`，会禁止修改和上下架

买家打开自己买到的商品时：

- 若卖家未删除记录，可以查看 `sold` 商品详情
- 若卖家已删除记录，会看到空态

当前还没做完的点：

- 点击顶部卖家信息时，仍然只是 toast：
  - `查看卖家主页`

### 8.9 商品聊天当前口径

链路：

1. 买家从商品详情点 `聊一聊`
2. 进入 `pages/chat/goods-room/index`
3. 卖家从：
   - 商品详情底部 `咨询会话`
   - 我的商品卡片 `咨询会话`
   进入 `pages/chat/goods-sessions/index`

已读逻辑：

- 优先调用 `markGoodsMessagesRead`
- 如果开发环境没部署，前端会做临时兜底

未读角标：

- 商品详情页按“当前商品总未读数”聚合
- 我的商品页按“每个商品的未读数”聚合

### 8.10 商品模块的权限原则

请牢牢记住这一条：

- 前端直接查库，只适合：
  - 查本人自己的商品
  - 查公开 `posted` 商品
- 买家读取已成交商品
- 卖家/买家读取跨角色聊天资料
- 收藏/浏览记录刷新最新状态

这些场景都应该优先走云函数兜底，而不是继续在前端直接 `where({ buyerOpenid })` 查库。

否则常见现象就是：

- 开发者工具日志出现：
  - `database permission denied`

这不是业务权限错，而是数据库规则拦住了错误的读取方式。

---

## 9. 任务模块的当前真实实现

### 9.1 任务支付主链路

1. `taskCreate`
2. `huifuMiniappPay` 下单
3. 前端 `wx.requestPayment`
4. `taskPaySuccess`
5. `taskAccept`
6. `taskSubmit`
7. 发布者确认完成时，`huifuMiniappPay action=delay_confirm_task`

### 9.2 任务完成提交

当前要求：

- 必须填写完成说明
  或
- 至少上传 1 张凭证

提交后：

- 写入 `tasks.submit`
- 发布者可在任务详情里查看说明 / 图片 / 提交时间

### 9.3 任务取消 / 退款

未接单：

- 发布者可直接取消并原路退款
- 入口：
  - 任务详情页

已接单 / 已提交：

- 发布者在聊天页发起取消申请
- 接单人只能在聊天页点“同意取消”
- 同意后立即进入：
  - `cancelled + refund_pending`

当前特殊兜底：

- 如果退款实际成功，但前端超时没拿到结果：
  - 页面会回读任务状态
  - 如果状态已收口，就按成功处理
- 如果汇付返回：
  - `申请退款金额大于可退款余额`
  - 当前代码按“这笔退款已经处理过”兜底

### 9.4 联系方式查看申请

页面路径：

- `pages/user/profile/index`

云函数：

- `taskContactFlow`

当前已有动作：

- `get_profile`
- `request_phone`
- `approve_phone`

当前没有动作：

- `reject_phone`

所以现在只支持“申请 -> 同意”，不支持“拒绝”。

### 9.5 任务聊天已读

云函数：

- `markMessagesReadByOwner`
- `markMessagesReadByPeer`

存在原因：

- 任务消息的已读写回也会受到数据库权限影响
- 所以最终要通过服务端改 `readByOwner / readByPeer`

---

## 10. 支付 / 分账 / 钱包 / 提现的当前口径

### 10.1 注册与收款开通

普通用户实名注册后，会自动做：

- 个人用户基本信息开户 `/v2/user/basicdata/indv`
- 用户业务入驻 `/v2/user/busi/open`

用户端不再单独展示：

- 收款开通页面
- 收款状态页面

### 10.2 商品分账

当前默认平台费率：

- 平台 `4%`
- 卖家 `96%`

代码读取顺序：

- 环境变量 `HUIFU_PLATFORM_FEE_RATE`
- 若无，则默认 `4%`

### 10.3 任务分账

当前正式口径：

- 接单人按订单原价拿 `96%`
- 平台拿剩余部分
- 若支付手续费导致 `confirmable` 小于订单原价，差额由平台承担
- 若 `confirmable` 甚至小于接单人应得，后端直接失败并释放锁

### 10.4 钱包页口径

钱包页顶部余额 = 汇付官方可用余额，不是微信支付余额。

`wallet_transactions` 只是镜像账本：

- 影响汇付余额的：
  - 收入
  - 提现
  - 提现手续费
  - 提现退回
- 不影响汇付余额的：
  - 商品购买
  - 任务付款
  - 原路退款

### 10.5 提现当前口径

当前用户侧固定：

- 默认 `D1`

当前页面行为：

- 已绑卡时默认折叠表单
- 不再要求填写银行卡手机号
- 仍要求开户地址（省、市）
- 只允许存在 1 笔处理中提现

已确认的第三方现象：

- `DM` 经常失败：
  - `DM取现额度不足`
- `D1` 可以成功受理：
  - `resp_code=00000000`
  - `trans_stat=P`

### 10.6 资金补偿任务

当前 `financeCompensate` 支持：

- `repairWalletDocs`
- `releaseExpiredGoodsLocks`
- `syncTaskRefunds`
- `syncWithdraws`
- `retryDelayConfirms`
- `repairMissingLedgers`
- `cleanupLogCollections`

定时任务：

- `financeCompensateTimer`
- 每 `10` 分钟触发一次

---

## 11. 图片审核链路

当前主要服务于商品。

### 11.1 启动审核

- 前端工具函数：
  - `hyyc/utils/imageAudit.js`
- 调用云函数：
  - `imageAuditStart`

### 11.2 审核回调

- 回调函数：
  - `imageAuditCallback`
- 回调体会更新：
  - `image_audit_jobs`
  - `goods.status`
  - `goods.auditNeedFixIdx`
  - `goods.auditError`

### 11.3 当前注意点

- `imageAuditCallback` 不是 `callFunction`，而是 HTTP 回调入口
- `COS_AUDIT_CALLBACK_URL` 必须指向这个函数 URL
- 建议一定配置 `COS_AUDIT_CALLBACK_TOKEN`
- 当前 `imageAuditStart` 代码里虽然兼容 `tasks`，但真实在跑的是商品图片审核

---

## 12. 权限与调试原则

### 12.1 数据库规则不在仓库里

这个项目当前没有把云数据库 rules 文件放在仓库里。

所以新同学接手时必须做两件事：

- 去云开发控制台看数据库权限规则
- 不要凭“本地查得到 / 查不到”来猜业务对错

### 12.2 前端直查与云函数兜底的边界

原则：

- 本人数据：
  - 前端可按 `_openid` 精确查询
- 公开商品：
  - 前端可按 `status=posted + community` 查询
- 跨角色数据：
  - 优先走云函数

典型必须走云函数的地方：

- 买家看已成交商品详情
- 收藏 / 浏览记录同步最新商品状态
- 我的商品里拉我买到的商品
- 任务聊天和商品聊天的已读回写
- 查看对方资料 / 完整手机号

### 12.3 不要再把旧调试集合当业务来源

不要依赖：

- `huifu_api_debug_logs`
- `function_debug_traces`

当前正式口径：

- 看主业务表
- 看云函数日志
- 看回调异常摘要

### 12.4 排错优先级

1. 先看业务主表
2. 再看相关云函数日志
3. 再看 `huifu_notify_logs`
4. 最后再怀疑第三方或数据库权限

### 12.5 常见现象对应判断

- 日志里出现 `database permission denied`
  - 先怀疑是不是错误地在前端直接查了跨角色数据
- 页面显示“处理中”
  - 先看业务表状态是否其实已经回写
- 前端超时但资金状态像是成功
  - 先看 `huifuMiniappPay` / `walletWithdraw` / `taskCancelFlow` 日志
- 收藏或浏览记录状态不更新
  - 先看 `getGoodsProfile` 是否已部署

---

## 13. 环境变量总表

下面按函数分组列。带“必配”的建议视为必须配齐。

### 13.1 `registerUserByIdCard`

- 必配：
  - `TENCENT_SECRET_ID`
  - `TENCENT_SECRET_KEY`
  - `ALLOWED_COMMUNITIES`
- 可选：
  - `TENCENT_REGION`
    - 默认 `ap-beijing`
  - `HUIFU_UPPER_HUIFU_ID`

### 13.2 `huifuMiniappPay`

- 必配：
  - `HUIFU_SYS_ID`
  - `HUIFU_PRODUCT_ID`
  - `HUIFU_HUIFU_ID`
  - `HUIFU_PRIVATE_KEY` 或 `HUIFU_PRIVATE_KEY_PATH`
- 普通用户开户 / 业务入驻建议配：
  - `HUIFU_UPPER_HUIFU_ID`
- 小程序支付必配：
  - `HUIFU_SUB_APPID`
  - `HUIFU_NOTIFY_URL`
- 业务入驻回调建议配：
  - `HUIFU_USER_BUSI_NOTIFY_URL`
- 提现回调建议配：
  - `HUIFU_WITHDRAW_NOTIFY_URL`
- 平台费率可选：
  - `HUIFU_PLATFORM_FEE_RATE`
- 进阶可选：
  - `HUIFU_API_HOST`
  - `GOODS_PAYMENT_LOCK_TTL_MS`
  - `TASK_DELAY_CONFIRM_LOCK_TTL_MS`
  - `SYSTEM_COMPENSATE_TOKEN`

### 13.3 `goodsPurchase`

- 无新增必配环境变量
- 会读取：
  - `HUIFU_PLATFORM_FEE_RATE`

### 13.4 `walletWithdraw`

- 无新增必配环境变量
- 依赖 `huifuMiniappPay` 相关环境变量完整
- 可选：
  - `WITHDRAW_SUBMIT_LOCK_TTL_MS`
  - `SYSTEM_COMPENSATE_TOKEN`

### 13.5 `huifuPayNotify`

- 必配：
  - `HUIFU_NOTIFY_TOKEN`
  - `HUIFU_PLATFORM_PUBLIC_KEY`
- 建议也配：
  - `HUIFU_SYS_ID`
  - `HUIFU_PRODUCT_ID`
  - `HUIFU_HUIFU_ID`
  - `HUIFU_PLATFORM_FEE_RATE`

### 13.6 `financeCompensate`

- 必配：
  - `SYSTEM_COMPENSATE_TOKEN`
- 可选：
  - `FINANCE_LOG_RETENTION_DAYS`
  - `HUIFU_PLATFORM_FEE_RATE`

### 13.7 `financeCompensateTimer`

- 必配：
  - `SYSTEM_COMPENSATE_TOKEN`
- 可选：
  - `FINANCE_COMPENSATE_TIMER_LIMIT`

### 13.8 `adminFinanceCompensate` / `adminLogin`

- 可选但建议配置：
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
- `adminFinanceCompensate` 还必配：
  - `SYSTEM_COMPENSATE_TOKEN`

如果不配置管理员账号密码：

- 代码会回退到默认账号密码
- 生产环境不建议这么做

### 13.9 `imageAuditStart`

- 必配：
  - `COS_SECRET_ID`
  - `COS_SECRET_KEY`
  - `COS_AUDIT_BUCKET`
  - `COS_AUDIT_REGION`
  - `COS_AUDIT_CALLBACK_URL`
- 强烈建议配置：
  - `COS_AUDIT_CALLBACK_TOKEN`
- 可选：
  - `COS_AUDIT_BIZ_TYPE`

### 13.10 `imageAuditCallback`

- 强烈建议配置：
  - `COS_AUDIT_CALLBACK_TOKEN`

### 13.11 `exchangePhoneNumber`

- 无环境变量要求
- 但微信公众平台必须开通“获取手机号”能力

### 13.12 前端配置同步要求

这不是环境变量，但每次新环境接手都要对齐：

- `hyyc/app.js`
  - 云开发 envId
- `hyyc/config/access.js`
  - `allowedCommunities`
  - `features`
- `hyyc/config/community.js`
  - 小区围栏
- `registerUserByIdCard` 的 `ALLOWED_COMMUNITIES`
  - 必须和前端开放小区口径一致

---

## 14. 云函数部署要求

### 14.1 当前必须部署的函数

这是按“当前真实页面会用到”整理的完整清单。

- 基础：
  - `login`
  - `exchangePhoneNumber`
- 注册 / 管理：
  - `registerUserByIdCard`
  - `adminLogin`
  - `adminFinanceCompensate`
- 商品：
  - `getGoodsProfile`
  - `getUserPublicProfile`
  - `goodsPurchase`
  - `markGoodsMessagesRead`
  - `imageAuditStart`
  - `imageAuditCallback`
- 任务：
  - `taskCreate`
  - `taskPaySuccess`
  - `taskAccept`
  - `taskSubmit`
  - `taskCancelFlow`
  - `deleteTaskWithMessages`
  - `taskContactFlow`
  - `markMessagesReadByOwner`
  - `markMessagesReadByPeer`
- 资金：
  - `huifuMiniappPay`
  - `walletWithdraw`
  - `huifuPayNotify`
  - `financeCompensate`
  - `financeCompensateTimer`

### 14.2 建议也部署的函数

- `huifuUserApplyForMe`
- `huifuIndvOpenForMe`
- `checkUserByIdNumber`

原因：

- 它们不一定在当前用户页面直接出现
- 但排查历史数据或手工修复时会用到

### 14.3 `cloudbaserc.json` 当前不完整

当前 `hyyc/cloudbaserc.json` 只列了一部分核心函数，例如：

- `registerUserByIdCard`
- `huifuMiniappPay`
- `taskCreate`
- `taskPaySuccess`
- `taskAccept`
- `taskSubmit`
- `taskCancelFlow`
- `goodsPurchase`
- `walletWithdraw`
- `huifuPayNotify`

但没有列出很多现在真实在用的函数，例如：

- `login`
- `exchangePhoneNumber`
- `getGoodsProfile`
- `getUserPublicProfile`
- `markGoodsMessagesRead`
- `taskContactFlow`
- `markMessagesReadByOwner`
- `markMessagesReadByPeer`
- `imageAuditStart`
- `imageAuditCallback`
- `financeCompensate`
- `financeCompensateTimer`
- `adminLogin`
- `adminFinanceCompensate`

所以：

- 不要把 `cloudbaserc.json` 当成完整部署清单
- 手动部署或补全脚本都可以
- 但最终必须按本节清单核对

### 14.4 超时建议

- `huifuMiniappPay`
  - `60 秒`
- `taskCancelFlow`
  - `60 秒`
- `walletWithdraw`
  - `60 秒`
- `huifuPayNotify`
  - `60 秒`

### 14.5 回调 / 定时额外要求

- `huifuPayNotify`
  - 必须有可访问的云函数 URL
- `imageAuditCallback`
  - 必须有可访问的云函数 URL
  - URL 要回填给 `COS_AUDIT_CALLBACK_URL`
- `financeCompensateTimer`
  - 需要在云开发控制台配置定时触发

---

## 15. 新同学第一天上手顺序

建议严格按这个顺序来。

1. 微信开发者工具打开 `hyyc/`
2. 确认：
   - `appid`
   - `app.js` 里的云环境 ID
3. 在云开发控制台确认：
   - 数据库权限规则
   - 存储权限
   - 云函数环境变量
4. 按本文件第 14 节把云函数部署齐
5. 确认回调地址：
   - `huifuPayNotify`
   - `imageAuditCallback`
6. 确认以下集合至少存在或可被自动创建：
   - `userInfo`
   - `goods`
   - `tasks`
   - `messages`
   - `wallets`
   - `wallet_transactions`
   - `wallet_withdraw_requests`
   - `image_audit_jobs`
   - `huifu_notify_logs`
   - `finance_compensate_logs`
7. 真机至少跑一次：
   - 登录
   - 注册实名
   - 商品发布
   - 商品审核
   - 商品购买
   - 任务发布支付
   - 任务接单 / 提交 / 确认
   - 提现
8. 如果先改商品模块：
   - 先读
     - `hyyc/pages/profile/goods/index.js`
     - `hyyc/pages/goods/detail/index.js`
     - `hyyc/utils/userGoodsStore.js`
     - `hyyc/cloudfunctions/getGoodsProfile/index.js`
9. 如果先改任务模块：
   - 先读
     - `hyyc/pages/chat/room/index.js`
     - `hyyc/pages/task/detail/index.js`
     - `hyyc/cloudfunctions/taskCancelFlow/index.js`
     - `hyyc/cloudfunctions/taskContactFlow/index.js`
10. 如果先改资金模块：
   - 先读
     - `hyyc/cloudfunctions/huifuMiniappPay/index.js`
     - `hyyc/cloudfunctions/walletWithdraw/index.js`
     - `hyyc/cloudfunctions/huifuPayNotify/index.js`
     - `hyyc/cloudfunctions/financeCompensate/index.js`

---

## 16. 首轮联调 checklist

### 16.1 商品链路

- 发布商品
- 图片审核通过后出现在商品广场
- `need_fix` 时能看到修图提示
- 卖家能编辑并重新提交
- 卖家能上下架
- 买家能购买
- 买家购买后：
  - 卖家看到 `已售出`
  - 买家在“我买到的”里能看到
- 卖家删除商品记录后：
  - 买家点已购商品看到空态
- 收藏 / 浏览记录能同步最新状态
- 商品聊天未读能正常变化

### 16.2 任务链路

- 发布任务并支付
- 接单
- 提交完成
- 发布者查看提交内容
- 发布者确认完成
- 未接单任务可直接退款
- 已接单任务可申请取消并由对方同意
- 聊天里能发起查看手机号申请
- 对方同意后能看到完整手机号

### 16.3 钱包 / 提现链路

- 钱包页能查到汇付余额
- 已绑卡用户再次进入页面时表单折叠
- 可发起 `D1` 提现
- 提现处理中时可主动同步状态
- 同一账号连续点击提现，只会受理一笔

### 16.4 补偿与回调

- `financeCompensateTimer` 周期性写入 `finance_compensate_logs`
- `huifuPayNotify` 能收到并处理真实回调
- `imageAuditCallback` 能把商品状态从 `pending` 收口到 `posted / need_fix`

---

## 17. 最重要的调试方法

### 17.1 先看哪个数据源

1. 先看业务主表
   - 商品看 `goods`
   - 任务看 `tasks`
   - 提现看 `wallet_withdraw_requests`
2. 再看对应云函数日志
3. 再看：
   - `huifu_notify_logs`
   - `finance_compensate_logs`

### 17.2 商品问题先查什么

- 我的商品 / 我买到的加载异常
  - 先看 `getGoodsProfile` 是否部署
- 已购商品详情打开失败
  - 先看 `getGoodsProfile action=get_goods_detail`
- 收藏 / 浏览记录状态不更新
  - 先看 `getGoodsProfile action=get_goods_snapshots`
- 商品聊天未读不消
  - 先看 `markGoodsMessagesRead`

### 17.3 任务问题先查什么

- 取消退款状态不对
  - 先看 `tasks.cancelRequest`
  - 再看 `taskCancelFlow`
  - 再看 `huifuMiniappPay`
- 手机号申请不对
  - 先看 `tasks.contactRequest / contactAccess`
  - 再看 `taskContactFlow`
- 聊天已读异常
  - 先看 `markMessagesReadByOwner / markMessagesReadByPeer`

### 17.4 提现问题先查什么

- 页面说失败，但返回 `resp_code=00000000` 且 `trans_stat=P`
  - 这不是失败，是已受理处理中
- 如果状态迟迟不回写
  - 先看 `walletWithdraw action=sync_active_withdraw`
  - 再看 `huifuPayNotify`

### 17.5 商品 / 任务权限问题的判断方法

如果开发者工具日志里出现：

- `database permission denied`

先不要立即改数据库规则，先判断是不是：

- 前端错误地直接查了跨角色数据
- 云函数没部署，导致代码回退到了本地直查

---

## 18. 当前已知风险与下一步优先级

### 18.1 已知风险

- 提现最终到账回调闭环还没完全真机验证完
- 商品卖家主页仍是占位
- 商品聊天 / 任务聊天都没有全局消息中心
- 手机号申请和任务取消申请都没有“拒绝”动作
- 还缺一轮完整双账号并发回归

### 18.2 下一步最该继续做的事

1. 再跑一次完整 `D1` 提现：
   - 绑卡 -> 提现 -> 到账 -> 回调回写
2. 再跑一次“支付成功后立刻退出小程序”的真实链路
3. 再做一次双账号并发回归：
   - 同一商品双人抢购
   - 同账号重复提现
   - 任务确认完成连续点击
4. 如果继续补商品侧：
   - 接真实卖家主页
   - 做全局消息中心
   - 做订阅消息
5. 如果继续补任务协商：
   - 增加拒绝手机号申请
   - 增加拒绝取消申请
   - 增加平台介入

---

## 19. 明确不做

- 不再恢复企业进件
- 不再新增企业商户相关页面和回调
- 不再恢复独立的“收款开通 / 收款状态”用户页面
- 不再把旧调试集合重新拉回业务主链路

---

## 20. 给下一位开发的最后一句提醒

这个项目最难的不是页面本身，而是“三层口径要同时一致”：

- 前端入口口径
- 云函数业务口径
- 数据库权限 / 环境变量 / 回调配置口径

如果你改了页面，却没同步云函数和部署配置，最后看到的通常不是“明显报错”，而是“某个链路只有一半能用”。先核对部署和配置，再判断是不是代码逻辑问题。
