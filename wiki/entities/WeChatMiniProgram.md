---
title: "别收藏了微信小程序"
type: entity
tags: [wechat, miniprogram, cloud-development, digest-inbox]
sources: [../sources/2026-07-13-digest-inbox-implementation.md]
last_updated: 2026-07-13
status: confirmed
confidence: high
---

# 别收藏了微信小程序

## 它是什么

使用原生 WXML、WXSS、JavaScript 和微信云开发构建的个人体验版小程序，用于把已经看到的公开文章变成可以丢弃或保留的一次性结论。

## 身份与位置

- 正式仓库：`D:\miniprogramcode\miniprogram`
- 小程序代码：`D:\miniprogramcode\miniprogram\hyyc`
- 项目配置：`D:\miniprogramcode\miniprogram\project.config.json`
- AppID：`wxcb0f641838abf6e6`
- 云环境：`hyyc-1gi3f5sqc5becabf`
- Git 远程：`git@github.com:zephyershen/miniprograme.git`

## 运行依赖

- 微信小程序基础库 `3.12.0`
- Node.js 18 云函数
- `wx-server-sdk`、`@cloudbase/node-sdk`、`@mozilla/readability`、`jsdom`
- CloudBase 内置大模型；部署前必须核对环境中实际可用的模型名

## 数据与权限

- 前端不传 OpenID，身份只由云函数上下文提供。
- 当前 `app.json` 不声明定位、通讯录、相册、摄像头或其他旧业务权限。
- 剪贴板只在用户点击按钮时读取。
- 真实密钥只能留在云环境变量或受限配置中；普通 Wiki 和仓库不保存密钥值。

## 部署状态

本地源代码和测试已完成；线上云资源、开发者工具编译、真机预览和体验版上传仍为 `needs-review`，不能把本地通过视为已经部署。

## 历史关系

旧版社区任务/二手交易项目已被替代。旧页面、函数和依赖可通过 `legacy-hyyc-704a88e` 标签回看，不应恢复到当前活跃代码。
