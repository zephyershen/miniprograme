---
title: "微信开发者工具 CLI 优先工作流"
type: concept
tags: [wechat, devtools, cli, automation, local-development]
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 微信开发者工具 CLI 优先工作流

## 长期规则

后续在本项目中启动、打开、验证、预览、上传和构建微信小程序时，默认优先使用微信开发者工具 CLI。图形界面只用于扫码登录、验证码、权限确认、审核确认和必须由用户目视判断的真机/模拟器交互，不再把人工打开开发者工具作为常规前置步骤。

CloudBase 函数、数据库和云资源操作继续使用 `cloudbase.cmd`；代码版本控制继续使用 Git。微信开发者工具 CLI 不替代这两类工具。

## 本机已验证配置

- CLI：`D:\Apps\miniprogram\cli.bat`
- 项目：`D:\miniprogram`
- 自动化端口：`9420`
- 网络边界：只允许监听 `127.0.0.1:9420`，不得暴露到局域网或公网
- 验证版本：Stable `2.01.2510290`；开发者工具升级后必须重新核对路径、版本和端口

标准启动或接管命令：

```powershell
& 'D:\Apps\miniprogram\cli.bat' auto --project 'D:\miniprogram' --port 9420 --trust-project
```

标准验证命令：

```powershell
& 'D:\Apps\miniprogram\cli.bat' islogin --project 'D:\miniprogram' --port 9420
& 'D:\Apps\miniprogram\cli.bat' open --project 'D:\miniprogram' --port 9420
Get-NetTCPConnection -State Listen -LocalPort 9420
```

当前已验证 `auto`、`open` 和 `islogin` 可用，登录状态为已登录，端口只在本机回环地址监听。

## 常规执行顺序

1. 先检查 `9420` 是否在 `127.0.0.1` 监听。
2. 未监听时执行标准 `auto` 命令；开发者工具已开但未启用端口时，先正常关闭窗口，避免强制结束进程造成未保存内容丢失，再由 CLI 重启。
3. 使用 `islogin` 验证登录状态。扫码或验证码只能交给用户完成；完成后继续 CLI 流程。
4. 使用 `open`、`preview`、`upload`、`build-npm` 等 CLI 子命令执行对应操作；上传体验版仍需遵守用户明确授权和微信平台审核边界。
5. 每次 CLI 操作后检查 `git status` 与目标页面；只提交任务要求的改动。

## 故障恢复

- 若状态文件显示服务端口已开启，但 `9420` 没有监听，说明本地状态与实际进程发生漂移。正常关闭开发者工具后重新执行标准 `auto` 命令，并在 CLI 的启用服务端口提示中确认。
- 若端口超时，不要直接暴露新端口或关闭防火墙；先确认开发者工具进程、端口占用和回环监听状态。
- `open` 可能机械重排 `project.config.json`。执行后必须检查差异；没有业务含义的格式漂移应还原，不能夹带进功能提交。
- 不记录或传播自动化握手值、会话标识、临时令牌、用户数据目录或其他短期运行信息。

## 人工边界

以下环节继续由用户操作或确认：微信扫码登录、拖动/短信验证码、账号权限授权、平台审核确认、支付或付费开通，以及需要主观判断的真机视觉验收。除此之外，能由 CLI 稳定完成的开发者工具操作都按本工作流自动执行。
