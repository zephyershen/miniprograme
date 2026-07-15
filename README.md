# 别收藏了 · 知识更新台

面向微信端的编辑型知识获取平台。首页用横向频道和非卡片式信息流组织 AI、科技、娱乐、社会、游戏与英语内容；当前已接入 AI/科技精选图文流，首页只向用户呈现资讯本身。

## 本地开发

1. 在微信开发者工具导入仓库根目录。
2. AppID 使用 `wxcb0f641838abf6e6`，云环境使用 `hyyc-1gi3f5sqc5becabf`。
3. 分别在 `hyyc/cloudfunctions/digestIngest`、`hyyc/cloudfunctions/digestStore` 和 `hyyc/cloudfunctions/knowledgeFeed` 安装依赖。
4. 先按 `docs/cloud-cleanup.md` 核对云端资源，再通过根目录 `cloudbaserc.json` 部署三个云函数。
5. 在 `hyyc` 目录执行 `npm test` 运行本地测试。

## 当前产品边界

- 待消化队列最多 5 条，结论卡最多 20 张。
- 只支持无需登录的中英文 HTTPS 文章页。
- 不保存网页全文，不提供推送、支付、实名、定位或聊天功能。
- 当前聚合资讯源提供 AI 前沿和科技精选，页面只显示原发布方和原文链接，不暴露聚合服务实现。
- 原文封面可用时缓存到 CloudBase；缺少真实图片的条目暂不在首页显示，也不生成或绘制替代封面。
- 娱乐、社会、游戏、英语及 OpenAI、Grok、GLM、DeepSeek 等厂商官方直连仍未接入，不能把当前首页描述为全频道实时新闻服务。
- AI 月度用量由应用侧按 Token 估算，超过 10 元后停止新增处理。
- 10 元硬上限只计算模型 Token，不包含 CloudBase 套餐、云函数和外网流量费用。

更完整的部署、云资源和验证说明见 `docs/` 与 `wiki/`。
