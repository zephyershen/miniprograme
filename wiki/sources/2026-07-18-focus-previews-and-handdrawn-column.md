---
title: "聚焦截图与手绘 AI 专栏实施证据"
type: source
tags: [source-preview, playwright, ai-column, image-generation, wechat-devtools]
date: 2026-07-18
last_updated: 2026-07-18
status: confirmed
confidence: high
---

# 聚焦截图与手绘 AI 专栏实施证据

## 原文截图

- 公网渲染器新增 `focus-policy.js`、`media-stability.js` 和 `capture-focused.js`，分别负责正文识别、媒体稳定和正文边界裁切；`capture.js` 保留整页回退。
- 本地真实浏览器夹具结果：识别 `article` 为高置信度，头像与主图 `2/2` 就绪，裁切宽度 736px，侧栏未进入截图。
- 生产 X 状态页验证：`focus-v1` 命中目标状态，高置信度得分 12509，媒体 `2/2` 就绪，生成 1 张 622×1004 截图且未截断。
- 云函数通过 `firstObservedAt/firstStoredAt/eligibleAt` 和固定发布时间边界执行 forward-only 策略；旧视觉任务不删除，但不会进入生产 worker。
- 渲染器与 `knowledgeFeed` 均已部署。部署后分钟任务保持 `pendingVisualCount:0`，并完成 1 个符合新边界的视觉任务；缺少 `eligibleAt` 的旧任务由策略跳过。上游资讯源随后出现一次独立的 `FEED_SOURCE_FAILURE` 退避，本机直连同一 fingerprint/items 接口均为 HTTP 200，需继续由定时任务观察恢复。

## AI 专栏

- 首批六课为 Agent、Skill、MCP、Tool Call、RAG、Context；每课由 `catalog.js` 提供定义、真实例子、流程、检查项、易错点和结论。
- 用户提供的 18 张完整手绘知识海报按 Agent、Skill、MCP、Tool Call、RAG、Context 分为六组，每课三张；源图均为 1086×1448 PNG，总计 52,106,685 bytes。
- `superseded`：首轮导入生成 680×907 WebP，总计 1,682,558 bytes；开发者工具正常，但用户手机预览只出现海报容器背景。
- 当前 `scripts/import-ai-column-posters.js` 校验固定文件名和源尺寸，再生成 640×853、质量 50、4:2:0 的非渐进式基线 JPEG；18 张输出总计 1,603,890 bytes。原始 PNG 保留在 `png/`，旧 WebP 与六张 JPEG 占位图均已移除。
- `features/ai-column/assets.js` 独立维护 18 条资源路径，`catalog.js` 继续拥有课程语义，`model.js` 只组装轮播页码；页面使用整幅 `aspectFit` 海报和原生 `swiper`，不再重复渲染图片内已有的知识文字。
- 微信开发者工具实际验证 Agent 第一、第二页手动滑动以及 Skill 独立海报加载，控制台没有新增红色错误。IDE 保持打开，未结束任何开发者工具进程。
- 真机问题修复移除 `swiper` 内图片组件的 `lazy-load`，关闭淡入，并增加图片错误提示、资源 key 日志和重试提示。随后加入模型驱动的受控加载窗口：未展开 0 张，展开后“当前页 + 下一页”，滑到第二页才加载第三页；不会进入专栏就请求 18 张。需要用户扫描新预览码复验，旧预览不会自动更新。

## 回归

- `npm test`：178/178 通过。
- `npm run check`：28 个 JSON、154 个 JavaScript、10 个页面通过。
- `git diff --check`：通过。
- 海报输出核验：18/18 个文件唯一，均为 640×853 非渐进式 JPEG；项目配置排除非运行时目录后，加入受控加载窗口的 CLI `preview` 实际报告总包 1,786,530 bytes。
- 模块化复审：截图识别、媒体等待、裁切、forward-only 策略、课程语义、海报资源映射和确定性导入脚本均为独立边界；正式收费前仍需把完整专栏内容迁移到服务端重鉴权接口。

## 敏感信息处理

部署令牌、服务器凭据、维护令牌、OpenID 和派生身份未写入普通 Wiki、截图或用户可见输出；仍只保存在既有受限配置中。
