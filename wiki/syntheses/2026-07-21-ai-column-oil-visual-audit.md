---
title: "AI 专栏 72 张 Oil Visual 图片的 Packy 多模态审核"
type: synthesis
tags: [ai-column, oil-visual, packy, image-audit, quality]
sources: [../sources/2026-07-19-packy-grok-intelligence.md, ../decisions/2026-07-20-cloudbase-ai-primary-packy-fallback.md]
date: 2026-07-21
last_updated: 2026-07-21
status: confirmed
confidence: high
---

# AI 专栏 72 张 Oil Visual 图片的 Packy 多模态审核

## 范围与方法

- 审核目录：`D:\files\miniprogram\AI专栏24课手绘图_oil-visual_20260721`
- 提示词：`D:\files\miniprogram\AI专栏24课手绘图生成提示词.md`
- 使用项目既有 PackyAPI Responses 多模态链路与 `grok-4.5`，每批三张、严格 JSON Schema 输出；本机密钥仅在运行时读取，未写入脚本、日志或本页。
- 审核维度：火柴人和边境牧羊犬的肢体/脸部完整性，提示词核心机制与证据是否完整，文字和数据是否影响使用，以及标题、边距、水印等可用性。
- 火柴人的细线四肢、遮挡和多步骤中重复出现的边牧不按真实人体标准误判；只有多余/缺失/融合肢体等实质问题才要求替换。

## 结果

- 首轮 72 张结构化审核：70 张直接通过，2 张进入人工原图复核。
- `03-hallucination-02.png`：确认同一火柴人因同时持三把放大镜出现额外手臂。已保持主题不变，把三把放大镜改为独立桌面支架，并明确主角只有两条正常手臂；通过同一 ChatGPT 单会话脚本重新生成并覆盖。Packy 单图复审结果为 `pass`，内容评分 9/10、置信度 0.93。
- `12-acceptance-01.png`：首轮模型产生自相矛盾的文字误判。原图已清楚呈现左侧“看起来不错”、右侧“逐项检查”以及清单下角揭开的橙色隐藏错误，人物肢体正常。单图复审结果为 `pass`，内容评分 9/10、置信度 0.93，因此未替换。
- `02-context-02.png` 首轮内容评分 7/10，但人物正常，右侧文档、读者群和检查表三个物件已分别表达上一版、目标读者和修改要求；结合“资料完整”与左右对比可在十秒内理解，保留现图。
- 最终 Packy 记录：72/72 `pass`。

## 最终验证

- 72 个 PNG 与提示词文件名一一对应，无缺失、无多余、无无法读取文件、无重复哈希。
- 所有图片统一为 1086×1448；替换图生成后的 1–2 像素偏差已做高质量机械校正。
- ChatGPT 浏览器自动化保持单会话、逐张生成、下载后暂停；自动下载产生的额外标签页在收尾时关闭。

## 可复用工具

- ChatGPT 生图主脚本：`C:\Users\shenz\Documents\Codex\2026-07-21\new-chat\work\playwright\slow_chatgpt_images.ps1`
- Packy 审核脚本：`C:\Users\shenz\Documents\Codex\2026-07-21\new-chat\work\packy_image_audit.js`
- Packy 结构化结果：`C:\Users\shenz\Documents\Codex\2026-07-21\new-chat\work\packy-image-audit-results.json`
