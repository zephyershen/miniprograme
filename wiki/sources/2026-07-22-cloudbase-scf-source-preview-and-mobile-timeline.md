---
title: "CloudBase SCF 截图迁移、公网代理收缩与移动时间线验证"
type: source
tags: [cloudbase, scf, source-preview, proxy, timeline, wechat]
date: 2026-07-22
last_updated: 2026-07-22
status: confirmed
confidence: high
---

# CloudBase SCF 截图迁移、公网代理收缩与移动时间线验证

## 范围

- 将原文截图执行、Cloud Storage 上传和函数响应合同迁入 CloudBase `sourcePreviewWorker`。
- 将公网服务器收缩为受限 WSS 出口代理并移除旧 renderer。
- 修复“最新”资讯时间与节点重叠，并增加按日期折叠。

## 实现证据

- `sourcePreviewWorker` 使用独立浏览器运行时：公网开发环境可用完整 Playwright，SCF 使用 `playwright-core` + Sparticuz Chromium；失效冻结句柄最多重启一次。
- `knowledgeFeed` 由单独 adapter 负责 `callFunction` 合同、请求超时和响应验证；preview/thumbnail service 不直接理解 CloudBase SDK。
- SCF 上传完整 JPEG 集合，只返回 File ID 和一张代表图；所有站点先直连，X 的 401/登录墙路径追加精确 status id 的官方嵌入页，再按需要走本地 CONNECT → WSS → 公网 Mihomo 的受控链路。
- `rendererHttpFallbackEnabled` 生产默认关闭，旧公网 `/source-preview/` 已返回 410。
- 列表模型以稳定 `dateKey` 标记日期组；页面维护 `collapsedTimelineDays`，点击日期头折叠/展开该日全部卡片，不影响相邻日期。
- 移动端时间线为 86rpx 预留区，时间宽 52rpx；竖线位于 73rpx，13rpx 节点位于 67rpx，使时间、节点和正文之间都有明确间距。热度模式继续不显示时间线。

## 生产验证

- 公网端最终状态：Nginx 443、`127.0.0.1:8792` WSS relay、`127.0.0.1:7890` Mihomo；8791/7891/8443 不再监听，旧服务和目录均不存在。
- WSS relay 通过 X 实网测试：`HTTP/1.1 200 OK`，返回 4359 bytes；公开健康端点为 200，旧 renderer 端点为 410。
- SCF X canary：19.5 秒完成，1 段、目标 status 精确匹配、1 张云端 JPEG。下载原图肉眼确认作者头像、昵称、正文、主视频、引用视频和互动区正确。
- 迁移前的连续生产日志已确认多条真实 X、x.ai、TechCrunch 和 Google 页面由 SCF 成功生成，且 `scfUnavailable=false`、`fallbackTrue=false`。
- 2026-07-22 新路由 canary 明确记录 `egressMode`：当前 CloudBase 对测试 X 原页与官方嵌入页直连均未成功，自动切换 `foreign-proxy` 后两条路径分别精确命中目标、各上传 1 张 JPEG。测试文件随后按精确路径删除；生产代理令牌和环境变量仍完整保留。

## 测试与构建

- Node：422/422 通过。
- 项目检查：35 JSON、264 JavaScript、11 pages。
- 时间线新增模型回归：折叠整日不会隐藏相邻日期。
- 微信开发者工具 `preview` 成功，包体 1,775,837 bytes；未上传体验版或提交审核。

## 结论

当前生产截图已经不依赖公网服务器运行 Chromium。公网机只承担必要外站的网络中继；CloudBase 直连可用时不经过它。任务队列仍有意保留，因此能避免丢任务并支持失败恢复，但不应把“使用 SCF”描述成绝对零排队。

X 云端请求是否被视为自动化取决于 X 看到的出口 IP、匿名会话、浏览器指纹和访问频率，不取决于业务方是否自称爬虫。当前实现不会伪造登录会话：先用公开原页，再用 X 官方公开嵌入展示，最后才切受控代理；若三层均失败则保留文字而不发布错误截图。需要 API 级绝对稳定性时，仍应配置官方 X API Bearer Token 和对应付费额度。

## 敏感信息处理

本页未记录 CloudBase 凭据、renderer token、服务器密码、OpenID、支付凭据或环境变量实际值；只记录非敏感服务名、端口角色和验证结果。

## 官方资料

- [CloudBase 云函数运行环境](https://docs.cloudbase.net/cloud-function/runtime-support)
- [CloudBase CLI 云函数配置](https://docs.cloudbase.net/cli-v1/functions/configs)
- [CloudBase 云函数调用](https://docs.cloudbase.net/cloud-function/how-use)
- [CloudBase 资源调用](https://docs.cloudbase.net/cloud-function/resource-integration/cloudbase)
- [SCF 响应集成限制](https://cloud.tencent.com/document/product/583/56124)
- [Sparticuz Chromium 使用说明](https://github.com/Sparticuz/chromium/blob/master/README.md)
