---
title: "替换公网地址回程恢复与生产切换"
type: source
tags: [source-preview, proxy, cloudbase, networking, canary, production]
date: 2026-07-22
last_updated: 2026-07-22
status: confirmed
confidence: high
---

# 替换公网地址回程恢复与生产切换

## 范围

- 验证服务商替换公网地址后，原服务器系统盘、SSH、Nginx、WSS 中继和 X 直连是否正常。
- 使用 CloudBase 上海函数发起真实 TLS/WebSocket 探针和 X 截图，重新验证旧地址曾失败的腾讯云回程链路。
- 通过正式证书域名与固定地址分离 DNS 和连接目标，在公共 DNS 尚未更新时完成安全生产切换。

## 节点与 TLS 验证

- 新地址的 22、80、443 均可连接；SSH 登录确认主机名仍为 `mrshenzf`，Nginx 与 `source-preview-relay.service` 均为 active，中继继续只监听 `127.0.0.1:8792`。
- 节点直接访问 X robots 与真实 status 页面均返回 HTTP 200，不运行 Mihomo、Chromium 或 Cloud Storage 上传。
- 正式域名证书有效；DNSPod 的正式 A 记录已于 2026-07-22 16:10:48 更新到替换地址，并由节点解析器、腾讯公共 DNS 与公共递归解析器复核传播成功。灰度阶段新增的独立 `sslip.io` 证书继续保留作故障诊断，不作为生产依赖。
- 生产不依赖 `sslip.io`：`sourcePreviewWorker` 使用正式证书域名作为 WSS URL，并通过 `SOURCE_PREVIEW_RELAY_ADDRESS` 固定连接替换地址，TLS SNI 和证书校验保持完整。

## 令牌与 CloudBase 配置

- 新节点初始中继令牌与 CloudBase 当前令牌不一致；节点令牌已对齐到现有 `sourcePreviewWorker` 令牌，避免同时改动调用方和执行函数。普通 Wiki 未记录实际值，只通过 SHA-256 指纹确认两端一致。
- CloudBase CLI 的基础配置更新命令没有应用 `envVariables`；随后使用腾讯云 SCF `UpdateFunctionConfiguration` 精确更新 WSS URL 和固定地址，并通过 `GetFunction` 复查函数状态为 `Active`、两个变量均已生效。
- `probeRelay` 从 CloudBase 上海函数连接替换地址成功：`relayReady=true`、`addressPinned=true`、目标为 `x.com:443`，两次探针约 675ms/799ms。旧地址的 WebSocket opening handshake 回程问题在替换地址上未复现。

## 真实 X canary

- 真实 status 截图在 79.716 秒内完成，`egressMode=foreign-proxy`、`targetMatched=true`、5/5 媒体就绪、质量结论 `accept`，并上传 1 张 JPEG。
- CLI 因函数返回包含完整 Base64 审核图而报告调用失败，但函数日志 `retCode=0` 且 `RetMsg.ok=true`；这是调用结果体过大，不是截图失败。后续 canary 判断应以函数日志和云对象为准，或让专用探针响应不返回审核图。
- canary JPEG 已通过云存储对象类型检查，并按精确路径删除；复查确认对象不存在。
- 随后把跨函数响应收敛为 Cloud File ID，父函数只下载一张有界代表图交给 AI 复审，不再让完整 Base64 截图穿过函数返回体。修复后的真实 X canary 在 15.185 秒内完成并通过精确目标校验。
- 四并发实测暴露了 Nginx 默认 `worker_connections=768` 的真实瓶颈；生产已提升为 4096，并将 `worker_rlimit_nofile` 提升为 8192。热重载前后 `nginx -t` 均通过，节点约 913 MiB 内存、1 GiB swap，在并发测试中仍有约 500 MiB 可用内存且 swap 未使用。
- 本机缺失的 Chrome 已从 Google 官方安装包完成安装，版本 `150.0.7871.182`；Playwright 使用持久化 Chrome 会话打开真实页面成功，后续 DNSPod 与网页诊断不再依赖手工浏览器准备。

## 当前结论与后续

- 替换地址已满足生产门禁并成为当前 X 出口；CloudBase 截图仍先直连，只有 X 直连/官方嵌入失败时才走该受限 WSS 中继。
- 正式代理子域名已指向替换地址并完成传播。`SOURCE_PREVIEW_RELAY_ADDRESS` 暂时保留为确定性连接保护：它不会绕过证书校验，TLS SNI 仍使用正式域名；待连续生产观察稳定后再决定是否移除。
- 最新资讯已完成一次生产补图：跨函数大响应、区域受限站点绕路和 Nginx 连接数三个瓶颈均已修复；MarkTechPost 的精确页面 Open Graph 主图通过 CloudBase 视觉模型 0.95 置信度复审并发布。确实 404、匿名访问不可见或 AI 判定不相关的来源继续只显示文字，不发布错误页或无意义图片。
- 旧地址的回程失败记录保留为历史证据，不再代表当前线路状态。

## 敏感信息

本页未记录公网 IP、SSH 私钥、CloudBase 临时凭据、中继令牌或环境变量实际值；连接元数据保存在 Git 忽略的 `wiki/secrets/`。
