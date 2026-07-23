---
title: "CloudBase 六并发截图与个人代理余量验证"
type: source
tags: [cloudbase, scf, source-preview, queue, nginx, proxy, capacity]
date: 2026-07-22
last_updated: 2026-07-22
status: confirmed
confidence: high
---

# CloudBase 六并发截图与个人代理余量验证

## 范围

- 判断 1C1G 公网中继在保留单人 Clash/AI/新闻和偶尔视频用途时，是否可以承载更多 CloudBase 截图并发。
- 在不增加空闲定时调用的前提下，把新资讯的实时等待目标收敛到 0。

## 当前实现

- `knowledgeFeed` 每批最多并行调用 6 个独立 2GB `sourcePreviewWorker`；每个实例仍只有一个 Chromium，不共享容器内存。
- fresh live 等待目标从 2 改为 0，新资讯优先于 repair/recovery 历史任务；失败退避、8 次阻断、全局租约和 v3 质量闸门不变。
- 视觉定时器继续在每分钟 `:10/:25/:40/:55` 四次探测。并发只在队列有工作时发生，避免把空闲轮询提高到六次而持续消耗 512MB 编排函数资源。
- Nginx 保持 `worker_connections 4096`、`worker_rlimit_nofile 8192`。不继续上调到 8 个截图实例，给单人代理连接、TLS、上游波动和系统服务保留余量。

## 实测证据

- 空闲时服务器约 913MB 物理内存，约 420MB 已用、约 490MB available，1GB Swap 使用为 0；常态已建立连接约 61–165，Nginx 与中继服务均 active。
- 两轮真实六路 X 截图均 6/6 精确命中、6/6 通过质量闸门并使用受控中继；较快一轮单路约 10.0–10.5 秒、整批约 13.1 秒。
- 压测采样窗口最多约 121 个已建立连接，中继最多约 82 个文件描述符，最低约 490MB available，Swap 0，1 分钟负载最高约 0.02；17:00 之后没有新的 `worker_connections are not enough` 或 `too many open files`。
- 压测生成的临时对象均按本轮唯一前缀精确删除。生产实时队列复核为 `pending=0`、`leased=0`、fresh live `=0`；剩余 65 条 retry 和 4 条 blocked 均为历史退避/诊断记录，不阻塞新任务。

## 结论

- 当前适合把截图并发从 4 提到 6；不建议提高到 8。
- 单人 Clash 使用主要增加带宽和少量长连接，不会像在 VPS 上运行 Chromium 那样占用大量内存。偶尔视频可与六并发共存，但持续满速视频与长页截图同时发生时仍可能互相争抢 200Mbps 出口，因此保留当前余量比追求更高峰值更重要。
- “实时等待目标 0”是调度优先级，不是对外站、冷启动、限流或断网的绝对零延迟承诺；文字放行和失败退避仍是必要的可用性边界。

## 验证

- 434/434 个 Node 测试通过。
- 项目检查通过 35 个 JSON、267 个 JavaScript 文件和 11 个页面。
- `knowledgeFeed` 已部署；部署后函数状态 Available，视觉定时器继续启用。

## 敏感信息处理

本页不记录公网 IP、SSH 私钥、CloudBase 凭据、中继令牌、代理订阅或账号密码。
