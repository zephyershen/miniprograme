---
title: "专栏高清预览与资讯被动更新实施证据"
type: source
tags: [ai-column, cloud-storage, knowledge-feed, ux, wechat-devtools]
date: 2026-07-18
last_updated: 2026-07-18
status: confirmed
confidence: high
---

# 专栏高清预览与资讯被动更新实施证据

## 专栏高清预览

- `features/ai-column/assets.js` 同时维护包内轻图与 CloudBase 高清文件 ID；`model.js` 负责生成预览 URL 组，`pages/curated` 只负责触发 `wx.previewImage`。
- 18 张 1086×1448 高清基线 JPEG 使用质量 82、4:4:4 色度采样，总计 8,239,952 bytes；全部上传到版本化 `ai-column/posters-hd/v1/` 前缀，云端清单为 18/18。
- 线上抽查 `agent-1.jpg` 返回 HTTP 200、`image/jpeg`、407,542 bytes。高清文件不进入主包，只有点击海报或“高清查看”才请求；列表继续使用现有受控加载窗口。

## 资讯被动更新

- `feed-item` repository 新增最新游标和游标后计数；`item-feed-query-service` 新增过滤与权益一致的 `getUpdates`；公共路由仅暴露 `feedUpdates` 读接口。
- 资讯页在可见期间按 60 秒调度轻量探测，页面隐藏或卸载后停止；探测不修改 `rawFeed`、`loadedItems` 或滚动位置。
- 模拟器注入 12 条新资讯提示后，原主稿 ID 保持不变；悬浮胶囊可见，点击路径独立于后台检测。专栏首次展开仍只创建两张轻图，高清 URL 组为三张。
- 部署后的 `feedUpdates` 真实调用成功，返回 `newCount: 0`、有效最新游标、同步时间和非 stale 状态。

## 回归与发布证据

- 181/181 个 Node 测试通过；项目检查覆盖 28 个 JSON、154 个 JavaScript 和 10 个页面。
- CloudBase `knowledgeFeed` 强制部署成功；高清云存储上传 18/18 成功。
- 微信开发者工具 CLI `preview` 成功，实际总包 1,793,643 bytes；模拟器专栏/资讯截图页面异常为 0，IDE 保持打开。
- 最新手机预览二维码：`output/playwright/wechat-hd-and-feed-preview-qr.png`。

## 敏感信息处理

本轮未记录或写入 OpenID、ownerKey、账号、密码、维护令牌或其他凭据；云端操作只复用既有登录态与同一项目环境。
