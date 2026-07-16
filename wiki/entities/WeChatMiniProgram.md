---
title: "知识获取平台微信小程序"
type: entity
tags: [wechat, miniprogram, cloud-development, knowledge-platform, editorial-index]
sources: [../sources/2026-07-13-digest-inbox-implementation.md, ../sources/2026-07-14-cloud-cleanup-and-deployment.md, ../sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, ../sources/2026-07-15-editorial-ui-implementation.md, ../sources/2026-07-15-aihot-feed-integration.md, ../sources/2026-07-16-source-preview-deployment.md]
last_updated: 2026-07-16
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
- 2026-07-16 微信开发者工具已编译并渲染分页资讯首页、原文截图详情、来源 URL 和相关阅读；来源区位于“接着看”之前，控制台无项目级红色错误。
- 当前本地回归为 90/90 个 Node 测试；项目检查覆盖 21 个 JSON、77 个 JavaScript 和 6 个页面。

## 部署状态

2026-07-14 已清理旧云业务资源并部署个人消化闭环。2026-07-15 新建 `knowledge_feed_cache` 并部署第三个 Node.js 18.15 云函数 `knowledgeFeed`；2026-07-16 增加视觉发布门禁和每 5 分钟一次的 `knowledge-feed-visual-sync`。新资讯先进入内部缓存，真实封面或原文截图准备完成后才进入首页、详情、筛选计数和相关阅读。最新部署版本已于 18:00 自动触发成功。

当前 CloudBase 套餐无法为 `hy3-preview` 扣减 Token，模型请求返回 429；应用会释放预算并返回明确标注的本地临时摘要，因此基本闭环可用，但真实 AI 摘要、翻译和相关性判断仍需开通合适套餐或配置自有模型。体验版上传仍为 `needs-review`。

AI/科技精选源已部署，具备 15 分钟缓存、来源追踪、服务端分页与筛选。当前动态池 106/106 有视觉素材：13 条真实原文封面、93 条受控原文页面截图；不存在分类视觉兜底或 AI 配图。CloudBase 负责刷新、定时编排、上传 JPEG 和公开数据，独立公网服务器通过 Playwright 与回环 Mihomo 负责渲染外站。截图失败 30 分钟后重试，并优先处理从未尝试的新条目。

该精选源不等同于重点厂商官方源分别直连；娱乐、社会、游戏和英语仍为待接入状态。当前没有已验证的外部业务域名，微信小程序也不能直接唤起任意系统浏览器，因此外部原文入口复制 URL 并提示用户到手机浏览器粘贴。

## 历史关系

旧版社区任务/二手交易项目已被替代。旧页面、函数和依赖可通过 `legacy-hyyc-704a88e` 标签回看，不应恢复到当前活跃代码。
