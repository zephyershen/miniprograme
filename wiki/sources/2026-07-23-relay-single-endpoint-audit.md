---
title: "生产中继单端点与旧节点角色复核"
type: source
tags: [source-preview, proxy, cloudbase, failover, operations]
date: 2026-07-23
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# 生产中继单端点与旧节点角色复核

## 范围

- 核对 `sourcePreviewWorker` 的线上环境配置是否仍引用旧公网节点。
- 核对截图执行代码是否存在第二中继、自动故障切换或旧节点回退。
- 明确旧公网服务器对小程序生产链路和个人代理服务的不同边界。

## 证据

- 2026-07-23 通过 CloudBase CLI 读取线上 `sourcePreviewWorker` 详情；只输出字段存在性和地址匹配布尔值，没有输出中继令牌、域名或公网地址。
- 线上函数已配置正式中继 URL 和一个固定连接地址；替换后的现行地址存在，先前地址不存在。
- `source-preview-renderer/index.js` 只读取一组 `SOURCE_PREVIEW_RELAY_URL`、`SOURCE_PREVIEW_RELAY_ADDRESS` 和共享令牌；没有第二 URL、第二地址或自动旧节点回退字段。
- X/区域受限页面的有界路线会在当前中继失败后尝试 CloudBase 直连路径，但该直连路径不等于旧公网服务器，且历史上对 X 并不稳定。

## 当前结论

- 对小程序生产截图链路而言，旧公网服务器已经不在使用，也不是自动备用机；生产只指向当前替换后的公网中继。
- 在当前配置下关闭旧服务器不会改变小程序请求路径；新中继宕机时不会自动切回旧服务器，只会尝试代码内的 CloudBase 直连路线并让失败任务进入重试/文字降级。
- 旧服务器若仍承载个人 Clash/Mihomo、订阅或其他非小程序服务，是否可以停机必须按那些服务单独确认，不能从小程序配置推出。
- 若要把旧节点变成真正高可用备用，需要显式实现第二组中继配置和健康失败切换；在固定连接地址仍启用时，仅修改 DNS 不能完成自动切换。

## 敏感信息

本页不记录公网 IP、正式代理域名、SSH 凭据、中继令牌、CloudBase 凭据或环境变量实际值。
