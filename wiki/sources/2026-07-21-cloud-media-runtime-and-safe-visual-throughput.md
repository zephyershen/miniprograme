---
title: "CloudBase 媒体运行时解析与安全截图提速证据"
type: source
tags: [cloudbase, wechat, media, source-preview, production, verification]
date: 2026-07-21
last_updated: 2026-07-22
status: confirmed
confidence: high
---

# CloudBase 媒体运行时解析与安全截图提速证据

## 客户端根因与修复

- 开发者工具原错误路径为 `/pages/feed-detail/cloud://.../knowledge-source-avatars/...webp`。客户端确实曾把原始 File ID 当作页面相对资源，因而请求不存在的本地路径并返回 500；运行时换取 HTTPS 临时地址的本地修复仍未上传体验版。
- 资讯列表、详情、精选和收藏现统一把 CloudBase File ID 批量换成 HTTPS 临时地址；图片实际加载失败时强制刷新一次，第二次失败确定性降级。个人资料和评论媒体也采用同一原则。
- 2026-07-22 复现到一个列表缩略图旧签名返回 HTTP 403，而同一 File ID 新换取的 3600 秒签名立即返回 HTTP 200，证明对象没有丢失，失效点在临时地址。客户端此前固定正缓存 30 分钟且忽略 SDK `maxAge`；现已统一归一化秒/毫秒寿命、预留到期安全余量，并把无寿命信息的默认缓存降为 5 分钟。
- 静态检查未发现 WXML `<image src>` 继续直接绑定原始 CloudBase File ID。开发者工具 CLI 已在 `127.0.0.1:9420` 接管并打开项目；最近日志中本地图片 500、编译错误和 WXML/WXSS 语法错误匹配数均为 0。客户端仍未上传体验版或提交审核。

## 生产存储权限复核

- 生产 Cloud Storage 规则只公开读取 `knowledge-covers/`、`knowledge-previews/`、`knowledge-thumbnails/` 和 `user-media/`，遗漏了 `knowledge-source-avatars/`。因此即使客户端已正确调用临时地址接口，普通小程序用户仍无法读取来源头像；这是与客户端直绑 `cloud://` 并列的第二个根因。
- 生产抽样下载的 Rohan Paul、Elon Musk 与 Xiaohu 三个 WebP 均为有效头像，说明样本的抓取、账号映射和上传内容本身正确；问题在读取权限，不在代理或头像提取。
- 来源头像目前已由 `knowledgeFeed` 云函数下载并持久化，迁移浏览器截图架构不是修复头像的前置条件。2026-07-21 已只对 `knowledge-source-avatars/` 前缀补生产公开读规则；线上规则复读命中，最新 8 条资讯有 3 条返回来源头像 File ID，抽样对象临时 HTTPS 地址返回 HTTP 200、`image/webp`。客户端运行时解析修复已通过测试并在开发者工具重新打开，仍待随完整版本上传体验版。

## AIHOT 展示结构

- 资讯列表和详情都把作者头像、昵称、`@handle` 与时间放在正文上方；标题、摘要和媒体之后再展示 AIHOT 原始标签。
- “最新”列表按日期分组，左侧只占 62rpx，显示纵向细线、时间和节点；“热度”列表恢复全宽，避免没有时间语义时浪费手机空间。
- 头像临时地址不可用时保留首字母占位；无图资讯仍完整展示文字，不把媒体失败升级为页面失败。

## 截图服务与调度

- Nginx 读取超时从 30 秒提高到 54 秒。原先约 50 秒得到 504 的 canary 之后能到达应用并由质量闸门返回 422，说明代理层不再提前截断慢请求。
- `knowledgeFeed` 的 8 个定时触发器已逐条复核，均为 `Enable=1`、`Available`、`on`。视觉触发器为 `10,25,40,55 * * * * * *`；来源、分析、归档、旧视觉和日/周/月简报触发器均仍存在，未被本轮同步误删。
- 恢复触发器后的 6 分钟样本出现 23 次函数触发：14 次因全局租约占用安全退出，9 次真正 capture；每次实际 capture 最大值始终为 1。结果为成功 8、质量 422 重试 1，HTTP 429 和 504 均为 0。
- 最新 12 条在复核时为 `ready=11`、`retry=1`、`pending/queued/failed=0`。全量 v3 live 队列仍有 89 条，其中 pending 85、retry 3、leased 1、blocked/cleanup 0；持续入队速度仍高于单机净清空速度，但最新资讯已被优先处理。
- renderer 保持 active/running、重启数 0；当前内存约 546 MiB、历史峰值约 1.05 GiB，服务上限约 1.27 GiB。四频已使单并发机器接近持续工作，不具备安全开启第二个 Chromium 的余量。

## 验证

- 全量 Node 测试：404/404。
- 项目检查：35 个 JSON、252 个 JavaScript、11 个页面。
- 媒体专项覆盖批量部分失败、短期负缓存、单次强制刷新、过期页面代际、收藏页加载竞态、个人头像和评论附件。
- `git diff --check` 无代码格式错误，仅有仓库既有 CRLF 提示。

## 相关实现

- `hyyc/features/knowledge-feed/cloud-media-session.js`
- `hyyc/features/knowledge-feed/cloud-media-recovery.js`
- `hyyc/features/knowledge-feed/source-presentation.js`
- `hyyc/features/user-profile/media.js`
- `hyyc/features/engagement/media.js`
- `hyyc/pages/inbox/index.wxml`
- `hyyc/pages/inbox/index.wxss`
- `hyyc/pages/feed-detail/index.wxml`
- `hyyc/pages/feed-detail/index.wxss`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-visual-worker-service.js`
- `cloudbaserc.json`
