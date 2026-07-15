---
title: "2026-07-15 微信端到端验证与运行时修复"
type: source
tags: [wechat, cloudbase, e2e, runtime, ai, fallback]
sources: [../../hyyc/cloudfunctions/digestIngest/index.js, ../../hyyc/cloudfunctions/digestIngest/lib/fallback.js, ../../hyyc/cloudfunctions/digestStore/index.js, ../../hyyc/cloudfunctions/digestStore/lib/card-transaction.js, ../../hyyc/tests/fallback.test.js]
last_updated: 2026-07-15
status: confirmed
confidence: high
---

# 2026-07-15 微信端到端验证与运行时修复

## Provenance

- Source path / origin: `D:\miniprogram`、微信开发者工具真实微信上下文、CloudBase CLI/API 与函数日志
- Date observed: 2026-07-15
- Scope: `hyyc-1gi3f5sqc5becabf` 中两个云函数、5 个集合及 4 个小程序页面
- Status: confirmed
- Confidence: high

本页不保存登录账号、密码、临时凭据、OpenID 原值或测试文章正文。

## 发现的问题与修复

### 数据库文档 `_id` 不能被更新

CloudBase 返回 `-501007 不能更新_id的值`。原因是若干 `.doc(id).set({ data })` 的写入对象仍包含 `_id`。已在用户状态、月度用量、每日统计、队列和卡片写入前移除 `_id`，并新增事务测试断言。

### 事务并发读取导致 `TransactionBusy`

文章入队事务曾通过 `Promise.all` 并发执行多个 `transactionGet`。CloudBase 事务不接受这组并行操作，已改为顺序读取。

### CloudBase SDK 缺少 WebSocket 依赖

云端日志提示缺少 `ws`。两个函数均锁定加入 `ws@8.21.0` 后重新部署，警告消失。

## AI 模型状态

- 环境已启用 `hunyuan-v3` 模型组，可识别模型 `hy3-preview`。
- 原默认组 `cloudbase` 在该环境的可用模型列表为空，因此默认提供方改为 `hunyuan-v3`。
- 模型实际请求仍返回 429。当前标准版固定额度与账户正余额不能直接替代该模型需要的 Token/资源额度。
- 未自动开启新的付费套餐；这是需要用户明确决定的外部计费变更。

## 透明兜底

- AI 调用失败时释放预算预留。
- 从已安全抓取的文章正文生成长度受控的本地规则临时摘要。
- 队列文档写入 `processingMode: local_fallback`。
- 详情页明确显示“Cloud AI 暂不可用”，并说明结果没有 AI 翻译和相关性判断。
- 用户仍可丢弃或保留，避免核心流程被套餐配置完全阻断。

## 真实微信端到端结果

在真实微信身份上下文中已依次验证：

1. `savePreferences` 保存 3 个关注方向成功。
2. 导入公开 HTTPS 文章，抓取与解析成功。
3. AI 返回 429 后自动生成 `local_fallback` 临时摘要并入队。
4. 消化详情页正常渲染且显示降级提示。
5. 保留操作成功，队列记录转为结论卡；卡片页显示 1/20。
6. 统计显示添加 1、处理 1、7 天内处理 1、活跃天数 1。
7. `purgeMyData` 成功删除该测试身份的数据。
8. 最终 dashboard 复核：队列、卡片、关注方向均为空，用量和统计均为 0。

## 回归验证

- `npm test`：32/32 通过。
- `npm run check`：15 个 JSON、34 个 JavaScript、4 个页面通过。
- 两个云函数在全部修复后重新部署成功。

## 结论

小程序核心闭环在真实微信开发者工具上下文中可用，数据库与状态流转已验证。当前真正 AI 能力仍受套餐 Token 限制，应用通过明确标注的本地临时摘要保持可用；体验版上传和 30 天验证尚未完成。

