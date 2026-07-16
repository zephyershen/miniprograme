---
title: "缺图资讯使用受控原文页面截图"
type: decision
tags: [source-preview, playwright, cloudbase, security, ux]
date: 2026-07-16
last_updated: 2026-07-16
status: accepted
confidence: high
---

# 缺图资讯使用受控原文页面截图

## 背景

全部资讯都应展示，不能因上游没有封面而隐藏；但长篇纯文字列表和详情缺少视觉锚点，阅读吸引力不足。用户明确希望优先使用原文页面截图，并在原文较长时提供多张预览，而不是生成与原文无关的 AI 配图。

普通 CloudBase 云函数不适合安装和长期运行 Chromium。项目已有一台配有 Mihomo 出口代理的公网服务器，可承担受控浏览器渲染。

## 选项

1. 继续使用纯文字：成本最低，但不能满足图文体验目标。
2. 用生成式 AI 制作替代图片：视觉更强，但可能误导用户，且需要额外模型接口和费用。
3. 在 CloudBase 云函数中直接运行浏览器：部署简单，但运行环境、体积、内存和超时不适合 Chromium。
4. 公网服务器运行独立 Playwright 渲染器，CloudBase 只负责编排、上传和缓存。

## 最终决定

采用选项 4：

- 原始封面仍是最高优先级；只有没有真实封面的资讯才使用原文页面截图。
- 独立 Node.js/Playwright 服务最多截取 3 个手机视口，输出 JPEG；不复制原文正文，不生成虚构图片。
- CloudBase `knowledgeFeed` 通过维护专用 action 调用渲染器，将图片写入 `knowledge-previews/source/`，公开 DTO 只返回 `visualFileId`、`visualKind` 和最多 3 个 `previewFileIds`。
- 首页把第一张截图当作视觉素材；详情页展示第一张并提供“点击查看 N 张”，使用 `wx.previewImage` 浏览完整截图组。
- 批量 `hydratePreviews` 只处理仍然缺少视觉素材的条目；需要重建已有截图时使用单条 `hydratePreview(id, true)`，避免批量强制调用反复处理同一批条目。

## 安全边界

- 渲染器只绑定回环地址，Nginx 仅暴露 HTTPS 路由；捕获接口使用至少 32 字符 Bearer Token。
- CloudBase 维护 action 使用另一枚独立令牌，不能由普通小程序用户上下文调用。
- 目标只允许默认 443 端口的公共 HTTPS；每个浏览器请求都重新检查 DNS 和私网/保留地址。
- 服务在没有回环代理时默认拒绝启动；生产代理必须在自身 DNS 解析后拒绝内网、回环、链路本地、CGNAT、组播和保留网段。
- 浏览器阻止 Service Worker，只允许一个并发捕获，并限制请求体、响应体、单图大小、截图数量和总超时。
- HTTP 4xx/5xx、无主文档响应和浏览器错误页不作为成功截图保存。
- 服务使用独立非 root 用户和 systemd 安全限制；Nginx 对捕获路由限流。

## 数据一致性与生命周期

- 资讯刷新在数据库事务内读取最新缓存并合并封面/截图字段，避免刷新覆盖并发回填。
- 封面和截图维护统一使用事务 patch，不再用旧快照覆盖整个数组。
- 被上游移除的资讯所引用的视觉文件进入持久化清理队列；只允许删除知识资讯模块拥有的两个文件前缀。
- 单条强制重建若生成的截图少于旧截图，已不再使用的尾图也在事务 patch 时进入同一持久化清理队列；仍被任意资讯引用的文件会从队列中排除。
- 删除失败保留队列并在后续刷新重试，不能把任意 `cloud://` 文件当作可删除对象。
- 本地 `config.local.js`、服务器凭据和令牌都必须被 Git 与云函数部署包排除；实际值只保存在 `wiki/secrets/` 和受限运行环境中。

## 影响

- 2026-07-16 最终动态池的 106 条资讯全部拥有视觉素材：13 条使用真实封面，93 条使用原文截图。
- 用户仍通过摘要获取知识，截图是视觉预览和原文上下文，不替代摘要，也不宣称是文章全文存档。
- 新服务器或容器部署必须复制同等的代理和出口隔离；不能只运行 Dockerfile 而省略私网出口拒绝。
- 截图质量仍受目标站登录墙、地区限制、反爬和页面结构影响；失败状态可通过维护 action 查询并重试。

## 状态

accepted

## 日期和来源

- 日期：2026-07-16
- 来源：用户对缺图资讯和原文截图的要求、服务器配置审计、当前代码、CloudBase 与微信开发者工具端到端验证

## 相关代码 / 页面

- `hyyc/cloudrun/source-preview-renderer/`
- `hyyc/cloudfunctions/knowledgeFeed/services/preview-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-service.js`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/feed-cache.js`
- `hyyc/pages/inbox/index.wxml`
- `hyyc/pages/feed-detail/`
