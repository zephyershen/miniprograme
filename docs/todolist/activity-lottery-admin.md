# HYYC 活动抽奖与管理员系统开发方案

更新时间：2026-03-19

这份文档的目标不是讲抽象概念，而是把“管理员活动页 + 普通用户抽奖页 + 中奖记录 + 奖金入账”这条线直接讲到可开发。

读完后应该能直接开始做：

- 管理员身份改造
- `我的` 页管理员入口
- `tabBar` 活动页
- 活动配置后台
- 倒计时与抽奖交互
- 中奖名额与金额拆分
- 奖金入账与失败重试
- 真机回归与灰度上线

---

## 0. 当前实现进度（截至 2026-03-19）

### 0.1 已完成

- 正式管理员身份判定已落地，服务端按 `_openid = o9-tA3ea7rJR2XSlTuLlJlTbLeNI` 校验
- `我的` 页管理员入口已落地
- `tabBar` 活动页已落地
- 管理员活动页已落地：
  - 活动列表
  - 新建活动
  - 编辑草稿/下线活动
  - 发布活动
  - 下线活动
  - 结束活动
  - 中奖记录查看
  - 派奖记录查看
  - 失败重试
- 普通用户活动页已落地：
  - 当前活动读取
  - 倒计时
  - 参与抽奖
  - 统一开奖
  - 我的结果
  - 最新开奖结果
  - 历史活动
- 抽奖槽位、抽奖记录、派奖日志、管理员审计日志都已落库
- `activity_funding_orders` 活动入池订单已落库
- 钱包已支持 `activity_income` 奖励流水
- 删除 `local_wallet` 测试活动时，已支持先自动回退本地奖励，再删除活动
- 已入池的 `delay_split` 活动已支持删除时自动退回未分出去的剩余金额
- 奖励发放已经支持两条链路：
  - `local_wallet`
  - `delay_split`
  - `official_balance`
- 管理员微信支付活动金额入池已落地
- 活动金额入池已改为延时交易，开奖后可自动确认分账给中奖用户
- 已补“活动金额支付完成后才能发布”的服务端校验
- 支付成功后已支持两条确认路径：
  - 管理员前端支付成功立即确认
  - 支付回调异步兜底确认
- 活动页已切换到“先参与、到点统一开奖”的主链路
- 活动页已去掉普通用户可见的“总福袋数 / 中奖概率 / 奖池展示”
- 活动页中央交互区已改成统一开奖卡片，不再使用福袋/即时抽奖样式
- 活动核心代码已清理旧的“福袋槽位 / 即时抽奖 / 动态命中率”兼容分支
- 活动时间已按中国时区修正，新的活动会按 `Asia/Shanghai` 口径解析与展示
- 已修复发布活动与用户抽奖时 `document.set` 携带 `_id` 导致的云开发报错
- 已新增 `activityReveal` 云函数，负责到点统一开奖并自动发奖
- 管理员页面和用户页面都已接入“到点自动触发统一开奖”的刷新逻辑

### 0.2 当前缺失

- 还没有管理员页面上的“付款关系提交”按钮，虽然底层接口已接好
- 还没有“活动金额入池失败 / 超时 / 退款”的完整运营处理页
- 还没有活动结束后“无人参与时剩余金额自动退回”的完整闭环
- 还没有真实线上资金链路的完整回归记录
- 还没有灰度、补偿任务、运营巡检清单

### 0.3 当前测试口径

- 如果只测功能链路，用 `ACTIVITY_PAYOUT_MODE=local_wallet`
- 如果测活动真实自动到账，用 `ACTIVITY_PAYOUT_MODE=delay_split`
- 如果测旧的余额发放方案，用 `ACTIVITY_PAYOUT_MODE=official_balance`
- `ACTIVITY_PAYOUT_MODE` 需要至少在：
  - `activityUser`
  - `activityPayout`
  两个云函数里保持一致

### 0.4 当前注意事项

- 2026-03-19 之前按旧逻辑保存的活动时间，可能已经写成了错误的绝对时间
- 这类旧活动建议重新保存开奖时间后再发布，或直接新建测试活动
- `delay_split` 不再依赖余额支付权限，但依赖活动入池支付单成功且原交易信息可用
- `delay_split` 的自动到账本质是：管理员先支付活动金额为延时交易，中奖后再自动确认分账
- 删除已入池活动时，只会退回还没有分出去的剩余金额；已经确认分账给用户的金额不会自动收回
- 当前活动不再按固定福袋位即时抽奖，而是按“参与抽奖 -> 到点统一开奖”发放
- `ACTIVITY_PAYOUT_MODE` 切换后，只会影响新生成的派奖日志，旧活动 / 旧中奖记录不会自动改模式

---

## 1. 目标与本期口径

本期要做的不是“所有用户互相发红包”，而是：

- 平台管理员发布活动
- 平台管理员设置总奖金、中奖名额、开奖时间
- 普通注册用户在开奖前点击“参与抽奖”
- 到开奖时间后系统从已参与用户中统一开奖
- 若参与人数不足，则按实际参与人数重新拆分全部奖金
- 开奖后奖金自动进入平台钱包体系，后续再提现

本期不做：

- 普通用户发现金红包
- 普通用户给其他普通用户转账
- 轮盘围观型大屏开奖
- 多管理员、多角色后台体系
- 复杂营销裂变、邀请助力、分享加次数

---

## 2. 必须先定死的产品决策

### 2.1 管理员判定口径

正式版管理员不再使用当前“隐藏登录 + 临时冒充用户”的测试逻辑。

本期唯一正式管理员固定为：

- 手机号：`18451306773`
- `userInfo._id`：`6a0a1fb669ba051f009897926f6fb98b`
- `_openid`：`o9-tA3ea7rJR2XSlTuLlJlTbLeNI`

服务端最终判定字段只认 `_openid`。

原因：

- `_openid` 是当前小程序登录态里最稳定的服务端身份键
- 手机号后续可能换绑
- `_id` 是数据库文档主键，适合做初始化校验，但不适合作为微信登录的唯一来源

正式口径：

- 前端是否展示管理员入口，可以根据当前缓存用户的 `_openid` 计算 `isPlatformAdmin`
- 所有管理员云函数必须再次在服务端校验 `_openid`
- 任何前端传入的 `isPlatformAdmin: true` 都不可信

### 2.2 活动玩法口径

本期活动采用：

- 报名参与 + 到点统一开奖
- 倒计时期间，用户点击一次按钮即视为参与成功
- 到开奖时间后，系统从已参与用户中抽出中奖用户
- 用户默认每个活动仅允许参与 1 次

不采用：

- 即时开奖型
- 轮盘共享开奖
- 老虎机博彩风

### 2.3 为什么不再使用“总福袋数”

旧方案里加 `totalDrawSlots`，本质是为“即时抽奖”服务的。

它的问题是：

- 你无法预知最后到底有多少真实用户会来点“抽奖”
- 如果奖位被埋进了大量空白位，最后可能出现“活动结束了，但奖没有发完”
- 为了补这个问题，后端会越来越依赖动态命中率和补偿逻辑，复杂度高

统一开奖方案更适合当前产品：

- 管理员只设置 `总金额 + 中奖人数 + 奖金方式 + 开奖时间`
- 用户在开奖前点击“参与抽奖”就进入名单
- 开奖时系统按当时的真实参与名单抽奖
- 随机红包：如果参与人数少于中奖人数，则按实际参与人数重新拆分全部金额
- 均分红包：要求总金额能被配置中奖人数整分；如果开奖时参与人数不足，已发出的中奖人仍按固定均分金额发放，未发出的金额保留在活动余额中

本期正式口径：

- 管理员发活动时必须设置：
  - 总奖金
  - 中奖人数
  - 奖金方式：`均分红包 / 随机红包`
  - 开奖时间
- 普通用户在开奖前可以点击：
  - `参与抽奖`
- 到开奖时间后：
  - 系统统一开奖
  - 统一写中奖记录
  - 统一创建派奖日志
  - 统一触发奖金发放

下面历史章节里如果仍看到“福袋 / 即时开奖 / 总福袋数”表述，统一视为旧方案存档，不再作为当前实现口径。
  - 中奖名额
  - 总福袋数
  - 金额分配规则
  - 开抢时间

示例：

- `200 元奖金，2 个中奖名额，总福袋数 300`
  - 代表活动共有 `300` 个即时抽奖槽位，其中 `2` 个中奖，`298` 个未中奖
- `200 元奖金，50 个中奖名额，总福袋数 1000`
  - 代表活动共有 `1000` 个即时抽奖槽位，其中 `50` 个中奖，`950` 个未中奖

---

## 3. 页面与交互总览

### 3.1 `我的` 页面管理员入口

位置：

- 放在 [pages/profile/index/index.wxml](/mnt/d/miniprogram/hyyc/pages/profile/index/index.wxml) 当前空白的第 6 个快捷入口位

显示规则：

- 普通用户不显示
- 仅管理员显示

文案建议：

- 标题：`活动管理`
- 副标题不需要

图标建议：

- 礼盒
- 扭蛋机
- 星星票券

点击后跳转：

- `/pages/activity/admin/index`

### 3.2 `tabBar` 活动页

将当前 `tabBar` 从 4 项改成 5 项：

1. `任务`
2. `商品`
3. `活动`
4. `发布`
5. `我的`

活动页图标：

- 未选中：`/mnt/d/miniprogram/hyyc/assets/tabbar/present.png`
- 选中：`/mnt/d/miniprogram/hyyc/assets/tabbar/present-clicked.png`

活动页路径：

- `/pages/activity/index/index`

### 3.3 活动页视觉方向

不建议用老虎机。

原因：

- 老虎机会把页面气质拉向博彩感
- 你这个场景是“社区温馨活动 + 抽奖”，不适合做成博彩 UI
- 在小程序审核语境里，老虎机比礼盒、福袋、扭蛋机更敏感

推荐用：

- 温馨奶油系插画背景
- 中央礼盒 / 福袋 / 扭蛋机作为主互动组件
- 柔和暖色按钮
- 云朵、彩带、星星、贴纸、奖券、礼花作为氛围元素

视觉参考方向：

- https://www.bing.com/images/search?q=cute+pastel+lottery+ui+mobile
- https://www.bing.com/images/search?q=cozy+illustration+plants+cat+room+mobile+ui

推荐落地方向：

- 背景：奶油白 + 浅杏 + 薄荷绿 + 珊瑚粉
- 主视觉：福袋开箱
- 辅助元素：飘带、气球、贴纸、云朵、奖券

### 3.4 活动页首屏结构

建议从上到下分 5 块：

1. 顶部插画 Hero
2. 活动摘要卡
3. 倒计时 / 开抢状态卡
4. 主抽奖交互区
5. 中奖滚动播报 + 我的活动记录

当前实现补充：

- 奖池展示已经并入“倒计时 / 当前状态卡”内部
- 不再单独起一个新的奖池面板

首屏展示字段：

- 活动标题
- 活动说明
- 总奖金
- 中奖名额
- 总福袋数
- 已参与人数
- 剩余中奖名额
- 剩余奖金
- 开抢时间
- 倒计时

### 3.5 两种展示模式

活动页主抽奖交互不要因为“2 个名额”和“50 个名额”变成两套完全不同的产品，只调整奖池展示组件。

#### 模式 A：少量名额展示

触发条件：

- `winnerCount <= 6`

展示方式：

- 首屏展示大礼盒卡片
- 礼盒数量按中奖名额展示
- 强调“稀有奖项感”

示例：

- `200 元 / 2 人中奖 / 300 个福袋`
  - 页面显示 2 个大礼盒卡
  - 副文案显示：`共 300 个福袋，2 个幸运大奖`
  - 按钮文案：`开始拆福袋`

#### 模式 B：大量名额展示

触发条件：

- `winnerCount > 6`

展示方式：

- 不平铺几十个礼盒
- 改成“奖池进度条 + 小福袋矩阵 + 档位胶囊”
- 强调“多人中奖、参与感强”

示例：

- `200 元 / 50 人中奖 / 1000 个福袋`
  - 页面不展示 50 个大礼盒
  - 展示：
    - `50 个中奖名额`
    - `共 1000 个福袋`
    - `已开出 17 / 50`
    - 小福袋点阵墙
    - 中奖播报流

### 3.6 用户抽奖流程

用户端完整流程：

1. 进入活动页
2. 如果未到开抢时间，显示倒计时
3. 倒计时结束后，按钮变为可点击
4. 点击 `开始拆福袋`
5. 前端播放 `0.8s ~ 1.2s` 的开箱动画
6. 调用云函数抽取一个槽位
7. 立刻展示结果弹层
8. 如果中奖，记录“到账处理中 / 已到账”
9. 如果未中奖，记录“已参与”
10. 用户后续再进入，展示自己的历史结果，不允许重复参与

---

## 4. 页面详细设计

### 4.1 管理员活动页 `/pages/activity/admin/index`

页面结构建议分 4 个区域：

#### 区域 1：概览卡片

- 当前活动数
- 待开始活动数
- 开抢中活动数
- 待派奖数
- 派奖失败数

#### 区域 2：活动列表

列表项字段：

- 活动标题
- 状态
- 开抢时间
- 总奖金
- 已中奖人数 / 总中奖人数
- 已参与人数
- 待派奖数

列表操作：

- 新建
- 编辑
- 上线
- 下线
- 查看记录
- 查看中奖人
- 重试派奖

#### 区域 3：活动配置表单

必填项：

- `title`
  - 活动标题
- `subtitle`
  - 活动副标题
- `description`
  - 活动说明
- `openAt`
  - 开抢时间
- `endAt`
  - 活动结束时间
- `totalAmountYuan`
  - 总奖金
- `winnerCount`
  - 中奖人数
- `amountMode`
  - 奖金分配方式，仅保留：
    - `equal`：均分红包，总金额必须能被配置中奖人数整分
    - `random_range`：随机红包，总金额会随机拆成若干份
- `displayMode`
  - 展示模式，默认自动

选填项：

- `coverTheme`
  - 背景主题
- `buttonText`
  - 按钮文案，默认 `开始拆福袋`
- `rules`
  - 活动规则
- `winnerNotice`
  - 中奖说明
- `maxDrawPerUser`
  - 默认固定 `1`

#### 区域 4：中奖与派奖面板

- 中奖记录
- 奖金金额
- 用户昵称 / 楼栋门牌
- 是否已入账
- 入账失败原因
- 重试按钮

### 4.2 普通用户活动页 `/pages/activity/index/index`

页面状态：

- 无活动
- 活动未开始
- 活动进行中
- 我已抽过
- 活动已结束
- 活动已下线

#### 无活动

显示：

- 插画占位
- 文案：`暂时还没有活动，晚点再来看看`

#### 活动未开始

显示：

- 倒计时
- 奖池摘要
- 规则
- 按钮置灰

文案建议：

- `距离开抢还有`
- `准时来拆福袋`

#### 活动进行中

显示：

- 剩余福袋
- 剩余中奖名额
- 剩余奖金
- 主交互按钮
- 中奖滚动播报

#### 我已抽过

显示：

- 我的结果卡
- 如果中奖，展示中奖金额与到账状态
- 如果未中奖，展示未中奖态和历史记录

#### 活动已结束

显示：

- 活动已结束
- 已中奖人数
- 中奖名单节选
- 我的参与结果

---

## 5. 数据模型设计

本期建议新增 5 个集合。

### 5.1 `activity_campaigns`

作用：

- 存活动主信息

建议字段：

```js
{
  _id: 'auto',
  title: '春日幸运福袋',
  subtitle: '今晚 20:00 开抢',
  description: '活动说明',
  rules: ['每人仅 1 次', '活动奖金入平台钱包'],
  status: 'draft', // draft | scheduled | open | sold_out | finished | finished_partial | offline | cancelled
  coverTheme: 'cozy_gift',
  displayMode: 'auto', // auto | featured_pool | stacked_pool
  buttonText: '开始拆福袋',
  totalAmountFen: 20000,
  winnerCount: 2,
  totalDrawSlots: 300,
  blankSlotCount: 298,
  maxDrawPerUser: 1,
  amountMode: 'weighted_template', // equal | weighted_template | random_range
  amountConfig: {
    templateId: 'double_lucky_2',
    minFen: 100,
    maxFen: 15000
  },
  progress: {
    drawCount: 0,
    uniqueUserCount: 0,
    winCount: 0,
    loseCount: 0,
    remainingAmountFen: 20000,
    remainingWinnerCount: 2,
    remainingSlotCount: 300
  },
  adminSnapshot: {
    userId: '6a0a1fb669ba051f009897926f6fb98b',
    openid: 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI',
    phone: '18451306773',
    nickname: '平台管理员'
  },
  openAt: Date,
  endAt: Date,
  publishedAt: Date,
  finishedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

推荐索引：

- `status + openAt`
- `status + createdAt`
- `adminSnapshot.openid + createdAt`

### 5.2 `activity_draw_slots`

作用：

- 活动发布时预生成全部抽奖槽位
- 每次用户抽奖，原子地领走一个槽位

建议字段：

```js
{
  _id: 'auto',
  campaignId: 'xxx',
  slotNo: 1,
  slotType: 'prize', // prize | blank
  tierCode: 'lucky_a', // 可空
  tierLabel: '超级幸运', // 可空
  amountFen: 15000, // blank 为 0
  status: 'unused', // unused | locked | used | expired
  lockId: '',
  lockedAt: null,
  usedAt: null,
  usedByOpenid: '',
  usedByUserId: '',
  drawRecordId: '',
  payoutStatus: 'none', // none | pending | success | failed
  createdAt: Date,
  updatedAt: Date
}
```

推荐索引：

- `campaignId + status`
- `campaignId + slotNo`
- `campaignId + usedByOpenid`

### 5.3 `activity_draw_records`

作用：

- 每个用户每次活动的参与记录

建议字段：

```js
{
  _id: 'auto',
  campaignId: 'xxx',
  openid: 'o9-xxx',
  userId: 'user_doc_id',
  userSnapshot: {
    nickname: 'Zephyr',
    community: '花语云萃',
    building: '11栋',
    door: '703'
  },
  drawSeq: 1,
  result: 'win', // win | lose
  slotId: 'slot_xxx',
  slotNo: 8,
  amountFen: 15000,
  tierCode: 'lucky_a',
  tierLabel: '超级幸运',
  resultText: '恭喜中奖 ¥150.00',
  payoutStatus: 'pending', // none | pending | success | failed
  payoutLogId: '',
  requestId: 'uuid',
  drawAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

推荐索引：

- `campaignId + openid`
- `campaignId + drawAt`
- `openid + drawAt`

### 5.4 `activity_payout_logs`

作用：

- 中奖后的奖金入账日志

当前字段口径：

```js
{
  _id: 'auto',
  campaignId: 'xxx',
  drawRecordId: 'xxx',
  slotId: 'xxx',
  openid: 'o9-xxx',
  userId: 'user_doc_id',
  userHuifuId: '666...', // 当前代码仍沿用历史字段名，表示用户收款账号
  amountFen: 15000,
  amountYuanText: '150.00',
  payoutMode: 'delay_split', // delay_split | official_balance | local_wallet | manual_pending
  status: 'pending', // pending | processing | success | failed
  retryCount: 0,
  fundingOrderId: '',
  fundingOrderReqDate: '',
  fundingOrderReqSeqId: '',
  fundingOrderHfSeqId: '',
  fundingOrderAmountFen: 0,
  fundingReservedAmountFen: 0,
  lastErrorCode: '',
  lastErrorMsg: '',
  channelReqSeqId: '',
  channelReqDate: '',
  channelSeqId: '',
  channelRespCode: '',
  channelRespDesc: '',
  channelTransStatus: '',
  walletLedgerId: '',
  walletMirrorStatus: '', // pending | success | failed
  walletMirrorErrorMsg: '',
  clientIp: '',
  finishedAt: null,
  createdAt: Date,
  updatedAt: Date
}
```

推荐索引：

- `campaignId + status`
- `drawRecordId`
- `openid + status`

### 5.5 `activity_admin_logs`

作用：

- 记录管理员操作审计

建议字段：

```js
{
  _id: 'auto',
  action: 'publish_campaign',
  campaignId: 'xxx',
  operatorOpenid: 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI',
  operatorUserId: '6a0a1fb669ba051f009897926f6fb98b',
  payloadSnapshot: {},
  result: 'success',
  errorMsg: '',
  createdAt: Date
}
```

---

## 6. 金额分配规则

### 6.1 通用规则

金额统一使用“分”为单位存储：

- `200 元` 存为 `20000`

校验规则：

- `totalAmountFen >= winnerCount`
- `winnerCount >= 1`
- `totalDrawSlots >= winnerCount`
- `maxDrawPerUser` 本期固定为 `1`

### 6.2 分配模式一：均分

适用：

- 奖项均等
- 想减少解释成本

示例：

- `200 元 / 50 人`
  - 每人 `4 元`

### 6.3 分配模式二：倍率模板

适用：

- 想做“头奖更大，尾奖更小”
- 适合 2 人、3 人、5 人、10 人、50 人等不同档位

口径：

- 管理员选择模板
- 系统根据倍率权重归一化后，自动算出每个中奖槽位金额
- 最终总额必须精确等于活动总奖金

示例 A：

- `200 元 / 2 人`
- 模板：`[1.5, 0.5]`
- 结果：
  - 1 人 `150 元`
  - 1 人 `50 元`

示例 B：

- `200 元 / 50 人`
- 模板按档位配置：
  - `2 人 * 3.0`
  - `8 人 * 1.5`
  - `20 人 * 1.0`
  - `20 人 * 0.5`

系统按权重算出实际金额，再做分级舍入，最后把尾差补到最高档或最后一个槽位。

### 6.4 分配模式三：随机区间

适用：

- 想做“金额有波动，但整体受控”

管理员配置：

- 最小金额
- 最大金额
- 总中奖人数

系统规则：

- 每个中奖槽位金额在区间内随机
- 总和必须等于活动总奖金
- 生成失败时回退为模板模式或均分模式

本期建议：

- 先做 `均分`
- 再做 `倍率模板`
- `随机区间` 放到第二阶段

---

## 7. 中奖逻辑与并发设计

### 7.1 用户只能抽一次

本期固定规则：

- 同一 `openid` 在同一活动下只能创建 1 条 `activity_draw_records`

如果重复点击：

- 直接返回第一次结果
- 不再重复扣槽位

### 7.2 即时开奖的服务端步骤

用户点击抽奖时，云函数按这个顺序执行：

1. 校验活动存在且状态为 `open`
2. 校验用户已实名、已注册、收款账户已准备好
3. 校验用户不是管理员本人
4. 校验当前用户没有参与过本活动
5. 创建用户抽奖锁，防止重复点击
6. 从 `activity_draw_slots` 中随机取一个 `unused` 槽位
7. 将槽位更新为 `used`
8. 写入 `activity_draw_records`
9. 回写 `activity_campaigns.progress`
10. 如果是中奖槽位，写 `activity_payout_logs`
11. 触发奖金入账
12. 返回前端结果

### 7.3 为什么不用前端随机

因为前端随机会导致：

- 可被篡改
- 无法控制中奖人数
- 无法保证并发下不超发
- 无法审计

抽奖结果必须只在云函数里生成。

### 7.4 槽位不足与活动结束

特殊情况：

- 所有福袋都已抽完
- 所有中奖名额已发完
- 活动到结束时间

处理口径：

- 福袋抽完：活动进入 `sold_out`
- 名额发完但还有空白槽位：活动也可直接结束
- 超过 `endAt`：活动进入 `finished`

### 7.5 参与人数少于总福袋数

如果活动结束时：

- 还有未使用中奖槽位
- 但已参与人数已经大于等于中奖人数

则管理员后台提供一个 `补抽剩余中奖槽位` 按钮：

- 从已参与未中奖用户中随机补齐中奖名额

如果活动结束时：

- 实际参与人数小于中奖人数

则最终实际中奖人数等于实际参与人数，未发出的奖金不入账，活动标记为 `finished_partial`。

本期建议：

- 第一版先允许“未抽完则自然结束”
- 第二版再加“活动结束后补抽”

---

## 8. 奖金入账与钱包口径

### 8.1 当前项目现状

当前代码已经支持两种奖励发放模式：

- `local_wallet`
  - 只用于先测活动功能链路
  - 中奖后直接写本地钱包奖励流水
  - 删除测试活动时，会自动写一条奖励回退流水，把本地测试余额冲回去
- `delay_split`
  - 管理员先把活动金额支付为延时交易
  - 中奖后自动发起交易确认分账
  - 分账成功后再镜像一条本地钱包奖励流水
  - 删除已入池活动时，会自动尝试退回原交易里尚未确认分账的剩余金额
- `official_balance`
  - 先走官方余额发放
  - 发放成功后再镜像一条本地钱包奖励流水

当前还没完成的是：

- 管理员后台里的付款关系提交按钮
- 活动结束后剩余未分账金额的自动退回
- 通道侧“余额支付/奖金发放权限”开通前的真实线上发放
- 真实线上整链路回归记录

### 8.2 本期目标口径

活动中奖后，目标链路是：

1. 管理员创建活动草稿
2. 管理员支付活动金额并完成入池
3. 活动发布
4. 用户中奖
5. 创建派奖日志
6. 自动确认分账，把本次中奖金额分给中奖用户
7. 发放成功后写本地钱包流水
8. 用户在钱包页看到余额增加
9. 用户自行提现

### 8.3 外部依赖说明

当前仓库已经接通：

- 开户
- 业务入驻
- 支付
- 分账
- 提现

当前已经补上的能力：

- 活动奖励延时确认分账适配
- 交易确认查询
- 失败重试
- 本地奖励流水镜像

当前还缺的关键闭环：

- 入池完成后的活动资金冻结 / 占用口径
- 入池失败或退款时的运营处理流程
- 通道权限未开通时的运营指引和页面提示

因此现在的测试要分两种口径：

- 功能链路测试
  - `ACTIVITY_PAYOUT_MODE=local_wallet`
- 延时分账真实到账测试
  - `ACTIVITY_PAYOUT_MODE=delay_split`
  - 管理员先支付活动金额
  - 中奖后自动确认分账
  - 不再依赖余额支付权限

注意：

- `ACTIVITY_PAYOUT_MODE` 目前至少要在 `activityUser` 和 `activityPayout` 两个云函数里保持一致
- 旧活动如果是 2026-03-19 之前按旧时间逻辑生成的，建议重新保存时间后再测
- `delay_split` 依赖活动支付单的原交易号、原请求日期、原请求流水号被正确保存
- 如果某条派奖一直是 `发放中`，优先查 `activityPayout sync_status` 和交易确认查询

### 8.4 本地流水建议文案

中奖入账成功后，`wallet_transactions` 建议写：

- `type: 'activity_income'`
- `title: 活动奖金`
- `summary: 春日幸运福袋奖励到账 ¥4.00，已发到钱包余额`

如果删除 `local_wallet` 测试活动，建议再写一条：

- `type: 'activity_revert'`
- `title: 活动奖励回退`
- `summary: 测试活动删除，已回退本地奖励 ¥4.00`

---

## 9. 权限设计

### 9.1 角色

本期只有 2 个角色：

- `platform_admin`
- `normal_user`

### 9.2 权限矩阵

- 普通用户
  - 可查看活动页
  - 可查看倒计时
  - 可参与抽奖
  - 可查看自己的结果
  - 不可创建、编辑、上线、下线活动

- 管理员
  - 可查看活动页
  - 可进入活动管理页
  - 可创建活动
  - 可编辑活动
  - 可上线活动
  - 可下线活动
  - 可查看中奖记录
  - 可查看派奖失败记录
  - 可重试派奖

### 9.3 服务端校验口径

管理员云函数统一校验：

```js
const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';
```

可额外做一次交叉校验：

- `_id === 6a0a1fb669ba051f009897926f6fb98b`
- `phone === 18451306773`

但最终放行条件仍以 `_openid` 为准。

### 9.4 前端显示口径

前端只负责：

- 显示或隐藏管理员入口
- 显示或隐藏管理员操作按钮

前端不负责：

- 真正的权限判断

---

## 10. 新增页面、文件与模块现状

### 10.1 页面（当前已新增）

已新增：

- `hyyc/pages/activity/index/index.js`
- `hyyc/pages/activity/index/index.wxml`
- `hyyc/pages/activity/index/index.wxss`
- `hyyc/pages/activity/index/index.json`
- `hyyc/pages/activity/admin/index.js`
- `hyyc/pages/activity/admin/index.wxml`
- `hyyc/pages/activity/admin/index.wxss`
- `hyyc/pages/activity/admin/index.json`

说明：

- 活动用户页必须在主包，因为它是 `tabBar` 页
- 管理员页可以先放主包，后面再决定是否拆分包

### 10.2 工具模块（当前已新增）

已新增：

- `hyyc/utils/platformAdmin.js`
  - 统一判断当前用户是否管理员
- `hyyc/utils/activityMoney.js`
  - 金额转分、分转元、倍率模板计算、尾差处理
- `hyyc/utils/activityStatus.js`
  - 活动状态与时间判断
- `hyyc/utils/activityTheme.js`
  - 视觉主题映射

### 10.3 图标与视觉素材（当前状态）

当前已新增：

- `hyyc/assets/tabbar/present.png`
- `hyyc/assets/tabbar/present-clicked.png`

当前说明：

- 活动页主体视觉目前以页面渐变、卡片和暖色块样式为主
- 专用的活动插画素材包还没有系统补齐
- 如果后续需要进一步增强“温馨可爱”的质感，再单独补 `assets/pages/activity/*`

---

## 11. 云函数现状

当前已经新增并接入 3 个云函数。

### 11.1 `activityAdmin`（当前已实现）

作用：

- 所有管理员操作入口

当前 action：

- `dashboard`
- `list_campaigns`
- `get_campaign_detail`
- `create_campaign`
- `update_campaign`
- `publish_campaign`
- `offline_campaign`
- `finish_campaign`
- `list_draw_records`
- `list_winners`
- `list_payout_logs`
- `retry_payout`

### 11.2 `activityUser`（当前已实现）

作用：

- 普通用户查询与抽奖入口

当前 action：

- `get_current_campaign`
- `get_campaign_detail`
- `get_my_record`
- `draw`
- `get_winner_feed`
- `get_history_campaigns`

### 11.3 `activityPayout`（当前已实现）

作用：

- 奖金入账与重试

当前 action：

- `enqueue_payout`
- `process_one`
- `retry_failed`
- `sync_status`

说明：

- `activityPayout` 目前已独立，负责奖励发放、状态同步和失败重试
- 当前支持三种模式：
  - `local_wallet`
  - `delay_split`
  - `official_balance`
- 当前推荐活动正式链路使用 `delay_split`

---

## 12. 云函数接口草案

### 12.1 `activityAdmin.create_campaign`

入参建议：

```js
{
  action: 'create_campaign',
  title: '春日幸运福袋',
  subtitle: '今晚 20:00 开抢',
  description: '...',
  openAt: '2026-03-19 20:00:00',
  endAt: '2026-03-19 23:59:59',
  totalAmountFen: 20000,
  winnerCount: 2,
  totalDrawSlots: 300,
  amountMode: 'weighted_template',
  amountConfig: {
    templateId: 'double_lucky_2'
  }
}
```

返回建议：

```js
{
  ok: true,
  campaignId: 'xxx'
}
```

### 12.2 `activityAdmin.publish_campaign`

服务端动作：

1. 校验管理员身份
2. 校验活动状态必须为 `draft` 或 `scheduled`
3. 校验金额与人数关系
4. 根据金额规则生成中奖槽位
5. 生成空白槽位
6. 更新活动状态为 `scheduled`
7. 写管理员日志

### 12.3 `activityUser.get_current_campaign`

返回建议：

```js
{
  ok: true,
  campaign: {
    id: 'xxx',
    title: '春日幸运福袋',
    status: 'scheduled',
    openAt: '...',
    endAt: '...',
    countdownMs: 123456,
    totalAmountText: '200.00',
    winnerCount: 2,
    totalDrawSlots: 300,
    remainingWinnerCount: 2,
    remainingSlotCount: 300,
    displayMode: 'featured_pool'
  },
  myRecord: null
}
```

### 12.4 `activityUser.draw`

入参建议：

```js
{
  action: 'draw',
  campaignId: 'xxx',
  requestId: 'uuid'
}
```

返回建议：

```js
{
  ok: true,
  result: {
    outcome: 'win',
    amountFen: 15000,
    amountText: '150.00',
    resultText: '恭喜中奖 ¥150.00',
    payoutStatus: 'pending'
  }
}
```

或：

```js
{
  ok: true,
  result: {
    outcome: 'lose',
    resultText: '这次没有拆到奖金，下次活动见'
  }
}
```

---

## 13. 状态机设计

### 13.1 活动状态

- `draft`
  - 草稿
- `scheduled`
  - 已发布，未开抢
- `open`
  - 开抢中
- `sold_out`
  - 槽位已抽完或名额已发完
- `finished`
  - 自然结束
- `finished_partial`
  - 实际参与人数不足，未发完全部中奖名额
- `offline`
  - 管理员手动下线
- `cancelled`
  - 作废取消

状态迁移：

- `draft -> scheduled`
- `scheduled -> open`
- `open -> sold_out`
- `open -> finished`
- `scheduled -> offline`
- `open -> offline`

### 13.2 抽奖记录状态

- `win`
- `lose`

### 13.3 派奖状态

- `none`
- `pending`
- `processing`
- `success`
- `failed`

---

## 14. 与现有项目的集成点

### 14.1 `app.json`

当前已修改：

- 新增 `pages/activity/index/index`
- 新增 `pages/activity/admin/index`
- 调整 `tabBar` 为 5 项

### 14.2 `我的` 页

当前已修改：

- [pages/profile/index/index.wxml](/mnt/d/miniprogram/hyyc/pages/profile/index/index.wxml)
- [pages/profile/index/index.js](/mnt/d/miniprogram/hyyc/pages/profile/index/index.js)
- [pages/profile/index/index.wxss](/mnt/d/miniprogram/hyyc/pages/profile/index/index.wxss)

改动点：

- 新增管理员入口
- 读取当前用户是否管理员
- 入口仅管理员可见

### 14.3 登录与用户缓存

当前已改造：

- 现有 `isSuperAdmin` 测试逻辑保留但降级，不再作为正式后台权限来源
- 新增 `isPlatformAdmin`

当前做法：

- 在 `getStoredUser()` 拿到用户后，根据 `_openid` 计算 `isPlatformAdmin`
- 页面显示用这个值
- 云函数仍自行校验

### 14.4 钱包流水

当前已适配新增流水类型：

- `activity_income`

---

## 15. 第一阶段开发顺序

当前按下面顺序推进，阶段状态如下。

### 阶段 1：管理员身份与入口（已完成）

目标：

- 完成管理员身份正式化
- `我的` 页出现管理员入口
- `tabBar` 出现活动页

交付：

- 能识别管理员
- 能看到活动管理页空壳
- 普通用户看不到管理员入口

当前状态：

- 已完成

### 阶段 2：活动管理页表单与列表（已完成）

目标：

- 能新建、编辑、上线、下线活动

交付：

- `activity_campaigns`
- `activity_draw_slots`
- `activity_admin_logs`
- 管理员页列表与创建表单

当前状态：

- 已完成

### 阶段 3：用户活动页与倒计时（已完成）

目标：

- 普通用户能看到活动页
- 开抢前能倒计时
- 开抢后按钮可点击

交付：

- 活动页首屏
- 倒计时
- 活动状态切换

当前状态：

- 已完成
- 2026-03-19 已补时区修正，新建活动按中国时区解析显示

### 阶段 4：抽奖结果与中奖记录（已完成）

目标：

- 用户点击后立刻出结果
- 同一用户不能重复抽
- 能记录 win / lose

交付：

- `activity_draw_records`
- `activityUser.draw`
- 我的参与结果卡

当前状态：

- 已完成
- 已补发布活动 / 用户抽奖时 `_id` 写入报错修复

### 阶段 5：派奖日志与钱包对接（部分完成）

目标：

- 中奖记录能进入派奖队列
- 成功后写钱包流水

交付：

- `activity_payout_logs`
- `activity_income` 钱包流水
- 管理员失败重试页

当前状态：

- 已完成：派奖日志、钱包流水、失败重试、`local_wallet` 功能链路
- 已完成：`delay_split` 延时交易自动确认分账
- 已完成：交易确认查询与发放中状态同步
- 已完成：`official_balance` 正式余额发放适配与状态查询
- 已完成：管理员微信支付活动金额入池
- 已完成：`activity_funding_orders`
- 已完成：已入池才能发布
- 已完成：删除 `local_wallet` 测试活动时自动回退本地奖励
- 已完成：删除 `delay_split` 已入池活动时退回未分账剩余金额
- 未完成：管理员后台付款关系提交
- 未完成：活动结束后剩余未分账金额的自动退回

### 阶段 6：补偿、风控与灰度（部分完成）

目标：

- 防重复、失败重试、审计、灰度验证

交付：

- 锁
- 审计日志
- 重试机制

当前状态：

- 已完成：重复点击防护、管理员审计日志、派奖失败重试
- 已完成：管理员表单支持 `均分红包 / 随机红包`
- 已完成：均分红包在创建阶段校验“总金额必须能被中奖人数整分”
- 已完成：统一开奖时按奖金方式分别计算金额
- 未完成：灰度发布清单、线上整链路资金回归、补偿任务巡检、真机回归清单

---

## 16. 验收清单

### 16.1 管理员权限

- 只有 `_openid = o9-tA3ea7rJR2XSlTuLlJlTbLeNI` 的用户能看到管理员入口
- 普通用户看不到管理员入口
- 普通用户直接调用管理员云函数会被拦截

### 16.2 管理员活动管理

- 能新建活动
- 能编辑草稿活动
- 能发布活动
- 能下线活动
- 能看到活动列表
- 能看到中奖记录

### 16.3 用户活动页

- 无活动时有空态
- 未开始时倒计时正常
- 到点后按钮自动可用
- 已参与后再次进入显示历史结果

### 16.4 抽奖逻辑

- 同一用户不能重复中奖
- 同一用户不能重复抽奖
- 中奖人数不会超发
- 槽位耗尽后活动结束
- 并发点击不会多扣槽位

### 16.5 钱包与派奖

- 中奖记录能创建派奖日志
- 派奖成功后钱包能看到活动奖金流水
- 派奖失败后管理员能看到失败原因并重试

---

## 17. 风险与注意事项

### 17.1 合规风险

页面文案避免使用：

- 赌博
- 赌运气
- 下注
- 梭哈
- 爆奖
- 老虎机

推荐文案：

- 活动奖金
- 幸运福袋
- 拆礼物
- 抽惊喜

### 17.2 并发风险

最容易出问题的地方：

- 用户重复点击
- 同时多人抽奖超发
- 活动状态切换不及时
- 钱包入账成功但本地流水没写
- 本地流水写了但官方余额真实入账失败

### 17.3 数据一致性风险

必须优先保证：

- 不超发
- 不重复中奖
- 不重复入账

可以容忍短暂延迟但最终要补偿的：

- 活动页剩余数量展示有数秒延迟
- 钱包页流水稍晚出现

---

## 18. 二期能力预留

这期先不做，但字段和结构最好预留：

- 多管理员
- 多活动并行
- 每人多次抽奖
- 分享增加次数
- 报名后统一开奖
- 结束后自动补抽
- 活动海报分享
- 中奖名单分页
- 活动主题皮肤切换

---

## 19. 最终建议

如果按“可控、可开发、可灰度”的角度，这个功能最稳的落地方式是：

1. 先把管理员身份正式化
2. 再做活动配置和用户活动页
3. 再做即时抽奖
4. 最后接真钱入账

不要一开始就把“活动后台、并发抽奖、钱包入账、合规文案”四件事揉在一起做。

先把页面、数据和状态流跑通，后面接真钱时才不会乱。
