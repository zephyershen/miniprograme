# 别收藏了

一个有硬上限的个人知识消化箱：粘贴公开文章链接，得到与个人关注方向相关的短摘要和英文关键句，然后明确选择丢弃或保留一张结论卡。

## 本地开发

1. 在微信开发者工具导入仓库根目录。
2. AppID 使用 `wxcb0f641838abf6e6`，云环境使用 `hyyc-1gi3f5sqc5becabf`。
3. 分别在 `hyyc/cloudfunctions/digestIngest` 和 `hyyc/cloudfunctions/digestStore` 安装依赖。
4. 先按 `docs/cloud-cleanup.md` 核对云端资源，再部署两个新云函数。
5. 在 `hyyc` 目录执行 `npm test` 运行本地测试。

## 产品边界

- 待消化队列最多 5 条，结论卡最多 20 张。
- 只支持无需登录的中英文 HTTPS 文章页。
- 不保存网页全文，不提供资讯流、推送、支付、实名、定位或聊天功能。
- AI 月度用量由应用侧按 Token 估算，超过 10 元后停止新增处理。
- 10 元硬上限只计算模型 Token，不包含 CloudBase 套餐、云函数和外网流量费用。

更完整的部署、云资源和验证说明见 `docs/` 与 `wiki/`。
