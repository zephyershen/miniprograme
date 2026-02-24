# 汇付分账接入进度（HYYC 小程序）

更新时间：2026-02-15

## 背景（用一句话说明）
我们要实现“平台收款后，把钱自动分给个人用户（卖家/接单人）”，并支持两类业务：

- 商品交易：买家付款后，卖家立刻拿到钱（平台抽 3%）。
- 任务交易：发布任务的人先把钱“托管/冻结”，完成后再打给接单人；取消/删除任务则退款。

> 这里的“分账接收方都是个人”，意味着要先让个人在汇付体系里有账号（huifu_id），否则没法分账给他。

## 已经做好的（代码已落地）

### 1) 商品购买：已接入“实时分账”的下单入口
已把商品购买从“普通下单”改为“下单时携带分账串 acct_split_bunch”：

- 前端改动：`hyyc/pages/goods/detail/index.js`
  - 调云函数时从 `action: 'jspay'` 改为 `action: 'jspay_goods'`
  - 下单失败时会把云函数返回的错误信息 toast 出来（例如“卖家未开通收款”）

- 云函数改动：`hyyc/cloudfunctions/huifuMiniappPayTest/index.js`
  - 新增 `action: 'jspay_goods'`：云函数会
    - 读取商品价格
    - 找到卖家（goods._openid 对应的 userInfo）
    - 从卖家 userInfo 中读取“卖家汇付用户号（huifu_id）”
    - 自动计算平台抽成（默认 3%）
    - 生成分账串：
      - 平台（商户 huifu_id）拿 3%
      - 卖家（个人用户 huifu_id）拿剩余 97%
    - 调 `POST /v3/trade/payment/jspay` 时携带 `acct_split_bunch`

> 简单例子：买家付 100 元 -> 平台 3 元 + 卖家 97 元（分账在“下单时”一起完成）。

### 2) 云函数里已补齐一些“后续会用到的接口动作”（但目前还没接到业务流）
仍在同一个云函数 `huifuMiniappPayTest` 里，新增了这些 action（方便后续联调）：

- `user_indv_open`：个人用户基本信息开户（`/v2/user/basicdata/indv`）
- `user_busi_open`：用户业务入驻（`/v2/user/busi/open`，含 `upper_huifu_id`）
- `delay_confirm`：延时交易确认/分账（`/v2/trade/payment/delaytrans/confirm`）
- `scanpay_refund`：退款（`/v3/trade/payment/scanpay/refund`）

备注：
- 这些 action 目前偏“联调工具/测试动作”，还没有做完整的权限控制、参数校验、幂等等“生产级封装”。

### 3) 可配置的平台抽成费率
在云函数里支持通过环境变量/入参控制平台抽成（默认 3%）：

- 环境变量：`HUIFU_PLATFORM_FEE_RATE`
  - 可填 `0.03`（表示 3%）或 `3`（也会按 3%处理）

## 还没做的（当前缺口）

### 1) “个人接收方入驻/绑卡”还没接到小程序流程里
虽然云函数已经有 `user_indv_open` 和 `user_busi_open` 的调用入口，但：

- 小程序端还没有“让用户填写并提交银行卡、手机号、身份证信息”的页面
- `userInfo` 表里也没有稳定存储“用户的汇付 huifu_id”的字段规范（目前只是云函数尝试兼容读取）

现状要求（否则商品支付会被拦）：
- 卖家必须在 `userInfo` 里有“汇付用户号（huifu_id）”，否则 `jspay_goods` 会返回 `SELLER_NOT_ONBOARDED`。

### 2) 任务场景（预收/延时分账/退款）尚未实现
你描述的任务场景本质上需要“延时分账（预收托管）”：

- 发布任务（A）：先支付 -> 资金进延迟户（不可结算/不可取现）
- 完成确认（A）：调“交易确认 delaytrans/confirm” -> 分账给接单人（B）
- 取消/删除（A）：走退款（通常按原交易退款）

但目前任务模块：
- 还没有接入任何支付
- `approve()` 只是 UI 提示，没有资金动作
- `deleteTaskWithMessages` 只删任务/聊天，不做退款

### 3) 生产级支付闭环仍缺：回调验真、订单表、对账/幂等
目前商品支付仍是“前端支付成功就当成功”，缺少：

- 支付回调（notify/webhook）接入
- 服务端验签/查单确认（避免假支付、掉单）
- 订单表（记录 req_seq_id、hf_seq_id、金额、状态、退款状态等）
- 幂等控制（重复回调/重复点击不会导致重复分账/重复发货）

## 明天继续做（推荐执行顺序）

### Step 1：先把“个人用户入驻/绑卡”做成一个可用流程
目标：让任意用户都能拿到自己的 `huifu_id`，并绑定银行卡，具备“可分账入账/可提现”的能力。

建议做法：

- 新增一个页面：`我的钱包/收款设置`
  - 收集：姓名、身份证、手机号、银行卡号、开户行地区等（按汇付接口要求）
  - 调云函数：
    1) `user_indv_open` 拿到用户 `huifu_id`
    2) `user_busi_open` 把用户挂到 `upper_huifu_id = 你公司 huifu_id` 下，并配置结算/取现/绑卡
  - 把返回的 `huifu_id` 写回 `userInfo`（例如 `userInfo.huifu.huifuId`）

### Step 2：把任务“预收托管”接起来（延时分账）
目标：任务发布时先付款，完成后自动打给接单人，取消则退款。

建议数据模型（至少要存这些）：
- tasks 增加字段：
  - `pay.reqSeqId`、`pay.reqDate`、`pay.hfSeqId`（下单返回里有）
  - `pay.amountYuan`
  - `pay.status`（created/paid/confirmed/refunded）
  - `workerOpenid/workerId`（接单人）

建议流程：
- 发布任务时：
  - 下单 `jspay`，但传 `delay_acct_flag=Y`（延时交易）
- 业主确认完成时（approve）：
  - 调 `delay_confirm`（org_req_date + org_req_seq_id / org_hf_seq_id），并传分账串，把钱分给接单人
- 业主删除任务时：
  - 若已支付且未确认分账：直接走退款 `scanpay_refund`
  - 若已确认分账：需要按汇付分账退款规则走（这个需要再对照文档细化）

### Step 3：补齐“真实支付闭环”（避免资金风险）
最低限度要做：
- 落库订单 + 状态机
- 支付回调验签或查单确认（不要只信前端）
- 所有关键接口做幂等（用 req_seq_id 做幂等键）

## 备注（今天改动涉及的文件）
- `hyyc/cloudfunctions/huifuMiniappPayTest/index.js`
- `hyyc/pages/goods/detail/index.js`

