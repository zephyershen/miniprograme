---
title: "公网 WSS/Mihomo 中继容量与真实截图流量复核"
type: source
tags: [proxy, mihomo, capacity, traffic, source-preview]
date: 2026-07-22
last_updated: 2026-07-22
status: confirmed
confidence: high
---

# 公网 WSS/Mihomo 中继容量与真实截图流量复核

## 范围

- 只读复核现网公网服务器的 CPU、内存、磁盘、服务状态和 24 小时告警。
- 对一次真实 X 视频推文的 CloudBase 截图尝试采集公网中继网卡增量与 CONNECT 目标。
- 判断“截图会不会经过视频域名”以及代理专用新机的最低配置。

## 现网资源

- 机器为 2 vCPU、1968 MiB 内存；采样时约使用 581–593 MiB、可用约 1.37 GiB，根盘使用 13.3 GB、剩余约 25.1 GB。
- `mihomo.service`、`source-preview-proxy.service`、`nginx.service` 均为 active/running，重启数为 0，最近 24 小时没有 warning 级代理日志。
- 主要常驻进程 RSS：WSS relay 约 118 MiB、Mihomo 约 58 MiB，另有 Nginx、Fail2ban、腾讯云监控代理和一个独立插件同步 Node 服务。
- 代理自身文件很小：WSS relay、Mihomo 配置和 Nginx 配置合计约 11 MiB。当前 13.3 GB 占用主要来自系统、1.7 GB journal、`/home` 下的开发工具和其他历史文件，因此全新最小化代理节点可使用 10 GB 磁盘，但不适合原盘无清理镜像迁移。

## 真实截图流量

- 一次真实 X 视频推文截图尝试期间，公网网卡增量约为 RX 2.73 MB、TX 2.89 MB；这是整机观测值，可作为该次代理流量的保守近似，不是长期账单精确值。
- CONNECT 目标包含 `x.com`、`api.x.com`、`pbs.twimg.com`、`abs.twimg.com`，并实际出现 2 条 `video.twimg.com` 连接和 1 条 Sentry 连接。
- 因此“只生成截图”不等于浏览器只下载最终 JPEG：Chromium 仍需加载页面脚本、图片、字体和视频的初始资源。但本次没有观察到完整视频级的大流量，整次出站仍只有约 2.9 MB。
- 本地 CLI 等待 SCF 返回时遇到腾讯 API 网络超时；该错误不影响中继侧已经采集到的真实域名和流量证据，但本次不作为截图成功率验收。

## 异常进程

- 发现一个不属于 systemd 服务的历史 Codex CLI 进程，自 2026-01-20 起持续存在并占满约一个 vCPU；父进程同样位于旧用户会话。它解释了 2C 机器负载长期接近 1，不能作为业务真实算力需求。
- 本轮只读诊断，没有终止该进程。降配或迁移前应先确认并清理，否则 1 vCPU 节点会被它占满。

## 结论

- 对“只保留 WSS relay + Mihomo + Nginx”的新节点，1 vCPU、1 GiB RAM、200 Mbps、每月 512 GB 出站流量在当前规模下足够；建议保留 1–2 GiB swap，并限制 journal。
- 512 GB 按本次约 2.9 MB 出站折算可覆盖约 17 万次同量级捕获；即使单次按 10 倍保守放大，也远高于当前每日新增规模。
- 2C4G 计算型没有实际收益，3 TB 流量型只在未来将浏览器迁回公网机、承担其他大流量服务或真实月度观测接近 400 GB 时再考虑。

## 敏感信息

本页没有记录公网 IP、SSH 端口、密码、代理节点、订阅信息、令牌或域名密钥；实际连接信息仍只保存在 `wiki/secrets/`。
