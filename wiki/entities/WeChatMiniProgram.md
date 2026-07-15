---
title: "知识获取平台微信小程序"
type: entity
tags: [wechat, miniprogram, cloud-development, knowledge-platform, editorial-index]
sources: [../sources/2026-07-13-digest-inbox-implementation.md, ../sources/2026-07-14-cloud-cleanup-and-deployment.md, ../sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, ../sources/2026-07-15-editorial-ui-implementation.md, ../sources/2026-07-15-aihot-feed-integration.md]
last_updated: 2026-07-15
status: confirmed
confidence: high
---

# 知识获取平台微信小程序

## 它是什么

使用原生 WXML、WXSS、JavaScript 和微信云开发构建的编辑型知识获取平台。目标频道覆盖 AI、科技、娱乐、社会、游戏和英语；当前首页已接入 AI HOT 的 AI/科技精选图文流，并复用已验证的公开文章导入、摘要、取舍和收藏闭环。

## 身份与位置

- 当前工作仓库：`D:\miniprogram`
- 小程序代码：`D:\miniprogram\hyyc`
- 项目配置：`D:\miniprogram\project.config.json`
- 云部署配置：`D:\miniprogram\cloudbaserc.json`
- AppID：`wxcb0f641838abf6e6`
- 云环境：`hyyc-1gi3f5sqc5becabf`
- Git 远程：`https://github.com/zephyershen/miniprograme.git`

## 运行依赖

- 微信小程序基础库 `3.12.0`
- Node.js 18.15 云函数
- `wx-server-sdk`、`@cloudbase/node-sdk`、`@mozilla/readability`、`jsdom`、`ws@8.21.0`
- CloudBase 大模型组 `hunyuan-v3`，默认模型 `hy3-preview`

## 数据与权限

- 前端不传 OpenID，身份只由云函数上下文提供。
- 当前 `app.json` 不声明定位、通讯录、相册、摄像头或其他旧业务权限。
- 剪贴板只在用户点击按钮时读取。
- 真实密钥只能留在云环境变量或受限配置中；普通 Wiki 和仓库不保存密钥值。
- 6 个当前集合均为 `ADMINONLY`，只由云函数访问；公共资讯缓存不保存用户身份。

## 如何运行与验证

- 在微信开发者工具打开 `D:\miniprogram`，小程序根目录由 `project.config.json` 指向 `hyyc/`。
- 本地执行 `npm test` 与 `npm run check`。
- 真实微信上下文的已验证闭环：保存关注方向、导入公开文章、查看摘要、保留卡片、核对统计、清除个人数据。
- 2026-07-15 微信开发者工具已编译并渲染 AI HOT 20 条图文内容、横向频道、主稿和非卡片式内容结构；本地测试为 41/41。

## 部署状态

2026-07-14 已清理旧云业务资源并部署个人消化闭环。2026-07-15 新建 `knowledge_feed_cache`、部署第三个 Node.js 18.15 云函数 `knowledgeFeed`，并在微信开发者工具中确认 AI HOT 20 条公共资讯渲染；个人闭环验证数据此前已清除。

当前 CloudBase 套餐无法为 `hy3-preview` 扣减 Token，模型请求返回 429；应用会释放预算并返回明确标注的本地临时摘要，因此基本闭环可用，但真实 AI 摘要、翻译和相关性判断仍需开通合适套餐或配置自有模型。体验版上传仍为 `needs-review`。

AI HOT 精选源已部署，具备 15 分钟缓存、来源追踪、7 张真实原文封面和分类视觉兜底。它目前只覆盖 AI/科技，也不等同于重点厂商官方源分别直连；其他四个频道仍为待接入状态。

## 历史关系

旧版社区任务/二手交易项目已被替代。旧页面、函数和依赖可通过 `legacy-hyyc-704a88e` 标签回看，不应恢复到当前活跃代码。
