---
title: "新公网直连中继部署与 CloudBase 回程路由灰度"
type: source
tags: [source-preview, proxy, cloudbase, networking, canary]
date: 2026-07-22
last_updated: 2026-07-22
status: superseded
confidence: high
---

# 新公网直连中继部署与 CloudBase 回程路由灰度

> 当前状态：本页记录的是原公网地址的回程失败与回滚历史，已被 [替换公网地址回程恢复与生产切换](2026-07-22-replacement-relay-ip-cutover.md) 取代。原抓包结论仍作为旧地址的事故证据保留。

## 范围

- 在新购 1 vCPU、1 GiB 节点上部署只承担 X 出口的受限 WSS 中继，不在公网机运行 Chromium，也不授予 Cloud Storage 上传权限。
- 验证新节点直连 X、本地 WSS、CloudBase 到新节点的真实链路，并以真实 X 截图作为切换门禁。
- 灰度失败时恢复旧中继，避免生产截图链路中断。

## 新节点部署状态

- Ubuntu 24.04 已完成最小化部署：独立非登录服务账号、Nginx、受限 WSS 中继、自动续期 TLS、1 GiB swap、受限 journald 与仅开放 SSH/HTTP/HTTPS 的防火墙。
- 中继只监听回环端口，由 Nginx 暴露令牌保护的 WSS 路径；出口模式为直连，不安装 Mihomo，也不消耗开发者本地 VPN 流量。
- 新节点直接访问 X robots 和真实 status 页面均返回 HTTP 200；本地通过正式域名连接 WSS，并由中继访问 X，也成功返回 200。

## CloudBase 灰度结果

- CloudBase 探针连接新中继时在 WebSocket opening handshake 阶段超时。
- 服务端抓包确认腾讯云源地址的 TCP SYN 已到达新节点 443，新节点也通过默认网关持续发出 SYN-ACK，但腾讯侧没有返回最终 ACK；Nginx 正常监听 IPv4/IPv6，防火墙计数确认 443 流量已放行。
- 因此失败点位于新服务商到腾讯云方向的回程路由、上游清洗或运营商互联，不是 WSS 实现、TLS、Nginx、防火墙、CloudBase 函数内存或节点算力。

## 生产回滚与验收

- 未把新节点设为生产出口；CloudBase 环境变量已恢复旧中继，新增的可选地址固定能力保持向后兼容但未启用。
- CloudBase 对旧中继的认证探针成功，随后真实 X canary 在 53.4 秒内完成，精确命中目标并上传 1 张 JPEG；canary 文件验收后按精确路径删除。
- 当前视觉队列没有新的 `pending` 或 `leased` 任务；保留的是 95 条历史质量/网络重试，不构成实时排队。

## 验证

- 原文截图专项测试 34/34 通过。
- 全量 Node 测试 425/425 通过。
- 项目检查通过，覆盖 35 个 JSON、266 个 JavaScript 文件和 11 个页面。

## 后续切换门禁

1. 新服务商修复到腾讯云中国大陆源网段的回程路由或上游过滤。
2. 先运行 CloudBase 认证探针，要求 WebSocket 握手成功且目标 TLS 返回数据。
3. 再运行真实 X canary，要求目标精确匹配、图片通过质量审核并上传成功。
4. 两项都通过后才切换生产中继；切换前不删除旧节点。

## 敏感信息

本页没有记录公网 IP、SSH 私钥、CloudBase 凭据、中继令牌或环境变量实际值；连接元数据只存放在 `wiki/secrets/`。
