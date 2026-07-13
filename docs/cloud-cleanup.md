# 云环境清理与部署

目标环境：`hyyc-1gi3f5sqc5becabf`

## 重要边界

用户已确认旧业务数据可以全部清除。清理仅针对该云开发环境中的旧业务资源，不修改微信主体、AppID、商户号、支付平台账号或其他外部账号绑定。

## 清理前资源清单

在云开发控制台记录以下信息，清单中不得写入密钥值或用户数据：

- 云函数名称、运行时、触发器和环境变量名称。
- 数据库集合名称、记录数量和索引名称。
- 云存储文件数量、目录前缀和总容量。
- 已启用的 AI 模型名称、环境套餐和资源点余额。

本地旧代码包含的 19 个云函数名称已记录在 `docs/legacy-cloud-resource-inventory.md`。数据库、存储和线上触发器无法仅从 Git 得知，必须以控制台实际结果补齐。

## 清理顺序

1. 确认当前控制台环境 ID 完全匹配 `hyyc-1gi3f5sqc5becabf`。
2. 导出上述不含敏感值的资源清单。
3. 删除旧云函数、触发器、旧数据库集合、旧云存储文件和旧业务环境变量。
4. 创建集合：`digest_queue`、`conclusion_cards`、`user_state`、`daily_stats`、`usage_monthly`。
5. 将集合权限设为仅云函数可读写。
6. 在 CloudBase AI 中启用 `hy3-preview`；若目录中不存在，再启用 `deepseek-v4-flash-202605`。
7. 使用 Node.js 18 部署 `digestIngest`，超时设为 60 秒。
8. 使用 Node.js 18 部署 `digestStore`，超时设为 20 秒。
9. 真机验证后上传体验版，不直接提交公开审核。

模型名与计费在 2026-07-13 依据官方目录和价格页核对。`hy3-preview` 使用输入长度分档；`deepseek-v4-flash-202605` 存在峰谷价，代码按较高的高峰价估算以保护 10 元硬上限。部署时仍必须再次核对环境返回的模型目录和计费信息：

10 元上限仅覆盖模型 Token 预估成本，不包含 CloudBase 套餐、云函数调用和外网流量。当前个人版参考价为 19.9 元/月，实际费用以部署时控制台为准。

- https://docs.cloudbase.net/ai/model/model-access
- https://cloud.tencent.com/document/product/876/127357
- https://docs.cloudbase.net/ai/announcement/deepseek-v4-price-update

## 回滚

旧代码可从 Git 标签 `legacy-hyyc-704a88e` 恢复。旧云数据按用户决定不做内容备份，因此云端清理不可通过 Git 回滚。
