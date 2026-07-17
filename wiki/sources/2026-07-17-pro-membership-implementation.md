---
title: "Pro 会员与知识智能骨架实施证据"
type: source
tags: [membership, entitlements, cursor, curated-feed, digest, cloudbase, deployment]
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# Pro 会员与知识智能骨架实施证据

## 本地实现

- `app.json` 已切换为资讯、精选、简报、我的四个原生 Tab，共 9 个页面。
- 小程序新增 `features/membership/`、`features/curated-feed/`、`features/briefing/`；会员降级时清理受保护的全局缓存。
- “我的”页为真实管理员增加普通用户、Pro 会员、管理员三个身份预览按钮；切换后资讯页会检测会员会话版本并重新查询，精选和简报在 Tab `onShow` 时重新鉴权。
- 免费用户资讯固定 7 天，Pro 为 30 天，管理员为 `history.mode=all`；30 天锁定入口和 7 天边界提示不会在信息流插广告。
- 免费精选与简报只使用代码内固定样例；生产分析未启用时，会员页面显示待启用状态，不回退到上游精选或普通热度。
- 简报引用通过 `digestId + itemId` 访问，越过当前历史边界时只能返回生成时固化的引用快照。

## 后端实现

- `knowledgeFeed` 公共业务 action 为 `entitlements / setRolePreview / feed / item / digest / digestReference`；其中 `setRolePreview` 只接受具有有效真实管理员授权的微信身份。
- 新增独立 `knowledgeOps`，以云端维护令牌保护人工授权、撤销、管理员授权、分析回填与状态查询。
- 管理员预览状态只写入现有 `knowledge_feed_access_grants.previewRole`，不新增集合、不修改管理员授权角色，也不创建虚假会员记录。权益响应同时区分 `actualRole` 与当前有效 `role`。
- 会员、分析结果、分析任务与简报使用四个独立管理端集合；原始 OpenID 只在函数内用于 SHA-256 派生，不写数据库。
- 生产 intelligence Provider 明确为 disabled；新资讯任务与视觉队列相互独立，补图不阻塞公开资讯，分析也不依赖截图。
- 最新、热度、精选均使用稳定数据库游标；后续页不再重复 count 或生成筛选矩阵。
- 数据覆盖由连续 `coverage:'all'` 日索引计算；旧 `daily-curated` 历史不会被宣称为完整月度数据。

## 云端部署与安全

- 2026-07-17 16:26 后重新部署 `knowledgeFeed`；函数保持 Active/Available、单一分钟触发器和既有三个环境变量名称。
- 2026-07-17 身份预览完成后再次部署 `knowledgeFeed` 成功；部署未新增触发器、集合或客户端可写权限。
- 新部署 `knowledgeOps`，仅配置维护令牌环境变量，无定时触发器；受保护状态调用成功。
- 四个新增集合已创建并设置为 `ADMINONLY`。
- `knowledge_feed_items` 创建 12 组时间、热度、精选、频道与主题复合索引；分析任务和简报各创建一组队列/窗口索引。
- 运维状态调用返回 3,090 条资讯、0 条分析、0 个分析任务、0 份简报、0 个会员，符合“架构先上线、AI 和人工会员尚未启用”的预期。
- 部署后的分钟触发器继续每轮完成 2 个列表缩略图任务；`intelligence` 与 `digests` 明确返回 disabled。一次上游探测失败进入既有持久化退避，不影响条目库读取和视觉 worker。

## 验证

- `npm.cmd test`：170/170 通过，包含真实管理员预览 free/member、非法角色和非管理员拒绝路径。
- `npm.cmd run check`：27 个 JSON、143 个 JavaScript、9 个页面通过。
- `git diff --check`：通过，仅有 Windows 行尾提示。
- 云端函数无微信上下文调用返回稳定 `AUTH_REQUIRED`，证明新版本成功装载且不会接受伪造身份。

## 暂未完成

- 用户尚未提供 AI API，因此真实分析、精选和三种简报保持关闭。
- 当前管理员账号已经可以预览三种页面和访问边界；真实会员到期、宽限、撤销及续费状态的账号级验收仍应使用第二个微信账号。
- 支付、订单、回调、退款和自动续费均未启用。
- 25,000 条线上压测和中端真机性能面板仍需在真实数据或专用压测环境完成。
