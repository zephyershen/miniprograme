# CloudBase 数据库索引合同与生产漂移证据

日期：2026-07-23

## 范围

- 只审计生产关键查询的数据库索引，不修改业务服务。
- 重点覆盖用户媒体清理截止时间、旧头像/评论附件反查、资讯分页与视觉任务、互动收藏、会员订单回调和对账。
- 通过 TCB 原生 `ListTables`、`DescribeTable` 只读回读；脚本只保留集合名、索引名、唯一性和有序字段。
- 本轮没有执行索引 `apply`，没有创建集合、修改文档或删除未知索引。

## 版本化控制

- `docs/cloud-database-indexes.json` 是 34 个必要索引的增量合同。
- `hyyc/scripts/cloudbase-database-indexes.js` 提供 `plan`、`check`、`readback` 和 `apply`。
- `apply` 必须提供与目标完全一致的 `--confirm-env`，且只调用 `UpdateTable.CreateIndexes`。
- 缺少合同集合、出现同名不同定义索引时，会在任何写入前停止；字段、方向和唯一性相同的旧名称索引按等价满足处理。
- 未知索引和 CloudBase 内置索引只回读或保留，不会删除、改名或覆盖。
- CLI 原始失败信息也被抑制，避免供应商未来新增的响应字段绕过索引元数据白名单。

## 生产只读漂移

合同要求 34 个索引；合同集合中回读到 43 个现有索引（包含内置索引）。没有同名定义冲突，合同范围内没有需要处置的未知自建索引；缺少以下 11 个索引：

1. `knowledge_feed_archive/date_desc`：`date:-1`
2. `knowledge_feed_comments/attachments_file_id_1`：`attachments.fileId:1`
3. `knowledge_feed_comments/item_status_created_id`：`itemId:1, status:1, createdAt:-1, _id:-1`
4. `knowledge_feed_items/ps_sc_tags_pub_id`：`publicState:1, sourceChannelKey:1, sourceTags:1, publishedAt:-1, _id:-1`
5. `knowledge_feed_items/ps_sc_tags_score_pub_id`：`publicState:1, sourceChannelKey:1, sourceTags:1, score:-1, publishedAt:-1, _id:-1`
6. `knowledge_feed_items/visual_held_1`：`visualPublicationHeld:1`
7. `knowledge_feed_user_engagements/owner_favorited_at`：`ownerKey:1, favorited:1, favoritedAt:-1`
8. `knowledge_membership_orders/status_next_check_at_1`：`status:1, nextCheckAt:1`
9. `knowledge_user_media/cleanup_after_1`：`cleanupAfter:1`
10. `knowledge_user_media/cleanup_claim_expires_at_1`：`cleanupClaimExpiresAt:1`
11. `knowledge_user_profiles/avatar_file_id_1`：`avatarFileId:1`

生产环境尚无 `knowledge_user_media` 集合，因此这是索引应用的前置阻断项。应先运行版本化集合 apply 显式创建该集合，再由数据库规则脚本回读确认 `ADMINONLY`，随后重新运行索引 `plan/check`；索引脚本不会靠真实用户流量或隐式副作用创建集合，也不会在该集合缺失时部分应用其他索引。

现网已确认满足的关键索引包括：

- 分析任务 `status_priority_due` 与分析记录 `analyzedAt_1`
- 评论 `itemId_1`
- 简报 `window_status_generated`
- 资讯已有的 `ps_*` 分页族与 `analysis_coverage`
- 收藏/互动 `ownerKey_1`
- 视觉任务 `visual_jobs_next_attempt`、`visual_jobs_priority_due`、`visual_jobs_status`
- 支付回调 `channelOrderId_1`、`providerTransactionId_1`、`wechatPayTransactionId_1`

## 验证

- 索引控制专项测试：8/8 通过。
- 全量 Node 测试：515/515 通过。
- 离线合同检查：34 个索引、16 个查询 owner 均通过，且所有集合都属于 `ADMINONLY` 数据库合同。
- 项目静态检查：30 个 JSON、277 个 JavaScript、11 个页面通过。
- 真实生产 `plan`、`readback` 返回同一组 11 项漂移；`check` 正确以退出码 1 阻止发布。
- 无确认的 `apply` 在首次远程读取前拒绝；未执行带确认的 `apply`。

## 后续业务层修复

索引审计时发现的收藏/评论 100 条后截断已由后续生产整改任务修复：收藏在数据库中过滤和排序后再限制，评论按游标继续读取到满足页面数量。该修复不属于索引控制改动，索引合同仍只描述数据库访问路径。

## 敏感信息处理

普通 Wiki、合同、测试和报告不包含数据库文档、用户数据、Cloud File ID、短期签名地址、函数环境变量值、登录凭据或原始 TCB 响应。
