---
title: "精选与简报采用 AI 自动发布，评论采用多模态 AI 先审后发"
type: decision
tags: [ai, moderation, curated-feed, digests, comments, automation, packyapi]
sources: [../sources/2026-07-19-packy-grok-intelligence.md, ../sources/2026-07-19-profile-moderation-and-huifu-payment.md]
last_updated: 2026-07-19
status: accepted
confidence: high
---

# 精选与简报采用 AI 自动发布，评论采用多模态 AI 先审后发

## 背景

产品负责人明确选择全自动运行：不设置管理员逐条批准，不限制本轮模型额度；PackyAPI `grok-4.5` 负责资讯分析、精选判断、简报生成，以及会员评论文本和图片审核。

## 决策

1. 资讯分析任务由分钟触发器自动领取，单轮最多 10 条；Provider 最多五条合批。AI 分析通过确定性质量策略形成 `standard` 或 `curated` 投影，`curated` 直接进入会员精选。
2. 24h、7d、30d 简报达到各自最少来源数后由 AI 生成，并以 `status: published`、`reviewMode: ai` 直接发布。
3. 评论在写入公开评论集合前同步审核文本和最多三张图片。图片先换取短期 HTTPS URL，再与文本一起作为不可信输入发送给模型；提示词明确忽略评论中的指令注入。
4. 评论审核为 fail-closed：`reject` 不发布，`unsure`、模型不可用或图片 URL 解析失败也不发布。被拒绝的新上传评论图片立即删除，避免留下无引用文件。
5. 通过的评论只保存紧凑审核审计，包括判定、置信度、分类、短理由、Provider、模型、用量和审核时间；公开 DTO 不暴露内部审核字段。
6. 用户界面不暴露分析、生成、审核或覆盖率机制：精选/简报 DTO 不返回机制说明，简报不展示覆盖不完整告警，空状态使用“正在整理”，评论输入坞只显示“正在上传图片”或“正在发布”，服务失败也使用普通发布文案。覆盖率继续留在云端文档供运维判断；资讯主题中的“AI 前沿”和学习内容中的“AI 专栏”仍属于产品内容，不受此规则影响。
7. 用户主动选择的昵称和头像在保存公开资料前使用独立严格资料审核合同；头像先换取短期 HTTPS URL。拒绝、不确定、Provider 不可用或 URL 失败均不保存，新上传且被拒绝的头像立即删除。
8. 当前阶段明确不实现举报、评论删除、申诉或自动隐藏；它们是产品负责人暂缓的治理能力，不再作为本轮上线实现范围，但也不能据此宣称长期 UGC 治理已完整。

## 模块边界

- `adapters/intelligence-contracts.js` 定义严格的资讯、简报和评论审核 JSON Schema。
- `adapters/packy-intelligence-provider.js` 只负责 Responses 文本/图片传输、结构化输出和错误映射。
- `services/comment-moderation-service.js` 负责临时图片 URL、fail-closed 规则、审计和拒绝文件清理。
- `services/profile-moderation-service.js` 与 `services/user-profile-service.js` 负责昵称/头像审核、成功保存和未采用头像清理。
- `services/feed-analysis-worker-service.js` 与 `services/digest-generation-service.js` 分别编排分析队列和简报窗口。
- `repositories/` 只负责分析投影、简报发布和评论持久化；页面不直接依赖 Provider。

## 结果与风险

- 自动分析、简报生成、真实精选读取和真实简报读取已在生产打开；支付仍独立关闭。
- 模型失败不会把未经审核的评论公开，但会暂时阻止正常评论；客户端只对暂时不可用重试一次。
- 微信不会默认审核 `wx.cloud.uploadFile` 上传的评论图片。微信 `/wxa/media_check_async` 和 CloudBase COS 内容审核都是需要主动调用或在控制台显式启用的可选能力；当前项目没有调用微信内容安全接口，也没有配置 COS 自动审核，因此继续使用现有多模态审核，直到另行完成异步回调/冻结流程。
- 无人工复核意味着仍存在模型误判、漏判和用户申诉缺口。供应商 AUP 对外部发布的专业媒体内容提出人工复核要求，因此本决策满足产品负责人的自动化要求，但不能据此宣称供应商条款或法律合规已经完成。
- 若真实数据证明同步审核延迟不可接受，再把评论审核迁移为隔离的异步待发布队列；当前不为假设流量提前拆分云函数。

## 被替代的结论

- 取代“最近 30 天覆盖 95% 且人工抽检后才开放精选和简报”。
- 取代“图片评论公开前尚未接入内容审核”。
- 取代“前端应显示 AI 自动判断/审核披露”的界面结论；后台审计仍保留。
