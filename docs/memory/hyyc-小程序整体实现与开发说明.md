# hyyc 小程序整体实现与开发说明

更新时间：2026-03-26

## 1. 文档目标

这份文档不是需求文档，而是给后续接手同学的“项目记忆”。

主要解决 4 个问题：

1. 这是一个什么类型的小程序项目，整体是怎么组织的。
2. 主要业务线分别落在哪些页面、云函数、集合里。
3. 现阶段维护时最容易踩坑的地方有哪些。
4. 如果要继续优化，应该按什么顺序推进。

## 2. 先建立整体认知

这个项目本质上是一个“原生微信小程序 + 云开发 CloudBase + 多业务线云函数”的单仓项目，不是传统前后端分离架构。

它的主要业务线包括：

- 游客浏览、微信轻登录、完整实名
- 任务发布、支付、接单、提交、取消/退款
- 闲置商品发布、图片审核、购买、聊天
- 消息中心与任务/商品双聊天体系
- 钱包、交易记录、提现
- 抽奖活动与后台管理

项目的一个重要特点是：

- 页面层承担了大量状态拼装、列表渲染、交互控制逻辑
- 云函数承担了支付、退款、鉴权、敏感状态流转、后台操作
- 数据库里既有业务主表，也有不少“中间态/日志/隐藏态”集合

所以新人第一次接手时，不要把它理解成“几个页面 + 几个接口”，而要理解成“页面状态机 + 云函数状态机 + 数据集合约束”一起工作。

## 3. 项目目录结构

项目根目录：`/mnt/d/miniprogram/hyyc`

核心目录如下：

- `app.js`
  - 小程序入口，初始化云环境和全局用户信息。
- `app.json`
  - 页面注册、分包、tabBar、权限声明。
- `pages/`
  - 主要页面目录，业务集中在这里。
- `components/`
  - 公共组件。
- `utils/`
  - 公共工具、状态处理、缓存、格式化等。
- `config/`
  - 业务访问控制、功能开关等配置。
- `cloudfunctions/`
  - 核心后端逻辑，支付、提现、聊天、任务、活动都在这里。
- `data/`
  - 静态数据。
- `assets/`
  - 图片资源。
- `styles/`
  - 样式公共文件。

## 4. 页面与分包结构

### 4.1 主包页面

`app.json` 里主包页面主要包括：

- `pages/welcome/index`
- `pages/home/index/index`
- `pages/goods/index/index`
- `pages/activity/index/index`
- `pages/goods/detail/index`
- `pages/publish/index/index`
- `pages/publish/task/index`
- `pages/publish/goods/index`
- `pages/profile/index/index`
- `pages/activity/admin/index`
- `pages/profile/account/index`
- `pages/profile/tasks/index`
- `pages/profile/goods/index`
- `pages/profile/favorites/index`
- `pages/profile/messages/index`
- `pages/profile/wallet/index`
- `pages/profile/withdraw/index`

### 4.2 分包

当前已经做了业务分包，主要是：

- `pages/auth/*`
- `pages/task/*`
- `pages/chat/*`
- `pages/user/*`

### 4.3 TabBar

底部 TabBar 业务分别是：

- 任务
- 闲置
- 活动
- 发布
- 我的

这意味着项目的一级业务视图，其实就是围绕这五块展开的。

## 5. 入口与全局配置

### 5.1 `app.js`

`app.js` 做了两件关键事情：

1. 初始化云开发环境
2. 在 `globalData` 里挂全局用户、社区等数据

当前云环境写死为：

- `hyyc-1gi3f5sqc5becabf`

这说明当前项目并没有把环境切换彻底抽象掉，后续如果要做多环境管理，这里是优先处理点。

### 5.2 `config/access.js`

这个文件很关键，属于“项目级业务开关和准入控制”：

- 允许社区：`花语云萃`
- 功能开关：`taskWorkflow`、`goodsChat`
- 首页公告文案也在这里

新人接手时，凡是“为什么某社区进不去”“为什么某功能开关没开”，优先先看这里。

## 6. 认证与实名链路

### 6.1 欢迎页与首次引导：`pages/welcome/index`、`pages/guide/index`

欢迎页不是纯展示页，它是整个登录/注册路由中枢；同时项目现在增加了首次使用说明页，用来降低冷启动门槛。

当前流程大致如下：

1. 首次进入时，如果用户没看过说明页，会先打开 `pages/guide/index`
2. 用户可直接点“先逛逛”进入任务/商品 Tab 浏览公开内容
3. 用户也可以走“微信手机号登录 / 注册”主入口
4. 主入口里先调 `login` 云函数拿 openid
5. 根据 `_openid` 查 `userInfo`
6. 未注册则进入社区选择，再跳微信轻登录
7. 已注册则校验社区是否允许进入
8. 已实名用户进入首页，未实名用户进入个人页继续完善

这个页面还有一个隐藏能力：

- 连点标题 5 次会进入管理员登录
- 管理员登录走 `adminLogin` 云函数

所以这里实际上同时承担了：

- 游客浏览分流
- 登录/轻登录分流
- 管理员隐蔽入口

### 6.2 微信轻登录：`pages/auth/register/index`

这一层现在不再建议理解为“基础注册”或“轻实名”，更准确的口径是“微信轻登录”。

当前主要收集：

- 手机号
- 社区
- 协议勾选
- 头像、昵称改成可选补充项

手机号通过 `exchangePhoneNumber` 获取，最终由 `registerLiteUser` 写入。

适合理解为“低门槛建档 + 社区偏好确认”，不是完整实名。

当前轻登录完成后，主要价值是：

- 给账号建立稳定 openid / 手机号 / 社区归属
- 允许继续浏览公开内容而不丢失账号态
- 允许收藏商品、保存商品浏览记录
- 为后续实名、发布、交易减少重复填写

当前轻登录完成后，仍然不会开放：

- 接单
- 购买
- 聊天
- 发布
- 消息中心
- 钱包 / 提现

### 6.3 完整实名：`pages/auth/realname/index`

完整实名是项目里一个很重的表单页，涉及：

- 社区 / 楼栋 / 门牌
- 手机号授权
- 头像
- 身份证正反面上传
- 地址与位置围栏校验
- 协议同意

提交后调用 `registerUserByIdCard`。

这里要特别注意：

- 开发环境有位置围栏豁免分支
- 身份证图片不是一开始就上传，而是提交时处理
- 页面卸载时会清理临时身份证文件
- 当前项目的完整实名是“项目自建实名核验链路”，不是直接读取微信实名资料

补充一个非常关键的产品/技术事实：

- 微信小程序官方公开能力可以给你登录态 `openid/unionid/session_key`
- 可以在用户同意后给你手机号
- 可以在用户交互后给你头像和昵称
- 但官方公开能力并没有直接给小程序返回“微信实名姓名 / 身份证号”

所以当前项目里，完整实名仍然要靠你自己的实名表单和证件核验链路完成。现在的实现方式是上传身份证正反面，再由 `registerUserByIdCard` 处理。

### 6.4 共享认证辅助模块

主要包括：

- `pages/auth/_shared/community.js`
  - 当前社区只有 `花语云萃`
  - 含中心点和半径配置
- `pages/auth/_shared/geo.js`
  - 地理距离计算
- `pages/auth/_shared/api.js`
  - 含真实手机号换绑逻辑，也留有部分 mock 痕迹

### 6.5 当前用户状态与权限边界

这部分是 2026-03-26 这轮冷启动改造后最容易影响后续优化的地方。

当前项目按用户状态分 3 层：

1. 游客
   - 不要求实名、不要求绑卡、不要求先定位
   - 可进入任务广场、商品广场
   - 可查看公开且脱敏后的任务详情、商品详情
2. 微信轻登录用户
   - 已完成手机号 + 社区建档
   - 可继续浏览公开内容
   - 可收藏商品、保留浏览记录
   - 仍不能接单、购买、聊天、发布、看消息中心、用钱包
3. 已实名用户
   - 开放交易、接单、聊天、发布、活动、钱包等完整能力

后续新人继续改权限时，优先遵守这个原则：

- “看”尽量放开给游客
- “留痕 / 收藏 / 个性化偏好”给轻登录
- “交易 / 沟通 / 资金 / 发布”收口到实名

## 7. 任务业务线

任务线是当前项目的核心业务之一，重点不是“发布一条记录”，而是“带支付和退款的状态机”。

### 7.1 相关页面

- `pages/home/index/index`
  - 首页任务广场
- `pages/publish/task/index`
  - 发布/编辑任务
- `pages/task/detail/index`
  - 任务详情
- `pages/task/submit/index`
  - 任务提交凭证
- `pages/profile/tasks/index`
  - 我的任务

### 7.2 核心状态理解

任务不是简单的 `posted / accepted / completed`。

实际还叠加了：

- 支付状态
- 接单状态
- 提交状态
- 取消申请状态
- 退款状态
- 释放接单状态

相关逻辑现在分散在：

- 页面本地计算
- `taskCancelFlow`
- `taskAccept`
- `taskSubmit`
- `taskPaySuccess`

所以任何任务问题都不要只看一个页面，要同时看前端状态推导和云函数最终写库逻辑。

### 7.3 发布与支付流程

任务发布页：`pages/publish/task/index`

当前链路是：

1. 调 `taskCreate`
2. 创建 `tasks` 文档，初始状态通常为 `pay_pending`
3. 调 `huifuMiniappPay`
4. 拉起 `wx.requestPayment`
5. 支付成功后调 `taskPaySuccess`
6. 任务变为 `posted`

这里有两个维护重点：

- 任务创建不是发布成功，而是先创建待支付单
- 真正上架要以支付成功回写为准

### 7.4 接单、提交、取消、退款

关键云函数：

- `taskAccept`
  - 接单
- `taskSubmit`
  - 提交任务凭证
- `taskCancelFlow`
  - 取消、释放、退款、退款状态同步
- `deleteTaskWithMessages`
  - 删除任务及聊天记录
- `taskContactFlow`
  - 联系方式申请与授权

`taskCancelFlow` 是任务线最值得优先读透的云函数之一，因为它把多种动作都放在一个入口里处理，包含：

- `request_release`
- `approve_release`
- `request`
- `approve`
- `cancel_direct`
- `sync_refund_status`
- `batch_sync_refund_status`

这类“动作式单入口云函数”是当前项目的重要设计风格，后续扩展时建议继续沿用，但要把动作枚举和状态迁移文档化。

### 7.5 任务列表与删除策略

`pages/profile/tasks/index` 除了显示我的任务，还做了几件事情：

- 对 `pay_pending` 的任务支持继续支付
- 对可删除任务支持单删/批量删
- 会对长期可清理任务做自动清理
- 会批量同步待退款任务状态

所以这个页面不是纯列表页，而是一个“任务运维页”。

## 8. 商品业务线

商品线也是一条完整链路：发布 -> 图片审核 -> 上架 -> 咨询聊天 -> 支付购买 -> 已售出。

### 8.1 相关页面

- `pages/goods/index/index`
  - 商品广场
- `pages/goods/detail/index`
  - 商品详情
- `pages/publish/goods/index`
  - 发布/编辑商品
- `pages/profile/goods/index`
  - 我的发布 / 我的购买
- `pages/profile/favorites/index`
  - 收藏与浏览历史
- `pages/user/seller/index`
  - 卖家主页

### 8.2 商品列表页特点

`pages/goods/index/index.js` 是项目里最大的页面之一，承担了很多逻辑：

- 商品列表拉取
- 分类筛选
- 瀑布流布局
- 新商品轮询/监听
- 图片临时链接处理
- 图片预取
- 游客态 / 轻登录态 / 已实名态三种视图切换

2026-03-26 之后，商品广场公开列表做了两层兜底：

- 优先前端直接查询公开 `goods` 数据
- 前端查询失败时，再回退 `getGoodsProfile` 的 `list_public_goods`

这样做的目的，是避免“前端已放开游客浏览，但云函数还没部署到最新版本”时，游客商品页看不到内容。

这说明商品线相比任务线，更偏向“前端大页面 + 后端聚合接口”的组织方式。

### 8.3 商品发布与审核

`pages/publish/goods/index` 当前是直接写 `goods` 集合，然后发起图片审核。

典型流程：

1. 前端创建/更新商品文档
2. 状态先置为 `pending`
3. 调 `imageAuditStart`
4. 审核回调 `imageAuditCallback`
5. 审核通过后转 `posted`
6. 不通过则转 `need_fix`

注意这里和任务线不一样：

- 任务的关键状态切换更偏云函数闭环
- 商品发布页目前仍保留了较多前端直写库逻辑

这会导致商品线的权限和状态收口程度不如任务线统一，后续优化建议优先补齐。

### 8.4 商品详情与购买

`pages/goods/detail/index` 也是超大文件之一。

承担的能力包括：

- 商品详情加载
- 买家/卖家/本人多角色视图切换
- 收藏、浏览历史
- 支付锁处理
- 购买支付
- 上下架/编辑入口
- 商品咨询聊天入口
- 游客 / 轻登录用户只读脱敏浏览

这里现在已经不是“只有实名用户才能看详情”了，而是：

- 游客可看公开商品详情
- 轻登录用户可看详情，并允许收藏
- 咨询、购买、卖家主页等动作继续收口到实名

购买流程大致是：

1. 调 `huifuMiniappPay`
2. 拉起微信支付
3. 支付成功后调 `goodsPurchase`
4. 云函数内部做并发保护、锁校验、幂等处理
5. 商品转已售，卖家钱包记账

这里的关键点是：

- 商品成交最终必须以 `goodsPurchase` 为准
- 页面本地状态只能做展示，不应代替成交判定

### 8.5 商品后台聚合接口

`getGoodsProfile` 是商品线的核心聚合云函数，当前动作包括：

- `get_goods_snapshots`
- `list_my_goods`
- `list_public_goods`
- `delete_my_goods_record`
- `get_goods_detail`

这是商品线里相对成熟的“服务层入口”，后续如果要继续治理商品逻辑，优先从这里扩展，而不是继续让页面直接读写多个集合。

## 9. 聊天与消息中心

项目里实际存在两套会话场景：

- 任务聊天
- 商品咨询聊天

但最终又会汇总到统一消息中心。

### 9.1 相关页面

- `pages/chat/room/index`
  - 任务聊天
- `pages/chat/goods-room/index`
  - 商品聊天
- `pages/profile/messages/index`
  - 消息中心

### 9.2 数据与云函数

主要依赖：

- `messages`
- `getMessageCenter`
- `chatSendMessage`
- `deleteMessageCenterSession`
- `markMessagesReadByOwner`
- `markMessagesReadByPeer`
- `markGoodsMessagesRead`

### 9.3 当前实现特点

任务聊天和商品聊天有不少相似逻辑：

- 实时监听
- 历史消息分页
- 未读标记
- 会话删除/隐藏
- 跳转到业务详情页

但两套页面目前仍是分别维护的，导致重复逻辑较多。

例如：

- 未读标记实现并不完全统一
- 商品聊天用了 `bizType='goods'`
- 任务消息则更多依赖任务字段语义

如果后续要做聊天治理，建议先抽公共会话层，再抽业务扩展层。

### 9.4 消息中心

`getMessageCenter` 会统一聚合任务和商品会话：

- 最新一条消息
- 未读数量
- 会话跳转路径
- 隐藏状态过滤

这是消息体系的总入口，后续若要接更多消息类型，优先在这里扩展，而不是先改消息中心页面。

## 10. 钱包与提现

### 10.1 相关页面

- `pages/profile/wallet/index`
- `pages/profile/withdraw/index`

### 10.2 核心集合

- `wallets`
- `wallet_transactions`
- `wallet_withdraw_requests`

### 10.3 主要云函数

`walletWithdraw` 目前是钱包/提现主入口，动作包括：

- `profile`
- `activity_credit`
- `activity_revert`
- `sync_active_withdraw`
- `wallet_summary`
- `bind_card`
- `open_cash`
- `submit`

这是典型的“单函数多动作”设计。

### 10.4 维护时要注意的点

钱包页面除了调用云函数，也会直接查交易流水集合。

因此查看“余额不对”“提现状态不同步”时，要分清三层：

1. 钱包主余额
2. 交易流水
3. 提现申请状态

另外页面里已经明确提示了：

- 可用余额和实时结算之间可能有延迟

这意味着很多钱包问题不能只从前端展示层判断，需要同时看支付回调、提现回调和补偿逻辑。

## 11. 活动与后台管理

活动模块是项目里相对独立的一条业务线，复杂度已经接近一个小后台系统。

### 11.1 用户侧页面

- `pages/activity/index/index`

依赖云函数：

- `activityUser`
- `activityReveal`

主要能力：

- 活动首页
- 当前活动详情
- 中奖名单
- 报名参与
- 倒计时
- 历史活动

### 11.2 管理侧页面

- `pages/activity/admin/index`

这是另一个超大页面，承担了：

- 活动创建 / 编辑
- 发布 / 下线 / 结束 / 删除
- 资金单准备与支付
- 中奖记录查看
- 发奖日志查看
- 异常检查
- 退款与重试发奖

### 11.3 活动相关集合

- `activity_campaigns`
- `activity_draw_records`
- `activity_draw_slots`
- `activity_funding_orders`
- `activity_payout_logs`
- `activity_admin_logs`

### 11.4 活动相关云函数

用户侧：

- `activityUser`

揭晓侧：

- `activityReveal`

管理侧：

- `activityAdmin`
- `activityPayout`

这条业务线已经有明显“领域化”的雏形，后续如果要继续增强活动系统，优先保持这种边界，不要再把管理逻辑散回页面里。

## 12. 后台运维与管理员能力

管理员能力主要散落在两个地方：

### 12.1 登录入口

- `pages/welcome/index`
  - 隐藏式管理员登录

### 12.2 账户页后台工具

- `pages/profile/account/index`

里面已经有一批平台级工具：

- `adminLegalDocsSync`
- `adminRestoreUserAccount`
- `adminFinanceCompensate`
- `adminRepairUserIdentity`
- `adminResetTestData`

这说明“个人中心账户页”其实兼具了运维入口能力，不是纯个人资料页。

新人修改这里时，要格外注意不要误伤管理员能力。

## 13. 主要数据库集合

当前能确认的核心集合如下：

用户与认证：

- `userInfo`
- `user_community`
- `legal_docs`
- `realname_verify_logs`

任务与消息：

- `tasks`
- `messages`
- `message_center_hidden`

商品与审核：

- `goods`
- `image_audit_jobs`

钱包与支付：

- `wallets`
- `wallet_transactions`
- `wallet_withdraw_requests`
- `finance_compensate_logs`
- `huifu_notify_logs`

活动：

- `activity_campaigns`
- `activity_draw_records`
- `activity_draw_slots`
- `activity_funding_orders`
- `activity_payout_logs`
- `activity_admin_logs`

后台恢复与修复：

- `admin_user_recovery_logs`

建议后续单独再补一份“集合字段说明文档”，因为目前字段语义还是更多依赖代码推断。

## 14. 关键公共工具模块

### 14.1 用户缓存

`utils/userIdentity.js`

职责：

- 本地缓存用户
- 更新用户缓存
- 统一管理员标记

本地存储 key：

- `hyyc_user`

### 14.2 平台管理员识别

`utils/platformAdmin.js`

这里直接写死了管理员标识，包括：

- 用户 id
- openid
- 手机号

这属于高风险硬编码，维护时一定要知道它存在。

### 14.3 商品收藏/浏览历史

`utils/userGoodsStore.js`

职责：

- 收藏商品
- 浏览历史
- 快照刷新

并限制了：

- 收藏最多 60 条
- 浏览历史最多 100 条

### 14.4 图片审核封装

`utils/imageAudit.js`

职责：

- 前端发起图片审核任务

### 14.5 轻量公共工具

其他常用工具包括：

- `utils/ui.js`
- `utils/validators.js`
- `utils/format.js`
- `utils/avatarCache.js`

这些模块适合继续扩展，尽量不要把重复校验和重复格式化再写回页面。

## 15. 当前项目的实现风格总结

从整体实现看，项目已经形成了几个明显特征：

### 15.1 优点

- 敏感资金和状态流转，大多已经放进云函数
- 商品、消息、活动已经出现“聚合服务函数”雏形
- 分包已做，一级业务结构清晰
- 收藏、头像缓存、活动金额等已有局部工具沉淀

### 15.2 主要问题

#### 问题一：超大页面太多

当前多个页面超过 600 行，维护压力明显偏高，典型包括：

- `pages/chat/room/index.js`
- `pages/chat/goods-room/index.js`
- `pages/goods/index/index.js`
- `pages/goods/detail/index.js`
- `pages/activity/admin/index.js`
- `pages/profile/tasks/index.js`
- `pages/profile/account/index.js`
- `pages/profile/wallet/index.js`

这些页面通常同时承担：

- 数据请求
- 状态推导
- 权限分支
- 弹窗交互
- 列表渲染
- 本地缓存

这是后续优化的第一阻力。

#### 问题二：状态机逻辑分散

最明显的是：

- 任务取消/退款/释放状态
- 商品上架/审核/售出状态
- 消息未读状态

这些状态既在页面算，又在云函数算，容易出现前后不一致。

#### 问题三：前端直读库与云函数聚合混用

例如商品详情场景里，既有前端直读，又有云函数 fallback。

短期可用，但长期会带来两个问题：

1. 权限边界不稳定
2. 页面要背负更多兼容分支

#### 问题四：硬编码较多

包括但不限于：

- 云环境 id
- 管理员身份
- 允许社区
- 一些业务配置与文案

后续如果做多社区、多管理员、多环境，就会成为明显障碍。

#### 问题五：自动化验证不足

当前项目更偏“真实云环境 + 真机/开发者工具联调 + 云日志排查”。

这对熟悉业务的人可行，但对新人不友好。

## 16. 新人接手时建议的阅读顺序

不要一上来就从某个大页面从头读到尾，效率很低。

建议顺序如下：

1. 先看 `app.js`、`app.json`
   - 理解项目入口、分包和 tabBar。
2. 再看 `pages/welcome/index`
   - 理解登录、注册、实名、管理员入口。
3. 再按业务线看“页面入口 + 核心云函数”成对阅读
   - 任务：`pages/publish/task/index` + `taskCreate` / `taskPaySuccess` / `taskCancelFlow`
   - 商品：`pages/publish/goods/index` + `getGoodsProfile` / `goodsPurchase` / `imageAuditStart`
   - 聊天：`pages/profile/messages/index` + `getMessageCenter` / `chatSendMessage`
   - 钱包：`pages/profile/wallet/index` + `walletWithdraw`
   - 活动：`pages/activity/index/index` + `activityUser` / `activityReveal`
4. 最后再读几个超大页面
   - 因为这时你已经有业务地图，不会陷入局部细节。

## 17. 后续优化建议

如果目标是“让新人更容易接手并持续优化”，建议按下面顺序推进。

### 17.1 第一优先级：抽状态与常量

优先抽离这些内容：

- 集合名常量
- storage key 常量
- 任务状态枚举与状态解释器
- 商品状态枚举与状态解释器
- 消息会话类型与未读统计工具

这样做收益最高，因为它能立刻降低页面里的隐式知识。

### 17.2 第二优先级：拆超大页面

优先处理以下页面：

- `pages/goods/index/index.js`
- `pages/goods/detail/index.js`
- `pages/chat/room/index.js`
- `pages/chat/goods-room/index.js`
- `pages/activity/admin/index.js`

拆分建议不是“拆成更多页面”，而是先拆本地模块：

- `services/`
- `state/`
- `helpers/`
- `constants/`

先把逻辑从页面文件挪出去，再考虑结构升级。

### 17.3 第三优先级：统一读写入口

建议对敏感业务逐步改成：

- 优先走云函数聚合接口
- 页面只处理展示与交互

尤其是：

- 商品详情读取
- 任务详情读取
- 消息会话聚合
- 钱包余额/流水摘要

### 17.4 第四优先级：补运维文档与回归清单

至少要补这几类文档：

- 云函数部署清单
- 环境变量清单
- 数据集合用途说明
- 核心回归测试清单

建议最少覆盖以下回归链路：

- 新用户登录与轻注册
- 完整实名
- 发布任务并支付
- 接单与提交任务
- 取消任务与退款
- 发布商品与图片审核
- 商品支付购买
- 商品聊天与消息中心
- 钱包与提现
- 活动创建、参与、揭晓、发奖

## 18. 部署与环境变量关注点

项目依赖的外部配置不少，尤其是支付和审核相关。

已识别到的关键环境变量主要包括以下几类：

管理员与准入：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ALLOWED_COMMUNITIES`

支付与汇付：

- `HUIFU_API_HOST`
- `HUIFU_HUIFU_ID`
- `HUIFU_UPPER_HUIFU_ID`
- `HUIFU_SYS_ID`
- `HUIFU_PRODUCT_ID`
- `HUIFU_SUB_APPID`
- `HUIFU_JSPAY_PATH`
- `HUIFU_NOTIFY_URL`
- `HUIFU_NOTIFY_TOKEN`
- `HUIFU_PRIVATE_KEY`
- `HUIFU_PRIVATE_KEY_PATH`
- `HUIFU_PLATFORM_PUBLIC_KEY`
- `HUIFU_USER_BUSI_NOTIFY_URL`
- `HUIFU_WITHDRAW_NOTIFY_URL`

图片审核与腾讯云：

- `TENCENT_REGION`
- `COS_AUDIT_BIZ_TYPE`
- `COS_AUDIT_CALLBACK_TOKEN`

活动相关：

- `ACTIVITY_AUTO_CREATE_COLLECTIONS`
- `ACTIVITY_PAYOUT_MODE`
- `ACTIVITY_REVEAL_LOCK_TTL_MS`
- `ACTIVITY_FUNDING_PAYMENT_BUFFER_FEN`
- `ACTIVITY_FUNDING_PAYMENT_FEE_RATE`
- `ACTIVITY_FUNDING_PENDING_TTL_MS`

其他锁与补偿：

- `GOODS_PAYMENT_LOCK_TTL_MS`
- `TASK_DELAY_CONFIRM_LOCK_TTL_MS`
- `WITHDRAW_SUBMIT_LOCK_TTL_MS`
- `SYSTEM_COMPENSATE_TOKEN`
- `FINANCE_COMPENSATE_TIMER_LIMIT`
- `FINANCE_LOG_RETENTION_DAYS`

后续应该再单独维护一份“环境变量来源与用途表”，否则新人很难判断某个云函数报错是代码问题还是环境问题。

## 19. 排查问题时的建议方法

当出现线上问题时，建议按以下顺序排查：

1. 先确认用户身份阶段
   - 未注册、轻注册、已实名、管理员，这四类看到的逻辑并不相同。
2. 再确认当前业务单据状态
   - 任务、商品、提现、活动订单都不是单状态。
3. 再确认是页面本地状态错，还是云函数最终写库错
   - 这一点很关键。
4. 最后再看数据库主记录、日志集合、支付/审核回调日志

尤其不要只凭前端页面展示就下结论。

## 20. 推荐继续沉淀的文档

这份文档适合作为总览，但还不够支撑长期维护。

建议继续补 4 份文档：

1. 《数据库集合与核心字段说明》
2. 《云函数动作枚举与状态迁移表》
3. 《支付、退款、提现、活动发奖回调链路说明》
4. 《新人回归测试清单》

如果团队后续继续扩展，建议按业务线再拆分成：

- 任务业务说明
- 商品业务说明
- 消息体系说明
- 钱包体系说明
- 活动体系说明

## 21. 一句话结论

这个项目已经不是一个简单的小程序页面集合，而是一个带支付、审核、消息、钱包、活动后台的中型业务系统。

后续优化的关键不是继续堆页面逻辑，而是把“状态、常量、聚合接口、运维文档”先抽出来，这样新人接手成本才会真正下降。
