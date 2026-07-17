---
title: "知识获取平台微信小程序"
type: entity
tags: [wechat, miniprogram, cloud-development, knowledge-platform, editorial-index]
sources: [../sources/2026-07-13-digest-inbox-implementation.md, ../sources/2026-07-14-cloud-cleanup-and-deployment.md, ../sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, ../sources/2026-07-15-editorial-ui-implementation.md, ../sources/2026-07-15-aihot-feed-integration.md, ../sources/2026-07-16-source-preview-deployment.md, ../sources/2026-07-17-full-feed-admin-and-capacity.md]
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 知识获取平台微信小程序

## 它是什么

使用原生 WXML、WXSS、JavaScript 和微信云开发构建的编辑型知识获取平台。目标频道覆盖 AI、科技、娱乐、社会、游戏和英语；当前首页已接入近 7 天 AI/科技全量资讯，并复用已验证的公开文章导入、摘要、取舍和收藏闭环。

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
- 当前业务集合只由云函数访问；公共资讯缓存与按日历史归档都不保存用户身份。
- 普通用户由云函数限制近 7 天，人工 Pro 为 30 天，管理员查看项目全部已归档数据；角色由 OpenID 的 SHA-256 派生键、独立会员记录和管理员授权决定，管理员优先。当前唯一微信账号已授予管理员角色，普通 Wiki 不记录其身份哈希。

## 如何运行与验证

- 默认使用 `D:\Apps\miniprogram\cli.bat auto --project D:\miniprogram --port 9420 --trust-project` 启动或接管微信开发者工具；端口只监听 `127.0.0.1`。完整启动、验证和恢复步骤见 [微信开发者工具 CLI 优先工作流](../concepts/WeChatDevToolsCLI.md)。
- 小程序根目录由 `project.config.json` 指向 `hyyc/`；扫码、验证码、权限和审核确认仍由用户完成。
- 本地执行 `npm test` 与 `npm run check`。
- 真实微信上下文的已验证闭环：保存关注方向、导入公开文章、查看摘要、保留卡片、核对统计、清除个人数据。
- 2026-07-16 微信开发者工具已编译并渲染分页资讯首页、原文截图详情、来源 URL 和相关阅读；来源区位于“接着看”之前，控制台无项目级红色错误。
- 当前本地回归为 170/170 个 Node 测试；项目检查覆盖 27 个 JSON、143 个 JavaScript 和 9 个页面。

## 部署状态

2026-07-14 已清理旧云业务资源并部署个人消化闭环。2026-07-15 部署第三个 Node.js 18.15 云函数 `knowledgeFeed`；2026-07-17 新部署受维护令牌保护、无触发器的 `knowledgeOps`。当前单一 `knowledge-feed-source-sync` 每分钟查指纹，变化时刷新全量条目；没有图片的资讯也可进入首页，同时由 `knowledge_feed_visual_jobs` 在后台持续补图。

当前 CloudBase 套餐无法为 `hy3-preview` 扣减 Token，模型请求返回 429；应用会释放预算并返回明确标注的本地临时摘要，因此基本闭环可用，但真实 AI 摘要、翻译和相关性判断仍需开通合适套餐或配置自有模型。体验版上传仍为 `needs-review`。

AI/科技全量源已部署，具备每分钟指纹检查、6 小时条目条件校验、24 小时完整刷新、持久化退避、分布式租约、来源追踪、服务端分页与计数矩阵。CloudBase 负责条目/日索引/视觉任务存储、角色权益、定时编排和上传 JPEG；独立公网服务器通过 Playwright 与回环 Mihomo 负责渲染外站。实时视觉任务优先于历史，worker 每分钟最多处理 2 条；详情只挂载当前及相邻截图，自动播放一轮后停止，仍可手动滑动并整组全屏查看。

SCF 平台可为一个函数绑定多个触发器；当前线上只保留一个分钟触发器，是为规避 CloudBase CLI 3.6.1 的单触发器配置与列表覆盖行为。会员架构现为普通 7 天、Pro 30 天、管理员全部归档；四个新增会员/智能集合为 `ADMINONLY`，条目、队列和简报复合索引已创建。真实 AI 精选、简报和支付仍关闭。

该精选源不等同于重点厂商官方源分别直连；娱乐、社会、游戏和英语仍为待接入状态。当前没有已验证的外部业务域名，微信小程序也不能直接唤起任意系统浏览器，因此外部原文入口复制 URL 并提示用户到手机浏览器粘贴。

## 历史关系

旧版社区任务/二手交易项目已被替代。旧页面、函数和依赖可通过 `legacy-hyyc-704a88e` 标签回看，不应恢复到当前活跃代码。
