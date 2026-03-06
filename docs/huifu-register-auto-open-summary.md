# 注册即开户（汇付）联调总结（HYYC）

更新时间：2026-02-27

## 这次做成了什么
- 用户在小程序完成实名注册后，会自动调用汇付“个人开户”接口（`/v2/user/basicdata/indv`）。
- 成功后，把用户的 `huifu_id` 写回 `userInfo`，并把 `huifu_open_status` 置为 `success`。
- 身份证有效期改为“用户手动选择范围”（开始日期必选；非长期还要选结束日期）。

## 关键概念（用最简单的话）
- `huifu_id`：用户在汇付系统里的“账户号”（像一张存在汇付那边的账户卡号）。
  - 有了它，分账时才能把钱分给这个用户。
- 绑卡/入驻（`user_busi_open`）：把“银行卡”等结算信息交给汇付。
  - 没绑卡时：钱可以分到账户里，但不会自动到用户银行卡。
  - 用户真要拿到银行卡：需要你们在提现时让他填银行卡信息，再走“提现/结算”流程。
- 延时分账（`delay_acct_flag=Y`）：钱先在“延迟户”里；任务完成后再 `delay_confirm` 才会真正分给平台/用户。

## 代码改动点（落地位置）
- 注册页新增“身份证有效期”选择：
  - `miniprogram/hyyc/pages/auth/realname/index.wxml`
  - `miniprogram/hyyc/pages/auth/realname/index.js`
  - `miniprogram/hyyc/pages/auth/realname/index.wxss`
- 注册云函数：注册成功后自动开户、写回 `userInfo.huifu_id/huifu_open_status`：
  - `miniprogram/hyyc/cloudfunctions/registerUserByIdCard/index.js`
- 汇付调用云函数改名（去掉 Test）：`huifuMiniappPayTest` -> `huifuMiniappPay`
  - `miniprogram/hyyc/cloudfunctions/huifuMiniappPay/`
  - 小程序支付调用点：`miniprogram/hyyc/pages/goods/detail/index.js`
- 补偿/重试开户（给已注册用户用的“补写回”工具云函数）：
  - `miniprogram/hyyc/cloudfunctions/huifuIndvOpenForMe/`

## 云函数需要配置什么（很重要）
这些环境变量要配在云函数 `huifuMiniappPay`（因为它负责真正调用汇付接口）：
- `HUIFU_SYS_ID`：汇付后台“参数信息”里能看到。
- `HUIFU_PRODUCT_ID`：汇付后台“参数信息”里能看到（示例里是 `PAYUN`）。
- `HUIFU_HUIFU_ID`：商户号（汇付后台“商户信息”里能看到）。
- `HUIFU_PRIVATE_KEY`：商户私钥（汇付后台“密钥管理 -> 商户私钥”）。

说明：
- 商户私钥有时是一大段字母数字（像 `MII...`），不一定带 `-----BEGIN PRIVATE KEY-----` 头尾。
  - 本项目代码支持把“纯 Base64 私钥”自动包成 PEM 使用。
- 私钥不要发到群里，也不要提交到 git，只放在云函数环境变量里。

## 我们遇到过的典型问题（以及结论）
- 报错：`汇付私钥格式不正确...`
  - 原因：没配对私钥，或复制内容有空格/被截断，或拿错了（把公钥当私钥）。
  - 处理：到汇付后台“密钥管理”重新配置/下载商户私钥，并正确配置 `HUIFU_PRIVATE_KEY`。
- 出现过“返回成功但写库失败”的矛盾状态：
  - 例如 `huifu_open_fail_reason=00000000:成功` 但 `huifu_open_status=failed`。
  - 原因：代码里提取 `huifu_id` 的逻辑曾经写错，已修复。

## 下一步建议（按计划走）
完整计划在：`miniprogram/docs/huifu-split-plan.md`
- 分账前置检查（必须）：分账接收方要有 `huifu_id` 且 `huifu_open_status=success`，否则拦截并提示先开户/重试开户。
- 钱包与提现门槛：做 `wallet_ledger`（流水）和可提现余额（>=50 元才能提现）。
- 提现时再绑卡：新增绑卡页面 + 调 `user_busi_open`，只保存银行卡摘要（如后四位/银行名），不落库完整卡号。

