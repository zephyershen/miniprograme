---
title: "CloudBase 媒体只以 File ID 持久化，并采用单并发高频视觉调度"
type: decision
tags: [cloudbase, media, knowledge-feed, wechat, source-preview, reliability]
sources: [../sources/2026-07-21-cloud-media-runtime-and-safe-visual-throughput.md]
date: 2026-07-21
last_updated: 2026-07-22
status: accepted
confidence: high
---

# CloudBase 媒体只以 File ID 持久化，并采用单并发高频视觉调度

## 背景

来源头像已经成功缓存到 CloudBase，但资讯详情把 `cloud://...` 直接绑定到 WXML `<image src>`。微信渲染层把它当作相对本地路径并拼到 `/pages/feed-detail/` 后，最终报本地图片 500。与此同时，公网截图的浏览器任务常超过旧 Nginx 30 秒读取超时，历史修复任务与持续新资讯又共同占用单机队列，导致最新卡片长时间无图。

## 最终决定

- CloudBase `cloud://` File ID 只作为持久标识和鉴权输入，禁止直接绑定为任何 WXML 图片地址。页面只绑定运行时换取的 HTTPS 临时地址或本地占位。
- `features/knowledge-feed/cloud-media-session.js` 统一收集作者头像、列表图、封面、预览图和相关阅读图片，按 CloudBase 上限分成每批最多 50 个，合并并发请求，并使用有界正/负缓存。
- 正缓存必须服从 `getTempFileURL` 返回的 `maxAge` 并预留安全余量；SDK 未返回寿命时最多缓存 5 分钟。不得再用固定 30 分钟缓存覆盖签名链接的实际寿命。
- 资讯文字先渲染，媒体地址异步补入；单个地址加载失败时统一失效缓存并强制重取一次。仍失败则只隐藏该图片、显示头像首字母或保留正文，不形成无限重试。
- 同样的 File ID 边界应用到个人头像、评论头像与评论附件，避免只修资讯页面后在其他入口复现。
- 页面只消费展示模型：作者头像、昵称、账号和时间位于内容上方，上游原始标签位于媒体下方；“最新”排序使用 62rpx 的移动端时间线，“热度”排序不伪造时间线。
- 公网 renderer 保持一个真实 Chromium capture 和全局租约。CloudBase 只把视觉触发探测提高到每分钟 `:10/:25/:40/:55`，每次最多认领一个任务；租约占用时立即安全退出，不用额外并发换速度。
- Nginx `proxy_read_timeout` 提高到 54 秒，使较慢的有效请求有机会到达质量闸门；错误壳、目标不匹配和稀疏页面继续由 v3/AI 审核 fail-closed，不能为了吞吐放宽图片质量。

## 模块边界

- `services/cloud-media.js` 只封装 CloudBase 临时地址 API。
- feature media session 负责批处理、缓存和 DTO 回填；media recovery 只负责页面图片失败后的单次恢复。
- presentation/model 保存 `avatarFileId`、`avatarUrl` 和首字母占位的显式合同；页面只绑定 `*Url`，不直接调用云媒体 API。
- 视觉 repository 管理任务、租约和生命周期；worker service 只做车道选择与单任务编排；renderer 只负责浏览器捕获和页面质量证明。

## 容量边界

当前 2C2G 公网机的 renderer 历史峰值约 1.05 GiB，服务内存上限约 1.27 GiB，第二个真实 Chromium 会把故障风险推到不可接受范围。四频探测已让单并发接近持续工作，因此本阶段不增加真实并发；若以后要求全量积压持续净下降，应先扩容主机或拆独立实例，再通过同一租约/任务合同水平扩展。

## 状态

`accepted`。以后新增 CloudBase 媒体字段必须先进入对应 feature media session；任何 WXML 出现原始 `cloud://` `src` 都视为回归。

## 相关实现

- `hyyc/services/cloud-media.js`
- `hyyc/features/knowledge-feed/cloud-media-session.js`
- `hyyc/features/knowledge-feed/cloud-media-recovery.js`
- `hyyc/features/user-profile/media.js`
- `hyyc/features/engagement/media.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-visual-worker-service.js`
- `hyyc/pages/inbox/`
- `hyyc/pages/feed-detail/`
