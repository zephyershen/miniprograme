---
title: "Luma UI 重构与模拟器验证证据"
type: source
tags: [source, ui, visual-validation, wechat-devtools]
date: 2026-07-17
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# Luma UI 重构与模拟器验证证据

## 来源与范围

- 用户提供的资讯首页、资讯详情和“我的”页截图及本次明确反馈。
- 当前仓库 `D:\miniprogram` 的九个页面、全局样式、四 Tab 配置和既有自动化测试。
- Apple 官方 Human Interface Guidelines 的 Design principles、Materials、Typography、Layout 与 UI Design Dos and Don’ts。
- 微信开发者工具 Stable `2.01.2510290`、CLI 回环服务与小程序自动化截图。

## 视觉计划

- 色彩：珍珠画布 `#f3f4f8`、实体表面 `#ffffff`、石墨正文 `#17181d`、中性灰 `#686d7a`、鸢尾焦点 `#5b5ce2`。
- 字体：中文显示与正文使用系统字体/苹方回退；数字和小型英文信息使用 `DIN Alternate` 回退。
- 布局：顶部频道、筛选、排序合并为悬浮控制表面；头条、列表、摘要、权益和设置按内容责任形成柔和实体表面。
- 记忆点：高价值内容和选中状态使用一次性的蓝紫“知识光谱”微光，其余区域保持低饱和。

## 代码变化

- 新增 `hyyc/styles/design-tokens.wxss`，删除旧 `editorial-tokens.wxss`。
- `app.wxss` 统一页面背景、圆角、阴影、按钮、卡片、弹层与输入原语。
- 重构九个页面的 WXSS；WXML 事件、JS、feature 模块、服务和云函数均未改变。
- 原生 Tab 仍为资讯、精选、简报、我的，只调整系统颜色。

## 验证结果

- `npm.cmd test`：170/170 通过。
- `npm.cmd run check`：27 个 JSON、143 个 JavaScript、9 个页面通过。
- `git diff --check`：通过，仅有既有 LF/CRLF 提示。
- 微信开发者工具 `islogin`、`open`、自动化连接成功；首页实际加载真实资讯，详情可从头条打开。
- 自动化截图覆盖资讯首页、资讯详情、精选、简报和我的；页面异常事件为 0。
- 首轮截图发现三身份分段按钮受原生最小宽度影响而溢出；改为 flex 等分并复拍，三个按钮宽度一致且全部位于 328px 容器内。
- 验证图片：`output/playwright/wechat-luma-home.png`、`wechat-luma-detail.png`、`wechat-luma-curated.png`、`wechat-luma-briefing.png`、`wechat-luma-profile.png`。
- 临时 `9421` 自动化进程在截图后停止；项目固定服务端口继续只监听 `127.0.0.1:9420`。

## 边界

- 未部署云函数、未修改集合、权限、索引、线上数据或支付/AI 开关。
- 未上传体验版；不同真机字体栅格、系统字号和透明度设置仍需发布前人工抽查。
