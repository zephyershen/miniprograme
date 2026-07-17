---
title: "全量补图、精选语义与移动端性能验证"
type: source
tags: [cloudbase, visual-backfill, quality, performance, verification]
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 全量补图、精选语义与移动端性能验证

## 在线数据与队列

- seed 前：有效条目 2,996，封面 13，原文截图 94，任意视觉 107，缺图 2,889；近 7 天缺图 1,843。
- 历史 seed：阶段 `complete`，近 7 天 offset 1,950；近 7 天优先、历史随后，任务按资讯文档 ID 去重。
- seed 后首次状态：队列约 2,890 条，`blocked=0`；定时 worker 已连续写回视觉。一次受限手动验证返回 `attempted=2, completed=2`，两条均为真实原文截图。
- 2026-07-17 14:16（Asia/Shanghai）受保护状态复核：有效条目 3,001，任意视觉 178，缺图 2,823；近 7 天条目 1,955，缺图 1,777；队列 `pending=2,824`、`leased=1`、`retry=4`、`blocked=0`。最近一轮 worker 仍为 `attempted=2, completed=2`，截图服务健康检查为 `ok=true, configured=true`。
- 2026-07-17 15:02 按列表缩略图版本重新完成全库 seed：有效条目 3,005，已有任意完整视觉 253，已有列表缩略图 12，缺完整视觉 2,752，缺列表缩略图 2,993；任务队列总数与后者严格一致，全部为 `pending`，`retry=0`、`blocked=0`。最新分钟 worker 为 `attempted=2, completed=2`，两条均原子写回完整原文截图和列表缩略图。
- 资讯源在验证期间继续增长，因此条目总数和缺图数会随分钟同步轻微变化；应以受保护 `visualStatus` 为运行事实，不以一次性静态数字判断完成度。

## 云端资源

- 新集合：`knowledge_feed_visual_jobs`，权限 `ADMINONLY`。
- 索引：`visual_jobs_next_attempt`、`visual_jobs_status`、`visual_jobs_priority_due(priority DESC, nextAttemptAt ASC)` 均由 CloudBase 表信息接口确认存在。
- `knowledgeFeed` 已重新部署；定时与手动 worker 正常，错误日志查询为空。
- 14:21～14:23 的连续定时日志中，全量视觉 worker 每轮仍为 `attempted=2, completed=2`；资讯 fingerprint 请求出现一次可恢复的 `FEED_SOURCE_FAILURE` 并进入 5 分钟退避，但没有使视觉队列停工。同期从本机复核 fingerprint 接口为 HTTP 200、约 241 ms，因此当前按瞬时上游/网络失败处理，继续由持久化退避自动恢复。
- 公网截图服务继续单并发运行；CloudBase 只负责编排、上传 JPEG、保存文件 ID 与事务写回。
- 公网渲染器版本 `/opt/source-preview/releases/20260717-064744` 已上线 `/thumbnail`；服务为 `active`、重启计数 0。使用真实 CloudBase 10 分钟临时文件 URL 的生产同路径验证返回 200，输出 360×253 JPEG、21,852 bytes；健康检查继续为 `ok=true, configured=true`。

## 精选语义

- 2026-07-17 公共 7 天池抽样统计：约 1,957 条，其中上游 `selected=true` 109 条，占 5.6%；精选平均热度约 72.5，非精选约 43.9。
- 这说明精选与热度相关但不等价。上游公开说明将精选描述为过滤噪声、保留值得看的信息，并会优先一手信源、减少营销软文和重复报道。
- 本项目没有自行生成“精选理由”，也没有把精选直接设为付费身份；只保存版本化质量级别，为以后会员筛选能力预留稳定边界。

## 性能验证

- 改造前条目级 facet：普通 7 天约 287 KB，管理员历史约 451 KB。
- 改造后管理员首屏：8 条资讯、8,400 格计数矩阵，完整云函数响应 27,092 bytes，其中矩阵 18,564 bytes；响应不再包含 `facets`。
- 客户端筛选从每次点击对几千条数据执行数万次匹配，改为每项一次矩阵索引；分页通过 `feed.remainingItems[n]` 数据路径只追加新行。
- 详情最多 12 张截图，但页面只挂载当前及相邻 2 张；自动轮播一轮后停止，降低持续定时更新和同时解码压力。
- 列表和相关阅读现优先使用 360×253、质量 64、最大 180 KB 的 JPEG 缩略图；详情仍使用完整图片。典型 1,080×1,350 原图的理论原始解码内存约 5.56 MiB，360×253 缩略图约 0.35 MiB，单图约降低 16 倍；迁移未完成前自动回退原图。

## 验证

- Node：151/151 测试通过。
- 项目检查：21 个 JSON、114 个 JavaScript、6 个页面通过。
- `git diff --check`：通过，仅有既有 CRLF 提示。
- CloudBase：函数部署成功；队列 ACL 与索引验证；全库缩略图 seed、视觉状态和 2/2 worker 在线验证。公网渲染器用真实 CloudBase 文件完成缩略图端到端验证。

## 敏感信息处理

维护令牌只从本机受限配置加载并用于调用，未输出其值，也未写入普通 Wiki、Git 或部署包。服务器账号、密码和截图令牌继续只存在于既有受限位置。
