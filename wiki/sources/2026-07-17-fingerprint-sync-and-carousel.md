---
title: "指纹同步与详情自动轮播验证"
type: source
tags: [cloudbase, fingerprint, timer, carousel, validation]
date: 2026-07-17
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 指纹同步与详情自动轮播验证

> 本页记录首次指纹同步上线时的证据。后续已改为 6 小时条件校验、24 小时完整刷新，并取消全量资讯的视觉公开门禁；见 [全量资讯、管理员权益与容量验证](2026-07-17-full-feed-admin-and-capacity.md)。

## 代码证据

- `adapters/aihot-source.js` 分离 fingerprint 与 selected items 请求，支持弱 ETag、304、`Retry-After` 和无浏览器特征的可识别 User-Agent。
- `services/source-sync-service.js` 负责分钟级指纹检查、15 分钟条目校验、6 小时完整校验、持久化退避和进程内单飞。
- `repositories/feed-cache.js` 使用事务租约保护跨实例同步，并在每次来源写入时校验 owner 与有效期。
- `services/sync-cycle-service.js` 把来源同步、即时视觉、历史归档和每 5 分钟兜底维护收敛到单一可信定时周期；新视觉工作优先，历史/兜底会顺延以满足 180 秒预算。
- `pages/feed-detail/` 使用原生 `swiper` 自动循环且支持手动滑动，圆点跟随当前索引；点击后一次换取全部云文件临时 URL，并从当前图打开微信全屏预览。

## 自动验证

- `npm test`：119/119 通过。
- `npm run check`：21 个 JSON、88 个 JavaScript、6 个页面通过。
- `git diff --check`：通过。
- 覆盖 fingerprint 304、selected/all 区分、15 分钟条件校验、6 小时完整校验、跨实例租约、过期 owner 防回写、空缓存 429、连续 503 退避、Timer fail closed、即时视觉优先、控制状态保留、自动/手动轮播及整组全屏预览。

## 云端验证

- 使用函数代码更新部署，保留了 `KNOWLEDGE_FEED_MAINTENANCE_TOKEN`、`SOURCE_PREVIEW_RENDERER_TOKEN`、`SOURCE_PREVIEW_RENDERER_URL` 三个既有环境变量名称。
- `knowledgeFeed` 状态为 Active/Available；唯一启用中的触发器是 `knowledge-feed-source-sync`，cron 为 `0 * * * * * *`。
- SCF 平台允许一个函数绑定多个触发器；当前只保留一个是为了避开 CloudBase CLI 3.6.1 的单触发器配置/列表覆盖行为，不是平台只能有一个。
- 2026-07-17 08:31 的真实定时调用返回 `updated`、`fingerprintChanged=true`、`itemsChecked=true`；08:32 返回 `not-modified`、`itemsChecked=false`，证明未重复拉取条目。
- 08:35 同一触发器返回 `visualMaintenanceDue=true` 并完成视觉维护，证明 5 分钟兜底分支没有丢失。10:03 新版本定时调用返回成功、来源 `not-modified`、历史归档 `ready`；归档统计为 60 天、1,297 条。
- 线上公开 feed 返回 `windowDays=7`、`totalAvailable=102`、`stale=false`；列表抽样只返回首张 `previewFileId`，但 `previewCount` 正确显示 3、4、5、8，证明列表精简和详情全图契约已分离。
- 缓存文档查询显示 `sourceObservedFingerprint` 与 `sourceAppliedFingerprint` 都为同一 `f1-...` 值，`sourcePollFailures=0`、`sourceNextPollAt=null`、`sourceLastErrorCode=''`、`sourceSyncLeaseOwner=''`、`sourceSyncLeaseUntil=null`。

## 截图服务验证

- 真实长页捕获返回 HTTP 200、协议 v2、页面高度 6,629px、5 张截图、`truncated=false`。
- 自动轮播、手动滑动和整组全屏预览的 WXML/JS 测试已通过；仍建议在真机抽查 1、5、8 张截图、循环圆点、从第 4 张进入全屏以及返回后继续轮播。
