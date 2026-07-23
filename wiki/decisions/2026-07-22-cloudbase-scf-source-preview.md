---
title: "原文截图迁入 CloudBase SCF，公网服务器只保留受限代理"
type: decision
tags: [source-preview, cloudbase, scf, playwright, proxy, security]
date: 2026-07-22
last_updated: 2026-07-22
status: accepted
confidence: high
---

# 原文截图迁入 CloudBase SCF，公网服务器只保留受限代理

## 背景

公网 2C2G 服务器只能安全运行一个 Chromium，历史内存峰值已经接近可用上限；继续增加 worker 会把吞吐问题变成整机重启和错误截图风险。截图质量闸门、视觉队列和 CloudBase 文件生命周期已经独立于浏览器实现，因此可以只迁移执行层，不改公开数据合同。

## 选项

1. 继续扩容或增加公网渲染进程：改动小，但浏览器、上传接口、代理和生产入口仍集中在单机。
2. CloudBase 函数全部直连外站：结构最简单，但 X 及部分区域受限站点的可达性不足。
3. CloudBase SCF 负责浏览器、截图和上传；所有站点先直连，X 原页失败后尝试官方嵌入页，仍失败才通过公网 WSS 中继；公网服务器不再运行截图 API。

## 最终决定

采用选项 3：

- 新建 `sourcePreviewWorker` CloudBase 云函数，使用 Node.js 20.19、2048 MB、90 秒超时、`playwright-core` 和 `@sparticuz/chromium` 执行截图。
- `knowledgeFeed` 通过 `wx-server-sdk.callFunction` 调用，并显式传入 SDK 请求超时；HTTP renderer fallback 默认关闭，生产不会再回退公网截图接口。
- SCF 在函数内完成截图和 Cloud Storage 上传，只返回 File ID、质量证明和一张有界的代表图供视觉审核，避免把整组 Base64 作为函数响应传回。
- 普通网站默认使用 CloudBase 出口直连；确认存在区域可达性问题的新闻站点优先走受令牌保护的 WSS 中继。精确 X status 为降低 401/登录墙和无效重试开销，依次尝试“中继官方嵌入页 → 中继原页 → 直连官方嵌入页 → 直连原页”，每条路径仍必须命中同一数字 status id。目标不匹配和图片无效仍 fail-closed，不会为了可达性发布错误截图。
- 对已知注册墙但源页面提供第一方 Open Graph 主图的站点，执行层可提取并渲染该图，但仍需由视觉模型核对可见标题、实体或主题；不能因为图片来自 Open Graph 就自动放行，也不能因为它不是完整浏览器页面就自动拒绝。
- 公网服务器仅保留 Nginx 443、WSS 中继 `127.0.0.1:8792` 和 Mihomo `127.0.0.1:7890`。旧 renderer、第二代理及 8791/7891/8443 监听均删除，旧 `/source-preview/` 路由固定返回 410。
- 冻结实例复用到失效浏览器句柄时，捕获服务清理缓存并只重启 Chromium 一次，避免把容器解冻问题永久写成任务失败。
- 视觉任务队列继续保留，用于退避、重试、清理、live/repair 公平性和应用级背压。单个 2GB SCF 实例仍只运行一次 Chromium 捕获；`knowledgeFeed` 调度器可同时调用 6 个隔离实例，并在同一全局租约内分批排空任务。fresh live 的等待目标为 0，新资讯先排空，再恢复 repair/recovery 公平轮转。
- SCF 去掉了公网单机 Chromium 瓶颈，但不承诺“永远没有排队”。目标 0 表示调度器不主动为历史公平性留下新资讯；突发新增、外站不可达、冷启动和上游限流仍可能产生短暂执行中状态，退避中的历史任务不等于最新资讯排队。

## 安全边界

- WSS 中继只接受经过令牌认证的 HTTPS `CONNECT host:443`，拒绝私网、回环、保留地址和非 443 目标。
- SCF 与中继令牌只存于受限配置和线上环境变量，普通 Wiki、日志和客户端均不记录实际值。
- 公网代理不接收截图结果、不持有 CloudBase 上传权限，也不运行浏览器；其职责只是把加密隧道内的外站字节转发到本机受控代理。
- CloudBase 函数的环境变量由线上环境维护，`cloudbaserc.json` 不写入密钥，后续部署不得用空配置覆盖生产值。

## 影响

- 截图 CPU/内存消耗从公网服务器迁入 CloudBase，公网服务器配置不再决定 Chromium 吞吐上限。
- 普通站点可直接利用 CloudBase 出口；只有确需国外访问的目标经过公网代理，减少带宽和单点依赖。
- 旧公网 renderer 目录和 systemd 服务已经删除；Nginx 变更前备份保存在服务器 `/etc/nginx/backups/`，路由可恢复，但旧 renderer 代码目录本身已删除。
- 原有 v3 质量闸门、AI 复核、四分钟有界等图、失败后文字放行和云文件清理合同保持不变。
- 2GB 是每个截图实例的内存；六并发会临时使用最多 6 个独立 2GB 配额实例，不在一个容器内争抢 CPU/内存。并发只在有任务时产生，不增加空闲轮询次数。公网中继的当前上限保留个人代理余量，不继续上调到 8。
- 公网中继的 Nginx 并发上限已从默认 768 提升到 4096，文件句柄上限提升到 8192；公网机仍只转发加密隧道，不承担浏览器内存与截图计算。
- X 官方嵌入兜底只接受从精确 `x.com`/`twitter.com` status URL 提取的纯数字 ID，固定构造 `platform.twitter.com` HTTPS 地址；嵌入页也必须再次命中同一 status id，不能降级成任意 X 页面。

## 状态

accepted

## 验证

- SCF 上线后，X 冷/热调用、AIHOT 直连和 Google/DeepMind 直连失败后代理重试均生成正确页面；生产 `knowledgeFeed` 日志确认函数调用成功且 HTTP fallback 为 false。
- 公网 renderer 下线后，WSS 中继访问 X `robots.txt` 返回 200/4359 bytes；中继健康为 200，旧 renderer 路由为 410。
- 下线后的 CloudBase X canary 在 19.5 秒内完成，`targetMatched=true`、上传 1 张 JPEG；下载肉眼核验包含正确头像、昵称、正文、两段视频和互动区，不是错误页。
- 2026-07-22 四并发部署后，同一秒观测到 4 个独立 `sourcePreviewWorker` 调用；一轮 162.8 秒尝试 13 条、成功 8 条，失败任务进入重试且未发布错误截图。
- 2026-07-22 路由复核确认当前 CloudBase 对 X 原页/官方嵌入页直连均不稳定，真实 canary 自动切换公网中继后精确命中目标并各上传 1 张 JPEG；这证明公网机仍有必要作为出口代理，但不再承担浏览器执行。
- 解决跨函数 Base64 大响应后，真实 X canary 从约 76–80 秒收敛到 15.185 秒；TechCrunch 长页、The Decoder 页面以及最新两条 X/Google 资讯均已成功补图。MarkTechPost 第一方 Open Graph 主图经 CloudBase 视觉模型以 0.95 置信度确认内容匹配后发布。
- 2026-07-22 晚间两轮六路真实 X 压测均为 6/6 精确命中并通过质量闸门；较快一轮单路约 10.0–10.5 秒、整批约 13.1 秒。代理窗口观测到最多约 121 个已建立连接、最低约 490MB 可用内存、Swap 0、负载最高约 0.02，Nginx 扩容后没有新的连接上限错误。压测对象均已删除。
- 正式代理域名 A 记录已切换并传播；健康检查经正式 TLS 域名返回 200。Chrome `150.0.7871.182` 已安装并通过 Playwright 持久化会话验证。
- 434/434 个 Node 测试通过；项目检查覆盖 35 个 JSON、267 个 JavaScript 文件和 11 个页面；微信开发者工具已重新打开并触发本地编译。

## 日期和来源

- 日期：2026-07-22
- 来源：用户要求、CloudBase/SCF 官方文档、当前代码、生产函数调用、WSS 实网测试、服务器监听与 Nginx 复核、微信开发者工具预览

## 相关代码 / 页面

- `cloudbaserc.json`
- `hyyc/cloudrun/source-preview-renderer/index.js`
- `hyyc/cloudrun/source-preview-renderer/src/browser-runtime.js`
- `hyyc/cloudrun/source-preview-renderer/src/egress-policy.js`
- `hyyc/cloudrun/source-preview-renderer/src/ws-proxy-bridge.js`
- `hyyc/cloudrun/source-preview-renderer/src/ws-relay-server.js`
- `hyyc/cloudfunctions/knowledgeFeed/adapters/source-preview-renderer-client.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/preview-service.js`
- `hyyc/scripts/decommission-source-preview.sh`
- `hyyc/scripts/finalize-source-preview-decommission.sh`
- [四并发截图与 24 课手绘图 v2 上线证据](../sources/2026-07-22-parallel-visual-worker-and-column-media-v2.md)
- [六并发截图与个人代理余量验证](../sources/2026-07-22-six-concurrency-and-personal-proxy-headroom.md)

## 取代关系

本决策取代 [缺图资讯使用受控原文页面截图](2026-07-16-source-preview-renderer.md) 中“公网服务器运行浏览器和截图 API”的执行层选择；原决定中的截图产品目标、SSRF 防护、v3 质量闸门、多图合同和文件生命周期仍然有效。
