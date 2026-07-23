---
title: "新公网节点个人 Clash 代理部署与 Mihomo 验证"
type: source
tags: [proxy, clash-verge, mihomo, sing-box, nginx, operations]
date: 2026-07-23
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# 新公网节点个人 Clash 代理部署与 Mihomo 验证

## 范围

- 在不改变小程序生产中继入口和防火墙的前提下，为项目所有者增加可由 Clash Verge 导入的个人代理。
- 复用正式域名的 Nginx 443/TLS，以独立回环服务和随机路径隔离个人流量与截图中继。
- 生成远程订阅和本机离线 YAML，并使用与 Clash Verge 同代的 Mihomo 做真实端到端验证。

## 实现

- 服务端使用官方 sing-box `1.13.14` Linux amd64 发布包，按 GitHub Release API 的 SHA-256 digest 校验后安装。
- `personal-proxy.service` 以独立无登录账号运行，VLESS/WebSocket 只监听 `127.0.0.1:8793`，systemd 保留只读文件系统和无额外 capability 等隔离；按所有者要求，2026-07-23 已把 `MemoryMax` 与 `TasksMax` 持久覆盖为 `infinity`，不设置个人代理并发或内存的人为配额。
- Nginx 在现有 443 站点增加两个独立随机精确路径：一个转发 WebSocket，一个只读返回 Clash YAML；订阅响应禁用缓存和 access log。没有新增公网端口或 UFW 规则。
- 现有 `/source-proxy/tunnel`、`/source-proxy/health`、`source-preview-relay.service` 和固定生产中继地址均未改变。
- 目标私网地址在 sing-box 路由层拒绝，避免个人凭据泄露后被用于访问节点私网或回环服务。

## 验证

- `sing-box check`、`nginx -t` 通过；Nginx、生产中继和个人代理均为 active/running，`NRestarts=0`。
- 公网仍只监听 22/80/443；生产中继与个人代理分别只监听回环 8792/8793。
- 远程订阅返回 HTTP 200、YAML 文件名和 `Cache-Control: no-store`。
- Mihomo `v1.19.29` 对下载后的订阅语法检查通过；隔离本地端口的真实 HTTPS 请求返回 204，代理出口与服务器出口一致。
- 用户明确要求暂不在本机 Clash Verge 中自动导入或切换，现有本地 7897 监听和当前订阅保持不变。
- 并发复核确认 sing-box 配置没有 `max_connections`/multiplex 流上限，Nginx 没有 `limit_conn` 或 `limit_req`；在线取消 systemd 资源上限时主进程 PID 未变化、重启增量为 0。本机 Clash 配置没有被修改。

## 敏感信息

实际订阅链接、UUID、随机路径和服务器连接信息只保存在 Git 忽略且 ACL 受限的 `wiki/secrets/` 与服务器受限配置中；普通 Wiki 不记录实际值。
