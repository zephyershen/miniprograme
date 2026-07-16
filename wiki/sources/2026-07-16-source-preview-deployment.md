---
title: "原文截图服务部署与端到端验证证据"
type: source
tags: [source-preview, deployment, playwright, cloudbase, wechat-e2e]
sources: [../../hyyc/cloudrun/source-preview-renderer, ../../hyyc/cloudfunctions/knowledgeFeed, ../../hyyc/pages/feed-detail, ../../hyyc/tests]
last_updated: 2026-07-16
status: confirmed
confidence: high
---

# 原文截图服务部署与端到端验证证据

## Provenance

- Source path / origin: 当前仓库、腾讯云公网服务器、CloudBase `knowledgeFeed`、云存储和微信开发者工具
- Date observed: 2026-07-16
- Scope: 缺图资讯原文截图生成、上传、缓存、前端展示、多图预览、安全边界和运行状态
- Status: confirmed
- Confidence: high

## 服务器部署

- 当前正式版本目录：`/opt/source-preview/releases/20260716-1555`，`/opt/source-preview/current` 指向该实体目录。
- systemd 服务名：`source-preview.service`；进程使用独立 `sourcepreview` 用户，服务监听 `127.0.0.1:8791`。
- Mihomo 只监听 `127.0.0.1:7890`，并在代理规则最前面拒绝私网、回环、链路本地、CGNAT、保留和组播地址。
- Nginx 公开路由为 `https://mrshenzf.top/source-preview/`；健康检查返回 `{ ok: true, configured: true }`，未授权捕获返回 HTTP 401。
- 服务、Mihomo 和 Nginx 均为 active；正式目录切换后的进程 `NRestarts=0`。一次真实捕获后的内存峰值约 344 MiB，低于 1.2 GiB systemd 上限。
- 服务器仍提示存在系统更新并需要重启；本轮未擅自升级或重启整台服务器。

## 渲染器验证

- 公共 HTTPS 正常页面捕获返回 HTTP 200、1 张 `1080x1350` JPEG。
- 私有地址请求被拒绝并记录 `PRIVATE_HOST`；示例 404 页面返回 HTTP 422，日志记录 `UPSTREAM_HTTP_404`。
- 服务没有使用 `--no-sandbox`，生产没有回环代理时会以 `LOOPBACK_PROXY_REQUIRED` 失败关闭。
- Playwright 包依赖审计结果为 0 个漏洞。

## CloudBase 回填和一致性

- `knowledgeFeed` 已部署最新版；部署配置明确排除 `config.local.js`，下载线上代码包复核结果为 `ConfigLocalPackaged=False`、`PreviewServicePackaged=True`。
- 上游动态池在最终部署后从 108 更新为 106，维护状态先发现 1 条待回填，随后成功生成截图。最终状态为：`totalItems=106`、`totalWithVisuals=106`、`totalWithOriginalCovers=13`、`totalWithSourcePreviews=93`、`pending=0`、`totalFailed=0`、`pendingVisualDeletes=0`。
- 云存储 `knowledge-previews/source/` 最终为 220 张 JPEG、约 25.3 MiB；一条资讯可有 1–3 张，93 条缺封面资讯均有至少一张截图。上游移除条目的孤儿截图已通过受限前缀清理。
- 最终全链路强制重建一条资讯耗时约 10.9 秒，路径为 CloudBase → HTTPS/Nginx → Playwright/Mihomo → CloudBase 云存储 → 事务缓存，返回 3 个 `previewFileIds` 且状态为 `ready`。
- 强制资讯刷新后首条返回 `visualKind=source-preview`；事务刷新没有覆盖既有截图字段，并能在上游池变化后发现新缺口。
- 事务 patch、最新快照合并、受限前缀孤儿清理和失败重试队列均有自动化测试；单条强制重建生成更少截图时，旧尾图会排入持久化清理队列，同时排除仍在引用的文件。重新部署后维护状态仍显示当前没有待清理文件。

## 微信端验证

- 微信开发者工具普通编译后首页显示真实资讯截图，无空白占位和项目级红色运行错误。
- 从首页进入详情后显示“原文页面预览 / 点击查看 3 张”。
- 点击进入 `wx.previewImage` 后顶部显示 `1 / 3`；左滑成功切换到 `2 / 3`，证明多图预览有效。
- 控制台只保留开发者工具自身的黄色兼容/性能提示。

## 本地回归

- `npm test`：82/82 通过。
- `npm run check`：21 个 JSON、73 个 JavaScript、6 个页面通过。
- `git diff --check`：通过。
- 渲染器 `npm audit --omit=dev --package-lock-only`：0 个漏洞。

## 已知风险

- `knowledgeFeed` 现有 `wx-server-sdk 4.0.2` 依赖树包含 6 个已知传递依赖问题（其中 5 个 high）；它们不是本次渲染器引入。不要按 npm 的破坏性建议盲目降级，应单独评估腾讯 SDK 的兼容升级路径。
- SSRF 的最终防线包含服务器 Mihomo/出口规则；迁移到其他服务器或容器时必须复制同等隔离。
- 登录墙、地区限制和强反爬页面仍可能无法生成有效截图；维护 action 会保留失败状态供后续重试。

## 敏感信息处理

- 普通 Wiki 不记录服务器 IP、密码或实际令牌。
- 服务器连接信息已从 `docs/txserverinfo.txt` 移入被 Git 忽略的 `wiki/secrets/`；普通页面只指向 `wiki/secrets/TencentServer.md` 元数据页。
- 截图服务令牌由被 Git 忽略的 `wiki/secrets/SourcePreview.md` 记录范围与轮换规则；实际值不进入普通 Wiki。
