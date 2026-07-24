---
title: "资料保存审核超时修复与生产部署"
type: source
tags: [profile, moderation, cloudbase-ai, reliability, deployment]
source_date: 2026-07-24
last_updated: 2026-07-24
status: confirmed
confidence: high
---

# 资料保存审核超时修复与生产部署

## 故障结论

- 用户通过微信开发者工具的“预览”二维码进入 `develop` 构建，选择微信头像和昵称后保存失败。
- 当天本机预览包与当前业务树一致，客户端已允许 `develop`、`trial`、`release`
  的已登记写请求；线上日志也确认头像上传成功、`saveProfile` 已到达
  `knowledgeFeed`，因此不是旧版只读门禁、头像读取或上传失败。
- 两次资料审核的 CloudBase 主模型都在 30 秒应用超时后才返回成功结果，实际模型
  耗时分别约 32 秒和 42 秒；随后串行 Packy 兜底发生网络失败。服务端按既定
  fail-closed 策略返回 `CONTENT_REVIEW_UNAVAILABLE`，没有发布头像或写入资料。
- 多模态审核使用 `qwen3.5-plus`。该模型默认开启深度思考，而头像与昵称安全分类
  不需要长推理；模型 trace 显示大量推理 token 是本次越过 30 秒边界的直接原因。

## 修复

- 提交 `fd932bf` 只在 CloudBase provider 的评论审核和资料审核请求中增加顶层
  `enable_thinking:false`；资讯分析、简报和来源预览审核不受影响。
- 模型、图片与昵称输入、严格 Schema、置信度门槛、违规类别判断、Packy 兜底和
  fail-closed 写入顺序全部保持不变。拒绝、不确定或两路 provider 失败时仍不发布、
  不保存。
- 没有单纯拉长同步等待时间，也没有增加自动重试，避免把失败等待和模型成本翻倍。
  若关闭思考后的真实 p95 仍接近 30 秒，再独立评估超时余量、有界竞速或异步审核。

## 验证与发布

- provider、资料审核和 provider 路由专项测试通过；新增断言确认分析请求不携带
  `enable_thinking`，评论与资料审核都显式传 `false`。
- 完整 `npm.cmd run verify` 通过，包含项目/环境/数据库/索引检查、全量测试、
  覆盖率门禁和生产依赖审计；`git diff --check` 通过。
- GitHub Actions `production-verify` 对 `fd932bf` 执行成功：
  https://github.com/zephyershen/miniprograme/actions/runs/30055926463
- 仅 code-only 更新 `knowledgeFeed`。发布后四函数 manifest 回读为 0 漂移、
  `knowledgeFeed` 恢复 `Active`；下载的线上入口和审核 adapter 与本地提交逐字节
  一致。环境变量、资源配置和触发器未改动。
- 这是纯服务端修复，当前预览二维码无需重新生成。真实账号再次保存是最终产品
  canary；完成前不把自动测试或代码回读表述为用户链路已验收。

## 安全与隐私

- 本记录不包含用户标识、来源 IP、头像 File ID、签名 URL、昵称、请求 ID、
  环境变量值或原始日志。
- 腾讯云 Qwen 调用指南说明 Qwen3.5 Plus 默认开启思考，并支持顶层
  `enable_thinking:false`：
  https://cloud.tencent.com/document/product/1823/132247
